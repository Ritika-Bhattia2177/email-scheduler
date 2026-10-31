import { Router } from 'express'
import { env } from '../config/env'
import { getRequestUserId } from '../utils/requestUser'
import {
  completeOAuthConnection,
  consumeOAuthState,
  createOAuthAuthorizationUrl,
  disconnectSlack,
  getSlackConnection,
  SlackServiceError,
} from '../services/slack.service'

const slackRouter = Router()

slackRouter.get('/oauth/start', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    response.redirect(302, await createOAuthAuthorizationUrl(userId))
  } catch (error) {
    next(error)
  }
})

slackRouter.get('/oauth/callback', async (request, response) => {
  const state = typeof request.query.state === 'string' ? request.query.state : ''
  console.info(JSON.stringify({
    level: 'info',
    event: 'slack_oauth_callback_received',
    hasState: Boolean(state),
    hasCode: typeof request.query.code === 'string',
    hasError: typeof request.query.error === 'string',
  }))
  if (!/^[a-f0-9]{64}$/i.test(state)) {
    response.status(400).json({ success: false, message: 'Slack OAuth state is missing or invalid' })
    return
  }

  try {
    const userId = await consumeOAuthState(state)
    if (!userId) {
      response.status(400).json({ success: false, message: 'Slack OAuth state is invalid, expired, or already used' })
      return
    }
    if (typeof request.query.error === 'string') {
      response.status(400).json({ success: false, message: 'Slack authorization was not granted' })
      return
    }
    const code = typeof request.query.code === 'string' ? request.query.code : ''
    if (!code || code.length > 4096) {
      response.status(400).json({ success: false, message: 'Slack authorization code is missing or invalid' })
      return
    }

    await completeOAuthConnection(userId, code)
    const redirect = new URL('/dashboard/integrations/slack', requireFrontendUrl())
    redirect.searchParams.set('slack_connected', '1')
    response.redirect(302, redirect.toString())
  } catch (error) {
    if (error instanceof SlackServiceError) {
      response.status(error.statusCode).json({ success: false, message: error.message })
      return
    }
    response.status(502).json({ success: false, message: 'Slack authorization could not be completed' })
  }
})

slackRouter.get('/status', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    response.json({ success: true, data: await getSlackConnection(userId) })
  } catch (error) {
    next(error)
  }
})

slackRouter.post('/disconnect', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    await disconnectSlack(userId)
    response.json({ success: true, data: { connected: false } })
  } catch (error) {
    next(error)
  }
})

export default slackRouter

function requireFrontendUrl(): string {
  if (!env.FRONTEND_URL) throw new SlackServiceError('FRONTEND_URL is not configured', 503)
  return env.FRONTEND_URL
}
