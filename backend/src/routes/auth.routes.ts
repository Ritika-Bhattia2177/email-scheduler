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
  AuthServiceError,
} from '../services/auth.service'

const authRouter = Router()

authRouter.get('/google', async (_request, response, next) => {
  try {
    const authorization = await createGoogleAuthorizationUrl()
    response.setHeader('Set-Cookie', oauthStateCookieHeader(authorization.state))
    response.redirect(302, authorization.url)
  } catch (error) {
    next(error)
  }
})

authRouter.get('/google/callback', async (request, response) => {
  const state = typeof request.query.state === 'string' ? request.query.state : ''
  if (!state || state.length > 128 || !/^[a-f0-9]+$/i.test(state)
    || !requestHasMatchingOAuthState(request.headers.cookie, state)) {
    response.setHeader('Set-Cookie', expiredOAuthStateCookieHeader())
    response.status(400).json({ success: false, message: 'Google OAuth state is missing or invalid' })
    return
  }

  try {
    const expectedNonce = await consumeGoogleOAuthState(state)
    response.setHeader('Set-Cookie', expiredOAuthStateCookieHeader())
    if (!expectedNonce) {
      response.status(400).json({ success: false, message: 'Google OAuth state is invalid, expired, or already used' })
      return
    }
    if (typeof request.query.error === 'string') {
      response.redirect(302, `${env.FRONTEND_URL}/login?error=google_sign_in_cancelled`)
      return
    }
    const code = typeof request.query.code === 'string' ? request.query.code : ''
    if (!code || code.length > 4096) {
      response.status(400).json({ success: false, message: 'Google authorization code is missing or invalid' })
      return
    }

    assertSessionConfiguration()
    const user = await authenticateGoogleCode(code, expectedNonce)
    response.setHeader('Set-Cookie', [expiredOAuthStateCookieHeader(), sessionCookieHeader(createSessionToken(user.id))])
    response.redirect(302, `${env.FRONTEND_URL}/dashboard/scheduled`)
  } catch (error) {
    if (error instanceof AuthServiceError && error.statusCode < 500) {
      response.redirect(302, `${env.FRONTEND_URL}/login?error=google_sign_in_failed`)
      return
    }
    response.redirect(302, `${env.FRONTEND_URL}/login?error=google_sign_in_failed`)
  }
})

authRouter.get('/me', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatarUrl: true },
    })
    if (!user) {
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
