import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, CheckCircle2, CircleAlert, Clock3, Download, FileText, Image as ImageIcon, Star, Trash2, X } from 'lucide-react'
import type { DashboardOutletContext } from '../components/layout/DashboardLayout'
import { getApiErrorMessage, getBlob, getData, postData } from '../services/api'
import { formatLocalDate, toEmailAttachments, type EmailEventRecord, type EmailJobRecord } from '../services/email'

export default function EmailDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { refreshKey, refreshEmails } = useOutletContext<DashboardOutletContext>()
  const [email, setEmail] = useState<EmailJobRecord | null>(null)
  const [starred, setStarred] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [canceling, setCanceling] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const pendingDetailRequestsRef = useRef(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    if (!id || !isUuid(id)) {
      setEmail(null)
      setError('Email not found')
      setLoading(false)
      return () => { active = false }
    }

    pendingDetailRequestsRef.current += 1
    void getData<EmailJobRecord>(`/emails/${encodeURIComponent(id)}`).then(result => {
      if (active) setEmail(result)
    }).catch(reason => {
      if (active) {
        setEmail(null)
        setError(getApiErrorMessage(reason))
      }
    }).finally(() => {
      pendingDetailRequestsRef.current = Math.max(0, pendingDetailRequestsRef.current - 1)
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [id, refreshKey, reloadKey])

  const emailStatus = email?.status
  useEffect(() => {
    if (!id || !emailStatus || ['SENT', 'FAILED', 'CANCELLED'].includes(emailStatus)) return
    let active = true
    let requestInFlight = false
    const refreshDetail = async () => {
      if (!active || requestInFlight || pendingDetailRequestsRef.current > 0 || document.visibilityState !== 'visible') return
      requestInFlight = true
      pendingDetailRequestsRef.current += 1
      try {
        const latest = await getData<EmailJobRecord>(`/emails/${encodeURIComponent(id)}`)
        if (active) setEmail(latest)
      } catch {
        // Keep showing the last successful detail while a background refresh is unavailable.
      } finally {
        pendingDetailRequestsRef.current = Math.max(0, pendingDetailRequestsRef.current - 1)
        requestInFlight = false
      }
    }
    const interval = window.setInterval(() => { void refreshDetail() }, 5_000)
    window.addEventListener('focus', refreshDetail)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshDetail)
    }
  }, [emailStatus, id])

  async function cancelScheduledEmail() {
    if (!email || email.status !== 'SCHEDULED' || canceling) return
    if (!window.confirm('Cancel this scheduled email?')) return
    setCanceling(true)
    setNotice('')
    try {
      await postData<EmailJobRecord>(`/emails/${encodeURIComponent(email.id)}/cancel`)
      setEmail(current => current ? { ...current, status: 'CANCELLED' } : current)
      setNotice('Scheduled email cancelled.')
      refreshEmails()
      setReloadKey(value => value + 1)
    } catch (reason) {
      setNotice(getApiErrorMessage(reason))
    } finally {
      setCanceling(false)
    }
  }

  function chooseMoreAction(action: string) {
    setNotice(`${action} is not available yet.`)
  }

  if (loading) return <section className="email-detail-page"><p role="status">Loading email…</p></section>
  if (!email) {
    return <section className="email-detail-page"><button className="detail-back" type="button" onClick={() => navigate(-1)}><ArrowLeft size={15} /> Back</button><p className="detail-not-found" role={error ? 'alert' : 'status'}>{error || 'Email not found'}</p>{error && id && isUuid(id) && <button className="detail-retry" type="button" onClick={() => setReloadKey(value => value + 1)}>Retry</button>}</section>
  }

  const recipients = email.recipients.map(recipient => recipient.email)
  const senderName = email.senderAccount.displayName || email.senderAccount.email
  const date = email.status === 'SENT' && email.sentAt ? formatLocalDate(email.sentAt) : formatLocalDate(email.scheduledAt)
  const attachments = toEmailAttachments(email.attachments)

  return (
    <article className="email-detail-page">
      <header className="detail-toolbar">
        <div className="detail-toolbar-start">
          <button className="detail-back" type="button" onClick={() => navigate(-1)} aria-label="Go back"><ArrowLeft size={15} /></button>
          <span>{email.subject}</span>
        </div>
        <div className="detail-actions">
          <button className={`detail-action ${starred ? 'is-starred' : ''}`} type="button" aria-label={starred ? 'Unstar email' : 'Star email'} aria-pressed={starred} onClick={() => setStarred(value => !value)}><Star size={15} fill={starred ? 'currentColor' : 'none'} /></button>
          <button className="detail-action" type="button" aria-label="Archive" onClick={() => chooseMoreAction('Archive')}><Archive size={14} /></button>
          {email.status === 'SCHEDULED'
            ? <button className="detail-action" type="button" aria-label="Cancel scheduled email" title="Cancel scheduled email" disabled={canceling} onClick={() => void cancelScheduledEmail()}><Trash2 size={14} /></button>
            : <button className="detail-action" type="button" aria-label="Delete" onClick={() => chooseMoreAction('Delete')}><Trash2 size={14} /></button>}
          <span className="detail-toolbar-divider" />
          <span className="detail-toolbar-avatar" aria-hidden="true">{initials(senderName)}</span>
        </div>
      </header>

      {notice && <div className="detail-notice" role={notice === 'Scheduled email cancelled.' ? 'status' : 'alert'}>{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={13} /></button></div>}
      {error && <div className="detail-notice" role="alert">{error}</div>}

      <section className="detail-message" aria-label="Email message">
        <div className="detail-sender-row">
          <span className="detail-avatar" aria-hidden="true">{initials(senderName)}</span>
          <div className="detail-sender-copy">
            <div className="detail-sender-line"><strong>{senderName}</strong><span>&lt;{email.senderAccount.email}&gt;</span></div>
            <small>to {recipients.join(', ') || 'No recipient'}</small>
          </div>
          <time className="detail-message-date">{date}</time>
        </div>

        <div className="detail-body">
          <EmailBody html={email.bodyHtml} />
        </div>

        {attachments.length > 0 && <AttachmentList emailId={email.id} attachments={attachments} />}
      </section>

      <EmailHistory events={email.events} />
    </article>
  )
}

const safeEmailTags = new Set([
  'a', 'b', 'blockquote', 'br', 'caption', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
  'td', 'th', 'thead', 'tr', 'u', 'ul',
])
const blockedEmailTags = new Set(['audio', 'button', 'embed', 'form', 'iframe', 'img', 'input', 'object', 'script', 'style', 'svg', 'video'])

function EmailBody({ html }: { html: string }) {
  const documentBody = new DOMParser().parseFromString(html, 'text/html').body
  return <>{Array.from(documentBody.childNodes).map((node, index) => renderEmailNode(node, `${index}`))}</>
}

function renderEmailNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (!(node instanceof Element)) return null

  const tag = node.tagName.toLowerCase()
  if (blockedEmailTags.has(tag)) return null
  const children = Array.from(node.childNodes).map((child, index) => renderEmailNode(child, `${key}.${index}`))
  if (!safeEmailTags.has(tag)) return <>{children}</>

  const properties: Record<string, unknown> = { key, style: safeEmailStyles(node as HTMLElement) }
  if (tag === 'a') {
    const href = safeEmailHref(node.getAttribute('href'))
    if (href) {
      properties.href = href
      properties.target = '_blank'
      properties.rel = 'noreferrer noopener'
    }
  }
  if (tag === 'td' || tag === 'th') {
    for (const attribute of ['colspan', 'rowspan'] as const) {
      const value = node.getAttribute(attribute)
      if (value && /^\d{1,2}$/.test(value)) properties[attribute] = Number(value)
    }
  }
  return createElement(tag, properties, ...children)
}

function safeEmailHref(value: string | null): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

function safeEmailStyles(element: HTMLElement): CSSProperties {
  const result: CSSProperties = {}
  const validColor = (value: string) => /^(#[\da-f]{3,8}|rgb\(\s*[\d.% ,]+\)|rgba\(\s*[\d.% ,]+\)|[a-z]{1,24})$/i.test(value)
  const validLength = (value: string) => /^(?:0|\d{1,3}(?:\.\d{1,2})?(?:px|em|rem|%))$/i.test(value)

  for (const [property, value] of Array.from(element.style).map(property => [property, element.style.getPropertyValue(property)])) {
    const trimmed = value.trim()
    if ((property === 'color' || property === 'background-color') && validColor(trimmed)) {
      if (property === 'color') result.color = trimmed
      else result.backgroundColor = trimmed
    } else if (property === 'font-weight' && /^(normal|bold|[1-9]00)$/i.test(trimmed)) {
      result.fontWeight = trimmed as CSSProperties['fontWeight']
    } else if (property === 'font-style' && /^(normal|italic|oblique)$/i.test(trimmed)) {
      result.fontStyle = trimmed as CSSProperties['fontStyle']
    } else if (property === 'text-align' && /^(left|right|center|justify)$/i.test(trimmed)) {
      result.textAlign = trimmed as CSSProperties['textAlign']
    } else if (property === 'text-decoration' && /^(none|underline|line-through|overline)(\s+(solid|dotted|dashed|wavy))?$/i.test(trimmed)) {
      result.textDecoration = trimmed
    } else if (property === 'font-size' && validLength(trimmed)) {
      result.fontSize = trimmed
    } else if (property === 'border-left') {
      const border = trimmed.match(/^(\d{1,2}px)\s+solid\s+(.+)$/i)
      if (border && validColor(border[2].trim())) result.borderLeft = `${border[1]} solid ${border[2].trim()}`
    } else if ((property === 'margin' || property === 'padding') && /^[-\w.% ]{1,40}$/.test(trimmed) && !/[a-z]{2,}/i.test(trimmed.replace(/px|em|rem/g, ''))) {
      if (property === 'margin') result.margin = trimmed
      else result.padding = trimmed
    }
  }
  return result
}

function EmailHistory({ events }: { events?: EmailEventRecord[] }) {
  const orderedEvents = events ? events.filter(event => event.type !== 'FAILED').sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0)
  }) : []

  return (
    <section className="detail-history" aria-labelledby="detail-history-title">
      <h2 id="detail-history-title">Email History</h2>
      {!events
        ? <p className="detail-history-empty">History is unavailable for this email.</p>
        : orderedEvents.length === 0
          ? <p className="detail-history-empty">No history events are available yet.</p>
          : <ol className="detail-history-list">
            {orderedEvents.map((event, index) => <HistoryEvent key={event.id} event={event} isLast={index === orderedEvents.length - 1} />)}
          </ol>}
    </section>
  )
}

function HistoryEvent({ event, isLast }: { event: EmailEventRecord; isLast: boolean }) {
  const kind = eventKind(event.type)
  const details = technicalDetails(event.message)
  const timestamp = formatLocalDate(event.createdAt)

  return (
    <li className={`detail-history-item ${isLast ? 'is-last' : ''}`}>
      <span className={`detail-history-marker is-${kind}`} aria-hidden="true">
        {kind === 'success' ? <CheckCircle2 size={15} /> : kind === 'error' ? <CircleAlert size={15} /> : <Clock3 size={15} />}
      </span>
      <div className="detail-history-content">
        <div className="detail-history-heading"><strong>{eventTitle(event.type)}</strong><time dateTime={event.createdAt}>{timestamp}</time></div>
        <p>{eventDescription(event.type)}</p>
        {details && event.type !== 'FAILED' && <details className="detail-history-technical">
          <summary>View technical details</summary>
          <pre>{details}</pre>
        </details>}
      </div>
    </li>
  )
}

function eventTitle(type: string): string {
  const normalized = type.trim().replace(/[ _-]+/g, ' ').toUpperCase()
  const known: Record<string, string> = {
    SCHEDULED: 'Scheduled',
    'RATE LIMITED': 'Rate limited',
    RATE_LIMITED: 'Rate limited',
    RESCHEDULED: 'Rescheduled',
    SENT: 'Sent',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    CANCELED: 'Cancelled',
    PROCESSING: 'Processing',
  }
  return known[normalized] ?? type.trim().replace(/[_-]+/g, ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase())
}

function eventKind(type: string): 'success' | 'error' | 'neutral' {
  const normalized = type.trim().replace(/[ _-]+/g, '_').toUpperCase()
  if (normalized === 'SENT') return 'success'
  if (normalized === 'FAILED') return 'error'
  return 'neutral'
}

function eventDescription(type: string): string {
  const normalized = type.trim().replace(/[ _-]+/g, '_').toUpperCase()
  const descriptions: Record<string, string> = {
    SCHEDULED: 'Email scheduled successfully.',
    RATE_LIMITED: 'Email was temporarily delayed because the sending limit was reached.',
    RESCHEDULED: 'Email was automatically rescheduled for the next available sending window.',
    SENT: 'Email sent successfully.',
    FAILED: 'Email delivery failed.',
    CANCELLED: 'Scheduled email was cancelled.',
    CANCELED: 'Scheduled email was cancelled.',
    PROCESSING: 'Email delivery has started.',
  }
  return descriptions[normalized] ?? 'Email history was updated.'
}

function technicalDetails(message: string | null): string | undefined {
  if (!message?.trim()) return undefined
  try {
    return JSON.stringify(JSON.parse(message), null, 2)
  } catch {
    return message
  }
}

function AttachmentList({ emailId, attachments }: { emailId: string; attachments: ReturnType<typeof toEmailAttachments> }) {
  return (
    <section className="detail-attachments" aria-label="Attachments">
      <h2>Attachments</h2>
      <div className="attachment-list">
        {attachments.map(attachment => <AttachmentCard key={attachment.id} emailId={emailId} attachment={attachment} />)}
      </div>
    </section>
  )
}

function AttachmentCard({ emailId, attachment }: {
  emailId: string
  attachment: ReturnType<typeof toEmailAttachments>[number]
}) {
  const isImage = attachment.type?.startsWith('image/') ?? false
  const [previewUrl, setPreviewUrl] = useState<string>()
  const [previewFailed, setPreviewFailed] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)

  useEffect(() => {
    if (!isImage) return
    let active = true
    let objectUrl: string | undefined
    void getBlob(`/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachment.id)}`)
      .then(blob => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      })
      .catch(() => {
        if (active) setPreviewFailed(true)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [emailId, attachment.id, isImage])

  async function downloadAttachment() {
    setDownloadFailed(false)
    try {
      const blob = await getBlob(`/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachment.id)}`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch {
      setDownloadFailed(true)
    }
  }

  return (
    <article className="attachment-item">
      {isImage && previewUrl
        ? <a className="attachment-preview" href={previewUrl} target="_blank" rel="noreferrer" aria-label={`Open preview of ${attachment.name}`}>
            <img src={previewUrl} alt={attachment.name} />
          </a>
        : <div className="attachment-preview attachment-preview-placeholder" role="img" aria-label={isImage ? 'Image preview unavailable' : `${attachmentTypeLabel(attachment.type)} attachment`}>
            {isImage ? <ImageIcon size={27} /> : <FileText size={27} />}
            <span>{isImage ? (previewFailed ? 'Preview unavailable' : 'Loading preview…') : attachmentTypeLabel(attachment.type)}</span>
          </div>}
      <div className="attachment-meta">
        <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
        <button className="attachment-download" type="button" onClick={() => void downloadAttachment()} aria-label={`Download ${attachment.name}`} title={`Download ${attachment.name}`}>
          <Download size={16} aria-hidden="true" />
        </button>
      </div>
      {attachment.size !== undefined && <span className="attachment-size">{formatFileSize(attachment.size)}</span>}
      {downloadFailed && <span className="attachment-download-error" role="alert">Download unavailable. Try again.</span>}
    </article>
  )
}

function attachmentTypeLabel(mimeType?: string): string {
  if (mimeType === 'application/pdf') return 'PDF document'
  if (mimeType === 'text/plain') return 'Text document'
  if (mimeType === 'text/csv' || mimeType === 'application/vnd.ms-excel') return 'CSV spreadsheet'
  return 'File attachment'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function initials(name: string): string {
  return name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
