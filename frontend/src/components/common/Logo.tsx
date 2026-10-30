export interface LogoProps {
  className?: string
}

export default function Logo({ className = '' }: LogoProps) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-label="ReachInbox">
      <span aria-hidden="true">R</span>
    </span>
  )
}
