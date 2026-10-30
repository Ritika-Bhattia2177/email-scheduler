import type { MailboxEmail } from '../../services/email'
import EmailRow from './EmailRow'
import EmailListError from './EmailListError'
import EmailListSkeleton from './EmailListSkeleton'

export interface EmailListProps {
  emails: MailboxEmail[]
  emptyMessage: string
  emptyDescription?: string
  loading?: boolean
  error?: string
  onRetry?: () => void
  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
}

export default function EmailList({ emails, emptyMessage, emptyDescription, loading = false, error, onRetry, page, totalPages, onPageChange }: EmailListProps) {
  if (loading) return <EmailListSkeleton />
  if (error) return <EmailListError message={error} onRetry={onRetry} />

  if (emails.length === 0) {
    return <div className="email-empty" role="status"><strong>{emptyMessage}</strong>{emptyDescription && <span>{emptyDescription}</span>}</div>
  }

  return <>
    <div className="email-list" role="list" aria-label="Emails">{emails.map(email => <EmailRow key={email.id} email={email} />)}</div>
    {page !== undefined && totalPages !== undefined && totalPages > 1 && onPageChange && <nav className="email-pagination" aria-label="Email pages">
      <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>Next</button>
    </nav>}
  </>
}
