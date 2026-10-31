import { prisma } from '../config/database'
import { assertStoredAttachmentExists } from './emailAttachmentStorage'
import { EmailDeliveryError, sendEmail } from './email.service'

export async function deliverEmailJob(emailJobId: string): Promise<Awaited<ReturnType<typeof sendEmail>>> {
  const emailJob = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    include: { senderAccount: true, recipients: true, attachments: true },
  })

  if (!emailJob?.senderAccount) throw new EmailDeliveryError('Sender account was not found', false)
  if (emailJob.recipients.length === 0) throw new EmailDeliveryError('Email job has no recipients', false)

  console.info(JSON.stringify({
    level: 'info',
    event: 'email_delivery_started',
    emailJobId: emailJob.id,
    recipientCount: emailJob.recipients.length,
  }))

  return sendEmail({
    senderEmail: emailJob.senderAccount.email,
    senderName: emailJob.senderAccount.displayName,
    recipients: emailJob.recipients.map(recipient => recipient.email),
    subject: emailJob.subject,
    html: emailJob.bodyHtml,
    attachments: await Promise.all(emailJob.attachments.map(async attachment => {
      let attachmentPath: string
      try {
        attachmentPath = await assertStoredAttachmentExists(attachment.storagePath)
      } catch {
        throw new EmailDeliveryError('A scheduled email attachment is unavailable', false)
      }
      return { filename: attachment.fileName, path: attachmentPath, contentType: attachment.mimeType }
    })),
  })
}
