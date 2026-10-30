import type { ChangeEventHandler, InputHTMLAttributes } from 'react'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  label?: string
  value: string
  onChange: ChangeEventHandler<HTMLInputElement>
  error?: string
}

export default function Input({ label, error, id, className = '', ...props }: InputProps) {
  const inputId = id ?? props.name
  const errorId = inputId ? `${inputId}-error` : undefined

  return (
    <div className="input-field">
      {label && inputId && <label htmlFor={inputId}>{label}</label>}
      <input
        {...props}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`input-control w-full rounded border bg-gray-50 text-sm outline-none ${className}`.trim()}
      />
      {error && <p className="input-error" id={errorId} role="alert">{error}</p>}
    </div>
  )
}
