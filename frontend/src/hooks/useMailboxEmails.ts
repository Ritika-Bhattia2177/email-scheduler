import { useEffect, useRef, useState } from 'react'
import { getApiErrorMessage, getData, getEnvelope } from '../services/api'
import { toMailboxEmail, type EmailJobRecord, type EmailSearchResponse, type MailboxEmail } from '../services/email'

export type MailboxKind = 'scheduled' | 'sent'

export function useMailboxEmails(kind: MailboxKind, search: string, refreshKey: number, statusFilter = '') {
  const [emails, setEmails] = useState<MailboxEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [retryKey, setRetryKey] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const loadedQueryRef = useRef<string | null>(null)
  const pendingRequestsRef = useRef(0)
  const query = search.trim()
  const requestKey = JSON.stringify([kind, query, page, statusFilter])

  useEffect(() => { setPage(1) }, [kind, query, statusFilter])

  useEffect(() => {
    let active = true
    if (loadedQueryRef.current !== requestKey) setLoading(true)
    setError(undefined)
    const timeout = window.setTimeout(() => {
      pendingRequestsRef.current += 1
      const request = loadMailboxEmails(kind, query, page, statusFilter)

      void request.then(result => {
        if (active) {
          setEmails(result.emails)
          setTotalPages(result.totalPages)
          loadedQueryRef.current = requestKey
        }
      }).catch(reason => {
        if (active) setError(getApiErrorMessage(reason))
      }).finally(() => {
        pendingRequestsRef.current = Math.max(0, pendingRequestsRef.current - 1)
        if (active) setLoading(false)
      })
    }, query ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [kind, query, refreshKey, retryKey, page, requestKey, statusFilter])

  useEffect(() => {
    const refreshVisibleMailbox = () => {
      if (document.visibilityState === 'visible' && pendingRequestsRef.current === 0) {
        setRetryKey(value => value + 1)
      }
    }
    const interval = window.setInterval(refreshVisibleMailbox, 5_000)
    window.addEventListener('focus', refreshVisibleMailbox)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisibleMailbox)
    }
  }, [])

  return { emails, loading, error, page, totalPages, setPage, retry: () => setRetryKey(value => value + 1) }
}

async function loadMailboxEmails(kind: MailboxKind, query: string, page: number, statusFilter: string): Promise<{ emails: MailboxEmail[]; totalPages: number }> {
  const limit = 100
  const status = kind === 'scheduled' ? 'SCHEDULED' : 'SENT'
  // Keep each mailbox scoped to its own state. A page level status selection
  // must never make sent/cancelled/failed records appear as active schedules.
  if (statusFilter && statusFilter !== 'ALL' && statusFilter !== status) {
    return { emails: [], totalPages: 1 }
  }

  if (query) {
    const params: Record<string, string | number> = { q: query, page, limit }
    params.status = status
    const firstPage = await getData<EmailSearchResponse>('/emails/search', params)
    return { emails: firstPage.results.map(toMailboxEmail), totalPages: firstPage.pagination.totalPages }
  }

  const params = { status: kind, page, limit }
  const firstPage = await getEnvelope<EmailJobRecord[]>('/emails', params)
  return { emails: firstPage.data.map(toMailboxEmail), totalPages: firstPage.pagination?.totalPages ?? 1 }
}
