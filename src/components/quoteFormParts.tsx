import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { getContainerSpec, specsOfCategory, type ContainerCategory, type ContainerId } from '../data/containers'
import { MAX_QUOTE_CHARGE, MAX_QUOTE_UNITS } from '../state/defaults'
import type { MoneyAmount, UnitCount } from '../types'
import type { LoadCheck } from '../utils/incotermsCalc'
import type { UnitChoice } from '../utils/quotation'
import { cx, focusRing, inputClass } from './classes'
import { NumberField } from './NumberField'
import { kgText, qty } from './quoteStyles'

/** Building blocks of the quotation form (tab ⑥). */

export function SectionHeader({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
        {n}
      </span>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {note && <span className="text-[11px] text-slate-500">{note}</span>}
    </div>
  )
}

export function FieldLabel({ htmlFor, children, extra }: { htmlFor?: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-1 flex items-end justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs leading-snug font-medium text-slate-600">
        {children}
      </label>
      {extra}
    </div>
  )
}

export function Hint({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'error' }) {
  return (
    <p
      className={cx(
        'mt-1 text-[11px] leading-relaxed',
        tone === 'muted' && 'text-slate-500',
        tone === 'warn' && 'text-amber-800',
        tone === 'error' && 'text-rose-700',
      )}
    >
      {children}
    </p>
  )
}

/** 「自動」/「手動」 chip with a reset button for manual values (`compact`: icon-only reset, for table rows). */
export function AutoState({
  manual,
  onReset,
  autoLabel = '自動',
  compact = false,
  resetLabel = '自動計算の値に戻す',
}: {
  manual: boolean
  onReset: () => void
  autoLabel?: string
  compact?: boolean
  resetLabel?: string
}) {
  if (!manual) {
    return (
      <span className="rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold whitespace-nowrap text-emerald-700 ring-1 ring-emerald-200">
        {autoLabel}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold whitespace-nowrap text-amber-800 ring-1 ring-amber-200">手動</span>
      <button
        type="button"
        onClick={onReset}
        className={cx(
          'inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium whitespace-nowrap text-indigo-700 hover:bg-indigo-50',
          compact && 'py-0.5',
          focusRing,
        )}
        title={resetLabel}
        aria-label={resetLabel}
      >
        <RotateCcw size={11} />
        {!compact && '自動に戻す'}
      </button>
    </span>
  )
}

/** Slider with the current value on the right and the range below. */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  unit = '%',
  children,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  display: string
  unit?: string
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          {label}
        </label>
        <span className="text-sm font-semibold text-slate-900 tabular-nums">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-5 w-full cursor-pointer accent-indigo-600"
      />
      <div className="flex justify-between text-[10px] text-slate-400 tabular-nums">
        <span>
          {min.toLocaleString('en-US')}
          {unit}
        </span>
        <span>
          {max.toLocaleString('en-US')}
          {unit}
        </span>
      </div>
      {children}
    </div>
  )
}

/** Small two-option toggle (USD / 円, cm / mm …). */
export function MiniToggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-md px-2 py-1 text-[11px] font-semibold transition',
            focusRing,
            value === option.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const MONEY_CURRENCIES = [
  { value: 'JPY' as const, label: '円' },
  { value: 'USD' as const, label: 'USD' },
]

/**
 * Amount in JPY or USD that is automatic (rate table / preset, JPY) until edited. Switching the
 * currency converts a manual amount at the USD rate; an automatic amount is just shown in the other currency.
 */
export function MoneyField({
  label,
  value,
  auto,
  usdRate,
  onChange,
  autoLabel,
  children,
}: {
  label: string
  value: MoneyAmount | null
  /** Automatic amount (JPY). */
  auto: number
  usdRate: number
  onChange: (value: MoneyAmount | null) => void
  autoLabel?: string
  children?: ReactNode
}) {
  const id = useId()
  const [display, setDisplay] = useState<'JPY' | 'USD'>(value?.currency ?? 'JPY')
  const currency = value?.currency ?? display
  const shown = value ? value.amount : currency === 'USD' ? Math.round((auto / usdRate) * 100) / 100 : auto
  const toggle = (next: 'JPY' | 'USD') => {
    setDisplay(next)
    if (!value || value.currency === next) return
    const amount = next === 'JPY' ? Math.round(value.amount * usdRate) : Math.round((value.amount / usdRate) * 100) / 100
    onChange({ amount, currency: next })
  }
  return (
    <div>
      <FieldLabel htmlFor={id} extra={<AutoState manual={value !== null} onReset={() => onChange(null)} autoLabel={autoLabel} />}>
        {label}
      </FieldLabel>
      <div className="flex items-center gap-1.5">
        <NumberField
          id={id}
          className="flex-1"
          value={shown}
          onChange={(amount) => onChange({ amount, currency })}
          min={0}
          max={MAX_QUOTE_CHARGE}
          step={currency === 'USD' ? 0.01 : 1}
          ariaLabel={label}
          suffix={currency === 'USD' ? 'USD' : '円'}
        />
        <MiniToggle value={currency} options={MONEY_CURRENCIES} onChange={toggle} label={`${label}の通貨`} />
      </div>
      {children}
    </div>
  )
}

/** JPY amount that is automatic until edited. */
export function YenField({
  label,
  value,
  auto,
  onChange,
  autoLabel,
  children,
}: {
  label: string
  value: number | null
  auto: number
  onChange: (value: number | null) => void
  autoLabel?: string
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div>
      <FieldLabel htmlFor={id} extra={<AutoState manual={value !== null} onReset={() => onChange(null)} autoLabel={autoLabel} />}>
        {label}
      </FieldLabel>
      <NumberField id={id} value={value ?? auto} onChange={onChange} min={0} max={MAX_QUOTE_CHARGE} step={1000} ariaLabel={label} suffix="円" />
      {children}
    </div>
  )
}

/** Warning when the containers / trucks cannot carry the packed weight or volume (重量・容積オーバー). */
export function LoadWarning({ check, choice, volume, weight }: { check: LoadCheck | null; choice: UnitChoice; volume: number; weight: number }) {
  if (!check || (!check.overWeight && !check.overVolume)) return null
  const problems = [
    check.overWeight && `梱包後重量 ${kgText(Math.round(weight))} kg が最大積載 ${kgText(check.capacityKg)} kg を超えています`,
    check.overVolume && `梱包後容積 ${qty(volume)} m³ が容積 ${qty(check.capacityM3)} m³ を超えています`,
  ].filter(Boolean)
  return (
    <p role="alert" className="mt-1 flex items-start gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] leading-relaxed text-rose-800 ring-1 ring-rose-200">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>
        {choice.spec.label} × {choice.units}
        {choice.spec.unitJa}：{problems.join('。')}。{choice.source === 'manual' ? '規格・数量を見直してください。' : ''}
      </span>
    </p>
  )
}

/** Container / truck type × count: automatic until changed (`null` = automatic). */
export function UnitsPicker({
  label,
  category,
  value,
  auto,
  autoLabel,
  onChange,
}: {
  label: string
  category: ContainerCategory
  value: UnitCount | null
  auto: UnitChoice
  autoLabel: string
  onChange: (value: UnitCount | null) => void
}) {
  const current = value ?? { id: auto.spec.id, units: auto.units }
  return (
    <div className="min-w-0">
      <FieldLabel extra={<AutoState manual={value !== null} onReset={() => onChange(null)} autoLabel={autoLabel} />}>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <select
          aria-label={`${label}の規格`}
          className={cx(inputClass, 'min-w-0 flex-1 px-2 py-1.5 text-[13px]')}
          value={current.id}
          onChange={(e) => onChange({ id: e.target.value as ContainerId, units: current.units })}
        >
          {specsOfCategory(category).map((spec) => (
            <option key={spec.id} value={spec.id}>
              {spec.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">×</span>
        <NumberField
          className="w-20 shrink-0"
          compact
          value={current.units}
          onChange={(units) => onChange({ id: current.id, units })}
          min={1}
          max={MAX_QUOTE_UNITS}
          ariaLabel={`${label}の数量`}
          suffix={getContainerSpec(current.id).unitJa}
        />
      </div>
    </div>
  )
}
