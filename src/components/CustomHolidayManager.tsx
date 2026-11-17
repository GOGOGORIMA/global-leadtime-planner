import { CalendarPlus, Trash2 } from 'lucide-react'
import { useId, useState, type Dispatch } from 'react'
import type { PlannerAction } from '../state/plannerReducer'
import type { OverrideMap } from '../types'
import { groupOverrideRanges, type ResolvedCountry } from '../utils/calendars'
import { diffDays, eachDay, isISODate, type ISODate, type OverrideKind } from '../utils/dateCalc'
import { formatJaDate } from '../utils/dateFormat'
import { btn, cx, inputClass, labelClass } from './classes'
import { CountryFlag } from './CountryFlag'
import { Badge, Segmented } from './ui'

const MAX_RANGE_DAYS = 366

const LABEL_SUGGESTIONS: ReadonlyArray<{ en: string; ja: string }> = [
  { en: 'Lunar New Year holidays', ja: '旧正月休暇' },
  { en: 'Factory shutdown', ja: '工場休業' },
  { en: 'Year-end & New Year holidays', ja: '年末年始休暇' },
  { en: 'Summer holidays', ja: '夏季休暇' },
  { en: 'Golden Week holidays', ja: 'GW休暇' },
  { en: 'Stocktaking', ja: '棚卸' },
  { en: 'Eid holidays', ja: 'イード（断食明け）休暇' },
  { en: 'Saturday shift', ja: '土曜出勤（臨時稼働）' },
]

interface CustomHolidayManagerProps {
  countries: readonly ResolvedCountry[]
  overrides: OverrideMap
  dispatch: Dispatch<PlannerAction>
  defaultDate: ISODate
}

export function CustomHolidayManager({ countries, overrides, dispatch, defaultDate }: CustomHolidayManagerProps) {
  const [country, setCountry] = useState(countries[1]?.code ?? countries[0].code)
  const [start, setStart] = useState(defaultDate)
  const [end, setEnd] = useState(defaultDate)
  const [kind, setKind] = useState<OverrideKind>('off')
  const [label, setLabel] = useState('')
  const labelsId = useId()

  const selectedCountry = countries.some((c) => c.code === country) ? country : countries[0].code
  const [from, to] = start <= end ? [start, end] : [end, start]
  const rangeValid = isISODate(start) && isISODate(end) && diffDays(from, to) < MAX_RANGE_DAYS
  const ranges = countries.flatMap((c) => groupOverrideRanges(c.code, overrides[c.code] ?? {}))
  const byCode = new Map(countries.map((c) => [c.code, c]))

  const add = () => {
    if (!rangeValid) return
    dispatch({
      type: 'setOverrides',
      country: selectedCountry,
      dates: eachDay(from, to),
      override: { kind, label: label.trim() || undefined },
    })
    setLabel('')
  }

  return (
    <div className="mt-5 grid gap-5 border-t border-slate-100 pt-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <CalendarPlus size={16} className="text-indigo-500" />
          期間でカスタム休日を追加
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">旧正月の延長休暇・工場の長期休暇・臨時の土曜稼働などをまとめて登録します。</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className={labelClass} htmlFor="override-country">
              国
            </label>
            <div className="relative">
              <CountryFlag
                code={selectedCountry}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
              />
              <select
                id="override-country"
                className={cx(inputClass, 'pl-10')}
                value={selectedCountry}
                onChange={(e) => setCountry(e.target.value)}
              >
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.info.nameJa}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="override-start">
              開始日
            </label>
            <input
              id="override-start"
              type="date"
              className={inputClass}
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                if (isISODate(e.target.value) && (!isISODate(end) || end < e.target.value)) setEnd(e.target.value)
              }}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="override-end">
              終了日
            </label>
            <input id="override-end" type="date" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="col-span-2">
            <span className={labelClass}>種別</span>
            <Segmented
              ariaLabel="種別"
              className="w-full"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'off', label: '休業日にする' },
                { value: 'work', label: '稼働日にする' },
              ]}
            />
          </div>
          <div className="col-span-2">
            <label className={labelClass} htmlFor="override-label">
              名称（英語推奨・メールに記載）
            </label>
            <input
              id="override-label"
              type="text"
              list={labelsId}
              className={inputClass}
              placeholder="例: Lunar New Year holidays"
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <datalist id={labelsId}>
              {LABEL_SUGGESTIONS.map((s) => (
                <option key={s.en} value={s.en} label={s.ja} />
              ))}
            </datalist>
          </div>
          <div className="col-span-2 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 tabular-nums">
              {rangeValid ? `${diffDays(from, to) + 1}日間` : `最大${MAX_RANGE_DAYS}日まで`}
            </span>
            <button type="button" className={btn.primary} disabled={!rangeValid} onClick={add}>
              <CalendarPlus size={16} />
              追加
            </button>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">登録済みのカスタム設定（{ranges.length}）</h3>
          {ranges.length > 0 && (
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-rose-600"
              onClick={() => window.confirm('すべてのカスタム休日・稼働日を削除しますか？') && dispatch({ type: 'clearOverrides' })}
            >
              すべて削除
            </button>
          )}
        </div>
        {ranges.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
            まだ登録はありません。
            <br />
            タイムラインの国の行の日付をクリックするか、左のフォームから期間で追加できます。
          </p>
        ) : (
          <ul className="mt-2 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {ranges.map((range) => {
              const c = byCode.get(range.country)
              return (
                <li key={`${range.country}-${range.start}-${range.kind}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <CountryFlag code={range.country} size="sm" />
                  <span className="w-24 shrink-0 truncate text-xs font-medium text-slate-600">{c?.info.nameJa ?? ''}</span>
                  <span className="shrink-0 text-xs font-medium text-slate-800 tabular-nums">
                    {range.start === range.end
                      ? formatJaDate(range.start)
                      : `${formatJaDate(range.start)} – ${formatJaDate(range.end, { year: range.start.slice(0, 4) !== range.end.slice(0, 4) })}`}
                  </span>
                  <Badge tone={range.kind === 'off' ? 'orange' : 'emerald'}>{range.kind === 'off' ? '休業' : '稼働'}</Badge>
                  <span className={cx('min-w-0 flex-1 truncate text-xs', range.label ? 'text-slate-700' : 'text-slate-400')}>
                    {range.label || '（名称なし）'}
                  </span>
                  <button
                    type="button"
                    className={cx(btn.icon, 'hover:bg-rose-50! hover:text-rose-600!')}
                    aria-label="削除"
                    onClick={() => dispatch({ type: 'setOverrides', country: range.country, dates: range.dates, override: null })}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
