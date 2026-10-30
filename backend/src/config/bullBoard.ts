import { timingSafeEqual } from 'node:crypto'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { Router, type RequestHandler } from 'express'
import { env } from './env'
import { emailQueue } from '../queues/emailQueue'

const basePath = '/admin/queues'
const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath(basePath)

const protectDashboard: RequestHandler = (request, response, next) => {
  const username = env.QUEUE_DASHBOARD_USERNAME
  const password = env.QUEUE_DASHBOARD_PASSWORD
  if (!username || !password) {
    response.status(503).json({ success: false, message: 'Queue dashboard authentication is not configured' })
    return
  }

  const authorization = request.header('authorization')
  if (!authorization?.startsWith('Basic ')) {
    response.setHeader('WWW-Authenticate', 'Basic realm="ReachInbox Queue Dashboard"')
    response.status(401).json({ success: false, message: 'Authentication is required' })
    return
  }

  let suppliedCredentials: string
  try {
    suppliedCredentials = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8')
  } catch {
    response.status(401).json({ success: false, message: 'Invalid credentials' })
    return
  }

  const separator = suppliedCredentials.indexOf(':')
  const suppliedUsername = separator < 0 ? '' : suppliedCredentials.slice(0, separator)
  const suppliedPassword = separator < 0 ? '' : suppliedCredentials.slice(separator + 1)
  if (!constantTimeEquals(suppliedUsername, username) || !constantTimeEquals(suppliedPassword, password)) {
    response.setHeader('WWW-Authenticate', 'Basic realm="ReachInbox Queue Dashboard"')
    response.status(401).json({ success: false, message: 'Invalid credentials' })
    return
  }

  next()
}

const dashboardRouter = Router()
if (env.BULL_BOARD_ENABLED) {
  createBullBoard({
    queues: [createEmailQueueAdapter()],
    serverAdapter,
    options: { uiConfig: { hideRedisDetails: true } },
  })
  dashboardRouter.use(protectDashboard)
  dashboardRouter.use(serverAdapter.getRouter())
}

export { basePath as bullBoardBasePath, dashboardRouter as bullBoardRouter }

function createEmailQueueAdapter(): BullMQAdapter {
  const adapter = new BullMQAdapter(emailQueue, { readOnlyMode: true })
  adapter.setFormatter('data', sanitizeEmailJobData)
  return adapter
}

function sanitizeEmailJobData(data: unknown): Record<string, string | number> {
  if (typeof data !== 'object' || data === null) return { detail: 'Job data unavailable' }

  const jobData = data as Record<string, unknown>
  return {
    ...(typeof jobData.emailJobId === 'string' ? { emailJobId: jobData.emailJobId } : {}),
    ...(typeof jobData.senderAccountId === 'string' ? { senderAccountId: jobData.senderAccountId } : {}),
    ...(typeof jobData.scheduledAt === 'string' ? { scheduledAt: jobData.scheduledAt } : {}),
    ...(typeof jobData.minimumDelayMs === 'number' ? { minimumDelayMs: jobData.minimumDelayMs } : {}),
    ...(typeof jobData.hourlyLimit === 'number' ? { hourlyLimit: jobData.hourlyLimit } : {}),
    ...(Array.isArray(jobData.recipientEmails) ? { recipientCount: jobData.recipientEmails.length } : {}),
  }
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}
