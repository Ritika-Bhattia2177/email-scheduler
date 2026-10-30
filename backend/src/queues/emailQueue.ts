import { Job, Queue } from 'bullmq'
import { redisConnection } from '../config/redis'
import { env } from '../config/env'
import type { EmailQueueJobData } from './queueTypes'
import { redactSecrets } from '../utils/redactSecrets'

export const EMAIL_QUEUE_NAME = 'email-scheduler'

export class EmailQueueUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Email scheduling queue is temporarily unavailable', options)
    this.name = 'EmailQueueUnavailableError'
  }
}

export const emailQueue = new Queue<EmailQueueJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    // Retain enough history for the dashboard (including 1000+ jobs) while
    // bounding Redis usage in both development and production.
    removeOnComplete: env.NODE_ENV === 'production'
      ? { age: 7 * 24 * 60 * 60, count: 1_000 }
      : { age: 7 * 24 * 60 * 60, count: 5_000 },
    removeOnFail: env.NODE_ENV === 'production'
      ? { age: 30 * 24 * 60 * 60, count: 5_000 }
      : { age: 30 * 24 * 60 * 60, count: 10_000 },
  },
})

emailQueue.on('error', error => {
  // Connection failures are surfaced by the shared Redis connection. Keep the
  // Queue emitter handled so EventEmitter does not print an uncaught stack.
  if (redisConnection.status !== 'ready') return
  console.error(JSON.stringify({ level: 'error', event: 'email_queue_error', message: redactSecrets(error.message) }))
})

export async function enqueueEmailJob(data: EmailQueueJobData): Promise<{
  job: Job<EmailQueueJobData>
  delay: number
  alreadyEnqueued: boolean
}> {
  const scheduledTimestamp = Date.parse(data.scheduledAt)
  if (!Number.isFinite(scheduledTimestamp)) {
    throw new Error('scheduledAt must be a valid date string')
  }

  const delay = Math.max(0, scheduledTimestamp - Date.now())
  const jobId = `email-${data.emailJobId}`
  try {
    const existingJob = await emailQueue.getJob(jobId)
    if (existingJob) {
      return { job: existingJob, delay, alreadyEnqueued: true }
    }

    const job = await emailQueue.add('process-email', data, {
      jobId,
      delay,
    })

    return { job, delay, alreadyEnqueued: false }
  } catch (error) {
    throw new EmailQueueUnavailableError(error instanceof Error ? { cause: error } : undefined)
  }
}
