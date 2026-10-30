import { randomUUID } from 'node:crypto'
import { redisConnection } from '../config/redis'
import { env } from '../config/env'

const WINDOW_MS = 60 * 60 * 1000

// A slot is reserved atomically before SMTP so concurrent workers cannot use
// the same capacity. Only commitEmailSend adds an item to the sent counters
// and advances the minimum-delay clock, which starts after SMTP success.
const reserveScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local windowMs = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local senderLimit = tonumber(ARGV[3])
local minimumDelay = tonumber(ARGV[4])
local member = ARGV[5]

for i = 1, 4 do redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - windowMs) end
local globalSent = redis.call('ZCARD', KEYS[1])
local senderSent = redis.call('ZCARD', KEYS[2])
local globalPending = redis.call('ZCARD', KEYS[3])
local senderPending = redis.call('ZCARD', KEYS[4])
local globalCount = globalSent + globalPending
local senderCount = senderSent + senderPending
local globalBlocked = globalCount >= globalLimit
local senderBlocked = senderCount >= senderLimit
local lastSuccessfulSend = tonumber(redis.call('GET', KEYS[5]) or '0')
local lastSuccessfulDelay = tonumber(redis.call('GET', KEYS[7]) or '0')
local pendingSend = redis.call('ZREVRANGE', KEYS[3], 0, 0, 'WITHSCORES')
local pendingDelay = pendingSend[1] and tonumber(redis.call('HGET', KEYS[6], pendingSend[1]) or '0') or 0
local requiredDelay = math.max(minimumDelay, lastSuccessfulDelay, pendingDelay)
local delayBlocked = requiredDelay > 0 and (globalPending > 0 or (lastSuccessfulSend > 0 and now - lastSuccessfulSend < requiredDelay))

if globalBlocked or senderBlocked or delayBlocked then
  local waitMs = 0
  if globalBlocked then
    local a = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    local b = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
    local first = math.min(a[2] and tonumber(a[2]) or now, b[2] and tonumber(b[2]) or now)
    waitMs = math.max(waitMs, first + windowMs - now)
  end
  if senderBlocked then
    local a = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    local b = redis.call('ZRANGE', KEYS[4], 0, 0, 'WITHSCORES')
    local first = math.min(a[2] and tonumber(a[2]) or now, b[2] and tonumber(b[2]) or now)
    waitMs = math.max(waitMs, first + windowMs - now)
  end
  if delayBlocked then
    local afterSuccessDelay = math.max(minimumDelay, lastSuccessfulDelay)
    if lastSuccessfulSend > 0 and now - lastSuccessfulSend < afterSuccessDelay then
      waitMs = math.max(waitMs, lastSuccessfulSend + afterSuccessDelay - now)
    end
    if pendingSend[2] then
      waitMs = math.max(waitMs, tonumber(pendingSend[2]) + math.max(minimumDelay, pendingDelay) - now)
    end
  end
  waitMs = math.max(1000, math.ceil(waitMs))
  return {0, waitMs, globalBlocked and 1 or 0, senderBlocked and 1 or 0, delayBlocked and 1 or 0, now + waitMs, lastSuccessfulSend, globalCount, senderCount, now}
end

redis.call('ZADD', KEYS[3], now, member)
redis.call('ZADD', KEYS[4], now, member)
redis.call('HSET', KEYS[6], member, minimumDelay)
redis.call('EXPIRE', KEYS[3], 7200)
redis.call('EXPIRE', KEYS[4], 7200)
redis.call('EXPIRE', KEYS[6], 7200)
return {1, 0, 0, 0, 0, now, lastSuccessfulSend, globalCount, senderCount, now}
`

const commitScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local globalRemoved = redis.call('ZREM', KEYS[3], ARGV[1])
local senderRemoved = redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('HDEL', KEYS[6], ARGV[1])
if globalRemoved == 1 and senderRemoved == 1 then
  redis.call('ZADD', KEYS[1], now, ARGV[1])
  redis.call('ZADD', KEYS[2], now, ARGV[1])
  redis.call('EXPIRE', KEYS[1], 7200)
  redis.call('EXPIRE', KEYS[2], 7200)
  redis.call('SET', KEYS[5], now, 'EX', 7200)
  redis.call('SET', KEYS[7], ARGV[2], 'EX', 7200)
  return 1
end
return 0
`

const releaseScript = `
local globalRemoved = redis.call('ZREM', KEYS[1], ARGV[1])
local senderRemoved = redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
return globalRemoved == 1 and senderRemoved == 1 and 1 or 0
`

export interface EmailRateLimitDecision {
  allowed: boolean
  reservationId?: string
  retryAfterMs: number
  retryAt: number
  checkedAt: number
  previousAttemptAt: number | null
  globalCount: number
  senderCount: number
  globalLimit: number
  senderLimit: number
  minimumDelayMs: number
  reasons: Array<'global-hourly-limit' | 'sender-hourly-limit' | 'minimum-delay'>
}

function keys(senderAccountId: string): [string, string, string, string, string, string, string] {
  // Shared hash tag keeps every key in one Redis Cluster slot for Lua atomicity.
  return [
    '{email-rate}:global:sent',
    `{email-rate}:sender:${senderAccountId}:sent`,
    '{email-rate}:global:pending',
    `{email-rate}:sender:${senderAccountId}:pending`,
    '{email-rate}:minimum-delay',
    '{email-rate}:global:pending-delays',
    '{email-rate}:minimum-delay-ms',
  ]
}

export async function reserveEmailSend(
  _emailJobId: string,
  senderAccountId: string,
  minimumDelayMs = env.EMAIL_DELAY_MS,
  requestedSenderLimit = env.MAX_EMAILS_PER_SENDER_PER_HOUR,
): Promise<EmailRateLimitDecision> {
  const reservationId = randomUUID()
  const globalLimit = env.MAX_EMAILS_PER_HOUR
  // Per-email requests may tighten the sender quota, but can never raise the
  // backend sender cap. The independent global quota remains enforced too.
  const senderLimit = Math.min(requestedSenderLimit, env.MAX_EMAILS_PER_SENDER_PER_HOUR)
  const rawDecision: unknown = await redisConnection.eval(
    reserveScript,
    7,
    ...keys(senderAccountId),
    WINDOW_MS,
    globalLimit,
    senderLimit,
    minimumDelayMs,
    reservationId,
  )

  if (!Array.isArray(rawDecision) || rawDecision.length !== 10 || rawDecision.some(value => typeof value !== 'number')) {
    throw new Error('Redis returned an invalid email rate-limit decision')
  }

  const [allowed, retryAfterMs, globalBlocked, senderBlocked, delayBlocked, retryAt, previousAttemptAt, globalCount, senderCount, checkedAt] = rawDecision as number[]
  const reasons: EmailRateLimitDecision['reasons'] = []
  if (globalBlocked === 1) reasons.push('global-hourly-limit')
  if (senderBlocked === 1) reasons.push('sender-hourly-limit')
  if (delayBlocked === 1) reasons.push('minimum-delay')
  return {
    allowed: allowed === 1,
    ...(allowed === 1 ? { reservationId } : {}),
    retryAfterMs,
    retryAt,
    checkedAt,
    previousAttemptAt: previousAttemptAt > 0 ? previousAttemptAt : null,
    globalCount,
    senderCount,
    globalLimit,
    senderLimit,
    minimumDelayMs,
    reasons,
  }
}

export async function commitEmailSend(reservationId: string, senderAccountId: string, minimumDelayMs = env.EMAIL_DELAY_MS): Promise<void> {
  const keySet = keys(senderAccountId)
  const committed: unknown = await redisConnection.eval(commitScript, 7, ...keySet, reservationId, minimumDelayMs)
  if (committed !== 1) throw new Error('Email rate-limit reservation expired before SMTP success was recorded')
}

export async function releaseEmailSend(reservationId: string, senderAccountId: string): Promise<void> {
  const keySet = keys(senderAccountId)
  await redisConnection.eval(releaseScript, 3, keySet[2], keySet[3], keySet[5], reservationId)
}
