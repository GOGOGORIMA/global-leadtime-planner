import { useState } from 'react'
import { cx, inputClass } from './classes'

/**
 * Right padding (px) that keeps the digits clear of the unit: the unit's right offset, its
 * estimated width (CJK ≈ 1 em, other characters ≈ 0.65 em) and a small gap — never less than the
 * padding short units such as `mm` / `円` have always had, so only longer units (`円/m³`) widen it.
 */
function suffixPadding(suffix: string, compact: boolean): number {
  const fontPx = compact ? 10 : 11
  const em = [...suffix].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e7f ? 1 : 0.65), 0)
  return Math.max(compact ? 28 : 36, Math.ceil((compact ? 6 : 10) + em * fontPx + 4))
}

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
  compact = false,
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
  /** Denser input for table rows. */
  compact?: boolean
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
      className={cx(inputClass, 'no-spinner text-right tabular-nums', compact ? 'px-1.5 py-1.5 text-[13px]' : 'px-2 py-1.5')}
      style={suffix ? { paddingRight: suffixPadding(suffix, compact) } : undefined}
    />
  )
  const field = suffix ? (
    <span className="relative block">
      {input}
      <span
        className={cx(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400',
          compact ? 'right-1.5 text-[10px]' : 'right-2.5 text-[11px]',
        )}
      >
        {suffix}
      </span>
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
