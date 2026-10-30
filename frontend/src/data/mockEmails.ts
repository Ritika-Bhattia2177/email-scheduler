export interface Email {
  id: string
  sender: string
  senderEmail: string
  recipient: string
  recipientEmail: string
  subject: string
  detailSubject?: string
  detailRecipient?: string
  detailDate?: string
  preview: string
  body: string
  highlightedContent?: string
  scheduledAt?: string
  sentAt?: string
  status: 'scheduled' | 'sent' | 'failed' | 'processing' | 'cancelled'
  attachments?: EmailAttachment[]
}

export interface EmailAttachment {
  id: string
  name: string
  url?: string
  type?: string
}

export interface ScheduledEmail extends Email {
  scheduledAt: string
  status: 'scheduled'
}

export interface SentEmail extends Email {
  sentAt: string
  status: 'sent'
}

export type MailboxEmail = Email

export const mockEmails: ScheduledEmail[] = [
  {
    id: '1', sender: 'Amanda Clark', senderEmail: 'sender@example.com', recipient: 'John Smith', recipientEmail: 'john.smith@example.com',
    subject: 'Meeting follow-up', preview: 'Hi John, just wanted to follow up on our meeting...',
    detailSubject: 'Oliver, hello there! | MJWY744 BM#52W01', detailRecipient: 'me', detailDate: 'Nov 3, 10:23 AM',
    body: 'Hey Oliver,\n\nYou’ve just RECEIVED something\n\n⚡ Extremely Exclusive—Only 4 Spots Worldwide Per Year | $25,000 investment ⚡\n⚡ To explore securing your private transformation, simply reply right now with “FLY OUT FIX”.\n\nYour coach for world-class performance,\n\nGrant\n\nP.S. Always remember that you can develop world class techniques! 🎾',
    highlightedContent: '⚡ Extremely Exclusive—Only 4 Spots Worldwide Per Year | $25,000 investment ⚡\n⚡ To explore securing your private transformation, simply reply right now with “FLY OUT FIX”.',
    scheduledAt: 'Tue 9:15:12 AM', status: 'scheduled',
    attachments: [
      { id: 'tennis-1', name: 'Tennis_Coach_Profile.png', type: 'image/png' },
      { id: 'tennis-2', name: 'Tennis_Coach_Profile2.png', type: 'image/png' },
    ],
  },
  {
    id: '2', sender: 'Oliver Brown', senderEmail: 'oliver.brown@domain.io', recipient: 'Olive', recipientEmail: 'olive@example.com',
    subject: "Ramit, great to meet you - you'll love it", preview: 'Hi Olive, was wondering if you had a chance to look...',
    body: "Hi Olive,\n\nRamit, great to meet you — you'll love it. Was wondering if you had a chance to look over the details.\n\nBest,\nOliver",
    scheduledAt: 'Thu 8:15:12 PM', status: 'scheduled',
  },
]

export const sentEmails: SentEmail[] = [
  {
    id: 'sent-1', sender: 'Oliver Brown', senderEmail: 'oliver.brown@domain.io', recipient: 'Sarah Wilson', recipientEmail: 'sarah.wilson@example.com',
    subject: 'Re: Project Update', preview: 'Thanks for the update, Sarah. Looks good!',
    body: 'Hi Sarah,\n\nThanks for the update, Sarah. Looks good!\n\nBest,\nOliver',
    sentAt: 'Oct 28, 2026, 10:30 AM', status: 'sent',
  },
  {
    id: 'sent-2', sender: 'Oliver Brown', senderEmail: 'oliver.brown@domain.io', recipient: 'Support', recipientEmail: 'support@reachinbox.io',
    subject: 'Issue with login', preview: 'I am having trouble logging in to the dashboard...',
    body: 'Hello Support,\n\nI am having trouble logging in to the dashboard.\n\nRegards,\nOliver',
    sentAt: 'Oct 28, 2026, 11:45 AM', status: 'sent',
  },
]
