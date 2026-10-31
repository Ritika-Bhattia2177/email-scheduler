import { DelayedError, Worker, type Job } from 'bullmq'
import { prisma } from '../config/database'
import { redisConnection } from '../config/redis'
import { EMAIL_QUEUE_NAME } from '../queues/emailQueue'
import type { EmailQueueJobData, EmailQueueJobResult } from '../queues/queueTypes'
import { env } from '../config/env'
import { EmailDeliveryError } from '../services/email.service'
import { deliverEmailJob } from '../services/emailDeliveryService'
import { commitEmailSend, releaseEmailSend, reserveEmailSend } from '../services/emailRateLimiter'
import { syncEmailSearchDocument } from '../services/emailSearchService'
import { notifyRateLimit } from '../services/slack.service'
import { redactSecrets } from '../utils/redactSecrets'

export const emailWorker = new Worker<EmailQueueJobData, EmailQueueJobResult>(
  EMAIL_QUEUE_NAME,
  async (job, token) => {
    console.info(JSON.stringify({ level: 'info', event: 'email_job_picked_up', queueJobId: job.id, emailJobId: job.data.emailJobId }))

    const emailJob = await prisma.emailJob.findUnique({
      where: { id: job.data.emailJobId },
      select: {
        id: true,
        userId: true,
        status: true,
        idempotencyKey: true,
        senderAccountId: true,
        scheduledAt: true,
        minimumDelayMs: true,
        hourlyLimit: true,
        senderAccount: { select: { email: true } },
      },
    })

    if (!emailJob) {
      console.warn(JSON.stringify({ level: 'warn', event: 'email_job_record_missing', emailJobId: job.data.emailJobId }))
      return { outcome: 'missing' }
    }
    if (emailJob.idempotencyKey !== job.data.idempotencyKey) throw new Error(`Idempotency key mismatch for email job ${emailJob.id}`)
    if (emailJob.status === 'CANCELLED') return { outcome: 'cancelled' }
    if (emailJob.status === 'SENT') return { outcome: 'already-sent' }
    const isImmediateSend = job.data.deliveryMode === 'send'
    if (emailJob.status !== 'SCHEDULED' && emailJob.status !== 'PROCESSING') {
      console.warn(JSON.stringify({ level: 'warn', event: 'email_job_not_claimable', emailJobId: emailJob.id, status: emailJob.status }))
      return { outcome: 'already-processing' }
    }

    if (emailJob.scheduledAt.getTime() > Date.now()) {
      await job.moveToDelayed(emailJob.scheduledAt.getTime(), token)
      throw new DelayedError()
    }

    const minimumDelayMs = emailJob.minimumDelayMs ?? job.data.minimumDelayMs ?? env.EMAIL_DELAY_MS
    const hourlyLimit = emailJob.hourlyLimit ?? job.data.hourlyLimit ?? env.MAX_EMAILS_PER_SENDER_PER_HOUR
    const rateLimit = await reserveEmailSend(emailJob.id, emailJob.senderAccountId, minimumDelayMs, hourlyLimit)
    if (!rateLimit.allowed) {
      const nextScheduledAt = new Date(rateLimit.retryAt)
      const rescheduled = await prisma.$transaction(async transaction => {
        const updated = await transaction.emailJob.updateMany({
          where: { id: emailJob.id, status: { in: ['SCHEDULED', 'PROCESSING'] }, scheduledAt: emailJob.scheduledAt },
          data: { status: isImmediateSend ? 'PROCESSING' : 'SCHEDULED', scheduledAt: nextScheduledAt },
        })
        if (updated.count === 0) return false

        const eventDetails = JSON.stringify({
          reason: `Rescheduled because ${rateLimit.reasons.join(', ')} is active.`,
          limitTypes: rateLimit.reasons.map(reason => reason === 'global-hourly-limit' ? 'global' : reason === 'sender-hourly-limit' ? 'sender' : 'minimum-delay'),
          previousAttemptAt: rateLimit.previousAttemptAt === null ? null : new Date(rateLimit.previousAttemptAt).toISOString(),
          attemptedAt: new Date(rateLimit.checkedAt).toISOString(),
          senderAccountId: emailJob.senderAccountId,
          currentGlobalCount: rateLimit.globalCount,
          currentSenderCount: rateLimit.senderCount,
          globalLimitPerHour: rateLimit.globalLimit,
          senderLimitPerHour: rateLimit.senderLimit,
          requestedHourlyLimit: hourlyLimit,
          minimumDelayMs,
          nextScheduledAt: nextScheduledAt.toISOString(),
        })
        await transaction.emailEvent.createMany({
          data: [
            { emailJobId: emailJob.id, type: 'RATE_LIMITED', message: eventDetails },
            { emailJobId: emailJob.id, type: 'RESCHEDULED', message: eventDetails },
          ],
        })
        return true
      })

      if (!rescheduled) return { outcome: 'not-claimed' }
      await syncEmailSearchDocument(emailJob.id)
      await job.updateData({ ...job.data, scheduledAt: nextScheduledAt.toISOString() })
      await job.moveToDelayed(nextScheduledAt.getTime(), token)
      try {
        await notifyRateLimit({
          userId: emailJob.userId,
          emailJobId: emailJob.id,
          senderAccountId: emailJob.senderAccountId,
          senderEmail: emailJob.senderAccount.email,
          limitTypes: rateLimit.reasons.map(reason => reason === 'global-hourly-limit' ? 'global' : reason === 'sender-hourly-limit' ? 'sender' : 'minimum-delay'),
          currentGlobalCount: rateLimit.globalCount,
          currentSenderCount: rateLimit.senderCount,
          globalLimit: rateLimit.globalLimit,
          senderLimit: rateLimit.senderLimit,
          nextScheduledAt,
          retryAfterMs: rateLimit.retryAfterMs,
        })
      } catch {
        console.warn(JSON.stringify({ level: 'warn', event: 'slack_rate_limit_notification_failed', userId: emailJob.userId }))
      }
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'email_rate_limited_and_rescheduled',
        emailJobId: emailJob.id,
        senderAccountId: emailJob.senderAccountId,
        reasons: rateLimit.reasons,
        nextScheduledAt: nextScheduledAt.toISOString(),
      }))
      throw new DelayedError()
    }

    let claimed: boolean
    try {
      claimed = await prisma.$transaction(async transaction => {
        const updated = await transaction.emailJob.updateMany({
          where: {
            id: emailJob.id,
            status: isImmediateSend ? { in: ['SCHEDULED', 'PROCESSING'] } : 'SCHEDULED',
          },
          data: { status: 'PROCESSING' },
        })
        if (updated.count === 0) return false
        await transaction.emailEvent.create({
          data: { emailJobId: emailJob.id, type: 'PROCESSING', message: 'Email delivery attempt started.' },
        })
        return true
      })
    } catch (error) {
      await safelyReleaseReservation(rateLimit.reservationId!, emailJob.senderAccountId, emailJob.id)
      throw error
    }

    if (!claimed) {
      await safelyReleaseReservation(rateLimit.reservationId!, emailJob.senderAccountId, emailJob.id)
      return { outcome: 'not-claimed' }
    }
    await syncEmailSearchDocument(emailJob.id)

    let delivery: Awaited<ReturnType<typeof deliverEmailJob>>
    try {
      delivery = await deliverEmailJob(emailJob.id)
    } catch (error) {
      await safelyReleaseReservation(rateLimit.reservationId!, emailJob.senderAccountId, emailJob.id)
      await recordDeliveryFailure(emailJob.id, job, error)
      throw error
    }

    // Count against rolling hourly quotas only after SMTP accepts the message.
    try {
      await commitEmailSend(rateLimit.reservationId!, emailJob.senderAccountId, minimumDelayMs)
    } catch (error) {
      // SMTP has accepted the email; do not let a Redis accounting error trigger
      // a BullMQ retry that could deliver the same message again.
      console.error(JSON.stringify({
        level: 'error',
        event: 'email_rate_limit_commit_failed_after_smtp_success',
        emailJobId: emailJob.id,
        message: safeErrorMessage(error),
      }))
    }

    try {
      await persistSentStatus(emailJob.id, delivery.info.messageId)
    } catch (error) {
      // SMTP has accepted this message. Do not throw to BullMQ: retrying the
      // whole processor could deliver the same email a second time.
      console.error(JSON.stringify({
        level: 'error',
        event: 'email_sent_status_persistence_failed_after_smtp_success',
        emailJobId: emailJob.id,
        message: safeErrorMessage(error),
      }))
      return { outcome: 'sent-status-persistence-failed' }
    }
    await syncEmailSearchDocument(emailJob.id)

    console.info(JSON.stringify({
      level: 'info',
      event: 'email_smtp_submission_succeeded',
      emailJobId: emailJob.id,
      messageId: delivery.info.messageId,
    }))
    if (delivery.previewUrl) {
      console.info(JSON.stringify({ level: 'info', event: 'ethereal_preview_available', emailJobId: emailJob.id, previewUrl: delivery.previewUrl }))
    }
    return { outcome: 'sent' }
  },
  {
    connection: redisConnection,
    concurrency: env.WORKER_CONCURRENCY,
  },
)

emailWorker.on('completed', (job, result) => {
  console.info(JSON.stringify({ level: 'info', event: 'email_queue_job_completed', queueJobId: job.id, emailJobId: job.data.emailJobId, outcome: result.outcome }))
})

emailWorker.on('ready', () => {
  console.info(JSON.stringify({ level: 'info', event: 'email_worker_ready', queueName: EMAIL_QUEUE_NAME }))
})

emailWorker.on('failed', (job, error) => {
  console.error(JSON.stringify({ level: 'error', event: 'email_queue_job_failed', queueJobId: job?.id, emailJobId: job?.data.emailJobId, message: safeErrorMessage(error) }))
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return
  void markExhaustedJobFailed(job.data.emailJobId, error).catch(persistenceError => {
    console.error(JSON.stringify({
      level: 'error',
      event: 'email_final_failure_persistence_failed',
      emailJobId: job.data.emailJobId,
      message: safeErrorMessage(persistenceError),
    }))
  })
})

emailWorker.on('error', error => {
  if (redisConnection.status !== 'ready') return
  console.error(JSON.stringify({ level: 'error', event: 'email_worker_error', message: safeErrorMessage(error) }))
})

emailWorker.on('stalled', jobId => {
  console.warn(JSON.stringify({ level: 'warn', event: 'email_queue_job_stalled', queueJobId: jobId }))
})

async function recordDeliveryFailure(emailJobId: string, job: Job<EmailQueueJobData, EmailQueueJobResult>, error: unknown): Promise<void> {
  const attemptLimit = job.opts.attempts ?? 1
  const finalAttempt = job.attemptsMade + 1 >= attemptLimit || (error instanceof EmailDeliveryError && !error.retryable)
  const message = safeErrorMessage(error)

  await prisma.$transaction(async transaction => {
    const state = finalAttempt
      ? 'FAILED' as const
      : job.data.deliveryMode === 'send' ? 'PROCESSING' as const : 'SCHEDULED' as const
    const updated = await transaction.emailJob.updateMany({
      where: { id: emailJobId, status: 'PROCESSING' },
      data: { status: state },
    })
    if (updated.count === 0) return
    if (finalAttempt) {
      await transaction.emailEvent.create({ data: { emailJobId, type: 'FAILED', message: failureEventMessage(error, `Email delivery failed: ${message}`) } })
    }
  })
  await syncEmailSearchDocument(emailJobId)

  console.warn(JSON.stringify({
    level: finalAttempt ? 'error' : 'warn',
    event: finalAttempt ? 'email_delivery_failed' : 'email_delivery_retry_scheduled',
    emailJobId,
    attempt: job.attemptsMade + 1,
    attempts: attemptLimit,
    message,
  }))
}

async function markExhaustedJobFailed(emailJobId: string, error: unknown): Promise<void> {
  const message = safeErrorMessage(error)
  const changed = await prisma.$transaction(async transaction => {
    const updated = await transaction.emailJob.updateMany({
      where: { id: emailJobId, status: { in: ['SCHEDULED', 'PROCESSING'] } },
      data: { status: 'FAILED' },
    })
    if (updated.count === 0) return false
    await transaction.emailEvent.create({
      data: { emailJobId, type: 'FAILED', message: failureEventMessage(error, `Email worker exhausted retries: ${message}`) },
    })
    return true
  })
  if (!changed) return
  await syncEmailSearchDocument(emailJobId)
  console.error(JSON.stringify({ level: 'error', event: 'email_job_marked_failed_after_retries', emailJobId, message }))
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown email delivery error'
  return redactSecrets(message)
}

function failureEventMessage(error: unknown, message: string): string {
  return error instanceof EmailDeliveryError && error.deliveryUncertain
    ? `Delivery outcome unknown; check the SMTP provider before retrying. ${message}`
    : message
}

async function persistSentStatus(emailJobId: string, messageId?: string | false): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.$transaction(async transaction => {
        const updated = await transaction.emailJob.updateMany({
          where: { id: emailJobId, status: 'PROCESSING' },
          data: { status: 'SENT', sentAt: new Date() },
        })
        if (updated.count === 0) {
          const current = await transaction.emailJob.findUnique({ where: { id: emailJobId }, select: { status: true } })
          if (current?.status === 'SENT') return
          throw new Error(`Email job ${emailJobId} left PROCESSING before SMTP completion`)
        }
        await transaction.emailEvent.create({
          data: {
            emailJobId,
            type: 'SENT',
            message: `SMTP accepted email${typeof messageId === 'string' ? ` (message ID: ${messageId})` : ''}.`,
          },
        })
      })
      return
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500))
    }
  }
  throw lastError
}

async function safelyReleaseReservation(reservationId: string, senderAccountId: string, emailJobId: string): Promise<void> {
  try {
    await releaseEmailSend(reservationId, senderAccountId)
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'email_rate_limit_reservation_release_failed',
      emailJobId,
      message: safeErrorMessage(error),
    }))
  }
}
