export interface StatusBadgeProps {
  status: 'scheduled' | 'sent' | 'failed' | 'processing' | 'cancelled'
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const labels = { scheduled: 'Scheduled', sent: 'Sent', failed: 'Failed', processing: 'Processing', cancelled: 'Cancelled' }
  const label = labels[status]
  return <span className={`email-status email-status-${status}`}><i aria-hidden="true" />{label}</span>
}
