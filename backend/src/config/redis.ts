import Redis from 'ioredis'
import { env } from './env'
import { redactSecrets } from '../utils/redactSecrets'

export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  maxRetriesPerRequest: null,
})

let connectionWarningLogged = false

redisConnection.on('error', (error: Error) => {
  if (connectionWarningLogged) return
  connectionWarningLogged = true
  console.warn(JSON.stringify({
    level: 'warn',
    event: 'redis_unavailable',
    message: redactSecrets(error.message),
    note: 'The API can start, but scheduled email jobs require Redis. The connection will retry automatically.',
  }))
})

redisConnection.on('ready', () => {
  if (connectionWarningLogged) {
    console.info(JSON.stringify({ level: 'info', event: 'redis_connection_restored' }))
  }
  connectionWarningLogged = false
})

export async function closeRedisConnection(): Promise<void> {
  if (redisConnection.status === 'end') return

  if (redisConnection.status === 'ready') {
    await redisConnection.quit()
    return
  }

  redisConnection.disconnect()
}
