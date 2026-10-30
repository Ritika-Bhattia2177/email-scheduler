import { Prisma } from '../generated/prisma/client'
import { elasticsearchClient } from '../config/elasticsearch'
import { env } from '../config/env'
import { prisma } from '../config/database'
import { estypes } from '@elastic/elasticsearch'
import { redactSecrets } from '../utils/redactSecrets'

const emailInclude = { senderAccount: true, recipients: true } satisfies Prisma.EmailJobInclude

type SearchableEmail = Prisma.EmailJobGetPayload<{ include: typeof emailInclude }>

export interface EmailSearchDocument extends Record<string, unknown> {
  id: string
  emailJobId: string
  userId: string
  ownerId: string
  senderAccountId: string
  senderId: string
  senderEmail: string
  senderDisplayName: string
  recipientEmails: string[]
  recipients: string[]
  subject: string
  body: string
  bodyText: string
  bodyHtml: string
  status: string
  scheduledAt: Date
  sentAt: Date | null
  createdAt: Date
  updatedAt: Date
  idempotencyKey: string
}

export interface SearchEmailsInput {
  userId: string
  page: number
  limit: number
  /** Optional to support filter-only searches. */
  query?: string
  status?: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED'
  senderAccountId?: string
  from?: Date
  to?: Date
  /** Backward-compatible aliases for existing clients. */
  senderId?: string
  scheduledFrom?: Date
  scheduledTo?: Date
  sentFrom?: Date
  sentTo?: Date
}

export class EmailSearchUnavailableError extends Error {
  readonly statusCode = 503

  constructor() {
    super('Email search is temporarily unavailable')
    this.name = 'EmailSearchUnavailableError'
  }
}

let indexReady = false
let indexInitialization: Promise<void> | undefined

const emailMapping = {
  properties: {
    id: { type: 'keyword' },
    emailJobId: { type: 'keyword' },
    userId: { type: 'keyword' },
    ownerId: { type: 'keyword' },
    senderAccountId: { type: 'keyword' },
    senderId: { type: 'keyword' },
    senderEmail: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 320 } } },
    senderDisplayName: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 320 } } },
    recipientEmails: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 320 } } },
    recipients: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 320 } } },
    subject: { type: 'text' },
    body: { type: 'text' },
    bodyText: { type: 'text' },
    bodyHtml: { type: 'text', index: false },
    status: { type: 'keyword' },
    scheduledAt: { type: 'date' },
    sentAt: { type: 'date' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
    idempotencyKey: { type: 'keyword', index: false },
  },
} satisfies estypes.MappingTypeMapping

export async function ensureEmailIndex(): Promise<void> {
  if (indexReady) return
  if (!indexInitialization) {
    indexInitialization = (async () => {
      const exists = await elasticsearchClient.indices.exists({ index: env.ELASTICSEARCH_INDEX })
      if (!exists) {
        try {
          await elasticsearchClient.indices.create({ index: env.ELASTICSEARCH_INDEX, mappings: emailMapping })
        } catch (error) {
          if (!isIndexAlreadyExists(error)) throw error
        }
      }
      // Safe and idempotent for existing indices: adds new fields without
      // deleting data or recreating the configured email index.
      await elasticsearchClient.indices.putMapping({ index: env.ELASTICSEARCH_INDEX, properties: emailMapping.properties })
      indexReady = true
    })()
  }

  try {
    await indexInitialization
  } catch (error) {
    indexInitialization = undefined
    throw error
  }
}

export async function initializeEmailIndexSafely(): Promise<void> {
  try {
    await ensureEmailIndex()
    console.info(JSON.stringify({ level: 'info', event: 'email_search_index_ready', index: env.ELASTICSEARCH_INDEX }))
  } catch (error) {
    logSearchError('email_search_index_initialization_failed', error)
  }
}

export async function syncEmailSearchDocument(emailJobId: string): Promise<void> {
  try {
    const email = await prisma.emailJob.findUnique({ where: { id: emailJobId }, include: emailInclude })
    if (!email) {
      await deleteEmailSearchDocument(emailJobId)
      return
    }
    await ensureEmailIndex()
    await elasticsearchClient.index({
      index: env.ELASTICSEARCH_INDEX,
      id: email.id,
      document: toSearchDocument(email),
    })
  } catch (error) {
    logSearchError('email_search_document_sync_failed', error, { emailJobId })
  }
}

export async function deleteEmailSearchDocument(emailJobId: string): Promise<void> {
  try {
    await ensureEmailIndex()
    await elasticsearchClient.delete({ index: env.ELASTICSEARCH_INDEX, id: emailJobId })
  } catch (error) {
    if (isDocumentNotFound(error)) return
    logSearchError('email_search_document_delete_failed', error, { emailJobId })
  }
}

export async function searchEmails(input: SearchEmailsInput): Promise<{
  results: Array<{
    id: string
    sender: { id: string; email: string; displayName: string }
    recipients: string[]
    subject: string
    status: string
    scheduledAt: Date
    sentAt: Date | null
    createdAt: Date
  }>
  total: number
}> {
  try {
    await ensureEmailIndex()
    const filters: estypes.QueryDslQueryContainer[] = [{ term: { userId: input.userId } }]
    if (input.status) filters.push({ term: { status: input.status } })
    const senderAccountId = input.senderAccountId ?? input.senderId
    if (senderAccountId) filters.push({ term: { senderAccountId } })
    const scheduledFrom = input.from ?? input.scheduledFrom
    const scheduledTo = input.to ?? input.scheduledTo
    if (scheduledFrom || scheduledTo) {
      filters.push({ range: { scheduledAt: { ...(scheduledFrom ? { gte: scheduledFrom.toISOString() } : {}), ...(scheduledTo ? { lte: scheduledTo.toISOString() } : {}) } } })
    }
    if (input.sentFrom || input.sentTo) {
      filters.push({ range: { sentAt: { ...(input.sentFrom ? { gte: input.sentFrom.toISOString() } : {}), ...(input.sentTo ? { lte: input.sentTo.toISOString() } : {}) } } })
    }

    const must: estypes.QueryDslQueryContainer[] = input.query
      ? [{
          multi_match: {
            query: input.query,
            fields: ['subject^4', 'senderEmail^3', 'senderDisplayName^2', 'recipientEmails^3', 'bodyText'],
            type: 'best_fields',
            operator: 'or',
            fuzziness: 'AUTO',
          },
        }]
      : [{ match_all: {} }]

    const response = await elasticsearchClient.search({
      index: env.ELASTICSEARCH_INDEX,
      from: (input.page - 1) * input.limit,
      size: input.limit,
      track_total_hits: true,
      sort: [{ createdAt: 'desc' }, { id: 'asc' }],
      query: {
        bool: {
          filter: filters,
          must,
        },
      },
    })

    const ids = response.hits.hits.map(hit => hit._id).filter((id): id is string => id !== undefined)
    if (ids.length === 0) return { results: [], total: totalHits(response.hits.total) }

    const postgresFilters: Prisma.EmailJobWhereInput = { userId: input.userId, id: { in: ids } }
    if (input.status) postgresFilters.status = input.status
    if (senderAccountId) postgresFilters.senderAccountId = senderAccountId
    if (scheduledFrom || scheduledTo) {
      postgresFilters.scheduledAt = {
        ...(scheduledFrom ? { gte: scheduledFrom } : {}),
        ...(scheduledTo ? { lte: scheduledTo } : {}),
      }
    }
    if (input.sentFrom || input.sentTo) {
      postgresFilters.sentAt = {
        ...(input.sentFrom ? { gte: input.sentFrom } : {}),
        ...(input.sentTo ? { lte: input.sentTo } : {}),
      }
    }

    const emails = await prisma.emailJob.findMany({ where: postgresFilters, include: emailInclude })
    const emailById = new Map(emails.map(email => [email.id, email]))
    const results = ids.flatMap(id => {
      const email = emailById.get(id)
      if (!email) return []
      return [{
        id: email.id,
        sender: { id: email.senderAccount.id, email: email.senderAccount.email, displayName: email.senderAccount.displayName },
        recipients: email.recipients.map(recipient => recipient.email),
        subject: email.subject,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
        createdAt: email.createdAt,
      }]
    })

    return { results, total: totalHits(response.hits.total) }
  } catch (error) {
    logSearchError('email_search_failed', error, { userId: input.userId })
    throw new EmailSearchUnavailableError()
  }
}

export async function reindexEmails(batchSize = 500): Promise<{ indexed: number; failed: number }> {
  await ensureEmailIndex()
  let indexed = 0
  let failed = 0
  let cursor: string | undefined

  while (true) {
    const batch = await prisma.emailJob.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      take: batchSize,
      include: emailInclude,
    })
    if (batch.length === 0) break

    const operations: Array<estypes.BulkOperationContainer | EmailSearchDocument> = []
    for (const email of batch) {
      operations.push({ index: { _index: env.ELASTICSEARCH_INDEX, _id: email.id } })
      operations.push(toSearchDocument(email))
    }
    const response = await elasticsearchClient.bulk({ operations, refresh: false })
    const batchFailed = response.items.filter(item => item.index?.error !== undefined).length
    failed += batchFailed
    indexed += batch.length - batchFailed
    cursor = batch[batch.length - 1]?.id
  }

  await elasticsearchClient.indices.refresh({ index: env.ELASTICSEARCH_INDEX })
  return { indexed, failed }
}

function toSearchDocument(email: SearchableEmail): EmailSearchDocument {
  const bodyText = htmlToText(email.bodyHtml)
  const recipients = email.recipients.map(recipient => recipient.email)
  return {
    id: email.id,
    emailJobId: email.id,
    userId: email.userId,
    ownerId: email.userId,
    senderAccountId: email.senderAccountId,
    senderId: email.senderAccountId,
    senderEmail: email.senderAccount.email,
    senderDisplayName: email.senderAccount.displayName,
    recipientEmails: recipients,
    recipients,
    subject: email.subject,
    body: bodyText,
    bodyText,
    bodyHtml: email.bodyHtml,
    status: email.status,
    scheduledAt: email.scheduledAt,
    sentAt: email.sentAt,
    createdAt: email.createdAt,
    updatedAt: email.updatedAt,
    idempotencyKey: email.idempotencyKey,
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function totalHits(total: number | estypes.SearchTotalHits | undefined): number {
  if (typeof total === 'number') return total
  return total?.value ?? 0
}

function isIndexAlreadyExists(error: unknown): boolean {
  if (!isRecord(error) || !isRecord(error.meta) || !isRecord(error.meta.body) || !isRecord(error.meta.body.error)) return false
  return error.meta.body.error.type === 'resource_already_exists_exception'
}

function isDocumentNotFound(error: unknown): boolean {
  return isRecord(error) && error.statusCode === 404
}

function logSearchError(event: string, error: unknown, context: Record<string, string> = {}): void {
  const message = redactSecrets(error instanceof Error ? error.message : 'Unknown Elasticsearch error')
  console.warn(JSON.stringify({ level: 'warn', event, ...context, message }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
