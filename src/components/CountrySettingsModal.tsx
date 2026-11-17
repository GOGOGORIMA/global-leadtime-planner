import { Info, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import {
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  getDefaultTimeZone,
  getDefaultWeekend,
  getRegionOptions,
  getTimeZoneOptions,
} from '../data/countries'
import type { CountrySettings } from '../types'
import type { ResolvedCountry } from '../utils/calendars'
import { WEEKDAYS_JA, formatWeekendJa } from '../utils/dateFormat'
import { formatClock, formatUtcOffset, getTimeZoneOffset, parseClock, timeZoneCity } from '../utils/timezone'
import { btn, cx, inputClass, labelClass } from './classes'
import { Badge, Flag, Modal } from './ui'

interface CountrySettingsModalProps {
  country: ResolvedCountry | null
  settings: CountrySettings | undefined
  now: number
  onChange: (patch: Partial<CountrySettings>) => void
  onReset: () => void
  onClose: () => void
}

const WEEKEND_PRESETS: ReadonlyArray<{ label: string; days: number[] }> = [
  { label: '土・日', days: [0, 6] },
  { label: '金・土', days: [5, 6] },
  { label: '日のみ', days: [0] },
  { label: '金のみ', days: [5] },
]

export function CountrySettingsModal({ country, settings, now, onChange, onReset, onClose }: CountrySettingsModalProps) {
  const regions = useMemo(() => (country ? getRegionOptions(country.code) : []), [country])
  if (!country) return null

  const timeZones = getTimeZoneOptions(country.code, country.region)
  const defaultTimeZone = getDefaultTimeZone(country.code, country.region)
  const defaultWeekend = getDefaultWeekend(country.code, country.region)
  const hasCustom = !!settings && Object.keys(settings).length > 0

  const toggleWeekday = (day: number) => {
    const next = country.weekend.includes(day) ? country.weekend.filter((d) => d !== day) : [...country.weekend, day]
    onChange({ weekend: [...next].sort((a, b) => a - b) })
  }

  const setHours = (field: 'workStart' | 'workEnd', value: string) => {
    const minutes = parseClock(value)
    if (minutes === null) return
    const start = field === 'workStart' ? minutes : country.workStart
    const end = field === 'workEnd' ? (minutes === 0 ? 1440 : minutes) : country.workEnd
    if (end <= start) return
    onChange({ workStart: start, workEnd: end })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Flag flag={country.info.flag} className="text-xl" />
          {country.info.nameJa}（{country.code}）の設定
          {country.isBase && <Badge tone="indigo">基準国</Badge>}
        </span>
      }
      footer={
        <>
          <button type="button" className={btn.ghost} onClick={onReset} disabled={!hasCustom}>
            <RotateCcw size={15} />
            初期値に戻す
          </button>
          <button type="button" className={btn.primary} onClick={onClose}>
            完了
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label className={labelClass} htmlFor="tz-select">
            タイムゾーン
          </label>
          <select
            id="tz-select"
            className={inputClass}
            value={country.timeZone}
            onChange={(e) => onChange({ timeZone: e.target.value === defaultTimeZone ? undefined : e.target.value })}
          >
            {(timeZones.includes(country.timeZone) ? timeZones : [country.timeZone, ...timeZones]).map((tz) => (
              <option key={tz} value={tz}>
                {timeZoneCity(tz)} — {formatUtcOffset(getTimeZoneOffset(now, tz))}（{tz}）
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">夏時間（DST）は日付ごとに自動で反映されます。</p>
        </div>

        {regions.length > 0 && (
          <div>
            <label className={labelClass} htmlFor="region-select">
              地域・州（地域の祝日を追加）
            </label>
            <select
              id="region-select"
              className={inputClass}
              value={country.region ?? ''}
              onChange={(e) => onChange({ region: e.target.value || undefined })}
            >
              <option value="">全国（国の祝日のみ）</option>
              {regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}（{r.code}）
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <span className={labelClass}>週末・定休日（クリックで切替）</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {WEEKDAYS_JA.map((label, day) => {
              const off = country.weekend.includes(day)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={off}
                  onClick={() => toggleWeekday(day)}
                  className={cx(
                    'h-9 w-9 rounded-lg border text-sm font-semibold transition',
                    off
                      ? 'border-slate-400 bg-slate-600 text-white hover:bg-slate-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
                  )}
                  title={off ? '休み（クリックで稼働に）' : '稼働（クリックで休みに）'}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">クイック設定:</span>
            {WEEKEND_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
                onClick={() => onChange({ weekend: preset.days })}
              >
                {preset.label}
              </button>
            ))}
            <span className="ml-auto text-slate-400">既定: {formatWeekendJa(defaultWeekend)}</span>
          </div>
        </div>

        <div>
          <span className={labelClass}>営業時間（現地時間）</span>
          <div className="flex items-center gap-2">
            <input
              type="time"
              step={900}
              aria-label="営業開始"
              className={inputClass}
              value={formatClock(country.workStart)}
              onChange={(e) => setHours('workStart', e.target.value)}
            />
            <span className="text-slate-400">〜</span>
            <input
              type="time"
              step={900}
              aria-label="営業終了"
              className={inputClass}
              value={formatClock(country.workEnd === 1440 ? 0 : country.workEnd)}
              onChange={(e) => setHours('workEnd', e.target.value)}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            既定: {formatClock(DEFAULT_WORK_START)}〜{formatClock(DEFAULT_WORK_END)}。会議可能時間帯の計算に使われます。
          </p>
        </div>

        <div className="flex gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <Info size={16} className="mt-0.5 shrink-0 text-slate-400" />
          {country.info.hasHolidayData ? (
            <p>
              祝日は <strong>date-holidays</strong> のデータから自動判定します（公休日・銀行休業日を休業扱い。半日休や記念日は参考表示のみ）。
              旧正月の延長休暇や工場の長期休暇は、タイムラインの日付クリックで「カスタム休日」として追加できます。
            </p>
          ) : (
            <p>
              この国の祝日データはありません。週末のみで計算されるため、祝日はタイムラインの日付クリックまたは「期間で追加」から
              カスタム休日として登録してください。
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
