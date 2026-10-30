import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { SenderAccount } from '../../services/email'

export interface SenderSelectorProps {
  selectedSender: SenderAccount | null
  senders: SenderAccount[]
  loading: boolean
  error?: string
  onRetry: () => void
  onSelect: (sender: SenderAccount) => void
}

export default function SenderSelector({ selectedSender, senders, loading, error, onRetry, onSelect }: SenderSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, senders.findIndex(sender => sender.id === selectedSender?.id))
  const [activeIndex, setActiveIndex] = useState(selectedIndex)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus()
  }, [open, activeIndex])

  function selectSender(sender: SenderAccount) {
    onSelect(sender)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function openDropdown() {
    setActiveIndex(selectedIndex)
    setOpen(value => !value)
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((index + direction + senders.length) % senders.length)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectSender(senders[index])
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && !containerRef.current?.contains(event.relatedTarget)) setOpen(false)
  }

  return (
    <div className="compose-field sender-field" onBlur={handleBlur} ref={containerRef}>
      <label htmlFor="compose-sender">From</label>
      <div className="sender-select-wrap">
        <button
          ref={triggerRef}
          id="compose-sender"
          className="sender-select-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls="sender-options"
          onClick={openDropdown}
          onKeyDown={handleTriggerKeyDown}
          disabled={loading || senders.length === 0}
        >
          <span>{loading ? 'Loading senders…' : selectedSender?.email ?? (senders.length ? 'Select a sender' : 'No sender accounts')}</span>
          {open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
        </button>
        {open && <div className="sender-options" id="sender-options" role="listbox" aria-label="Sender accounts">
          {senders.map((sender, index) => {
            const selected = sender.id === selectedSender?.id
            const initials = sender.displayName.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()
            return (
              <button
                ref={element => { optionRefs.current[index] = element }}
                className={`sender-option ${selected ? 'is-selected' : ''}`}
                key={sender.id}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={activeIndex === index ? 0 : -1}
                onClick={() => selectSender(sender)}
                onMouseEnter={() => setActiveIndex(index)}
                onKeyDown={event => handleOptionKeyDown(event, index)}
              >
                <span className="sender-option-avatar" aria-hidden="true">{initials}</span>
                <span className="sender-option-copy"><strong>{sender.displayName}</strong><small>{sender.email}</small></span>
                {selected && <Check className="sender-option-check" size={14} aria-label="Selected" />}
              </button>
            )
          })}
        </div>}
      </div>
      {error && <span className="compose-field-error" role="alert">{error} <button type="button" onClick={onRetry}>Retry</button></span>}
      {!loading && !error && senders.length === 0 && <span className="compose-field-error" role="status">Add a sender account before scheduling an email.</span>}
    </div>
  )
}
