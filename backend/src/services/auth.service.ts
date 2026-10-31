import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { OAuth2Client, type Credentials } from 'google-auth-library'
import { Prisma } from '../generated/prisma/client'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { redisConnection } from '../config/redis'

const GOOGLE_STATE_TTL_SECONDS = 600
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
export const SESSION_COOKIE_NAME = 'reachinbox_session'
export const OAUTH_STATE_COOKIE_NAME = 'reachinbox_google_state'

const consumeStateScript = `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value
`

interface GoogleProfile {
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
}

interface SessionPayload {
  sub: string
  exp: number
}

export class AuthServiceError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'AuthServiceError'
  }
}

export async function createGoogleAuthorizationUrl(): Promise<{ url: string; state: string }> {
  const clientId = requiredSetting(env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID')
  requiredSetting(env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET')
  assertSessionConfiguration()
  const state = randomBytes(32).toString('hex')
  const nonce = randomBytes(32).toString('hex')
  const stored = await redisConnection.set(googleStateKey(state), nonce, 'EX', GOOGLE_STATE_TTL_SECONDS, 'NX')
  if (stored !== 'OK') throw new AuthServiceError('Could not start Google sign-in. Please try again.', 503)

  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email',
    state,
    nonce,
  }).toString()
  return { url: authorizationUrl.toString(), state }
}

export function oauthStateCookieHeader(state: string): string {
  const attributes = [
    `${OAUTH_STATE_COOKIE_NAME}=${state}`,
    'Path=/api/auth/google',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${GOOGLE_STATE_TTL_SECONDS}`,
  ]
  if (env.NODE_ENV === 'production') attributes.push('Secure')
  return attributes.join('; ')
}

export function expiredOAuthStateCookieHeader(): string {
  return `${OAUTH_STATE_COOKIE_NAME}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

export function requestHasMatchingOAuthState(cookieHeader: string | undefined, state: string): boolean {
  if (!cookieHeader) return false
  const pair = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${OAUTH_STATE_COOKIE_NAME}=`))
  return pair?.slice(OAUTH_STATE_COOKIE_NAME.length + 1) === state
}

export async function consumeGoogleOAuthState(state: string): Promise<string | null> {
  const result: unknown = await redisConnection.eval(consumeStateScript, 1, googleStateKey(state))
  return typeof result === 'string' ? result : null
}

export async function authenticateGoogleCode(code: string, expectedNonce: string): Promise<{ id: string }> {
  const clientId = requiredSetting(env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID')
  const clientSecret = requiredSetting(env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET')
  try {
    const oauthClient = new OAuth2Client(clientId, clientSecret, env.GOOGLE_REDIRECT_URI)
    let tokens: Credentials
    try {
      ({ tokens } = await oauthClient.getToken(code))
    } catch (error) {
      logGoogleOAuthFailure('token_exchange', safeGoogleOAuthErrorCode(error))
      throw new AuthServiceError('Google sign-in could not be completed. Please try again.', 502)
    }
    if (!tokens.id_token) {
      logGoogleOAuthFailure('identity_token', 'id_token_missing')
      throw new AuthServiceError('Google did not return a verified identity token.', 401)
    }
    let ticket
    try {
      ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: clientId })
    } catch {
      logGoogleOAuthFailure('identity_verification', 'id_token_invalid')
      throw new AuthServiceError('Google did not return a verified email profile.', 401)
    }
    const claims = ticket.getPayload()
    if (!claims || claims.nonce !== expectedNonce) {
      logGoogleOAuthFailure('identity_validation', 'nonce_mismatch')
      throw new AuthServiceError('Google did not return a verified email profile.', 401)
    }
    if (!isGoogleProfile(claims)) {
      logGoogleOAuthFailure('identity_validation', 'profile_claims_invalid')
      throw new AuthServiceError('Google did not return a verified email profile.', 401)
    }
    try {
      return await findOrCreateGoogleUser(claims)
    } catch (error) {
      const reason = error instanceof AuthServiceError && error.statusCode === 409
        ? 'account_conflict'
        : prismaFailureCode(error) ?? 'user_persistence_failed'
      logGoogleOAuthFailure('user_persistence', reason)
      throw error
    }
  } catch (error) {
    if (error instanceof AuthServiceError) throw error
    throw new AuthServiceError('Google sign-in could not be completed. Please try again.', 502)
  }
}

function logGoogleOAuthFailure(stage: string, reason: string): void {
  console.warn(JSON.stringify({ level: 'warn', event: 'google_oauth_authentication_failed', stage, reason }))
}

function safeGoogleOAuthErrorCode(error: unknown): string {
  if (!isRecord(error)) return 'provider_request_failed'
  const response = isRecord(error.response) ? error.response : undefined
  const data = response && isRecord(response.data) ? response.data : undefined
  const providerCode = typeof data?.error === 'string'
    ? data.error
    : typeof error.code === 'string' ? error.code : undefined
  const allowedCodes = new Set([
    'invalid_grant', 'redirect_uri_mismatch', 'invalid_client', 'unauthorized_client',
    'invalid_request', 'invalid_scope', 'access_denied', 'temporarily_unavailable',
  ])
  return providerCode && allowedCodes.has(providerCode) ? providerCode : 'provider_request_failed'
}

function prismaFailureCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== 'string' || !/^P\d{4}$/.test(error.code)) return undefined
  return error.code
}

async function findOrCreateGoogleUser(profile: GoogleProfile): Promise<{ id: string }> {
  const email = profile.email.trim().toLowerCase()
  const googleUser = await prisma.user.findUnique({ where: { googleId: profile.sub } })
  const emailUser = await prisma.user.findUnique({ where: { email } })
  if (googleUser && emailUser && googleUser.id !== emailUser.id) {
    throw new AuthServiceError('This Google account conflicts with an existing application account.', 409)
  }

  const data = {
    email,
    googleId: profile.sub,
    name: profile.name?.trim() || email,
    avatarUrl: safeImageUrl(profile.picture),
  }
  if (googleUser) return prisma.user.update({ where: { id: googleUser.id }, data, select: { id: true } })
  if (emailUser) {
    if (emailUser.googleId && emailUser.googleId !== profile.sub) {
      throw new AuthServiceError('This email is already linked to another Google account.', 409)
    }
    return prisma.user.update({ where: { id: emailUser.id }, data, select: { id: true } })
  }

  try {
    return await prisma.user.create({ data, select: { id: true } })
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const concurrentUser = await prisma.user.findFirst({ where: { OR: [{ googleId: profile.sub }, { email }] } })
    if (!concurrentUser || (concurrentUser.googleId && concurrentUser.googleId !== profile.sub)) {
      throw new AuthServiceError('This Google account conflicts with an existing application account.', 409)
    }
    return prisma.user.update({ where: { id: concurrentUser.id }, data, select: { id: true } })
  }
}

export function createSessionToken(userId: string): string {
  const secret = sessionSecret()
  const payload: SessionPayload = { sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

export function assertSessionConfiguration(): void {
  sessionSecret()
}

export function verifySessionToken(token: string): string | null {
  try {
    const [encodedPayload, signature, extra] = token.split('.')
    if (!encodedPayload || !signature || extra !== undefined) return null
    const expected = createHmac('sha256', sessionSecret()).update(encodedPayload).digest()
    const supplied = Buffer.from(signature, 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!isRecord(payload) || typeof payload.sub !== 'string' || !isUuid(payload.sub)
      || typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null
    return payload.sub
  } catch {
    return null
  }
}

export function sessionCookieHeader(token: string): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
  if (env.NODE_ENV === 'production') attributes.push('Secure')
  return attributes.join('; ')
}

export function expiredSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

export function getSessionUserId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  const pair = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!pair) return null
  return verifySessionToken(pair.slice(SESSION_COOKIE_NAME.length + 1))
}

export function sessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS
}

function requiredSetting(value: string | undefined, name: string): string {
  if (!value) throw new AuthServiceError(`${name} is not configured on the backend.`, 503)
  return value
}

function sessionSecret(): string {
  const secret = requiredSetting(env.AUTH_SESSION_SECRET, 'AUTH_SESSION_SECRET')
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new AuthServiceError('AUTH_SESSION_SECRET must contain at least 32 bytes.', 503)
  }
  return secret
}

function googleStateKey(state: string): string {
  return `google:oauth:state:${state}`
}

function isGoogleProfile(value: unknown): value is GoogleProfile {
  return isRecord(value)
    && typeof value.sub === 'string' && value.sub.length > 0 && value.sub.length <= 255
    && typeof value.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
    && value.email_verified === true
    && (value.name === undefined || typeof value.name === 'string')
    && (value.picture === undefined || typeof value.picture === 'string')
}

function safeImageUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
