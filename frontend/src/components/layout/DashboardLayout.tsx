import { useEffect, useState } from 'react'
import { Outlet, useLocation, useOutletContext } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import type { AuthenticatedUser } from '../../auth'

export interface DashboardOutletContext {
  search: string
  statusFilter: string
  toggleSidebar: () => void
  refreshKey: number
  refreshEmails: () => void
}

export default function DashboardLayout() {
  const user = useOutletContext<AuthenticatedUser>()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 600px)').matches)
  const location = useLocation()
  useEffect(() => {
    // The header filter is shared by both mailbox routes. Reset it on route
    // changes so a Sent filter cannot hide all Scheduled emails (or vice versa).
    setStatusFilter('')
  }, [location.pathname])
  const isComposing = location.pathname === '/compose'
  const isReadingEmail = location.pathname.startsWith('/dashboard/email/')
  const toggleSidebar = () => setCollapsed(value => !value)
  const refreshEmails = () => setRefreshKey(value => value + 1)
  const mailboxNotice = (location.state as { mailboxNotice?: string } | null)?.mailboxNotice

  return (
    <div className={`dashboard-shell ${isComposing ? 'is-composing' : ''} ${isReadingEmail ? 'is-reading-email' : ''}`}>
      {!isComposing && !isReadingEmail && <Sidebar collapsed={collapsed} onToggle={toggleSidebar} accountName={user.name || user.email} accountEmail={user.email} avatarUrl={user.avatarUrl} />}
      <div className="dashboard-main">
        {!isComposing && !isReadingEmail && <Header search={search} onSearchChange={setSearch} onToggleSidebar={toggleSidebar} onRefresh={refreshEmails} statusFilter={statusFilter} onStatusFilterChange={setStatusFilter} />}
        <main className={`dashboard-content ${location.pathname.startsWith('/dashboard/') ? 'dashboard-content-mailbox' : ''} ${isReadingEmail ? 'dashboard-content-detail' : ''} ${isComposing ? 'dashboard-content-compose' : ''}`}>
          {mailboxNotice && !isReadingEmail && <p className="dashboard-toast" role="status">{mailboxNotice}</p>}
          <Outlet context={{ search, statusFilter, toggleSidebar, refreshKey, refreshEmails } satisfies DashboardOutletContext} />
        </main>
      </div>
    </div>
  )
}
