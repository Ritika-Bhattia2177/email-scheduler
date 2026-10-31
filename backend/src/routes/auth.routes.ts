import { Router } from 'express'
import { prisma } from '../config/database'
import { env } from '../config/env'
import { getRequestUserId } from '../utils/requestUser'
import {
  assertSessionConfiguration,
  authenticateGoogleCode,
  consumeGoogleOAuthState,
  createGoogleAuthorizationUrl,
  createSessionToken,
  expiredSessionCookieHeader,
  expiredOAuthStateCookieHeader,
  oauthStateCookieHeader,
  requestHasMatchingOAuthState,
  sessionCookieHeader,
  getSessionUserId,
  SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  AuthServiceError,
} from '../services/auth.service'

const authRouter = Router()

authRouter.get('/google', async (_request, response, next) => {
  try {
    const authorization = await createGoogleAuthorizationUrl()
    response.setHeader('Set-Cookie', oauthStateCookieHeader(authorization.state))
    response.redirect(302, authorization.url)
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'google_oauth_start_failed',
      reason: error instanceof AuthServiceError ? 'configuration_or_state_storage' : 'unexpected_error',
      ...(error instanceof AuthServiceError ? { statusCode: error.statusCode } : {}),
    }))
    next(error)
  }
})

authRouter.get('/google/callback', async (request, response) => {
  const state = typeof request.query.state === 'string' ? request.query.state : ''
  const stateHasValidFormat = Boolean(state && state.length <= 128 && /^[a-f0-9]+$/i.test(state))
  const stateCookiePresent = request.headers.cookie?.split(';').some(part => part.trim().startsWith(`${OAUTH_STATE_COOKIE_NAME}=`)) ?? false
  if (!stateHasValidFormat || !requestHasMatchingOAuthState(request.headers.cookie, state)) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'google_oauth_callback_rejected',
      stage: 'state_validation',
      reason: !stateHasValidFormat ? 'state_missing_or_malformed' : stateCookiePresent ? 'state_cookie_mismatch' : 'state_cookie_missing',
    }))
    response.setHeader('Set-Cookie', expiredOAuthStateCookieHeader())
    response.status(400).json({ success: false, message: 'Google OAuth state is missing or invalid' })
    return
  }

  let stage = 'state_consumption'
  try {
    const expectedNonce = await consumeGoogleOAuthState(state)
    response.setHeader('Set-Cookie', expiredOAuthStateCookieHeader())
    if (!expectedNonce) {
      console.warn(JSON.stringify({ level: 'warn', event: 'google_oauth_callback_rejected', stage, reason: 'state_expired_or_already_used' }))
      response.status(400).json({ success: false, message: 'Google OAuth state is invalid, expired, or already used' })
      return
    }
    if (typeof request.query.error === 'string') {
      console.info(JSON.stringify({ level: 'info', event: 'google_oauth_cancelled', reason: 'provider_denied', redirectPath: '/login?error=google_sign_in_cancelled' }))
      response.redirect(302, `${env.FRONTEND_URL}/login?error=google_sign_in_cancelled`)
      return
    }
    const code = typeof request.query.code === 'string' ? request.query.code : ''
    if (!code || code.length > 4096) {
      console.warn(JSON.stringify({ level: 'warn', event: 'google_oauth_callback_rejected', stage: 'authorization_code', reason: 'code_missing_or_malformed' }))
      response.status(400).json({ success: false, message: 'Google authorization code is missing or invalid' })
      return
    }

    stage = 'session_configuration'
    assertSessionConfiguration()
    stage = 'google_authentication_and_user_persistence'
    const user = await authenticateGoogleCode(code, expectedNonce)
    stage = 'session_creation'
    response.setHeader('Set-Cookie', [expiredOAuthStateCookieHeader(), sessionCookieHeader(createSessionToken(user.id))])
    console.info(JSON.stringify({
      level: 'info',
      event: 'google_oauth_callback_succeeded',
      sessionIssued: true,
      redirectPath: '/dashboard/scheduled',
    }))
    response.redirect(302, `${env.FRONTEND_URL}/dashboard/scheduled`)
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'google_oauth_callback_failed',
      stage,
      reason: error instanceof AuthServiceError ? 'authentication_service_error' : 'unexpected_error',
      redirectPath: '/login?error=google_sign_in_failed',
      ...(error instanceof AuthServiceError ? { statusCode: error.statusCode } : {}),
    }))
    response.redirect(302, `${env.FRONTEND_URL}/login?error=google_sign_in_failed`)
  }
})

authRouter.get('/me', async (request, response, next) => {
  try {
    const sessionUserId = getSessionUserId(request.headers.cookie)
    if (!sessionUserId && env.AUTH_MODE !== 'development') {
      const sessionCookiePresent = request.headers.cookie?.split(';').some(part => part.trim().startsWith(`${SESSION_COOKIE_NAME}=`)) ?? false
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'google_session_rejected',
        reason: sessionCookiePresent ? 'invalid_or_expired_cookie' : 'cookie_missing',
      }))
    }
    const userId = getRequestUserId(request)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatarUrl: true },
    })
    if (!user) {
      console.warn(JSON.stringify({ level: 'warn', event: 'google_session_rejected', reason: 'session_user_not_found' }))
      response.status(401).json({ success: false, message: 'Authentication required' })
      return
    }
    response.json({ success: true, data: user })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/logout', (_request, response) => {
  response.setHeader('Set-Cookie', expiredSessionCookieHeader())
  response.json({ success: true })
})

export default authRouter
