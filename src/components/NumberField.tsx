import { useState } from 'react'
import { cx, inputClass } from './classes'

/**
 * Numeric input that only commits valid numbers (the reducer clamps them to the allowed range).
 * The typed text is kept while editing ("12." stays) and re-synced on blur / outside changes.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  ariaLabel,
  suffix,
  disabled,
  id,
  className,
}: {
  /** Small caption above the input (omit for inline use). */
  label?: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  ariaLabel: string
  /** Unit shown inside the field, e.g. `mm`. */
  suffix?: string
  disabled?: boolean
  id?: string
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    setDraft(String(value))
  }
  const input = (
    <input
      id={id}
      type="number"
      inputMode={step < 1 ? 'decimal' : 'numeric'}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => setDraft(String(value))}
      className={cx(inputClass, 'no-spinner px-2 py-1.5 text-right tabular-nums', suffix && 'pr-9')}
    />
  )
  const field = suffix ? (
    <span className="relative block">
      {input}
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-slate-400">{suffix}</span>
    </span>
  ) : (
    input
  )
  if (!label) return <span className={cx('block min-w-0', className)}>{field}</span>
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="mb-0.5 block truncate text-[10px] font-medium text-slate-500">{label}</span>
      {field}
    </label>
  )
}
