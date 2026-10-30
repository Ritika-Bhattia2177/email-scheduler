export interface RoutePlaceholderProps {
  title: string
}

export default function RoutePlaceholder({ title }: RoutePlaceholderProps) {
  return <section className="scheduled-page"><div className="scheduled-heading"><div><p className="section-eyebrow">MAILBOX</p><h1>{title}</h1></div></div><div className="email-empty">{title === 'Sent' ? 'No sent emails yet' : 'Compose is coming soon'}</div></section>
}
