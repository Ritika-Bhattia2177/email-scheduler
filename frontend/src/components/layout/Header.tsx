import { Menu, RefreshCw } from 'lucide-react'
import SearchBar from '../common/SearchBar'

export interface HeaderProps {
  search: string
  onSearchChange: (value: string) => void
  onToggleSidebar: () => void
  onRefresh: () => void
  statusFilter: string
  onStatusFilterChange: (value: string) => void
}

export default function Header({ search, onSearchChange, onToggleSidebar, onRefresh, statusFilter, onStatusFilterChange }: HeaderProps) {
  return (
    <header className="dashboard-header">
      <button className="mobile-menu" type="button" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        <Menu size={18} />
      </button>
      <SearchBar value={search} onChange={onSearchChange} />
      <select className="dashboard-status-filter" aria-label="Filter emails by status" value={statusFilter} onChange={event => onStatusFilterChange(event.target.value)}>
        <option value="">Default view</option>
        <option value="SCHEDULED">Scheduled</option>
        <option value="PROCESSING">Processing</option>
        <option value="SENT">Sent</option>
        <option value="FAILED">Failed</option>
        <option value="CANCELLED">Cancelled</option>
        <option value="ALL">All statuses</option>
      </select>
      <button className="dashboard-header-action" type="button" aria-label="Refresh emails" title="Refresh emails" onClick={onRefresh}><RefreshCw size={12} /></button>
    </header>
  )
}
