import { Filter, Menu, RefreshCw } from 'lucide-react'
import { useState } from 'react'
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
  const [filterOpen, setFilterOpen] = useState(false)

  return (
    <header className="dashboard-header">
      <button className="mobile-menu" type="button" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        <Menu size={18} />
      </button>
      <SearchBar value={search} onChange={onSearchChange} />
      <div className="dashboard-filter-wrap">
        <button
          className={`dashboard-header-action ${statusFilter ? 'is-active' : ''}`}
          type="button"
          aria-label="Filter emails by status"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(value => !value)}
        >
          <Filter size={12} />
        </button>
        {filterOpen && (
          <div className="dashboard-filter-menu" role="menu" aria-label="Email status filter">
            <button type="button" className={!statusFilter ? 'is-selected' : ''} onClick={() => { onStatusFilterChange(''); setFilterOpen(false) }}>All statuses</button>
            <button type="button" className={statusFilter === 'SCHEDULED' ? 'is-selected' : ''} onClick={() => { onStatusFilterChange('SCHEDULED'); setFilterOpen(false) }}>Scheduled</button>
            <button type="button" className={statusFilter === 'SENT' ? 'is-selected' : ''} onClick={() => { onStatusFilterChange('SENT'); setFilterOpen(false) }}>Sent</button>
          </div>
        )}
      </div>
      <button className="dashboard-header-action" type="button" aria-label="Refresh emails" title="Refresh emails" onClick={onRefresh}><RefreshCw size={12} /></button>
    </header>
  )
}
