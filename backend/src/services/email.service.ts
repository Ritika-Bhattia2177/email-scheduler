import nodemailer from 'nodemailer'
import type { SentMessageInfo, Transporter } from 'nodemailer'
import { env } from '../config/env'

export interface EmailAttachmentInput {
  filename: string
  path: string
  contentType: string
}

export interface SendEmailInput {
  senderEmail: string
  senderName: string
  recipients: string[]
  subject: string
  html: string
  attachments: EmailAttachmentInput[]
}

export interface SendEmailResult {
  info: SentMessageInfo
  previewUrl: string | undefined
}

export class EmailDeliveryError extends Error {
  constructor(message: string, public readonly retryable: boolean, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EmailDeliveryError'
  }
}

let transporterPromise: Promise<Transporter<SentMessageInfo>> | undefined
let etherealTransporter = false

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const transporter = await getTransporter()
  const from = env.SMTP_FROM ?? `${input.senderName} <${input.senderEmail}>`

  try {
    const info = await transporter.sendMail({
      from,
      to: input.recipients,
      subject: input.subject,
      text: htmlToText(input.html),
      html: input.html,
      attachments: input.attachments,
    })

    const preview = etherealTransporter ? nodemailer.getTestMessageUrl(info) : false
    return { info, previewUrl: typeof preview === 'string' ? preview : undefined }
  } catch (error) {
    throw new EmailDeliveryError(errorMessage(error), true, { cause: error })
  }
}

async function getTransporter(): Promise<Transporter<SentMessageInfo>> {
  if (transporterPromise) return transporterPromise

  transporterPromise = createTransporter()
  try {
    return await transporterPromise
  } catch (error) {
    transporterPromise = undefined
    throw error
  }
}

async function createTransporter(): Promise<Transporter<SentMessageInfo>> {
  const hasUser = env.SMTP_USER !== undefined
  const hasPassword = env.SMTP_PASSWORD !== undefined
  if (hasUser !== hasPassword) {
    throw new EmailDeliveryError('SMTP_USER and SMTP_PASSWORD must be configured together', false)
  }

  if (hasUser && env.SMTP_USER && env.SMTP_PASSWORD) {
    etherealTransporter = false
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    })
  }

  if (env.NODE_ENV === 'production') {
    throw new EmailDeliveryError('SMTP credentials are required in production', false)
  }

  try {
    const account = await nodemailer.createTestAccount()
    etherealTransporter = true
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: account.user, pass: account.pass },
    })
  } catch (error) {
    throw new EmailDeliveryError(`Unable to create Ethereal test account: ${errorMessage(error)}`, true, { cause: error })
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown email delivery error'
}
