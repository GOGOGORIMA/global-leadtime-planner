import { ChevronLeft, ChevronRight, Clock, Users } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNow } from '../hooks/useNow'
import { getDayInfo, toParticipant, type ResolvedCountry } from '../utils/calendars'
import {
  ALL_DAYS_CALENDAR,
  addDays,
  getDayStatus,
  isISODate,
  type DayStatus,
  type ISODate,
  type WorkCalendar,
} from '../utils/dateCalc'
import { formatJaDate, weekdayJa } from '../utils/dateFormat'
import {
  findCommonIntervals,
  formatClock,
  formatInstantClock,
  formatUtcOffset,
  getBusinessSlots,
  getDayWindow,
  getTimeZoneAbbreviation,
  getTimeZoneOffset,
  getWorkingIntervals,
  getZonedDateTime,
  intersectIntervals,
  mergeIntervals,
  totalMinutes,
} from '../utils/timezone'
import { btn, cx, inputClass } from './classes'
import { CountryFlag } from './CountryFlag'
import { Badge, Card, type Tone } from './ui'

const HOUR_MS = 3_600_000

/**
 * Row layout: 220px label column + 24-hour bar. Below `sm` (phones) the label stacks above the bar.
 * The hour scale, every country row, the "everyone" row and the now-line overlay share this grid,
 * so all bars line up exactly.
 */
const ROW_GRID = 'grid grid-cols-1 gap-x-4 sm:grid-cols-[220px_1fr]'

interface MeetingPlannerProps {
  countries: readonly ResolvedCountry[]
  calendars: ReadonlyMap<string, WorkCalendar>
  date: ISODate
  today: ISODate
  onDateChange: (date: ISODate) => void
}

/** `8時間`, `5.5時間` (half hours stay short enough for the 220px label column), `45分`, `5時間15分`. */
function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes)
  if (rounded % 30 === 0 && rounded >= 60) return `${rounded / 60}時間`
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  if (h === 0) return `${m}分`
  return m ? `${h}時間${m}分` : `${h}時間`
}

const BAR = 'absolute top-1.5 flex h-6 items-center justify-center overflow-hidden rounded border'

const NON_WORKING_STYLE: Record<Exclude<DayStatus, 'working' | 'custom-work'>, { bar: string; label: string }> = {
  holiday: { bar: 'stripes-dark border-rose-300 bg-rose-200 text-rose-800', label: '祝日' },
  weekend: { bar: 'stripes-dark border-slate-300 bg-slate-200 text-slate-600', label: '週末' },
  'custom-off': { bar: 'stripes-dark border-amber-300 bg-amber-200 text-amber-900', label: '休業' },
}

function nowStatus(country: ResolvedCountry, calendar: WorkCalendar, now: number): { tone: Tone; label: string; title?: string } {
  const local = getZonedDateTime(now, country.timeZone)
  const info = getDayInfo(country, calendar, undefined, local.date)
  const status = getDayStatus(local.date, calendar)
  if (status === 'holiday') {
    const names = info.holidays.filter((h) => h.blocking).map((h) => h.name)
    return { tone: 'rose', label: '祝日', title: names.join(' / ') }
  }
  if (status === 'weekend') return { tone: 'slate', label: '週末' }
  if (status === 'custom-off') return { tone: 'amber', label: '休業日' }
  if (local.minutes >= country.workStart && local.minutes < country.workEnd) return { tone: 'emerald', label: '営業中' }
  return { tone: 'slate', label: '時間外' }
}

export function MeetingPlanner({ countries, calendars, date, today, onDateChange }: MeetingPlannerProps) {
  const now = useNow(15_000)
  const base = countries[0]
  const calendarOf = (code: string) => calendars.get(code) ?? ALL_DAYS_CALENDAR
  const dayWindow = useMemo(() => getDayWindow(date, base.timeZone), [date, base.timeZone])
  const span = dayWindow.end - dayWindow.start
  const pct = (instant: number) => ((instant - dayWindow.start) / span) * 100

  const { rows, baseBand } = useMemo(() => {
    const baseWorking = getWorkingIntervals(dayWindow, toParticipant(base, calendars.get(base.code) ?? ALL_DAYS_CALENDAR))
    const list = countries.map((country) => {
      const calendar = calendars.get(country.code) ?? ALL_DAYS_CALENDAR
      const participant = toParticipant(country, calendar)
      const slots = getBusinessSlots(dayWindow, participant).map((slot) => {
        const info = getDayInfo(country, calendar, undefined, slot.localDate)
        return {
          ...slot,
          status: getDayStatus(slot.localDate, calendar),
          holidayNames: info.holidays.filter((h) => h.blocking).map((h) => h.name),
        }
      })
      const working = mergeIntervals(slots.filter((s) => s.working))
      const overlap = country.isBase ? working : intersectIntervals(baseWorking, working)
      return { country, participant, slots, overlapMinutes: totalMinutes(overlap) }
    })
    return { rows: list, baseBand: baseWorking }
  }, [countries, calendars, dayWindow, base])

  const common = useMemo(() => findCommonIntervals(dayWindow, rows.map((r) => r.participant)), [rows, dayWindow])

  const hours = Math.round(span / HOUR_MS)
  const ticks = Array.from({ length: hours + 1 }, (_, h) => dayWindow.start + h * HOUR_MS)
  const gridTicks = ticks.filter((_, h) => h % 3 === 0 && h > 0 && h < hours)
  const showNow = now >= dayWindow.start && now < dayWindow.end

  // Hover crosshair
  const containerRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; clientX: number; clientY: number; instant: number } | null>(null)

  const onMouseMove = (e: ReactMouseEvent) => {
    const bar = barRef.current?.getBoundingClientRect()
    const container = containerRef.current?.getBoundingClientRect()
    if (!bar || !container || e.clientX < bar.left || e.clientX > bar.right) {
      setHover(null)
      return
    }
    const fraction = (e.clientX - bar.left) / bar.width
    setHover({
      x: e.clientX - container.left,
      clientX: e.clientX,
      clientY: e.clientY,
      instant: dayWindow.start + Math.round((fraction * span) / 60_000) * 60_000,
    })
  }

  const baseAbbr = getTimeZoneAbbreviation(base.timeZone, dayWindow.start + 12 * HOUR_MS)

  /** Background shared by every bar: 3-hour grid lines + the base country's business hours. */
  const barBackground = (
    <>
      {gridTicks.map((t) => (
        <span key={t} className="absolute inset-y-0 w-px bg-slate-300/70" style={{ left: `${pct(t)}%` }} />
      ))}
      {baseBand.map((b) => (
        <span
          key={`band-${b.start}`}
          className="absolute inset-y-0 border-x border-dashed border-emerald-500/70 bg-emerald-100/70"
          style={{ left: `${pct(b.start)}%`, width: `${pct(b.end) - pct(b.start)}%` }}
        />
      ))}
    </>
  )

  const dateControls = (
    <div className="flex items-center gap-1">
      <button type="button" className={btn.icon} aria-label="前日" onClick={() => onDateChange(addDays(date, -1))}>
        <ChevronLeft size={18} />
      </button>
      <input
        type="date"
        aria-label="対象日"
        className={cx(inputClass, 'w-40 py-1.5')}
        value={date}
        onChange={(e) => isISODate(e.target.value) && onDateChange(e.target.value)}
      />
      <button type="button" className={btn.icon} aria-label="翌日" onClick={() => onDateChange(addDays(date, 1))}>
        <ChevronRight size={18} />
      </button>
      <button type="button" className={btn.secondary + ' py-1.5'} disabled={date === today} onClick={() => onDateChange(today)}>
        今日
      </button>
    </div>
  )

  return (
    <Card
      icon={<Clock size={18} />}
      title="現在時刻と会議可能時間帯"
      subtitle={`${base.info.nameJa}時間（${baseAbbr}）の24時間軸で、各国の営業時間・休日を比較。バーにカーソルを合わせると各国の現地時刻を表示します。`}
      actions={dateControls}
    >
      <div ref={containerRef} className="relative" onMouseMove={onMouseMove} onMouseLeave={() => setHover(null)}>
        {/* Hour scale (base country time, 00–24, every 3 hours) */}
        <div className={ROW_GRID}>
          <div className="hidden truncate text-xs font-medium text-slate-500 sm:block">
            {formatJaDate(date)} の {base.info.nameJa}時間
          </div>
          <div ref={barRef} className="relative h-5 min-w-0">
            {ticks.map((t, h) => (
              <span
                key={t}
                className={cx(
                  'absolute -translate-x-1/2 text-[10px] text-slate-400 tabular-nums',
                  h % 3 !== 0 && 'hidden',
                  h % 6 !== 0 && 'max-sm:hidden',
                  h === 0 && 'translate-x-0',
                  h === hours && '-translate-x-full',
                )}
                style={{ left: `${pct(t)}%` }}
              >
                {h === hours ? '24' : formatInstantClock(t, base.timeZone).slice(0, 2)}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          <ul>
            {rows.map(({ country, slots, overlapMinutes }) => {
              const status = nowStatus(country, calendarOf(country.code), now)
              const offset = formatUtcOffset(getTimeZoneOffset(now, country.timeZone))
              const hoursLabel = `${formatClock(country.workStart)}-${formatClock(country.workEnd)}`
              return (
                <li key={country.code} className={cx(ROW_GRID, 'items-center gap-y-1 border-b border-slate-100 py-2.5')}>
                  {/* Label column (220px) */}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <CountryFlag code={country.code} />
                      <span className="truncate text-sm font-semibold text-slate-800">{country.info.nameJa}</span>
                      {country.isBase && <Badge tone="indigo">基準</Badge>}
                      <Badge tone={status.tone}>
                        <span title={status.title}>{status.label}</span>
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500 tabular-nums">
                      <span className="font-semibold text-slate-700">{formatInstantClock(now, country.timeZone)}</span>{' '}
                      ({weekdayJa(getZonedDateTime(now, country.timeZone).date)}) · {offset}
                      {!country.isBase && (
                        <>
                          {' · '}
                          <span className={overlapMinutes > 0 ? 'font-medium text-emerald-600' : 'text-slate-400'}>
                            重なり {overlapMinutes > 0 ? formatDuration(overlapMinutes) : 'なし'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 24-hour bar */}
                  <div className="min-w-0">
                    <div className="relative h-9 overflow-visible rounded-md bg-slate-100">
                      {barBackground}
                      {slots.map((slot) => {
                        const left = pct(slot.start)
                        const width = pct(slot.end) - left
                        const shown = `${formatInstantClock(slot.start, country.timeZone)}-${formatInstantClock(slot.end, country.timeZone)}`
                        if (slot.working) {
                          return (
                            <div
                              key={slot.start}
                              className={cx(BAR, 'border-emerald-600 bg-emerald-400/80 text-xs font-medium text-emerald-950')}
                              style={{ left: `${left}%`, width: `${width}%` }}
                              title={`${country.info.nameJa} 営業時間 ${hoursLabel}（この日に表示中: 現地 ${formatJaDate(slot.localDate, { year: false })} ${shown}）`}
                            >
                              {width > 14 && <span className="truncate px-1">{hoursLabel}</span>}
                            </div>
                          )
                        }
                        const style =
                          NON_WORKING_STYLE[slot.status as keyof typeof NON_WORKING_STYLE] ?? NON_WORKING_STYLE.weekend
                        return (
                          <div
                            key={slot.start}
                            className={cx(BAR, 'text-[10px] font-medium', style.bar)}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${country.info.nameJa}: ${style.label}${slot.holidayNames.length ? `（${slot.holidayNames.join(' / ')}）` : ''} 現地 ${formatJaDate(slot.localDate, { year: false })}`}
                          >
                            {width > 9 && <span className="truncate px-1">{slot.holidayNames[0] ?? style.label}</span>}
                          </div>
                        )
                      })}
                      {showNow && (
                        <span className="absolute top-0 bottom-0 z-20 w-0.5 bg-rose-500 sm:hidden" style={{ left: `${pct(now)}%` }} />
                      )}
                    </div>
                    {!country.isBase && (
                      <div className="relative mt-0.5 h-3.5 text-[10px] text-slate-400 tabular-nums">
                        {ticks
                          .filter((_, h) => h % 6 === 0 && h < hours)
                          .map((t, i) => (
                            <span key={t} className={cx('absolute', i > 0 && '-translate-x-1/2')} style={{ left: `${pct(t)}%` }}>
                              {formatInstantClock(t, country.timeZone)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}

            <li className={cx(ROW_GRID, 'items-center gap-y-1 py-2.5')}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
                  <Users size={15} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">全員が営業時間内</div>
                  <div className="text-xs text-slate-500">
                    {common.length > 0 ? `合計 ${formatDuration(totalMinutes(common))}` : '共通の時間帯なし'}
                  </div>
                </div>
              </div>
              <div className="relative h-9 min-w-0 overflow-visible rounded-md bg-slate-100">
                {barBackground}
                {common.map((c) => {
                  const left = pct(c.start)
                  const width = pct(c.end) - left
                  return (
                    <div
                      key={c.start}
                      className={cx(BAR, 'border-indigo-700 bg-indigo-500 text-xs font-semibold text-white')}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      {width > 12 && (
                        <span className="truncate px-1">
                          {formatInstantClock(c.start, base.timeZone)}-{formatInstantClock(c.end, base.timeZone)}
                        </span>
                      )}
                    </div>
                  )
                })}
                {showNow && (
                  <span className="absolute top-0 bottom-0 z-20 w-0.5 bg-rose-500 sm:hidden" style={{ left: `${pct(now)}%` }} />
                )}
              </div>
            </li>
          </ul>

          {/* Current time: one red line through every row (desktop / tablet) */}
          {showNow && (
            <div className={cx(ROW_GRID, 'pointer-events-none absolute inset-0 max-sm:hidden')} aria-hidden>
              <div />
              <div className="relative">
                <span
                  className="absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-rose-500"
                  style={{ left: `${pct(now)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {hover && (
          <>
            <span className="pointer-events-none absolute top-5 bottom-0 z-20 w-px bg-indigo-600/70" style={{ left: hover.x }} />
            <div
              className="pointer-events-none fixed z-50 w-64 rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow-lg backdrop-blur"
              style={{
                left: Math.min(hover.clientX + 14, (typeof document !== 'undefined' ? document.documentElement.clientWidth : 1200) - 270),
                top: hover.clientY + 14,
              }}
            >
              {countries.map((country) => {
                const local = getZonedDateTime(hover.instant, country.timeZone)
                const calendar = calendarOf(country.code)
                const working =
                  ['working', 'custom-work'].includes(getDayStatus(local.date, calendar)) &&
                  local.minutes >= country.workStart &&
                  local.minutes < country.workEnd
                return (
                  <div key={country.code} className="flex items-center gap-1.5 py-0.5">
                    <CountryFlag code={country.code} size="sm" />
                    <span className="w-20 truncate text-slate-600">{country.info.nameJa}</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{formatInstantClock(hover.instant, country.timeZone)}</span>
                    <span className="text-slate-400">{formatJaDate(local.date, { year: false })}</span>
                    <span className={cx('ml-auto h-2 w-2 rounded-full', working ? 'bg-emerald-500' : 'bg-slate-300')} />
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm border border-emerald-600 bg-emerald-400/80" />
          営業時間
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 border-x border-dashed border-emerald-500/70 bg-emerald-100/70" />
          {base.info.nameJa}の営業時間
        </span>
        <span className="flex items-center gap-1">
          <span className="stripes-dark h-2.5 w-4 rounded-sm bg-rose-200" />
          祝日
        </span>
        <span className="flex items-center gap-1">
          <span className="stripes-dark h-2.5 w-4 rounded-sm bg-slate-200" />
          週末
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm bg-indigo-500" />
          全員参加可能
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 bg-rose-500" />
          現在時刻
        </span>
      </div>
    </Card>
  )
}
