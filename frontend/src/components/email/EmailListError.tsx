import { RefreshCw } from 'lucide-react'

export interface EmailListErrorProps {
  message?: string
  onRetry?: () => void
}

export default function EmailListError({ message = 'Unable to load emails. Please try again.', onRetry }: EmailListErrorProps) {
  return (
    <div className="email-list-error" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onRetry} disabled={!onRetry}><RefreshCw size={12} />Retry</button>
    </div>
  )
}
