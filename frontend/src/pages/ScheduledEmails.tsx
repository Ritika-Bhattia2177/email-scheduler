import { useOutletContext } from 'react-router-dom'
import EmailList from '../components/email/EmailList'
import type { DashboardOutletContext } from '../components/layout/DashboardLayout'
import { useMailboxEmails } from '../hooks/useMailboxEmails'

export default function ScheduledEmails() {
  const { search, statusFilter, refreshKey } = useOutletContext<DashboardOutletContext>()
  const query = search.trim().toLowerCase()
  const { emails, loading, error, retry, page, totalPages, setPage } = useMailboxEmails('scheduled', search, refreshKey, statusFilter)

  return (
    <section className="scheduled-page">
      <header className="mailbox-heading">
        <div><span>MAILBOX</span><h1>Scheduled</h1><p>Emails waiting to be sent</p></div>
      </header>
      <EmailList
        emails={emails}
        loading={loading}
        error={error}
        onRetry={retry}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage={query || statusFilter ? 'No emails found' : 'No scheduled emails'}
        emptyDescription={query || statusFilter ? 'Try a different search or status.' : 'Emails you schedule will appear here.'}
      />
    </section>
  )
}
