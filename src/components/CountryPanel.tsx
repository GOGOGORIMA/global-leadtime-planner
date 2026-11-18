import { Check, Globe, Plus, Search, Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch } from 'react'
import {
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  PRESET_PARTNER_COUNTRIES,
  getCountryCatalog,
  getCountryInfo,
  getDefaultRegion,
  getDefaultWeekend,
} from '../data/countries'
import type { PlannerAction } from '../state/plannerReducer'
import type { ResolvedCountry } from '../utils/calendars'
import { formatWeekendJa } from '../utils/dateFormat'
import { formatClock, formatInstantClock, getTimeZoneAbbreviation } from '../utils/timezone'
import { btn, cx, inputClass, labelClass } from './classes'
import { CountryFlag } from './CountryFlag'
import { Badge, Card } from './ui'

interface CountryPanelProps {
  countries: readonly ResolvedCountry[]
  dispatch: Dispatch<PlannerAction>
  onOpenSettings: (code: string) => void
  now: number
}

function customizations(country: ResolvedCountry): string[] {
  const notes: string[] = []
  const defaultWeekend = getDefaultWeekend(country.code, country.region)
  if (country.weekend.join() !== defaultWeekend.join() || country.weekend.join() !== '0,6') {
    notes.push(`休:${formatWeekendJa(country.weekend)}`)
  }
  if (country.workStart !== DEFAULT_WORK_START || country.workEnd !== DEFAULT_WORK_END) {
    notes.push(`${formatClock(country.workStart)}–${formatClock(country.workEnd)}`)
  }
  // The default holiday region (United Kingdom → England) is not a customization.
  if (country.regionName && country.region !== getDefaultRegion(country.code)) notes.push(country.regionName)
  return notes
}

function CountryChip({
  country,
  now,
  onSettings,
  onRemove,
}: {
  country: ResolvedCountry
  now: number
  onSettings: () => void
  onRemove?: () => void
}) {
  const notes = customizations(country)
  return (
    <li
      className={cx(
        'group flex items-center gap-2 rounded-xl border py-1.5 pr-1 pl-2.5 shadow-sm',
        country.isBase ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200 bg-white',
      )}
    >
      <CountryFlag code={country.code} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-800">{country.info.nameJa}</span>
          {!country.info.hasHolidayData && (
            <Badge tone="amber" className="px-1! py-0! text-[10px]">
              祝日なし
            </Badge>
          )}
        </div>
        <div className="truncate text-[11px] text-slate-500 tabular-nums">
          {formatInstantClock(now, country.timeZone)} {getTimeZoneAbbreviation(country.timeZone, now)}
          {notes.length > 0 && <span className="text-indigo-600"> · {notes.join(' · ')}</span>}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center">
        <button
          type="button"
          className={btn.icon}
          onClick={onSettings}
          title="時差・週末・営業時間・地域祝日の設定"
          aria-label={`${country.info.nameJa}の設定`}
        >
          <Settings2 size={16} />
        </button>
        {onRemove && (
          <button
            type="button"
            className={cx(btn.icon, 'hover:bg-rose-50! hover:text-rose-600!')}
            onClick={onRemove}
            title="比較対象から外す"
            aria-label={`${country.info.nameJa}を外す`}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </li>
  )
}

function CountrySearch({ selected, onAdd }: { selected: ReadonlySet<string>; onAdd: (code: string) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [listStyle, setListStyle] = useState<CSSProperties | null>(null)

  // The list is position:fixed so the scrollable left pane cannot clip it; it opens upwards when
  // there is not enough room below and follows the input while the pane / window scrolls.
  const place = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const openUp = below < 240 && above > below
    setListStyle({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(160, Math.min(288, openUp ? above : below)),
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const catalog = getCountryCatalog()
    if (!q) return catalog.slice(0, 80)
    return catalog
      .filter((c) => c.code.toLowerCase() === q || c.nameEn.toLowerCase().includes(q) || c.nameJa.includes(query.trim()))
      .sort((a, b) => Number(b.code.toLowerCase() === q) - Number(a.code.toLowerCase() === q))
      .slice(0, 80)
  }, [query])

  const add = (code: string) => {
    if (selected.has(code)) return
    onAdd(code)
    setQuery('')
    setActive(0)
  }

  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="国を検索して追加"
        placeholder="国名で検索して追加（例: 中国, India, シンガポール）"
        className={cx(inputClass, 'pl-9')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(results.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const candidate = results[active]
            if (candidate) add(candidate.code)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && listStyle && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          style={listStyle}
          className="fixed z-50 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {results.map((c, i) => {
            const isSelected = selected.has(c.code)
            return (
              <li
                key={c.code}
                role="option"
                aria-selected={i === active}
                aria-disabled={isSelected}
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(c.code)
                }}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                  i === active && 'bg-indigo-50',
                  isSelected && 'cursor-default text-slate-400',
                )}
              >
                <CountryFlag code={c.code} lazy />
                <span className="font-medium">{c.nameJa}</span>
                <span className="truncate text-xs text-slate-400">{c.nameEn}</span>
                <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                  {!c.hasHolidayData && <Badge tone="amber">祝日なし</Badge>}
                  {isSelected && <Check size={14} className="text-emerald-600" />}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function CountryPanel({ countries, dispatch, onOpenSettings, now }: CountryPanelProps) {
  const base = countries[0]
  const partners = countries.slice(1)
  const selected = useMemo(() => new Set(countries.map((c) => c.code)), [countries])
  const catalog = getCountryCatalog()

  return (
    <Card
      icon={<Globe size={18} />}
      title="対象国と営業時間"
      subtitle="基準国（自社）と比較対象国を選択。⚙ から時差・週末・営業時間・地域祝日を調整できます。"
    >
      <div className="space-y-5">
        <div>
          <label className={labelClass} htmlFor="base-country">
            基準国（自社拠点）
          </label>
          <div className="relative">
            <CountryFlag code={base.code} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
            <select
              id="base-country"
              className={cx(inputClass, 'pl-10')}
              value={base.code}
              onChange={(e) => dispatch({ type: 'setBase', code: e.target.value })}
            >
              {catalog.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nameJa}
                </option>
              ))}
            </select>
          </div>
          <ul className="mt-2">
            <CountryChip country={base} now={now} onSettings={() => onOpenSettings(base.code)} />
          </ul>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={cx(labelClass, 'mb-0')}>比較対象国 ({partners.length})</span>
            {partners.length > 0 && (
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-rose-600"
                onClick={() => dispatch({ type: 'setPartners', codes: [] })}
              >
                すべて外す
              </button>
            )}
          </div>
          {partners.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              比較対象国がありません。下のプリセットか検索から追加してください。
            </p>
          ) : (
            <ul className="grid gap-2">
              {partners.map((country) => (
                <CountryChip
                  key={country.code}
                  country={country}
                  now={now}
                  onSettings={() => onOpenSettings(country.code)}
                  onRemove={() => dispatch({ type: 'removePartner', code: country.code })}
                />
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className={cx(labelClass, 'mb-0')}>プリセット（クリックで追加／解除）</span>
            <button
              type="button"
              className="text-xs text-indigo-600 hover:text-indigo-800"
              onClick={() =>
                dispatch({
                  type: 'setPartners',
                  codes: [...partners.map((p) => p.code), ...PRESET_PARTNER_COUNTRIES],
                })
              }
            >
              すべて追加
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_PARTNER_COUNTRIES.map((code) => {
              const info = getCountryInfo(code)
              const isBase = code === base.code
              const active = selected.has(code)
              return (
                <button
                  key={code}
                  type="button"
                  disabled={isBase}
                  aria-pressed={active}
                  title={isBase ? '基準国です' : info.nameJa}
                  onClick={() => dispatch({ type: active ? 'removePartner' : 'addPartner', code })}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition',
                    active
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      : 'border-dashed border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700',
                    isBase && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <CountryFlag code={code} size="sm" />
                  {info.nameJa}
                  {active ? <Check size={12} /> : <Plus size={12} />}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <span className={labelClass}>その他の国を追加</span>
          <CountrySearch selected={selected} onAdd={(code) => dispatch({ type: 'addPartner', code })} />
        </div>
      </div>
    </Card>
  )
}
