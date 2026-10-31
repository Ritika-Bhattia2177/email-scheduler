import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client'
import { prisma } from '../config/database'
import { emailQueue } from '../queues/emailQueue'
import { scheduleEmailJob } from '../services/emailSchedulerService'
import { searchEmails, syncEmailSearchDocument } from '../services/emailSearchService'
import { getRequestUserId } from '../utils/requestUser'
import { env } from '../config/env'
import {
  getUploadedAttachments,
  prepareUploadedAttachments,
  removeUploadedAttachments,
  assertStoredAttachmentExists,
  safeAttachmentFilename,
  uploadAttachments,
} from '../services/emailAttachmentStorage'

const emailsRouter = Router()
const MAX_MINIMUM_DELAY_MS = 24 * 60 * 60 * 1000
const MAX_HOURLY_LIMIT = 10_000

emailsRouter.post('/', (request, _response, next) => {
  try {
    getRequestUserId(request)
    next()
  } catch (error) {
    next(error)
  }
}, uploadAttachments, async (request, response, next) => {
  const uploadedFiles = getUploadedAttachments(request)
  let attachmentRecordsCreated = false
  try {
    const userId = getRequestUserId(request)
    if (!isRecord(request.body)) throw badRequest('Request body must be an object')
    const {
      senderAccountId,
      subject,
      bodyHtml,
      recipientEmails,
      scheduledAt,
      deliveryMode,
      idempotencyKey,
      minimumDelayMs,
      hourlyLimit,
    } = request.body as Record<string, unknown>

    const resolvedDeliveryMode = deliveryMode === undefined ? 'schedule' : deliveryMode
    if (resolvedDeliveryMode !== 'send' && resolvedDeliveryMode !== 'schedule') {
      throw badRequest('deliveryMode must be send or schedule')
    }

    if ('cc' in request.body || 'bcc' in request.body) throw badRequest('cc and bcc recipients are not supported')

    const idempotencyKeyHeader = request.header('Idempotency-Key')
    if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') {
      throw badRequest('idempotencyKey must be a string')
    }
    const bodyIdempotencyKey = typeof idempotencyKey === 'string' ? validateIdempotencyKey(idempotencyKey) : undefined
    const key = idempotencyKeyHeader !== undefined
      ? validateIdempotencyKey(idempotencyKeyHeader)
      : bodyIdempotencyKey ?? randomUUID()

    const existing = await prisma.emailJob.findUnique({ where: { idempotencyKey: key } })
    if (existing) {
      if (existing.userId !== userId) throw conflict('Idempotency key is already in use')
      if (existing.status === 'FAILED') throw conflict('This email job previously failed. Retry the existing job instead of resubmitting it.')
      if (existing.status === 'CANCELLED') throw conflict('This email job was cancelled. Use a new request key to schedule another email.')
      response.status(200).json({ success: true, data: publicEmailJob(await emailJobResponse(existing.id)) })
      return
    }

    if (typeof senderAccountId !== 'string' || !uuidPattern.test(senderAccountId)) throw badRequest('senderAccountId must be a valid UUID')
    if (typeof subject !== 'string' || !subject.trim()) throw badRequest('subject is required')
    if (subject.length > 998) throw badRequest('subject cannot exceed 998 characters')
    if (/[\u0000-\u001f\u007f]/.test(subject)) throw badRequest('subject cannot contain control characters')
    if (typeof bodyHtml !== 'string' || !bodyHtml.trim()) throw badRequest('bodyHtml is required')
    if (Buffer.byteLength(bodyHtml, 'utf8') > 900_000) throw badRequest('bodyHtml is too large')
    const normalizedRecipientInput = parseRecipientEmails(recipientEmails)
    if (normalizedRecipientInput.length === 0 || normalizedRecipientInput.length > 1000
      || normalizedRecipientInput.some(email => email.length > 320 || !emailPattern.test(email))) {
      throw badRequest('recipientEmails must contain at least one valid email address')
    }

    const scheduleDate = resolvedDeliveryMode === 'send' ? new Date() : parseScheduledAt(scheduledAt)

    // An explicitly supplied delay must be positive. Omitted values still use
    // EMAIL_DELAY_MS, including an intentional zero-delay development setting.
    const resolvedMinimumDelayMs = optionalBoundedInteger(parseFormInteger(minimumDelayMs, 'minimumDelayMs'), env.EMAIL_DELAY_MS, 'minimumDelayMs', 1, MAX_MINIMUM_DELAY_MS)
    const resolvedHourlyLimit = optionalBoundedInteger(parseFormInteger(hourlyLimit, 'hourlyLimit'), env.MAX_EMAILS_PER_SENDER_PER_HOUR, 'hourlyLimit', 1, MAX_HOURLY_LIMIT)

    const sender = await prisma.senderAccount.findFirst({ where: { id: senderAccountId, userId } })
    if (!sender) throw notFound('Sender account not found')

    const uniqueRecipients = [...new Set(normalizedRecipientInput.map(email => email.trim().toLowerCase()))]
    await prepareUploadedAttachments(uploadedFiles)
    let emailJob
    try {
      emailJob = await prisma.emailJob.create({
        data: {
          userId,
          senderAccountId: sender.id,
          subject: subject.trim(),
          bodyHtml,
          scheduledAt: scheduleDate,
          status: resolvedDeliveryMode === 'send' ? 'PROCESSING' : 'SCHEDULED',
          minimumDelayMs: resolvedMinimumDelayMs,
          hourlyLimit: resolvedHourlyLimit,
          idempotencyKey: key,
          recipients: { create: uniqueRecipients.map(email => ({ email })) },
          ...(resolvedDeliveryMode === 'send' ? {
            events: { create: { type: 'PROCESSING', message: 'Immediate email queued for delivery.' } },
          } : {}),
          ...(uploadedFiles.length > 0 ? {
            attachments: {
              create: uploadedFiles.map(file => ({
                fileName: safeAttachmentFilename(file.originalname),
                mimeType: file.mimetype,
                fileSize: file.size,
                storagePath: file.filename,
              })),
            },
          } : {}),
        },
      })
      attachmentRecordsCreated = true
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error

      // The unique database constraint resolves simultaneous requests using the same key.
      const concurrentWinner = await prisma.emailJob.findUnique({ where: { idempotencyKey: key } })
      if (!concurrentWinner) throw error
      if (concurrentWinner.userId !== userId) throw conflict('Idempotency key is already in use')
      if (concurrentWinner.status === 'FAILED') throw conflict('This email job previously failed. Retry the existing job instead of resubmitting it.')
      if (concurrentWinner.status === 'CANCELLED') throw conflict('This email job was cancelled. Use a new request key to schedule another email.')
      response.status(200).json({ success: true, data: publicEmailJob(await emailJobResponse(concurrentWinner.id)) })
      return
    }

    const queued = await scheduleEmailJobOrFail(emailJob.id, resolvedDeliveryMode)
    const responseData = { ...publicEmailJob(await emailJobResponse(emailJob.id)), queue: queued }
    response.status(201).json({ success: true, data: responseData })
    // Search indexing is best-effort and is not required for persistence or
    // queue acceptance. Let the API return promptly; workers sync subsequent
    // lifecycle changes, and this task ensures scheduled jobs are searchable.
    setImmediate(() => { void syncEmailSearchDocument(emailJob.id) })
  } catch (error) {
    next(error)
  } finally {
    if (!attachmentRecordsCreated) await removeUploadedAttachments(uploadedFiles)
  }
})

emailsRouter.get('/', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const requestedStatus = request.query.status
    if (requestedStatus !== undefined && !['scheduled', 'sent', 'failed'].includes(String(requestedStatus))) {
      throw badRequest('status must be scheduled, sent, or failed')
    }
    const page = positiveIntegerQuery(request.query.page, 1, 'page')
    const limit = positiveIntegerQuery(request.query.limit, 100, 'limit')
    if (limit > 100) throw badRequest('limit cannot exceed 100')
    if ((page - 1) * limit > 9_999) throw badRequest('Requested page is too far into the result set')
    const status = requestedStatus === 'sent'
      ? 'SENT' as const
      : requestedStatus === 'failed' ? 'FAILED' as const : 'SCHEDULED' as const
    const where = { userId, status }
    const [jobs, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        include: { senderAccount: true, recipients: true },
        orderBy: { scheduledAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.emailJob.count({ where }),
    ])
    response.json({
      success: true,
      data: jobs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    next(error)
  }
})

emailsRouter.get('/search', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const query = queryString(request.query.q, 'q')
    if (query && query.length > 500) throw badRequest('q cannot exceed 500 characters')

    const page = positiveIntegerQuery(request.query.page, 1, 'page')
    const limit = positiveIntegerQuery(request.query.limit, 20, 'limit')
    if (limit > 100) throw badRequest('limit cannot exceed 100')
    if ((page - 1) * limit > 9_999) throw badRequest('Requested page is too far into the result set')

    const statusText = queryString(request.query.status, 'status')?.toUpperCase()
    const allowedStatuses = ['SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] as const
    if (statusText && !allowedStatuses.includes(statusText as typeof allowedStatuses[number])) {
      throw badRequest('status must be scheduled, processing, sent, failed, or cancelled')
    }
    const senderAccountId = queryString(request.query.senderAccountId, 'senderAccountId')
    const legacySenderId = queryString(request.query.senderId, 'senderId')
    if (senderAccountId && !uuidPattern.test(senderAccountId)) throw badRequest('senderAccountId must be a valid UUID')
    if (legacySenderId && !uuidPattern.test(legacySenderId)) throw badRequest('senderId must be a valid UUID')
    if (senderAccountId && legacySenderId && senderAccountId !== legacySenderId) {
      throw badRequest('senderAccountId and senderId must match when both are provided')
    }

    const from = dateQuery(request.query.from, 'from') ?? dateQuery(request.query.scheduledFrom, 'scheduledFrom')
    const to = dateQuery(request.query.to, 'to') ?? dateQuery(request.query.scheduledTo, 'scheduledTo')
    if (from && to && from.getTime() > to.getTime()) throw badRequest('from must be earlier than or equal to to')
    const sentFrom = dateQuery(request.query.sentFrom, 'sentFrom')
    const sentTo = dateQuery(request.query.sentTo, 'sentTo')
    if (sentFrom && sentTo && sentFrom.getTime() > sentTo.getTime()) throw badRequest('sentFrom must be earlier than or equal to sentTo')
    const selectedSenderAccountId = senderAccountId ?? legacySenderId

    const result = await searchEmails({
      userId,
      query,
      page,
      limit,
      ...(statusText ? { status: statusText as typeof allowedStatuses[number] } : {}),
      ...(selectedSenderAccountId ? { senderAccountId: selectedSenderAccountId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(sentFrom ? { sentFrom } : {}),
      ...(sentTo ? { sentTo } : {}),
    })
    response.json({
      success: true,
      data: {
        // Keep the existing response keys and add the clearer pagination shape.
        results: result.results,
        emails: result.results,
        page,
        limit,
        total: result.total,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

emailsRouter.get('/:id/attachments/:attachmentId', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const id = validateEmailJobId(request.params.id)
    const attachmentId = request.params.attachmentId
    if (!uuidPattern.test(attachmentId)) throw badRequest('A valid attachment ID is required')
    const email = await prisma.emailJob.findFirst({
      where: { id, userId },
      select: {
        attachments: {
          where: { id: attachmentId },
          select: { fileName: true, mimeType: true, storagePath: true },
        },
      },
    })
    const attachment = email?.attachments[0]
    if (!attachment) throw notFound('Email attachment not found')

    let filePath: string
    try {
      filePath = await assertStoredAttachmentExists(attachment.storagePath)
    } catch {
      throw notFound('Email attachment content is unavailable')
    }

    response.setHeader('Content-Type', attachment.mimeType)
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(safeAttachmentFilename(attachment.fileName))}`)
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.sendFile(filePath)
  } catch (error) {
    next(error)
  }
})

emailsRouter.get('/:id', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const id = validateEmailJobId(request.params.id)
    const job = await prisma.emailJob.findFirst({
      where: { id, userId },
      include: { senderAccount: true, recipients: true, attachments: true, events: { orderBy: { createdAt: 'asc' } } },
    })
    if (!job) throw notFound('Email job not found')
    response.json({ success: true, data: publicEmailJob(job) })
  } catch (error) {
    next(error)
  }
})

emailsRouter.post('/:id/cancel', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const id = validateEmailJobId(request.params.id)
    const updated = await prisma.$transaction(async transaction => {
      const changed = await transaction.emailJob.updateMany({
        where: { id, userId, status: 'SCHEDULED' },
        data: { status: 'CANCELLED' },
      })
      if (changed.count === 0) return 0
      await transaction.emailEvent.create({ data: { emailJobId: id, type: 'CANCELLED', message: 'Cancelled by the user.' } })
      return changed.count
    })
    if (updated === 0) throw notFound('Scheduled email job not found')
    await removeNonActiveQueueJob(id)
    await syncEmailSearchDocument(id)
    response.json({ success: true, data: publicEmailJob(await emailJobResponse(id)) })
  } catch (error) {
    next(error)
  }
})

emailsRouter.post('/:id/retry', async (request, response, next) => {
  try {
    const userId = getRequestUserId(request)
    const id = validateEmailJobId(request.params.id)
    const job = await prisma.emailJob.findFirst({ where: { id, userId, status: 'FAILED' } })
    if (!job) throw notFound('Failed email job not found')
    const latestFailure = await prisma.emailEvent.findFirst({
      where: { emailJobId: job.id, type: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      select: { message: true },
    })
    if (latestFailure?.message?.startsWith('Delivery outcome unknown;')) {
      throw httpError(409, 'Delivery outcome is unknown. Check the SMTP provider before retrying to avoid sending a duplicate.')
    }
    try {
      const queuedJob = await emailQueue.getJob(`email-${job.id}`)
      if (queuedJob) await queuedJob.remove()
    } catch {
      throw httpError(503, 'Email scheduling queue is temporarily unavailable')
    }
    await prisma.emailJob.update({ where: { id: job.id }, data: { status: 'SCHEDULED', scheduledAt: new Date() } })
    await syncEmailSearchDocument(job.id)
    const queued = await scheduleEmailJobOrFail(job.id)
    response.json({ success: true, data: { ...publicEmailJob(await emailJobResponse(job.id)), queue: queued } })
  } catch (error) {
    next(error)
  }
})

async function emailJobResponse(id: string) {
  return prisma.emailJob.findUniqueOrThrow({
    where: { id },
    include: { senderAccount: true, recipients: true, attachments: true },
  })
}

function publicEmailJob<T extends { attachments?: Array<{ storagePath: string }> }>(job: T) {
  const { attachments, ...fields } = job
  return {
    ...fields,
    ...(attachments ? { attachments: attachments.map(attachment => {
      const { storagePath: _storagePath, ...metadata } = attachment
      return metadata
    }) } : {}),
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validateIdempotencyKey(value: string): string {
  const key = value.trim()
  if (!key || key.length > 255 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw badRequest('Idempotency-Key must be a non-empty value of at most 255 characters')
  }
  return key
}

function validateEmailJobId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw badRequest('A valid email job ID is required')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function queryString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw badRequest(`${name} must be provided once`)
  return value.trim()
}

function positiveIntegerQuery(value: unknown, fallback: number, name: string): number {
  const text = queryString(value, name)
  if (text === undefined) return fallback
  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw badRequest(`${name} must be a positive integer`)
  return parsed
}

function optionalBoundedInteger(value: unknown, fallback: number, name: string, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw badRequest(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function parseFormInteger(value: unknown, name: string): unknown {
  if (typeof value !== 'string') return value
  if (!/^-?\d+$/.test(value)) throw badRequest(`${name} must be an integer`)
  return Number(value)
}

function parseRecipientEmails(value: unknown): string[] {
  let recipients = value
  if (typeof value === 'string') {
    try {
      recipients = JSON.parse(value) as unknown
    } catch {
      throw badRequest('recipientEmails must contain at least one valid email address')
    }
  }
  if (!Array.isArray(recipients) || recipients.some(email => typeof email !== 'string')) {
    throw badRequest('recipientEmails must contain at least one valid email address')
  }
  return recipients as string[]
}

function dateQuery(value: unknown, name: string): Date | undefined {
  const text = queryString(value, name)
  if (text === undefined) return undefined
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) throw badRequest(`${name} must be a valid date`)
  return date
}

function parseScheduledAt(value: unknown): Date {
  if (typeof value !== 'string') throw badRequest('scheduledAt must be an ISO date-time with a timezone')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value)
  if (!match) throw badRequest('scheduledAt must be an ISO date-time with a timezone')

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', , zone, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    throw badRequest('scheduledAt must be a valid ISO date-time')
  }
  if (zone.toUpperCase() !== 'Z' && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) {
    throw badRequest('scheduledAt must contain a valid timezone offset')
  }

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw badRequest('scheduledAt must be a valid ISO date-time')
  if (date.getTime() < Date.now()) throw badRequest('scheduledAt must be in the future')
  return date
}

function badRequest(message: string): Error {
  return httpError(400, message)
}

function notFound(message: string): Error {
  return httpError(404, message)
}

function conflict(message: string): Error {
  return httpError(409, message)
}

function httpError(statusCode: number, message: string): Error {
  const error = new Error(message)
  Object.assign(error, { statusCode })
  return error
}

export default emailsRouter

async function scheduleEmailJobOrFail(emailJobId: string, deliveryMode: 'send' | 'schedule' = 'schedule') {
  try {
    return await scheduleEmailJob(emailJobId, deliveryMode)
  } catch {
    let changedCount = 0
    try {
      const changed = await prisma.emailJob.updateMany({
        where: { id: emailJobId, status: { in: ['SCHEDULED', 'PROCESSING'] } },
        data: { status: 'FAILED' },
      })
      changedCount = changed.count
    } catch {
      // If PostgreSQL is unavailable, the API still returns an explicit 503.
    }
    if (changedCount > 0) {
      try {
        await prisma.emailEvent.create({
          data: {
            emailJobId,
            type: 'FAILED',
            message: 'Email could not be added to the scheduling queue. Retry after queue service recovery.',
          },
        })
      } catch {
        console.warn(JSON.stringify({ level: 'warn', event: 'email_queue_failure_event_write_failed', emailJobId }))
      }
      await syncEmailSearchDocument(emailJobId)
    }
    await removeNonActiveQueueJob(emailJobId)
    throw httpError(503, 'Email could not be queued because a required service is unavailable. Please retry.')
  }
}

async function removeNonActiveQueueJob(emailJobId: string): Promise<void> {
  try {
    const job = await emailQueue.getJob(`email-${emailJobId}`)
    if (!job) return
    const state = await job.getState()
    if (state === 'active') return
    await job.remove()
  } catch {
    // The database state is authoritative; a worker will recheck it before delivery.
  }
}
