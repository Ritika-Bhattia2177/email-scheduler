import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, Slack, Unplug } from 'lucide-react'
import Button from '../components/ui/Button'
import { api, getApiErrorMessage, getData, postData } from '../services/api'
import { useSearchParams } from 'react-router-dom'

interface SlackConnectionStatus {
  connected: boolean
  teamId?: string
  teamName?: string
  slackUserId?: string
  connectedAt?: string
}

const SLACK_OAUTH_START_URL = `${api.defaults.baseURL}/slack/oauth/start`

export default function SlackIntegration() {
  const [searchParams] = useSearchParams()
  const [connection, setConnection] = useState<SlackConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')
  const oauthError = searchParams.has('slack_error') || searchParams.has('error')

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setConnection(await getData<SlackConnectionStatus>('/slack/status'))
    } catch (reason) {
      setError(getApiErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refreshStatus() }, [refreshStatus])

  async function disconnectSlack() {
    setDisconnecting(true)
    setError('')
    try {
      await postData<{ connected: false }>('/slack/disconnect')
      await refreshStatus()
    } catch (reason) {
      setError(getApiErrorMessage(reason))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl px-1 py-5 sm:px-4 sm:py-8" aria-labelledby="slack-integration-heading">
      <header className="mb-6 sm:mb-8">
        <p className="section-eyebrow">SETTINGS</p>
        <h1 id="slack-integration-heading" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Slack Integration</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Connect a Slack workspace to receive email delivery and rate limit notifications.</p>
      </header>

      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        <div className="flex items-start gap-4 border-b border-line bg-stone-50/70 px-5 py-5 sm:px-7 sm:py-6">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#4A154B]/10 text-[#4A154B]">
            <Slack size={23} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink">Workspace notifications</h2>
            <p className="mt-1 text-sm leading-5 text-muted">Manage the Slack workspace connected to this account.</p>
          </div>
          {connection?.connected && !loading && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800"><CheckCircle2 size={13} aria-hidden="true" />Connected</span>}
        </div>

        <div className="px-5 py-5 sm:px-7 sm:py-6">
          {oauthError && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900" role="alert">Slack authorization was not completed. You can try connecting again.</p>}
          {error && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert"><span>{error}</span><button className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2" type="button" onClick={() => void refreshStatus()}><RefreshCw size={13} aria-hidden="true" />Retry</button></div>}

          {loading && <div className="flex min-h-24 items-center gap-3 text-sm text-muted" role="status"><LoaderCircle className="animate-spin" size={18} aria-hidden="true" />Checking Slack connection…</div>}

          {!loading && !error && connection?.connected && <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Connected workspace</p>
              <p className="mt-1 truncate text-lg font-semibold text-ink">{connection.teamName || 'Slack workspace'}</p>
              {connection.connectedAt && <p className="mt-1 text-xs text-muted">Connected {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(connection.connectedAt))}</p>}
            </div>
            <Button variant="secondary" loading={disconnecting} onClick={() => void disconnectSlack()} className="shrink-0">
              <Unplug size={15} aria-hidden="true" />Disconnect Slack
            </Button>
          </div>}

          {!loading && !error && !connection?.connected && <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-ink">No Slack workspace connected</p>
              <p className="mt-1 text-sm leading-5 text-muted">Authorize access to choose the workspace that should receive notifications.</p>
            </div>
            <Button loading={connecting} onClick={() => {
              setConnecting(true)
              window.location.assign(SLACK_OAUTH_START_URL)
            }} className="shrink-0">
              <Slack size={16} aria-hidden="true" />Connect Slack<ExternalLink size={13} aria-hidden="true" />
            </Button>
          </div>}
        </div>
      </div>
    </section>
  )
}
