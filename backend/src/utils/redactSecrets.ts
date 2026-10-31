import { env } from '../config/env'

const configuredSecrets = [
  env.DATABASE_URL,
  env.REDIS_URL,
  env.REDIS_PASSWORD,
  env.SMTP_HOST,
  env.SMTP_USER,
  env.SMTP_PASSWORD,
  env.ELASTICSEARCH_API_KEY,
  env.ELASTICSEARCH_USERNAME,
  env.ELASTICSEARCH_PASSWORD,
  env.SLACK_CLIENT_SECRET,
  env.SLACK_TOKEN_ENCRYPTION_KEY,
  env.GOOGLE_CLIENT_SECRET,
  env.AUTH_SESSION_SECRET,
  env.QUEUE_DASHBOARD_PASSWORD,
].filter((secret): secret is string => Boolean(secret))

export function redactSecrets(message: string): string {
  let safeMessage = message
  for (const secret of configuredSecrets) safeMessage = safeMessage.replaceAll(secret, '[REDACTED]')
  safeMessage = safeMessage.replace(/((?:postgres(?:ql)?|redis|https?):\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@')
  return safeMessage.replaceAll(env.ELASTICSEARCH_NODE, '[REDACTED_ENDPOINT]')
}
