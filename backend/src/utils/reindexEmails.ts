import { elasticsearchClient } from '../config/elasticsearch'
import { prisma } from '../config/database'
import { reindexEmails } from '../services/emailSearchService'

async function main(): Promise<void> {
  try {
    const result = await reindexEmails(500)
    console.info(JSON.stringify({ level: 'info', event: 'email_reindex_finished', ...result }))
    if (result.failed > 0) process.exitCode = 1
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'email_reindex_failed',
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }))
    process.exitCode = 1
  } finally {
    await Promise.allSettled([elasticsearchClient.close(), prisma.$disconnect()])
  }
}

void main()
