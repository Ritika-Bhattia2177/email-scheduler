import { randomUUID } from 'node:crypto'
import { closeRedisConnection } from '../config/redis'
import { prisma } from '../config/database'
import { emailQueue } from '../queues/emailQueue'
import { scheduleEmailJob } from '../services/emailSchedulerService'
import { redactSecrets } from './redactSecrets'

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The queue load check is available only outside production')
  }

  const testId = randomUUID()
  const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const emailJobIds: string[] = []
  let userId: string | undefined
  let senderAccountId: string | undefined

  try {
    const testData = await prisma.$transaction(async transaction => {
      const user = await transaction.user.create({
        data: {
          email: `queue-test-${testId}@example.com`,
          name: 'BullMQ Development Test',
        },
      })
      const senderAccount = await transaction.senderAccount.create({
        data: {
          userId: user.id,
          email: `sender-${testId}@example.com`,
          displayName: 'BullMQ Test Sender',
        },
      })

      const jobIds = Array.from({ length: 1000 }, () => randomUUID())
      await transaction.emailJob.createMany({
        data: jobIds.map((id, index) => ({
          id,
          userId: user.id,
          senderAccountId: senderAccount.id,
          subject: 'Development queue capacity check',
          bodyHtml: '<p>Development-only queue test. No email is sent.</p>',
          scheduledAt,
          idempotencyKey: `queue-test-${testId}-${index}`,
        })),
      })
      await transaction.emailRecipient.createMany({
        data: jobIds.map((emailJobId, index) => ({ emailJobId, email: `recipient-${index}-${testId}@example.com` })),
      })
      return { userId: user.id, senderAccountId: senderAccount.id, jobIds }
    })
    userId = testData.userId
    senderAccountId = testData.senderAccountId
    emailJobIds.push(...testData.jobIds)

    const results = await Promise.all(emailJobIds.map(id => scheduleEmailJob(id)))
    const queuedCount = results.filter(result => !result.alreadyEnqueued).length
    if (queuedCount !== emailJobIds.length) throw new Error('Queue capacity check encountered an unexpected pre-existing job')
    console.info(JSON.stringify({
      level: 'info',
      event: 'development_queue_capacity_check_succeeded',
      logicalJobs: emailJobIds.length,
      queuedJobs: queuedCount,
      delayMs: results[0]?.delay,
      scheduledAt: scheduledAt.toISOString(),
      note: 'Synthetic jobs are scheduled 24 hours ahead and removed after the check; no email is sent.',
    }))
  } finally {
    await Promise.all(emailJobIds.map(async id => {
      const job = await emailQueue.getJob(`email-${id}`).catch(() => undefined)
      if (job) await job.remove().catch(() => undefined)
    }))
    if (userId) {
      await prisma.$transaction(async transaction => {
        await transaction.emailJob.deleteMany({ where: { userId } })
        if (senderAccountId) await transaction.senderAccount.deleteMany({ where: { id: senderAccountId } })
        await transaction.user.deleteMany({ where: { id: userId } })
      }).catch(() => undefined)
    }
    await emailQueue.close()
    await closeRedisConnection()
    await prisma.$disconnect()
  }
}

void main().catch(error => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'development_queue_test_failed',
    message: redactSecrets(error instanceof Error ? error.message : 'Unknown error'),
  }))
  process.exitCode = 1
})
