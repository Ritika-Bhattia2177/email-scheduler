import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'
  loading?: boolean
  children: ReactNode
}

export default function Button({
  variant = 'primary',
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`button button-${variant} transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${className}`.trim()}
    >
      {loading && <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />}
      {children}
    </button>
  )
}
