import { Link } from 'react-router-dom'
import { Clock3, Star } from 'lucide-react'
import type { MailboxEmail } from '../../services/email'
import StatusBadge from './StatusBadge'

export interface EmailRowProps {
  email: MailboxEmail
}

export default function EmailRow({ email }: EmailRowProps) {
  if (email.status === 'scheduled') {
    return (
      <Link className="email-row email-row-scheduled" role="listitem" to={`/dashboard/email/${email.id}`} aria-label={`${email.subject}, scheduled to ${email.recipient} at ${email.scheduledAt}`}>
        <span className="email-row-to">To: {email.recipient}</span>
        <span className="email-row-scheduled-time"><Clock3 size={8} aria-hidden="true" />{email.scheduledAt}</span>
        <span className="email-row-scheduled-content">
          <strong>{email.subject}</strong>
          <span className="email-row-scheduled-state"> - Scheduled - </span>
          <span className="email-row-scheduled-preview">{email.preview} · from {email.sender}</span>
        </span>
        <Star className="email-row-star" size={12} aria-hidden="true" />
      </Link>
    )
  }

  if (email.status === 'sent') {
    return (
      <Link className="email-row email-row-sent" role="listitem" to={`/dashboard/email/${email.id}`} aria-label={`${email.subject}, sent to ${email.recipient}`}>
        <span className="email-row-to">To: {email.recipient}</span>
        <StatusBadge status="sent" />
        <span className="email-row-sent-content"><strong>{email.subject}</strong><span> · {email.preview} · from {email.sender} · {email.sentAt}</span></span>
        <Star className="email-row-star" size={12} aria-hidden="true" />
      </Link>
    )
  }

  const initials = email.recipient.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()
  const date = email.scheduledAt ?? email.sentAt
  return (
    <Link className="email-row" role="listitem" to={`/dashboard/email/${email.id}`} aria-label={`${email.subject}, to ${email.recipientEmail}, from ${email.sender}`}>
      <span className="recipient-avatar" aria-hidden="true">{initials}</span>
      <div className="recipient-info">
        <span className="recipient-name">{email.recipientEmail}</span>
        <span className="recipient-address">to {email.recipient} · from {email.sender}</span>
      </div>
      <div className="email-subject"><strong>{email.subject}</strong><span className="email-preview"> — {email.preview}</span></div>
      <div className="email-schedule">{date}</div>
      <StatusBadge status={email.status} />
    </Link>
  )
}
