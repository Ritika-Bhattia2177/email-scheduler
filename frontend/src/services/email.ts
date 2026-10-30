export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED'
export type MailboxStatus = Lowercase<EmailStatus>

export interface Email {
  id: string
  sender: string
  senderEmail: string
  recipient: string
  recipientEmail: string
  subject: string
  preview: string
  body: string
  scheduledAt?: string
  sentAt?: string
  status: MailboxStatus
}

export type MailboxEmail = Email

export interface EmailAttachment {
  id: string
  name: string
  type?: string
  size?: number
}

export interface SenderAccount {
  id: string
  email: string
  displayName: string
}

export interface EmailRecipientRecord {
  id: string
  email: string
}

export interface EmailAttachmentRecord {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
}

export interface EmailEventRecord {
  id: string
  type: string
  message: string | null
  createdAt: string
}

export interface EmailJobRecord {
  id: string
  subject: string
  bodyHtml: string
  status: EmailStatus
  scheduledAt: string
  sentAt: string | null
  createdAt: string
  updatedAt: string
  senderAccount: SenderAccount
  recipients: EmailRecipientRecord[]
  attachments?: EmailAttachmentRecord[]
  events?: EmailEventRecord[]
}

export interface EmailSearchResult {
  id: string
  sender: SenderAccount
  recipients: string[]
  subject: string
  status: EmailStatus
  scheduledAt: string
  sentAt: string | null
  createdAt: string
}

export interface EmailSearchResponse {
  results: EmailSearchResult[]
  emails: EmailSearchResult[]
  page: number
  limit: number
  total: number
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export function toMailboxEmail(job: EmailJobRecord | EmailSearchResult): Email {
  const isSearchResult = 'sender' in job
  const sender = isSearchResult ? job.sender : job.senderAccount
  const recipientEmails = isSearchResult ? job.recipients : job.recipients.map(recipient => recipient.email)
  const firstRecipient = recipientEmails[0] ?? 'No recipient'
  const senderName = sender.displayName || sender.email
  const status = job.status.toLowerCase() as Email['status']
  const scheduledAt = formatLocalDate(job.scheduledAt)
  const sentAt = job.sentAt ? formatLocalDate(job.sentAt) : undefined
  const body = isSearchResult ? '' : htmlToPlainText(job.bodyHtml)

  return {
    id: job.id,
    sender: senderName,
    senderEmail: sender.email,
    recipient: recipientEmails.length > 1 ? `${firstRecipient} +${recipientEmails.length - 1}` : firstRecipient,
    recipientEmail: firstRecipient,
    subject: job.subject,
    preview: body.slice(0, 160),
    body,
    scheduledAt,
    ...(sentAt ? { sentAt } : {}),
    status,
  }
}

export function toEmailAttachments(records: EmailAttachmentRecord[] = []): EmailAttachment[] {
  return records.map(record => ({ id: record.id, name: record.fileName, type: record.mimeType, size: record.fileSize }))
}

export function formatLocalDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
  const container = document.createElement('div')
  container.innerHTML = withBreaks
  return (container.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim()
}

export function isEmailJobRecord(value: unknown): value is EmailJobRecord {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string'
    && 'senderAccount' in value && typeof value.senderAccount === 'object' && value.senderAccount !== null
    && 'recipients' in value && Array.isArray(value.recipients)
}
