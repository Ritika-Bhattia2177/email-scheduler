import { prisma } from '../config/database'
import { enqueueEmailJob } from '../queues/emailQueue'
import type { EmailQueueJobData, EnqueuedEmailJob } from '../queues/queueTypes'
import { env } from '../config/env'

export async function scheduleEmailJob(emailJobId: string, deliveryMode: 'send' | 'schedule' = 'schedule'): Promise<EnqueuedEmailJob> {
  const emailJob = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    include: {
      senderAccount: true,
      recipients: true,
    },
  })

  if (!emailJob) throw new Error(`Email job ${emailJobId} was not found`)
  if (emailJob.status === 'CANCELLED') throw new Error(`Email job ${emailJobId} has been cancelled`)

  const queueData: EmailQueueJobData = {
    emailJobId: emailJob.id,
    idempotencyKey: emailJob.idempotencyKey,
    deliveryMode,
    senderAccountId: emailJob.senderAccountId,
    senderEmail: emailJob.senderAccount.email,
    scheduledAt: emailJob.scheduledAt.toISOString(),
    minimumDelayMs: emailJob.minimumDelayMs ?? env.EMAIL_DELAY_MS,
    hourlyLimit: emailJob.hourlyLimit ?? env.MAX_EMAILS_PER_SENDER_PER_HOUR,
    recipientEmails: emailJob.recipients.map(recipient => recipient.email),
    subject: emailJob.subject,
    bodyHtml: emailJob.bodyHtml,
  }

  const result = await enqueueEmailJob(queueData)
  try {
    if (deliveryMode === 'send') return {
      jobId: result.job.id ?? `email-${emailJob.id}`,
      delay: result.delay,
      alreadyEnqueued: result.alreadyEnqueued,
    }

    const scheduledEvent = await prisma.emailEvent.findFirst({
      where: { emailJobId: emailJob.id, type: 'SCHEDULED' },
      select: { id: true },
    })

    if (!scheduledEvent) {
      await prisma.emailEvent.create({
        data: {
          emailJobId: emailJob.id,
          type: 'SCHEDULED',
          message: result.alreadyEnqueued ? 'Email job already exists in the scheduler queue.' : 'Email job added to the scheduler queue.',
        },
      })
    }
  } catch {
    // Queue acceptance is authoritative for whether the request was scheduled.
    // Keep the API truthful if event persistence is temporarily unavailable.
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'email_scheduled_event_write_failed',
      emailJobId: emailJob.id,
      message: 'Email was enqueued, but its scheduling event could not be persisted.',
    }))
  }

  return {
    jobId: result.job.id ?? `email-${emailJob.id}`,
    delay: result.delay,
    alreadyEnqueued: result.alreadyEnqueued,
  }
}
