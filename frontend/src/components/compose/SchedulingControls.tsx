export type DelayUnit = 'seconds' | 'minutes' | 'hours'

export interface SchedulingControlsProps {
  delayValue: number
  delayUnit: DelayUnit
  hourlyLimit: number
  onDelayValueChange: (value: number) => void
  onDelayUnitChange: (value: DelayUnit) => void
  onHourlyLimitChange: (value: number) => void
}

export default function SchedulingControls({
  delayValue,
  delayUnit,
  hourlyLimit,
  onDelayValueChange,
  onDelayUnitChange,
  onHourlyLimitChange,
}: SchedulingControlsProps) {
  const maximumDelayValue = delayUnit === 'seconds' ? 86_400 : delayUnit === 'minutes' ? 1_440 : 24
  const delayError = delayValue <= 0
    ? 'Minimum delay must be a positive integer.'
    : delayValue > maximumDelayValue
      ? `Maximum delay is ${maximumDelayValue} ${delayUnit}.`
      : ''
  const hourlyError = hourlyLimit <= 0
    ? 'Hourly limit must be a positive integer.'
    : hourlyLimit > 10_000
      ? 'Hourly limit cannot exceed 10,000.'
      : ''

  function readPositiveInteger(value: string, onChange: (value: number) => void) {
    if (value === '') {
      onChange(0)
      return
    }
    const number = Number(value)
    onChange(Number.isSafeInteger(number) && number > 0 ? number : 0)
  }

  return (
    <section className="scheduling-controls" aria-label="Scheduling settings">
      <div className="scheduling-group scheduling-inline-group">
        <label className="scheduling-label" htmlFor="delay-value">Minimum delay between emails</label>
        <div className="scheduling-input-pair">
          <input
            id="delay-value"
            aria-label="Delay between emails"
            aria-invalid={Boolean(delayError)}
            type="number"
            min="1"
            max={maximumDelayValue}
            step="1"
            value={delayValue > 0 ? delayValue : ''}
            onChange={event => readPositiveInteger(event.target.value, onDelayValueChange)}
            onKeyDown={event => { if (event.key === '-' || event.key === 'e' || event.key === 'E') event.preventDefault() }}
          />
          <select aria-label="Delay unit" value={delayUnit} onChange={event => onDelayUnitChange(event.target.value as DelayUnit)}>
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
          </select>
        </div>
        {delayError && <span className="scheduling-error" role="alert">{delayError}</span>}
      </div>

      <div className="scheduling-group scheduling-inline-group">
        <label className="scheduling-label" htmlFor="hourly-limit">Sender hourly limit</label>
        <input
          id="hourly-limit"
          className="hourly-limit-input"
          aria-label="Hourly limit"
          aria-invalid={Boolean(hourlyError)}
          type="number"
          min="1"
          max="10000"
          step="1"
          value={hourlyLimit > 0 ? hourlyLimit : ''}
          onChange={event => readPositiveInteger(event.target.value, onHourlyLimitChange)}
          onKeyDown={event => { if (event.key === '-' || event.key === 'e' || event.key === 'E') event.preventDefault() }}
        />
        <span className="scheduling-unit">emails/hour</span>
        {hourlyError && <span className="scheduling-error" role="alert">{hourlyError}</span>}
      </div>

    </section>
  )
}
