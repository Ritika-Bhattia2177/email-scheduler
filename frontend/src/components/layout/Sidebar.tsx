import { NavLink, useNavigate } from 'react-router-dom'
import { AlertCircle, Clock3, ChevronDown, Mail, Plus, Send, Slack } from 'lucide-react'
import type { ReactNode } from 'react'
import UserMenu from '../common/UserMenu'

export interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  accountName: string
  accountEmail: string
  avatarUrl: string | null
}

export default function Sidebar({ collapsed, onToggle, accountName, accountEmail, avatarUrl }: SidebarProps) {
  const navigate = useNavigate()

  return (
    <aside className={`dashboard-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-topline">
        <button className="app-logo" type="button" onClick={() => { if (collapsed) onToggle(); navigate('/dashboard/scheduled') }} aria-label="ReachInbox home" title="ReachInbox home">
          <span className="app-logo-mark"><Mail size={16} strokeWidth={1.8} /></span>
          <span className="app-logo-name">ONB</span>
        </button>
        <button className="sidebar-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <ChevronDown size={14} />
        </button>
      </div>

      <UserMenu name={accountName} email={accountEmail} avatarUrl={avatarUrl} />

      <button className="compose-button" type="button" onClick={() => navigate('/compose')}>
        <Plus size={13} strokeWidth={1.8} />
        <span>Compose</span>
      </button>

      <nav className="sidebar-nav" aria-label="Mailbox">
        <span className="sidebar-section-label">CORE</span>
        <SidebarLink to="/dashboard/scheduled" label="Scheduled" icon={<Clock3 size={12} strokeWidth={1.8} />} />
        <SidebarLink to="/dashboard/sent" label="Sent" icon={<Send size={12} strokeWidth={1.8} />} />
        <SidebarLink to="/dashboard/failed" label="Failed" icon={<AlertCircle size={12} strokeWidth={1.8} />} />
        <span className="sidebar-section-label">INTEGRATIONS</span>
        <SidebarLink to="/dashboard/integrations/slack" label="Slack" icon={<Slack size={12} strokeWidth={1.8} />} />
      </nav>
      <div className="sidebar-spacer" />
    </aside>
  )
}

function SidebarLink({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  return <NavLink to={to} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} title={label}>{icon}<span>{label}</span></NavLink>
}
