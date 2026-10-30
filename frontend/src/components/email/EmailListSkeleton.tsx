export interface EmailListSkeletonProps {
  rows?: number
}

export default function EmailListSkeleton({ rows = 4 }: EmailListSkeletonProps) {
  return (
    <div className="email-list email-list-skeleton" role="list" aria-label="Loading emails" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="email-skeleton-row" role="listitem" key={index}>
          <span className="email-skeleton-avatar" />
          <span className="email-skeleton-recipient" />
          <span className="email-skeleton-subject" />
          <span className="email-skeleton-date" />
          <span className="email-skeleton-status" />
        </div>
      ))}
    </div>
  )
}
