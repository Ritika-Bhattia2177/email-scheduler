export interface EmailQueueJobData {
  emailJobId: string
  idempotencyKey: string
  senderAccountId: string
  senderEmail: string
  scheduledAt: string
  minimumDelayMs?: number
  hourlyLimit?: number
  recipientEmails: string[]
  subject: string
  bodyHtml: string
}

export interface EmailQueueJobResult {
  outcome: 'sent' | 'sent-status-persistence-failed' | 'missing' | 'cancelled' | 'already-sent' | 'already-processing' | 'not-claimed'
}

export interface EnqueuedEmailJob {
  jobId: string
  delay: number
  alreadyEnqueued: boolean
}
