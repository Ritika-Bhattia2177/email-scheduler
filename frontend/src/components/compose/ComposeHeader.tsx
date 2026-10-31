import { ArrowLeft, Clock3, Paperclip } from 'lucide-react'
import { useState } from 'react'

export interface ComposeHeaderProps {
  onBack: () => void
  onAttach: () => void
  attachmentCount: number
  onSend: () => void
  onScheduleConfirm: () => boolean
  onScheduleCancel: () => void
  submitting: boolean
  submittingMode: 'send' | 'schedule' | null
  scheduleLabel: string | null
  startDate: string
  startTime: string
  onStartDateChange: (value: string) => void
  onStartTimeChange: (value: string) => void
}

export default function ComposeHeader({ onBack, onAttach, attachmentCount, onSend, onScheduleConfirm, onScheduleCancel, submitting, submittingMode, scheduleLabel, startDate, startTime, onStartDateChange, onStartTimeChange }: ComposeHeaderProps) {
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`

  return (
    <header className="compose-header">
      <div className="compose-header-title">
        <button className="compose-back" type="button" onClick={onBack} aria-label="Go back"><ArrowLeft size={16} /></button>
        <div className="compose-header-copy"><h1>Compose New Email</h1>{scheduleLabel && <span className="compose-schedule-summary" role="status">Scheduled for {scheduleLabel}</span>}</div>
      </div>
      <div className="compose-header-actions">
        <button className="compose-icon-button compose-attach-button" type="button" disabled={submitting} onClick={onAttach} aria-label={attachmentCount ? `Attach files, ${attachmentCount} selected` : 'Attach files'} title={attachmentCount ? `Attach files (${attachmentCount} selected)` : 'Attach files'}>
          <Paperclip size={18} />
          {attachmentCount > 0 && <span className="compose-attachment-count" aria-hidden="true">{attachmentCount}</span>}
        </button>
        <div className="compose-schedule-wrap">
          <button className="compose-icon-button compose-schedule-button" type="button" disabled={submitting} aria-expanded={scheduleOpen} aria-label="Choose scheduled send date and time" title="Schedule send" onClick={() => setScheduleOpen(value => !value)}><Clock3 size={18} /></button>
          {scheduleOpen && <div className="schedule-popover" role="dialog" aria-label="Schedule send">
            <strong>Schedule send</strong>
            <label className="schedule-popover-date-label" htmlFor="schedule-date">Pick date &amp; time</label>
            <input id="schedule-date" type="date" value={startDate} onChange={event => onStartDateChange(event.target.value)} />
            <input aria-label="Scheduled time" type="time" value={startTime} onChange={event => onStartTimeChange(event.target.value)} />
            <div className="schedule-quick-options">
              <button type="button" onClick={() => { onStartDateChange(tomorrowDate); onStartTimeChange('09:00') }}>Tomorrow</button>
              <button type="button" onClick={() => { onStartDateChange(tomorrowDate); onStartTimeChange('10:00') }}>Tomorrow, 10:00 AM</button>
              <button type="button" onClick={() => { onStartDateChange(tomorrowDate); onStartTimeChange('11:00') }}>Tomorrow, 11:00 AM</button>
              <button type="button" onClick={() => { onStartDateChange(tomorrowDate); onStartTimeChange('15:00') }}>Tomorrow, 3:00 PM</button>
            </div>
            <div className="schedule-popover-actions">
              <button type="button" className="schedule-cancel" onClick={() => { onScheduleCancel(); setScheduleOpen(false) }}>{scheduleLabel ? 'Clear schedule' : 'Cancel'}</button>
              <button type="button" className="schedule-done" onClick={() => { if (onScheduleConfirm()) setScheduleOpen(false) }} disabled={submitting}>{submittingMode === 'schedule' ? 'Scheduling…' : 'Schedule email'}</button>
            </div>
          </div>}
        </div>
        <button
          className={`compose-submit-button ${scheduleLabel ? 'is-send-later' : 'is-send-now'}`}
          type="button"
          disabled={submitting}
          aria-busy={submitting}
          aria-label={scheduleLabel ? 'Send later' : 'Send immediately'}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onSend()
          }}
        >
          {submittingMode === 'send' ? 'Sending…' : submittingMode === 'schedule' ? 'Scheduling…' : scheduleLabel ? 'Send Later' : 'Send'}
        </button>
      </div>
    </header>
  )
}
