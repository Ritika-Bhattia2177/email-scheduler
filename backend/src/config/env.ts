import dotenv from 'dotenv'

dotenv.config()

function requiredString(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function integer(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer${maximum < Number.MAX_SAFE_INTEGER ? ` no greater than ${maximum}` : ''}`)
  }
  return parsed
}

function nonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return parsed
}

function optionalString(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be either true or false`)
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error('NODE_ENV must be development, test, or production')
}

const authModeValue = optionalString('AUTH_MODE') ?? 'production'
if (authModeValue !== 'development' && authModeValue !== 'production') {
  throw new Error('AUTH_MODE must be development or production')
}
if (nodeEnv === 'production' && authModeValue === 'development') {
  throw new Error('AUTH_MODE=development cannot be used when NODE_ENV=production')
}

function allowedOrigins(): string[] {
  const configured = optionalString('CORS_ALLOWED_ORIGINS')
  const values = configured ? configured.split(',').map(value => value.trim()).filter(Boolean) : []
  if (values.length === 0) {
    try {
      const fallback = new URL(optionalString('FRONTEND_URL') ?? 'http://localhost:5173')
      if (!['http:', 'https:'].includes(fallback.protocol)) throw new Error('invalid protocol')
      return [fallback.origin]
    } catch {
      throw new Error('FRONTEND_URL must be a valid HTTP(S) URL')
    }
  }
  const origins = values
  return [...new Set(origins.map(value => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error('CORS_ALLOWED_ORIGINS must contain valid HTTP(S) origins')
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value.replace(/\/$/, '')) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain valid HTTP(S) origins')
    }
    return url.origin
  }))]
}

const databaseUrl = requiredString('DATABASE_URL')
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection URL')
}

export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production'
  AUTH_MODE: 'development' | 'production'
  PORT: number
  DATABASE_URL: string
  REDIS_HOST: string
  REDIS_PORT: number
  REDIS_PASSWORD?: string
  WORKER_CONCURRENCY: number
  EMAIL_DELAY_MS: number
  MAX_EMAILS_PER_HOUR: number
  MAX_EMAILS_PER_SENDER_PER_HOUR: number
  SMTP_HOST: string
  SMTP_PORT: number
  SMTP_SECURE: boolean
  SMTP_USER?: string
  SMTP_PASSWORD?: string
  SMTP_FROM?: string
  ELASTICSEARCH_NODE: string
  ELASTICSEARCH_INDEX: string
  ELASTICSEARCH_CA_CERT_PATH: string
  ELASTICSEARCH_API_KEY?: string
  ELASTICSEARCH_USERNAME?: string
  ELASTICSEARCH_PASSWORD?: string
  SLACK_CLIENT_ID?: string
  SLACK_CLIENT_SECRET?: string
  SLACK_REDIRECT_URI?: string
  SLACK_SCOPES: string
  SLACK_NOTIFICATION_CHANNEL_ID?: string
  SLACK_TOKEN_ENCRYPTION_KEY?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_REDIRECT_URI: string
  AUTH_SESSION_SECRET?: string
  FRONTEND_URL: string
  CORS_ALLOWED_ORIGINS: string[]
  BULL_BOARD_ENABLED: boolean
  QUEUE_DASHBOARD_USERNAME?: string
  QUEUE_DASHBOARD_PASSWORD?: string
}

export const env: Environment = {
  NODE_ENV: nodeEnv as Environment['NODE_ENV'],
  AUTH_MODE: authModeValue,
  PORT: integer('PORT', 5000, 65535),
  DATABASE_URL: databaseUrl,
  REDIS_HOST: optionalString('REDIS_HOST') ?? 'localhost',
  REDIS_PORT: integer('REDIS_PORT', 6379, 65535),
  REDIS_PASSWORD: optionalString('REDIS_PASSWORD'),
  WORKER_CONCURRENCY: integer('WORKER_CONCURRENCY', 5),
  EMAIL_DELAY_MS: nonNegativeInteger('EMAIL_DELAY_MS', 1000),
  MAX_EMAILS_PER_HOUR: integer('MAX_EMAILS_PER_HOUR', 100),
  MAX_EMAILS_PER_SENDER_PER_HOUR: integer('MAX_EMAILS_PER_SENDER_PER_HOUR', 50),
  SMTP_HOST: optionalString('SMTP_HOST') ?? 'smtp.ethereal.email',
  SMTP_PORT: integer('SMTP_PORT', 587, 65535),
  SMTP_SECURE: boolean('SMTP_SECURE', false),
  SMTP_USER: optionalString('SMTP_USER'),
  SMTP_PASSWORD: optionalString('SMTP_PASSWORD'),
  SMTP_FROM: optionalString('SMTP_FROM'),
  ELASTICSEARCH_NODE: optionalString('ELASTICSEARCH_NODE') ?? 'http://localhost:9200',
  ELASTICSEARCH_INDEX: optionalString('ELASTICSEARCH_INDEX') ?? 'emails',
  ELASTICSEARCH_CA_CERT_PATH: optionalString('ELASTICSEARCH_CA_CERT_PATH') ?? './http_ca.crt',
  ELASTICSEARCH_API_KEY: optionalString('ELASTICSEARCH_API_KEY'),
  ELASTICSEARCH_USERNAME: optionalString('ELASTICSEARCH_USERNAME'),
  ELASTICSEARCH_PASSWORD: optionalString('ELASTICSEARCH_PASSWORD'),
  SLACK_CLIENT_ID: optionalString('SLACK_CLIENT_ID'),
  SLACK_CLIENT_SECRET: optionalString('SLACK_CLIENT_SECRET'),
  SLACK_REDIRECT_URI: optionalString('SLACK_REDIRECT_URI'),
  SLACK_SCOPES: optionalString('SLACK_SCOPES') ?? 'chat:write',
  SLACK_NOTIFICATION_CHANNEL_ID: optionalString('SLACK_NOTIFICATION_CHANNEL_ID'),
  SLACK_TOKEN_ENCRYPTION_KEY: optionalString('SLACK_TOKEN_ENCRYPTION_KEY'),
  GOOGLE_CLIENT_ID: optionalString('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: optionalString('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REDIRECT_URI: optionalString('GOOGLE_REDIRECT_URI') ?? 'http://localhost:5000/api/auth/google/callback',
  AUTH_SESSION_SECRET: optionalString('AUTH_SESSION_SECRET'),
  FRONTEND_URL: (optionalString('FRONTEND_URL') ?? 'http://localhost:5173').replace(/\/$/, ''),
  CORS_ALLOWED_ORIGINS: allowedOrigins(),
  BULL_BOARD_ENABLED: boolean('BULL_BOARD_ENABLED', nodeEnv !== 'production'),
  // Prefer the public BULL_BOARD_* names; preserve the previous names for
  // existing local deployments that have not migrated their environment yet.
  QUEUE_DASHBOARD_USERNAME: optionalString('BULL_BOARD_USERNAME') ?? optionalString('QUEUE_DASHBOARD_USERNAME'),
  QUEUE_DASHBOARD_PASSWORD: optionalString('BULL_BOARD_PASSWORD') ?? optionalString('QUEUE_DASHBOARD_PASSWORD'),
}
