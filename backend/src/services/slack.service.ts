import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { redisConnection } from '../config/redis'

const OAUTH_STATE_TTL_SECONDS = 600
const SLACK_API_TIMEOUT_MS = 10_000
const MIN_NOTIFICATION_COOLDOWN_SECONDS = 60
const MAX_NOTIFICATION_COOLDOWN_SECONDS = 60 * 60

const consumeStateScript = `
local userId = redis.call('GET', KEYS[1])
if userId then redis.call('DEL', KEYS[1]) end
return userId
`

export interface SlackConnectionMetadata {
  connected: boolean
  teamId?: string
  teamName?: string
  slackUserId?: string
  connectedAt?: Date
}

export interface RateLimitSlackNotification {
  userId: string
  emailJobId: string
  senderAccountId: string
  senderEmail: string
  limitTypes: Array<'global' | 'sender' | 'minimum-delay'>
  currentGlobalCount: number
  currentSenderCount: number
  globalLimit: number
  senderLimit: number
  nextScheduledAt: Date
  retryAfterMs: number
}

interface SlackOAuthTokenResponse {
  accessToken: string
  teamId: string
  teamName?: string
  slackUserId?: string
}

export class SlackServiceError extends Error {
  constructor(message: string, readonly statusCode = 500) {
    super(message)
    this.name = 'SlackServiceError'
  }
}

export async function createOAuthAuthorizationUrl(userId: string): Promise<string> {
  const clientId = requireSetting(env.SLACK_CLIENT_ID, 'SLACK_CLIENT_ID')
  const redirectUri = requireSetting(env.SLACK_REDIRECT_URI, 'SLACK_REDIRECT_URI')
  const state = randomBytes(32).toString('hex')
  const stored = await redisConnection.set(oauthStateKey(state), userId, 'EX', OAUTH_STATE_TTL_SECONDS, 'NX')
  if (stored !== 'OK') throw new SlackServiceError('Could not create Slack OAuth state', 503)

  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', normalizedScopes())
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function consumeOAuthState(state: string): Promise<string | null> {
  const result: unknown = await redisConnection.eval(
    consumeStateScript,
    1,
    oauthStateKey(state),
  )
  if (typeof result === 'string') return result
  return null
}

export async function exchangeOAuthCode(code: string): Promise<SlackOAuthTokenResponse> {
  const clientId = requireSetting(env.SLACK_CLIENT_ID, 'SLACK_CLIENT_ID')
  const clientSecret = requireSetting(env.SLACK_CLIENT_SECRET, 'SLACK_CLIENT_SECRET')
  const redirectUri = requireSetting(env.SLACK_REDIRECT_URI, 'SLACK_REDIRECT_URI')
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })

  let response: Response
  try {
    response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(SLACK_API_TIMEOUT_MS),
    })
  } catch {
    throw new SlackServiceError('Slack OAuth service is unavailable', 502)
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(payload) || payload.ok !== true || typeof payload.access_token !== 'string') {
    throw new SlackServiceError('Slack authorization could not be completed', 502)
  }

  const team = isRecord(payload.team) ? payload.team : undefined
  const authedUser = isRecord(payload.authed_user) ? payload.authed_user : undefined
  if (!team || typeof team.id !== 'string') {
    throw new SlackServiceError('Slack returned incomplete workspace information', 502)
  }

  return {
    accessToken: payload.access_token,
    teamId: team.id,
    ...(typeof team.name === 'string' ? { teamName: team.name } : {}),
    ...(authedUser && typeof authedUser.id === 'string' ? { slackUserId: authedUser.id } : {}),
  }
}

export async function completeOAuthConnection(userId: string, code: string): Promise<SlackConnectionMetadata> {
  const tokenEncryptionKey = requireSetting(env.SLACK_TOKEN_ENCRYPTION_KEY, 'SLACK_TOKEN_ENCRYPTION_KEY')
  if (Buffer.byteLength(tokenEncryptionKey, 'utf8') < 32) {
    throw new SlackServiceError('SLACK_TOKEN_ENCRYPTION_KEY must contain at least 32 bytes', 503)
  }

  const tokenResponse = await exchangeOAuthCode(code)
  const connection = await prisma.slackConnection.upsert({
    where: { userId },
    create: {
      userId,
      teamId: tokenResponse.teamId,
      teamName: tokenResponse.teamName,
      slackUserId: tokenResponse.slackUserId,
      encryptedAccessToken: encryptAccessToken(tokenResponse.accessToken, tokenEncryptionKey),
    },
    update: {
      teamId: tokenResponse.teamId,
      teamName: tokenResponse.teamName,
      slackUserId: tokenResponse.slackUserId,
      encryptedAccessToken: encryptAccessToken(tokenResponse.accessToken, tokenEncryptionKey),
      connectedAt: new Date(),
    },
    select: { teamId: true, teamName: true, slackUserId: true, connectedAt: true },
  })

  return {
    connected: true,
    ...(connection.teamId ? { teamId: connection.teamId } : {}),
    ...(connection.teamName ? { teamName: connection.teamName } : {}),
    ...(connection.slackUserId ? { slackUserId: connection.slackUserId } : {}),
    connectedAt: connection.connectedAt,
  }
}

export async function getSlackConnection(userId: string): Promise<SlackConnectionMetadata> {
  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
    select: { teamId: true, teamName: true, slackUserId: true, connectedAt: true },
  })
  if (!connection) return { connected: false }
  return {
    connected: true,
    ...(connection.teamId ? { teamId: connection.teamId } : {}),
    ...(connection.teamName ? { teamName: connection.teamName } : {}),
    ...(connection.slackUserId ? { slackUserId: connection.slackUserId } : {}),
    connectedAt: connection.connectedAt,
  }
}

export async function disconnectSlack(userId: string): Promise<void> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } })
  await prisma.slackConnection.deleteMany({ where: { userId } })
  if (!connection) return

  try {
    await revokeSlackToken(decryptAccessToken(connection.encryptedAccessToken))
  } catch {
    console.warn(JSON.stringify({ level: 'warn', event: 'slack_token_revoke_failed', userId }))
  }
}

export async function sendSlackMessage(userId: string, text: string): Promise<void> {
  const channelId = requireSetting(env.SLACK_NOTIFICATION_CHANNEL_ID, 'SLACK_NOTIFICATION_CHANNEL_ID')
  const connection = await prisma.slackConnection.findUnique({ where: { userId } })
  if (!connection) throw new SlackServiceError('Slack is not connected for this application user', 409)
  const token = decryptAccessToken(connection.encryptedAccessToken)

  let response: Response
  try {
    response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: channelId, text }),
      signal: AbortSignal.timeout(SLACK_API_TIMEOUT_MS),
    })
  } catch {
    throw new SlackServiceError('Slack messaging service is unavailable', 502)
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    throw new SlackServiceError('Slack rejected the notification', 502)
  }
}

export async function notifyRateLimit(notification: RateLimitSlackNotification): Promise<void> {
  const applicableLimits = notification.limitTypes.filter((type): type is 'global' | 'sender' => type !== 'minimum-delay')
  if (applicableLimits.length === 0) return

  for (const limitType of new Set(applicableLimits)) {
    const scope = limitType === 'global' ? 'global' : `sender:${notification.senderAccountId}`
    const cooldownKey = `slack:rate-limit-notification:${notification.userId}:${scope}`
    const cooldownSeconds = Math.min(
      MAX_NOTIFICATION_COOLDOWN_SECONDS,
      Math.max(MIN_NOTIFICATION_COOLDOWN_SECONDS, Math.ceil(notification.retryAfterMs / 1000)),
    )

    try {
      const acquired = await redisConnection.set(cooldownKey, String(Date.now()), 'EX', cooldownSeconds, 'NX')
      if (acquired !== 'OK') continue

      const limitDescription = limitType === 'global' ? 'global hourly limit' : 'sender hourly limit'
      const currentCount = limitType === 'global' ? notification.currentGlobalCount : notification.currentSenderCount
      const configuredLimit = limitType === 'global' ? notification.globalLimit : notification.senderLimit
      const message = [
        `ReachInbox rate limit reached (${limitDescription}).`,
        `Sender: ${notification.senderEmail} (${notification.senderAccountId})`,
        `Email job: ${notification.emailJobId}`,
        `Usage: ${currentCount}/${configuredLimit} in the current hour.`,
        `Rescheduled for: ${notification.nextScheduledAt.toISOString()}`,
      ].join('\n')
      await sendSlackMessage(notification.userId, message)
      console.info(JSON.stringify({ level: 'info', event: 'slack_rate_limit_notification_sent', userId: notification.userId, limitType }))
    } catch {
      console.warn(JSON.stringify({ level: 'warn', event: 'slack_rate_limit_notification_failed', userId: notification.userId, limitType }))
    }
  }
}

function normalizedScopes(): string {
  return env.SLACK_SCOPES.split(/[\s,]+/).filter(Boolean).join(',') || 'chat:write'
}

function requireSetting(value: string | undefined, name: string): string {
  if (!value) throw new SlackServiceError(`${name} is not configured`, 503)
  return value
}

function oauthStateKey(state: string): string {
  return `slack:oauth:state:${state}`
}

function encryptionKey(): Buffer {
  const secret = requireSetting(env.SLACK_TOKEN_ENCRYPTION_KEY, 'SLACK_TOKEN_ENCRYPTION_KEY')
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new SlackServiceError('SLACK_TOKEN_ENCRYPTION_KEY must contain at least 32 bytes', 503)
  }
  return createHash('sha256').update(secret, 'utf8').digest()
}

function encryptAccessToken(token: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret, 'utf8').digest(), iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
}

function decryptAccessToken(encrypted: string): string {
  const [version, ivPart, tagPart, dataPart] = encrypted.split(':')
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) throw new SlackServiceError('Stored Slack token cannot be decrypted')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8')
}

async function revokeSlackToken(token: string): Promise<void> {
  await fetch('https://slack.com/api/auth.revoke', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(SLACK_API_TIMEOUT_MS),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
