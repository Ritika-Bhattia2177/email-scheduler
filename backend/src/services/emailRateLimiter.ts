import { randomUUID } from 'node:crypto'
import { redisConnection } from '../config/redis'
import { env } from '../config/env'

const WINDOW_MS = 60 * 60 * 1000
const RESERVATION_LEASE_MS = 2 * 60 * 1000
const RESERVATION_HEARTBEAT_MS = 30 * 1000

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
local reservationLeaseMs = tonumber(ARGV[6])

for i = 1, 4 do redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - windowMs) end
local recoveredReservations = 0
local pendingMembers = redis.call('ZRANGE', KEYS[3], 0, -1, 'WITHSCORES')
for index = 1, #pendingMembers, 2 do
  local pendingMember = pendingMembers[index]
  local pendingTimestamp = tonumber(pendingMembers[index + 1])
  local leaseKey = '{email-rate}:lease:' .. pendingMember
  if redis.call('EXISTS', leaseKey) == 0 and now - pendingTimestamp >= reservationLeaseMs then
    redis.call('ZREM', KEYS[3], pendingMember)
    redis.call('ZREM', KEYS[4], pendingMember)
    redis.call('HDEL', KEYS[6], pendingMember)
    recoveredReservations = recoveredReservations + 1
  end
end
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
  -- If an SMTP reservation is still active after its predicted slot,
  -- retry after the configured delay rather than creating a one-second
  -- rescheduling loop while that reservation is being completed.
  waitMs = math.max(1000, minimumDelay, pendingDelay, math.ceil(waitMs))
  local pendingTimestamp = pendingSend[2] and tonumber(pendingSend[2]) or 0
  return {0, waitMs, globalBlocked and 1 or 0, senderBlocked and 1 or 0, delayBlocked and 1 or 0, now + waitMs, lastSuccessfulSend, globalCount, senderCount, now, pendingTimestamp, pendingTimestamp > 0 and now - pendingTimestamp or 0, recoveredReservations}
end

redis.call('ZADD', KEYS[3], now, member)
redis.call('ZADD', KEYS[4], now, member)
redis.call('HSET', KEYS[6], member, minimumDelay)
redis.call('SET', KEYS[8], '1', 'PX', reservationLeaseMs)
redis.call('EXPIRE', KEYS[3], 7200)
redis.call('EXPIRE', KEYS[4], 7200)
redis.call('EXPIRE', KEYS[6], 7200)
return {1, 0, 0, 0, 0, now, lastSuccessfulSend, globalCount, senderCount, now, 0, 0, recoveredReservations}
`

const commitScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local globalRemoved = redis.call('ZREM', KEYS[3], ARGV[1])
local senderRemoved = redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('HDEL', KEYS[6], ARGV[1])
redis.call('DEL', KEYS[8])
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
redis.call('DEL', KEYS[4])
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
  pendingReservationAt: number | null
  pendingReservationAgeMs: number
  recoveredReservations: number
  reasons: Array<'global-hourly-limit' | 'sender-hourly-limit' | 'minimum-delay'>
}

function keys(senderAccountId: string, reservationId?: string): [string, string, string, string, string, string, string, string] {
  // Shared hash tag keeps every key in one Redis Cluster slot for Lua atomicity.
  return [
    '{email-rate}:global:sent',
    `{email-rate}:sender:${senderAccountId}:sent`,
    '{email-rate}:global:pending',
    `{email-rate}:sender:${senderAccountId}:pending`,
    '{email-rate}:minimum-delay',
    '{email-rate}:global:pending-delays',
    '{email-rate}:minimum-delay-ms',
    `{email-rate}:lease:${reservationId ?? 'unused'}`,
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
    8,
    ...keys(senderAccountId),
    WINDOW_MS,
    globalLimit,
    senderLimit,
    minimumDelayMs,
    reservationId,
    RESERVATION_LEASE_MS,
  )

  if (!Array.isArray(rawDecision) || rawDecision.length !== 13 || rawDecision.some(value => typeof value !== 'number')) {
    throw new Error('Redis returned an invalid email rate-limit decision')
  }

  const [allowed, retryAfterMs, globalBlocked, senderBlocked, delayBlocked, retryAt, previousAttemptAt, globalCount, senderCount, checkedAt, pendingReservationAt, pendingReservationAgeMs, recoveredReservations] = rawDecision as number[]
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
    pendingReservationAt: pendingReservationAt > 0 ? pendingReservationAt : null,
    pendingReservationAgeMs,
    recoveredReservations,
    reasons,
  }
}

export async function commitEmailSend(reservationId: string, senderAccountId: string, minimumDelayMs = env.EMAIL_DELAY_MS): Promise<void> {
  const keySet = keys(senderAccountId, reservationId)
  const committed: unknown = await redisConnection.eval(commitScript, 8, ...keySet, reservationId, minimumDelayMs)
  if (committed !== 1) throw new Error('Email rate-limit reservation expired before SMTP success was recorded')
}

export async function releaseEmailSend(reservationId: string, senderAccountId: string): Promise<void> {
  const keySet = keys(senderAccountId, reservationId)
  await redisConnection.eval(releaseScript, 4, keySet[2], keySet[3], keySet[5], keySet[7], reservationId)
}

export async function refreshEmailSendReservation(reservationId: string, senderAccountId: string): Promise<boolean> {
  const leaseKey = keys(senderAccountId, reservationId)[7]
  return (await redisConnection.pexpire(leaseKey, RESERVATION_LEASE_MS)) === 1
}

export { RESERVATION_HEARTBEAT_MS }
