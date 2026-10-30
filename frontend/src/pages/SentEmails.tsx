import { useOutletContext } from 'react-router-dom'
import EmailList from '../components/email/EmailList'
import type { DashboardOutletContext } from '../components/layout/DashboardLayout'
import { useMailboxEmails } from '../hooks/useMailboxEmails'

export default function SentEmails() {
  const { search, statusFilter, refreshKey } = useOutletContext<DashboardOutletContext>()
  const query = search.trim().toLowerCase()
  const { emails, loading, error, retry, page, totalPages, setPage } = useMailboxEmails('sent', search, refreshKey, statusFilter)

  return (
    <section className="sent-page">
      <EmailList
        emails={emails}
        loading={loading}
        error={error}
        onRetry={retry}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage={query || statusFilter ? 'No emails found' : 'No sent emails'}
        emptyDescription={query || statusFilter ? 'Try a different search or status.' : 'Emails successfully sent will appear here.'}
      />
    </section>
  )
}
