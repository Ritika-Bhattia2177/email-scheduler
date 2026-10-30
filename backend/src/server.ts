import app from './app'
import { emailQueue } from './queues/emailQueue'
import { closeRedisConnection } from './config/redis'
import { prisma } from './config/database'
import { env } from './config/env'
import { emailWorker } from './workers/emailWorker'
import { elasticsearchClient } from './config/elasticsearch'
import { initializeEmailIndexSafely } from './services/emailSearchService'

void initializeEmailIndexSafely()

const server = app.listen(env.PORT, () => {
  console.info(`ReachInbox backend listening on port ${env.PORT}`)
})

let shutdownInProgress: Promise<void> | null = null

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownInProgress) return shutdownInProgress

  shutdownInProgress = (async () => {
    console.info(JSON.stringify({ level: 'info', event: 'backend_shutdown_started', signal }))

    const failures: unknown[] = []
    try {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    } catch (error) {
      failures.push(error)
    }

    for (const closeResource of [
      () => emailWorker.close(),
      () => emailQueue.close(),
      () => closeRedisConnection(),
      () => prisma.$disconnect(),
      () => elasticsearchClient.close(),
    ]) {
      try {
        await closeResource()
      } catch (error) {
        failures.push(error)
      }
    }

    console.info(JSON.stringify({ level: 'info', event: 'backend_shutdown_complete', signal }))
    if (failures.length > 0) throw new AggregateError(failures, 'One or more backend resources failed to close')
  })()

  return shutdownInProgress
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      console.error(JSON.stringify({
        level: 'error',
        event: 'backend_shutdown_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }))
      process.exitCode = 1
    })
  })
}
