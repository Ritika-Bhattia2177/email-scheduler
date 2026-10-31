import { prisma } from '../config/database'
import { commitEmailSend, releaseEmailSend, reserveEmailSend } from './emailRateLimiter'
import { deliverEmailJob } from './emailDeliveryService'
import { redactSecrets } from '../utils/redactSecrets'

export class ImmediateEmailRateLimitError extends Error {
  readonly statusCode = 429

  constructor(retryAfterMs: number) {
    super(`Email rate limit reached. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`)
    this.name = 'ImmediateEmailRateLimitError'
  }
}

export class ImmediateEmailStatusPersistenceError extends Error {
  readonly statusCode = 503

  constructor() {
    super('SMTP accepted the email, but its status could not be saved. Check the mailbox before retrying.')
    this.name = 'ImmediateEmailStatusPersistenceError'
  }
}

export async function sendEmailImmediately(
  emailJobId: string,
  senderAccountId: string,
  minimumDelayMs: number,
  hourlyLimit: number,
): Promise<void> {
  let reservationId: string | undefined
  let smtpAccepted = false
  try {
    const decision = await reserveEmailSend(emailJobId, senderAccountId, minimumDelayMs, hourlyLimit)
    if (!decision.allowed || !decision.reservationId) {
      throw new ImmediateEmailRateLimitError(decision.retryAfterMs)
    }
    reservationId = decision.reservationId

    const delivery = await deliverEmailJob(emailJobId)
    smtpAccepted = true

    try {
      await commitEmailSend(reservationId, senderAccountId, minimumDelayMs)
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'email_rate_limit_commit_failed_after_smtp_success',
        emailJobId,
        message: redactSecrets(error instanceof Error ? error.message : 'Unknown rate-limit commit error'),
      }))
    }

    try {
      await prisma.$transaction(async transaction => {
        const updated = await transaction.emailJob.updateMany({
          where: { id: emailJobId, status: 'PROCESSING' },
          data: { status: 'SENT', sentAt: new Date() },
        })
        if (updated.count !== 1) throw new Error('Email status changed before SMTP success could be recorded')
        await transaction.emailEvent.create({
          data: {
            emailJobId,
            type: 'SENT',
            message: `SMTP accepted email${delivery.info.messageId ? ` (message ID: ${delivery.info.messageId})` : ''}.`,
          },
        })
      })
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'email_immediate_sent_status_persistence_failed',
        emailJobId,
        message: redactSecrets(error instanceof Error ? error.message : 'Unknown database error'),
      }))
      throw new ImmediateEmailStatusPersistenceError()
    }
  } catch (error) {
    if (!smtpAccepted) {
      if (reservationId) {
        try {
          await releaseEmailSend(reservationId, senderAccountId)
        } catch (releaseError) {
          console.error(JSON.stringify({
            level: 'error',
            event: 'email_rate_limit_reservation_release_failed',
            emailJobId,
            message: redactSecrets(releaseError instanceof Error ? releaseError.message : 'Unknown reservation error'),
          }))
        }
      }

      const message = redactSecrets(error instanceof Error ? error.message : 'Unknown email delivery error')
      try {
        await prisma.$transaction(async transaction => {
          const updated = await transaction.emailJob.updateMany({
            where: { id: emailJobId, status: 'PROCESSING' },
            data: { status: 'FAILED' },
          })
          if (updated.count === 1) {
            await transaction.emailEvent.create({
              data: { emailJobId, type: 'FAILED', message: failureEventMessage(error, `Immediate email delivery failed: ${message}`) },
            })
          }
        })
      } catch (persistError) {
        console.error(JSON.stringify({
          level: 'error',
          event: 'email_immediate_failure_persistence_failed',
          emailJobId,
          message: redactSecrets(persistError instanceof Error ? persistError.message : 'Unknown database error'),
        }))
      }
    }
    throw error
  }
}

function failureEventMessage(error: unknown, message: string): string {
  return error instanceof Error && 'deliveryUncertain' in error && error.deliveryUncertain === true
    ? `Delivery outcome unknown; check the SMTP provider before retrying. ${message}`
    : message
}
