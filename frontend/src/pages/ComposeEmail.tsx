import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import AttachmentPreview, { type ComposeAttachment } from '../components/compose/AttachmentPreview'
import ComposeHeader from '../components/compose/ComposeHeader'
import RecipientInput, { isValidRecipientEmail, type Recipient, type RecipientInputHandle } from '../components/compose/RecipientInput'
import RichTextEditor from '../components/compose/RichTextEditor'
import SchedulingControls from '../components/compose/SchedulingControls'
import type { DelayUnit } from '../components/compose/SchedulingControls'
import SenderSelector from '../components/compose/SenderSelector'
import UploadList from '../components/compose/UploadList'
import { getApiErrorMessage, getData, postData } from '../services/api'
import { formatLocalDate, type EmailJobRecord, type SenderAccount } from '../services/email'
import type { DashboardOutletContext } from '../components/layout/DashboardLayout'

interface ComposeFeedback {
  type: 'error' | 'success'
  message: string
}

interface ScheduleEmailPayload {
  senderAccountId: string
  subject: string
  bodyHtml: string
  recipientEmails: string[]
  scheduledAt: string
  minimumDelayMs: number
  hourlyLimit: number
}

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENT_COUNT = 10
const allowedAttachmentTypes = new Map<string, readonly string[]>([
  ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.txt', ['text/plain']],
  ['.csv', ['text/csv', 'application/vnd.ms-excel']],
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.gif', ['image/gif']],
  ['.webp', ['image/webp']],
])

export default function ComposeEmail() {
  const navigate = useNavigate()
  const { refreshEmails } = useOutletContext<DashboardOutletContext>()
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const recipientInputRef = useRef<RecipientInputHandle>(null)
  const inFlightRef = useRef(false)
  const submissionAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const [senders, setSenders] = useState<SenderAccount[]>([])
  const [sendersLoading, setSendersLoading] = useState(true)
  const [sendersError, setSendersError] = useState('')
  const [selectedSender, setSelectedSender] = useState<SenderAccount | null>(null)
  const [showSenderForm, setShowSenderForm] = useState(false)
  const [newSenderEmail, setNewSenderEmail] = useState('reachinbox.test@example.com')
  const [newSenderDisplayName, setNewSenderDisplayName] = useState('ReachInbox Test')
  const [creatingSender, setCreatingSender] = useState(false)
  const [senderCreationError, setSenderCreationError] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [scheduledAt, setScheduledAt] = useState<string | null>(null)
  const [delayValue, setDelayValue] = useState(5)
  const [delayUnit, setDelayUnit] = useState<DelayUnit>('seconds')
  const [hourlyLimit, setHourlyLimit] = useState(50)
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [feedback, setFeedback] = useState<ComposeFeedback | null>(null)
  const [submittingMode, setSubmittingMode] = useState<'send' | 'schedule' | null>(null)
  const submitting = submittingMode !== null
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null
  const hasValidScheduledTime = scheduledDate !== null
    && Number.isFinite(scheduledDate.getTime())
    && scheduledDate.getTime() > Date.now()

  const loadSenders = useCallback(async () => {
    setSendersLoading(true)
    setSendersError('')
    try {
      const result = await getData<SenderAccount[]>('/senders')
      setSenders(result)
      setSelectedSender(current => current && result.some(sender => sender.id === current.id) ? current : result[0] ?? null)
    } catch (error) {
      setSendersError(getApiErrorMessage(error))
    } finally {
      setSendersLoading(false)
    }
  }, [])

  async function createSender() {
    if (creatingSender) return
    if (!newSenderEmail.trim() || !newSenderDisplayName.trim()) {
      setSenderCreationError('Enter both an email address and display name.')
      return
    }
    setCreatingSender(true)
    setSenderCreationError('')
    try {
      const sender = await postData<SenderAccount>('/senders', {
        email: newSenderEmail,
        displayName: newSenderDisplayName,
      })
      setSenders(current => current.some(item => item.id === sender.id) ? current : [...current, sender])
      setSelectedSender(sender)
      setShowSenderForm(false)
    } catch (error) {
      setSenderCreationError(getApiErrorMessage(error))
    } finally {
      setCreatingSender(false)
    }
  }

  useEffect(() => { void loadSenders() }, [loadSenders])

  function addRecipientsFromList(emails: string[]) {
    setRecipients(current => {
      const unique = new Map(current.map(recipient => [recipient.email.trim().toLowerCase(), recipient]))
      emails.forEach(candidate => {
        const email = candidate.trim().toLowerCase()
        if (isValidRecipientEmail(email) && !unique.has(email)) unique.set(email, { email })
      })
      return [...unique.values()]
    })
  }

  function removeRecipient(email: string) {
    setRecipients(current => current.filter(recipient => recipient.email.toLowerCase() !== email.toLowerCase()))
  }

  function addAttachments(files: File[]) {
    let error = ''
    const validFiles: File[] = []
    let totalBytes = attachments.reduce((total, attachment) => total + attachment.file.size, 0)
    const selectedFileKeys = new Set(attachments.map(({ file }) => fileIdentity(file)))
    for (const file of files) {
      const identity = fileIdentity(file)
      if (selectedFileKeys.has(identity)) continue
      const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
      const allowedMimeTypes = allowedAttachmentTypes.get(extension)
      if (!allowedMimeTypes || !allowedMimeTypes.includes(file.type.toLowerCase())) {
        error = `${file.name}: unsupported file type.`
        continue
      }
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        error = `${file.name}: maximum file size is 10 MB.`
        continue
      }
      if (attachments.length + validFiles.length >= MAX_ATTACHMENT_COUNT) {
        error = 'You can attach up to 10 files.'
        continue
      }
      if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
        error = 'Combined attachment size cannot exceed 25 MB.'
        continue
      }
      validFiles.push(file)
      selectedFileKeys.add(identity)
      totalBytes += file.size
    }

    setAttachments(current => [...current, ...validFiles.map(file => ({ id: crypto.randomUUID(), file }))])
    setAttachmentError(error)
  }

  function removeAttachment(id: string) {
    setAttachments(current => current.filter(attachment => attachment.id !== id))
    setAttachmentError('')
  }

  function confirmSchedule(): boolean {
    const selectedDateTime = startDate && startTime ? new Date(`${startDate}T${startTime}`) : new Date(Number.NaN)
    const delayMultiplier = delayUnit === 'seconds' ? 1_000 : delayUnit === 'minutes' ? 60_000 : 3_600_000
    const minimumDelayMs = delayValue * delayMultiplier
    const valid = isSelectedLocalTime(selectedDateTime, startDate, startTime)
      && selectedDateTime.getTime() > Date.now()
      && Number.isSafeInteger(minimumDelayMs) && minimumDelayMs > 0 && minimumDelayMs <= 86_400_000
      && Number.isSafeInteger(hourlyLimit) && hourlyLimit >= 1 && hourlyLimit <= 10_000
    if (!valid) {
      setFeedback({ type: 'error', message: 'Choose a valid future date and time, minimum delay, and hourly limit.' })
      return false
    }
    setScheduledAt(selectedDateTime.toISOString())
    setFeedback({ type: 'success', message: `Scheduled for ${formatLocalDate(selectedDateTime.toISOString())}. Click Send Later to queue this email.` })
    return true
  }

  function cancelScheduleSelection() {
    setScheduledAt(null)
    setStartDate('')
    setStartTime('')
  }

  function sendEmail(event?: FormEvent<HTMLFormElement>) {
    void submitEmail(hasValidScheduledTime ? 'schedule' : 'send', event)
  }

  async function submitEmail(mode: 'send' | 'schedule', event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (inFlightRef.current) return
    if (attachmentError) {
      setFeedback({ type: 'error', message: attachmentError })
      return
    }

    const recipientCommit = recipientInputRef.current?.commitDraft() ?? { recipients, valid: true }
    const normalizedRecipients = [...new Set(recipientCommit.recipients.map(recipient => recipient.email.trim().toLowerCase()))]
    const invalidRecipient = !recipientCommit.valid || normalizedRecipients.some(email => !isValidRecipientEmail(email))
    const hasBody = hasMeaningfulBodyContent(body)
    const senderExists = selectedSender !== null && senders.some(sender => sender.id === selectedSender.id)
    const startDateTime = mode === 'schedule' && scheduledAt ? new Date(scheduledAt) : null
    const delayMultiplier = delayUnit === 'seconds' ? 1_000 : delayUnit === 'minutes' ? 60_000 : 3_600_000
    const minimumDelayMs = delayValue * delayMultiplier
    const limitsAreValid = Number.isSafeInteger(minimumDelayMs)
      && minimumDelayMs > 0 && minimumDelayMs <= 86_400_000
      && Number.isSafeInteger(hourlyLimit) && hourlyLimit >= 1 && hourlyLimit <= 10_000

    if (mode === 'schedule' && (!startDateTime || !isSelectedLocalTime(startDateTime, startDate, startTime) || startDateTime.getTime() <= Date.now())) {
      setScheduledAt(null)
      setFeedback({ type: 'error', message: 'Choose a valid future date and time before scheduling.' })
      return
    }
    if (!limitsAreValid) {
      setFeedback({ type: 'error', message: 'Enter a valid minimum delay and hourly limit.' })
      return
    }
    if (!senderExists || normalizedRecipients.length === 0 || invalidRecipient || !subject.trim() || !hasBody) {
      setFeedback({ type: 'error', message: 'Choose a sender, add valid recipients, enter a subject, and write your message.' })
      return
    }

    const payload: ScheduleEmailPayload = {
      senderAccountId: selectedSender.id,
      subject: subject.trim(),
      bodyHtml: body,
      recipientEmails: normalizedRecipients,
      // The existing API accepts future jobs only. A one-second lead time lets
      // the existing BullMQ worker pick up an immediate-send request without
      // adding another endpoint or bypassing worker rate-limit checks.
      scheduledAt: (startDateTime ?? new Date(Date.now() + 1_000)).toISOString(),
      minimumDelayMs,
      hourlyLimit,
    }
    const fingerprint = JSON.stringify({
      payload: { ...payload, scheduledAt: mode === 'schedule' ? payload.scheduledAt : 'immediate' },
      attachments: attachments.map(({ file }) => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified })),
    })
    if (!submissionAttemptRef.current || submissionAttemptRef.current.fingerprint !== fingerprint) {
      submissionAttemptRef.current = { fingerprint, key: crypto.randomUUID() }
    }

    inFlightRef.current = true
    setSubmittingMode(mode)
    setFeedback(null)
    try {
      const formData = new FormData()
      formData.append('senderAccountId', payload.senderAccountId)
      formData.append('subject', payload.subject)
      formData.append('bodyHtml', payload.bodyHtml)
      formData.append('recipientEmails', JSON.stringify(payload.recipientEmails))
      formData.append('scheduledAt', payload.scheduledAt)
      formData.append('minimumDelayMs', String(payload.minimumDelayMs))
      formData.append('hourlyLimit', String(payload.hourlyLimit))
      attachments.forEach(({ file }) => formData.append('attachments', file, file.name))
      await postData<EmailJobRecord>('/emails', formData, { 'Idempotency-Key': submissionAttemptRef.current.key })
      submissionAttemptRef.current = null
      setRecipients([])
      setSubject('')
      setBody('')
      setStartDate('')
      setStartTime('')
      setScheduledAt(null)
      setAttachments([])
      setFeedback({ type: 'success', message: `${mode === 'send' ? 'Email accepted and queued for delivery' : 'Email scheduled successfully'}${attachments.length > 0 ? ' with attachments' : ''}.` })
      refreshEmails()
      if (mode === 'send') navigate('/dashboard/sent')
      else window.setTimeout(() => navigate('/dashboard/scheduled'), 800)
    } catch (error) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error) })
    } finally {
      inFlightRef.current = false
      setSubmittingMode(null)
    }
  }

  return (
    <section className="compose-page">
      <ComposeHeader
        onBack={() => navigate(-1)}
        onAttach={() => attachmentInputRef.current?.click()}
        attachmentCount={attachments.length}
        onSend={sendEmail}
        onScheduleConfirm={confirmSchedule}
        onScheduleCancel={cancelScheduleSelection}
        submitting={submitting}
        submittingMode={submittingMode}
      isScheduled={hasValidScheduledTime}
        startDate={startDate}
        startTime={startTime}
        onStartDateChange={value => { setStartDate(value); setScheduledAt(null); setFeedback(null) }}
        onStartTimeChange={value => { setStartTime(value); setScheduledAt(null); setFeedback(null) }}
      />

      <form className="compose-form" onSubmit={sendEmail} noValidate>
        <SenderSelector
          senders={senders}
          selectedSender={selectedSender}
          loading={sendersLoading}
          error={sendersError || undefined}
          onRetry={() => void loadSenders()}
          onSelect={setSelectedSender}
        />
        {!sendersLoading && !sendersError && senders.length === 0 && <div className="sender-create">
          {!showSenderForm
            ? <button className="sender-create-toggle" type="button" onClick={() => setShowSenderForm(true)}>Add sender account</button>
            : <div className="sender-create-form" role="group" aria-label="Create sender account">
                <label>
                  <span>Email</span>
                  <input type="email" maxLength={320} value={newSenderEmail} onChange={event => setNewSenderEmail(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void createSender() } }} />
                </label>
                <label>
                  <span>Display name</span>
                  <input type="text" maxLength={200} value={newSenderDisplayName} onChange={event => setNewSenderDisplayName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void createSender() } }} />
                </label>
                <div className="sender-create-actions">
                  <button className="sender-create-submit" type="button" onClick={() => void createSender()} disabled={creatingSender}>{creatingSender ? 'Adding…' : 'Create sender'}</button>
                  <button className="sender-create-cancel" type="button" onClick={() => { setShowSenderForm(false); setSenderCreationError('') }} disabled={creatingSender}>Cancel</button>
                </div>
                {senderCreationError && <p className="sender-create-error" role="alert">{senderCreationError}</p>}
              </div>}
        </div>}
        <div className="compose-field compose-to-field">
          <label>To</label>
          <div className="compose-to-content">
            <RecipientInput ref={recipientInputRef} recipients={recipients} onRecipientsChange={setRecipients} onRemoveRecipient={removeRecipient} />
            <div className="compose-to-tools">
              <UploadList onFileUpload={addRecipientsFromList} />
              {recipients.length > 0 && <span className="compose-recipient-count">{recipients.length} {recipients.length === 1 ? 'recipient' : 'recipients'}</span>}
            </div>
          </div>
        </div>
        <div className="compose-field">
          <label htmlFor="compose-subject">Subject</label>
          <input id="compose-subject" type="text" value={subject} onChange={event => setSubject(event.target.value)} placeholder="Subject" />
        </div>

        <SchedulingControls
          delayValue={delayValue}
          delayUnit={delayUnit}
          hourlyLimit={hourlyLimit}
          onDelayValueChange={value => { setDelayValue(value); setFeedback(null) }}
          onDelayUnitChange={value => { setDelayUnit(value); setFeedback(null) }}
          onHourlyLimitChange={value => { setHourlyLimit(value); setFeedback(null) }}
        />
        {hasValidScheduledTime && scheduledAt && <p className="schedule-selected-summary" role="status">
          Scheduled for {formatLocalDate(scheduledAt)}. Click Send Later to schedule this email.
        </p>}

        <RichTextEditor value={body} onChange={setBody} linkRequest={0} />
        <AttachmentPreview
          attachments={attachments}
          inputRef={attachmentInputRef}
          error={attachmentError}
          isUploading={submitting && attachments.length > 0}
          onAdd={addAttachments}
          onRemove={removeAttachment}
        />

        {submitting && <p className="compose-feedback" role="status">{submittingMode === 'send' ? 'Sending…' : 'Scheduling email…'}</p>}
        {feedback && <p className={`compose-feedback compose-feedback-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
        <button className="visually-hidden" type="submit">Send</button>
      </form>
    </section>
  )
}

function fileIdentity(file: File): string {
  return `${file.name.toLowerCase()}\u0000${file.size}\u0000${file.lastModified}`
}

function isSelectedLocalTime(date: Date, selectedDate: string, selectedTime: string): boolean {
  if (!Number.isFinite(date.getTime())) return false
  const [year, month, day] = selectedDate.split('-').map(Number)
  const [hour, minute] = selectedTime.split(':').map(Number)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute
}

function hasMeaningfulBodyContent(bodyHtml: string): boolean {
  const parsed = new DOMParser().parseFromString(bodyHtml, 'text/html')
  return (parsed.body.textContent ?? '').replace(/\u00a0/g, ' ').trim().length > 0
}
