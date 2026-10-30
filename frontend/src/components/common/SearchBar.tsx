import { Search, X } from 'lucide-react'

export interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

export default function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <label className="dashboard-search">
      <Search size={12} strokeWidth={1.8} aria-hidden="true" />
      <input
        aria-label="Search emails"
        type="search"
        placeholder="Search"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      {value && <button type="button" onClick={() => onChange('')} aria-label="Clear search"><X size={14} /></button>}
    </label>
  )
}
