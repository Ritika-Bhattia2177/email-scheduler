import { forwardRef, useImperativeHandle, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

export interface Recipient {
  email: string
}

export interface RecipientInputProps {
  recipients: Recipient[]
  onRecipientsChange: (recipients: Recipient[]) => void
  onRemoveRecipient: (email: string) => void
}

export interface RecipientInputHandle {
  commitDraft: () => { recipients: Recipient[]; valid: boolean }
}

const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

export function isValidRecipientEmail(email: string): boolean {
  return emailPattern.test(email)
}

const RecipientInput = forwardRef<RecipientInputHandle, RecipientInputProps>(function RecipientInput(
  { recipients, onRecipientsChange, onRemoveRecipient },
  ref,
) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  function commitDraft() {
    const candidates = draft.split(/[,\n]+/).map(email => email.trim()).filter(Boolean)
    if (candidates.length === 0) return { recipients, valid: true }
    if (candidates.some(email => !isValidRecipientEmail(email))) {
      setError('Enter valid email addresses.')
      return { recipients, valid: false }
    }

    const unique = new Map(recipients.map(recipient => [recipient.email.trim().toLowerCase(), { email: recipient.email.trim().toLowerCase() }]))
    candidates.forEach(email => {
      const normalizedEmail = email.toLowerCase()
      if (!unique.has(normalizedEmail)) unique.set(normalizedEmail, { email: normalizedEmail })
    })
    const nextRecipients = [...unique.values()]
    onRecipientsChange(nextRecipients)
    setDraft('')
    setError('')
    return { recipients: nextRecipients, valid: true }
  }

  useImperativeHandle(ref, () => ({ commitDraft }), [draft, recipients])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commitDraft()
    } else if (event.key === 'Tab') {
      commitDraft()
    } else if (event.key === 'Backspace' && draft.length === 0 && recipients.length > 0) {
      onRemoveRecipient(recipients[recipients.length - 1].email)
    }
  }

  return (
    <div className="recipient-input-wrap">
      <div className="recipient-input">
        {recipients.map(recipient => (
          <span className="recipient-chip" key={recipient.email.toLowerCase()}>
            {recipient.email}
            <button type="button" onClick={() => onRemoveRecipient(recipient.email)} aria-label={`Remove ${recipient.email}`}><X size={12} /></button>
          </span>
        ))}
        <textarea
          name="recipient-entry"
          aria-label="Recipient email"
          rows={1}
          inputMode="email"
          autoComplete="new-password"
          value={draft}
          onChange={event => { setDraft(event.target.value); setError('') }}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
          placeholder={recipients.length ? '' : 'recipient@example.com'}
        />
      </div>
      {error && <span className="compose-field-error" role="alert">{error}</span>}
    </div>
  )
})

export default RecipientInput
