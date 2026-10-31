import { useOutletContext } from 'react-router-dom'
import EmailList from '../components/email/EmailList'
import type { DashboardOutletContext } from '../components/layout/DashboardLayout'
import { useMailboxEmails } from '../hooks/useMailboxEmails'

export default function FailedEmails() {
  const { search, statusFilter, refreshKey } = useOutletContext<DashboardOutletContext>()
  const query = search.trim().toLowerCase()
  const { emails, loading, error, retry, page, totalPages, setPage } = useMailboxEmails('failed', search, refreshKey, statusFilter)

  return (
    <section className="failed-page">
      <EmailList
        emails={emails}
        loading={loading}
        error={error}
        onRetry={retry}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage={query || statusFilter ? 'No emails found' : 'No failed emails'}
        emptyDescription={query || statusFilter ? 'Try a different search or status.' : 'Emails that could not be delivered will appear here. Open an email to see the delivery error.'}
      />
    </section>
  )
}
