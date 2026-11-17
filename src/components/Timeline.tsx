import { CalendarRange, ChevronLeft, ChevronRight, MousePointerClick, Scan } from 'lucide-react'
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { getHolidayCorrection } from '../data/holidayCorrections'
import type { PlannerAction } from '../state/plannerReducer'
import { CALENDAR_DAYS, type OverrideMap } from '../types'
import { getDayInfo, type DayInfo, type ResolvedCountry } from '../utils/calendars'
import {
  ALL_DAYS_CALENDAR,
  addDays,
  dayOfWeek,
  diffDays,
  eachDay,
  endOfWeek,
  isWorkingStatus,
  maxISODate,
  minISODate,
  startOfWeek,
  type ISODate,
  type ScheduleMode,
  type ScheduleResult,
  type WorkCalendar,
} from '../utils/dateCalc'
import { WEEKDAYS_EN, WEEKDAYS_JA, formatEnglishDate, formatJaDate, formatJaMonth } from '../utils/dateFormat'
import { btn, cx } from './classes'
import { CountryFlag } from './CountryFlag'
import { CustomHolidayManager } from './CustomHolidayManager'
import { DAY_STATUS_STYLES, stepColor } from './styles'
import { Card } from './ui'

/** One day = one 28px column (`w-7`). Cells are 26px wide with a 1px margin on each side. */
const CELL_W = 28
/** Sticky label column (`w-[210px]`). */
const LABEL_W = 210
const MAX_DAYS = 550

interface TimelineProps {
  countries: readonly ResolvedCountry[]
  calendars: ReadonlyMap<string, WorkCalendar>
  overrides: OverrideMap
  schedule: ScheduleResult
  mode: ScheduleMode
  anchor: ISODate
  today: ISODate
  orderDeadline?: ISODate
  dispatch: Dispatch<PlannerAction>
}

interface CountryRowData {
  country: ResolvedCountry
  cells: DayInfo[]
}

interface StepRowData {
  id: string
  index: number
  name: string
  days: number
  calendarLabel: string
  startIndex: number
  endIndex: number
  skipped: number[]
}

interface Marker {
  index: number
  label: string
  className: string
  lineClassName: string
}

interface GridProps {
  days: ISODate[]
  months: Array<{ key: string; label: string; count: number }>
  countryRows: CountryRowData[]
  stepRows: StepRowData[]
  markers: Marker[]
  baseWeekend: readonly number[]
  todayIndex: number
  /** Roving tabindex: the only day cell reachable with Tab (arrow keys move it). */
  activeRow: number
  activeCol: number
}

function actionHint(info: DayInfo): string {
  if (info.override) return 'クリックで解除'
  return isWorkingStatus(info.baseStatus) ? 'クリックでカスタム休日に' : 'クリックで臨時稼働日に'
}

/** Sticky label cell shared by every row of the matrix. */
const LABEL_CELL = 'sticky left-0 z-10 flex h-full shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-2'

/** Static grid: memoised so hover state changes in the parent never re-render hundreds of cells. */
const TimelineGrid = memo(function TimelineGrid({
  days,
  months,
  countryRows,
  stepRows,
  markers,
  baseWeekend,
  todayIndex,
  activeRow,
  activeCol,
}: GridProps) {
  const labelW = LABEL_W
  const width = labelW + days.length * CELL_W
  const labelStyle = { width: labelW, minWidth: labelW }
  const center = (index: number) => labelW + index * CELL_W + CELL_W / 2

  return (
    <div className="relative select-none" style={{ width }}>
      {/* Today column */}
      {todayIndex >= 0 && (
        <div
          className="pointer-events-none absolute top-5 bottom-0 z-0 bg-sky-400/15"
          style={{ left: labelW + todayIndex * CELL_W, width: CELL_W }}
        />
      )}
      {/* Marker lines (solid, through every row) */}
      {markers.map((m) => (
        <div
          key={`${m.label}-${m.index}`}
          className={cx('pointer-events-none absolute top-5 bottom-0 z-[5] w-0.5 -translate-x-1/2', m.lineClassName)}
          style={{ left: center(m.index) }}
        />
      ))}

      {/* Header row 1a: badges (今日 / 発注期限 …) above their day column */}
      <div className="relative flex h-5">
        <div className={LABEL_CELL} style={labelStyle} />
        {markers.map((m) => (
          <span
            key={`${m.label}-${m.index}`}
            className={cx(
              'absolute top-0.5 z-30 -translate-x-1/2 rounded px-1.5 py-px text-[10px] font-semibold whitespace-nowrap shadow-sm',
              m.className,
            )}
            style={{ left: center(m.index) }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* Header row 1b: year / month where the month changes */}
      <div className="relative flex h-5">
        <div className={LABEL_CELL} style={labelStyle} />
        {months.map((m) => (
          <div
            key={m.key}
            className="shrink-0 truncate border-l border-slate-200 px-1.5 text-[11px] leading-5 font-semibold text-slate-600"
            style={{ width: m.count * CELL_W }}
          >
            {m.label}
          </div>
        ))}
      </div>

      {/* Header row 2: weekday + day of month in every 28px column */}
      <div className="relative flex h-8 border-b border-slate-200">
        <div className={cx(LABEL_CELL, 'items-end pb-1 text-[10px] font-medium text-slate-400')} style={labelStyle}>
          日付
        </div>
        {days.map((date, i) => {
          const isWeekend = baseWeekend.includes(dayOfWeek(date))
          return (
            <div
              key={date}
              className={cx(
                'flex w-7 min-w-[28px] shrink-0 flex-col items-center justify-center text-[10px] leading-tight tabular-nums',
                isWeekend ? 'text-slate-400' : 'text-slate-600',
                i === todayIndex && 'font-bold text-sky-700',
              )}
            >
              <span className="text-[9px]">{WEEKDAYS_JA[dayOfWeek(date)]}</span>
              <span className="font-semibold">{Number(date.slice(8))}</span>
            </div>
          )
        })}
      </div>

      {/* Section A: working calendar of every country */}
      <div className="flex h-7">
        <div className={cx(LABEL_CELL, 'text-[11px] font-semibold text-slate-500')} style={labelStyle}>
          各国の稼働カレンダー
        </div>
      </div>
      {countryRows.map((row, r) => (
        <div key={row.country.code} className="relative flex h-8 items-center">
          <div className={LABEL_CELL} style={labelStyle}>
            <CountryFlag code={row.country.code} />
            <span className="truncate text-xs font-medium text-slate-700">{row.country.info.nameJa}</span>
            {row.country.isBase && (
              <span className="shrink-0 rounded bg-indigo-50 px-1 text-[9px] font-semibold text-indigo-600">基準</span>
            )}
          </div>
          {row.cells.map((cell, c) => (
            <button
              key={cell.date}
              type="button"
              data-r={r}
              data-c={c}
              tabIndex={r === activeRow && c === activeCol ? 0 : -1}
              aria-label={`${row.country.info.nameJa} ${formatJaDate(cell.date)} ${DAY_STATUS_STYLES[cell.status].label}`}
              className={cx(
                'relative z-[1] m-px h-7 w-[26px] min-w-[26px] shrink-0 rounded-[4px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600',
                DAY_STATUS_STYLES[cell.status].cell,
              )}
            >
              {cell.status === 'holiday' && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-white/90" />}
              {cell.status === 'custom-work' && (
                <span className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
              )}
              {cell.status === 'working' && cell.holidays.length > 0 && (
                <span className="absolute top-1 right-1 h-1 w-1 rounded-full bg-emerald-900/50" />
              )}
            </button>
          ))}
        </div>
      ))}

      {/* Section B: Gantt rows on the same date axis */}
      <div className="mt-1 flex h-7 border-t border-slate-200">
        <div className={cx(LABEL_CELL, 'text-[11px] font-semibold text-slate-500')} style={labelStyle}>
          <span className="truncate">
            工程
            <span className="text-[10px] font-normal">（ストライプ＝休業日でスキップ）</span>
          </span>
        </div>
      </div>
      {stepRows.map((row) => {
        const color = stepColor(row.index)
        const barLeft = row.startIndex * CELL_W + 1
        const barWidth = (row.endIndex - row.startIndex + 1) * CELL_W - 2
        return (
          <div key={row.id} className="relative flex h-8 items-center">
            <div className={LABEL_CELL} style={labelStyle} title={row.name}>
              <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', color.dot)} />
              <span className="truncate text-xs font-medium text-slate-700">
                {row.index + 1}. {row.name}
              </span>
            </div>
            <div className="relative h-full shrink-0" style={{ width: days.length * CELL_W }}>
              {/* z-[6]: above the marker lines (z-[5]) so they never cross the bar label; below the sticky labels (z-10). */}
              <div
                className={cx('absolute top-1 z-[6] h-6 overflow-hidden rounded', color.solid)}
                style={{ left: barLeft, width: barWidth }}
                title={`${row.name}: ${row.days}日 (${row.calendarLabel})`}
              >
                {row.skipped.map((i) => (
                  <span
                    key={i}
                    className={cx('gantt-skip absolute inset-y-0', color.soft)}
                    style={{ left: (i - row.startIndex) * CELL_W - 1, width: CELL_W }}
                  />
                ))}
                <span className="relative z-[1] flex h-full items-center px-1">
                  <span className="truncate rounded bg-slate-900/25 px-1.5 py-px text-[11px] font-semibold text-white">
                    {row.name} · {row.days}日 ({row.calendarLabel})
                  </span>
                </span>
              </div>
            </div>
          </div>
        )
      })}
      {stepRows.length === 0 && (
        <div className="flex h-8">
          <div className={cx(LABEL_CELL, 'text-xs text-slate-400')} style={labelStyle}>
            工程がありません
          </div>
        </div>
      )}
      <div className="flex h-2">
        <div className={LABEL_CELL} style={labelStyle} />
      </div>
    </div>
  )
})

function Tooltip({ info, country, x, y }: { info: DayInfo; country: ResolvedCountry; x: number; y: number }) {
  const blocking = info.holidays.filter((h) => h.blocking)
  const informational = info.holidays.filter((h) => !h.blocking)
  const correctionNote = getHolidayCorrection(country.code)?.note
  const style = DAY_STATUS_STYLES[info.status]
  const viewport = typeof document !== 'undefined' ? document.documentElement.clientWidth : 1200
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-30 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg"
      style={{ left: Math.max(8, Math.min(x - 144, viewport - 296)), top: y + 10 }}
    >
      <div className="flex items-center gap-1.5 text-slate-500">
        <CountryFlag code={country.code} />
        <span className="font-medium text-slate-700">{country.info.nameJa}</span>
        <span className="ml-auto tabular-nums">
          {formatJaDate(info.date)} · {WEEKDAYS_EN[dayOfWeek(info.date)]}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className={cx('h-3 w-3 rounded-sm', style.swatch)} />
        <span className="font-semibold text-slate-900">{style.label}</span>
        {info.status === 'holiday' && info.isWeekend && <span className="text-slate-400">（週末と重複）</span>}
      </div>
      {info.override?.label && <div className="mt-1 text-slate-700">📝 {info.override.label}</div>}
      {info.override && info.status === 'custom-work' && info.baseStatus !== 'working' && (
        <div className="mt-1 text-slate-500">本来は{DAY_STATUS_STYLES[info.baseStatus].label}</div>
      )}
      {blocking.length > 0 && (
        <ul className="mt-2 space-y-1">
          {blocking.map((h) => (
            <li key={h.rule + h.name}>
              <div className="flex items-center gap-1 font-medium text-rose-700">
                {h.name}
                {h.corrected && (
                  <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800">補正</span>
                )}
              </div>
              {h.localName && <div className="text-slate-600">{h.localName}</div>}
              <div className="text-[10px] text-slate-400">
                {h.type === 'bank' ? 'Bank holiday' : 'Public holiday'}
                {h.substitute ? ' · 振替休日 (substitute)' : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {informational.length > 0 && (
        <div className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
          参考（休業扱いなし）: {informational.map((h) => (h.localName ? `${h.name}（${h.localName}）` : h.name)).join(' / ')}
        </div>
      )}
      {info.holidays.some((h) => h.corrected) && correctionNote && (
        <div className="mt-1.5 text-[10px] leading-snug text-amber-700">※ {correctionNote}</div>
      )}
      <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-indigo-600">
        <MousePointerClick size={12} />
        {actionHint(info)}
      </div>
    </div>
  )
}

export function Timeline({
  countries,
  calendars,
  overrides,
  schedule,
  mode,
  anchor,
  today,
  orderDeadline,
  dispatch,
}: TimelineProps) {
  const [extraBefore, setExtraBefore] = useState(0)
  const [extraAfter, setExtraAfter] = useState(0)
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null)

  const hasSteps = schedule.ok && schedule.steps.length > 0
  const coreStart = hasSteps ? minISODate(schedule.start, anchor) : anchor
  const coreEnd = hasSteps ? maxISODate(schedule.end, anchor) : addDays(anchor, 28)
  const rangeStart = startOfWeek(addDays(coreStart, -3 - extraBefore * 7))
  let rangeEnd = endOfWeek(addDays(coreEnd, 3 + extraAfter * 7))
  if (diffDays(rangeStart, rangeEnd) >= MAX_DAYS) rangeEnd = addDays(rangeStart, MAX_DAYS - 1)

  const days = useMemo(() => eachDay(rangeStart, rangeEnd), [rangeStart, rangeEnd])

  const months = useMemo(() => {
    const list: Array<{ key: string; label: string; count: number }> = []
    for (const date of days) {
      const key = date.slice(0, 7)
      const last = list[list.length - 1]
      if (last?.key === key) last.count++
      else list.push({ key, label: formatJaMonth(date), count: 1 })
    }
    return list
  }, [days])

  const countryRows = useMemo<CountryRowData[]>(
    () =>
      countries.map((country) => {
        const calendar = calendars.get(country.code) ?? ALL_DAYS_CALENDAR
        return { country, cells: days.map((d) => getDayInfo(country, calendar, overrides[country.code], d)) }
      }),
    [countries, calendars, overrides, days],
  )

  const stepRows = useMemo<StepRowData[]>(() => {
    if (!schedule.ok) return []
    const lastIndex = days.length - 1
    return schedule.steps.map((s, index) => {
      const country = countries.find((c) => c.code === s.calendar)
      return {
        id: s.id,
        index,
        name: s.name,
        days: s.days,
        calendarLabel: s.calendar === CALENDAR_DAYS || !country ? '暦日' : `${country.info.nameJa}の営業日`,
        startIndex: Math.max(0, diffDays(rangeStart, s.start)),
        endIndex: Math.min(lastIndex, diffDays(rangeStart, s.end)),
        skipped: s.skippedDays.map((d) => diffDays(rangeStart, d)).filter((i) => i >= 0 && i <= lastIndex),
      }
    })
  }, [schedule, countries, rangeStart, days.length])

  const markers = useMemo<Marker[]>(() => {
    const list: Marker[] = []
    const push = (date: ISODate | undefined, label: string, className: string, lineClassName: string) => {
      if (!date) return
      const index = diffDays(rangeStart, date)
      if (index >= 0 && index < days.length) list.push({ index, label, className, lineClassName })
    }
    if (mode === 'backward') {
      push(anchor, '希望納期', 'bg-emerald-600 text-white', 'bg-emerald-600')
      if (hasSteps) push(orderDeadline, '発注期限', 'bg-indigo-600 text-white', 'bg-indigo-600')
    } else {
      push(anchor, '開始日', 'bg-indigo-600 text-white', 'bg-indigo-600')
      if (hasSteps && schedule.ok) push(schedule.end, '納期', 'bg-emerald-600 text-white', 'bg-emerald-600')
    }
    push(today, '今日', 'bg-sky-500 text-white', 'bg-transparent')
    return list
  }, [mode, anchor, orderDeadline, hasSteps, schedule, today, rangeStart, days.length])

  const todayIndex = diffDays(rangeStart, today)
  const base = countries[0]

  // Roving tabindex over the day cells: Tab enters the grid once, arrow keys move between cells.
  const [active, setActive] = useState<{ r: number; c: number } | null>(null)
  const activeRow = Math.min(active?.r ?? 0, Math.max(0, countryRows.length - 1))
  const activeCol = Math.min(active?.c ?? Math.max(0, todayIndex), days.length - 1)
  const gridRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef(false)
  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-r="${activeRow}"][data-c="${activeCol}"]`)?.focus()
  }, [activeRow, activeCol])

  const readCell = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.('[data-r]') as HTMLElement | null
    if (!el) return null
    const r = Number(el.dataset.r)
    const c = Number(el.dataset.c)
    return Number.isInteger(r) && Number.isInteger(c) ? { r, c, el } : null
  }

  const onClick = (e: ReactMouseEvent) => {
    const cell = readCell(e.target)
    if (!cell) return
    const row = countryRows[cell.r]
    const info = row?.cells[cell.c]
    if (!row || !info) return
    setActive({ r: cell.r, c: cell.c })
    dispatch({
      type: 'toggleOverride',
      country: row.country.code,
      date: info.date,
      defaultWorking: isWorkingStatus(info.baseStatus),
    })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const cell = readCell(e.target)
    if (!cell) return
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      Home: [0, -cell.c],
      End: [0, days.length - 1 - cell.c],
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    pendingFocus.current = true
    setActive({
      r: Math.min(countryRows.length - 1, Math.max(0, cell.r + move[0])),
      c: Math.min(days.length - 1, Math.max(0, cell.c + move[1])),
    })
  }

  const showTooltipFor = (target: EventTarget | null) => {
    const cell = readCell(target)
    if (!cell) {
      setHover(null)
      return
    }
    const rect = cell.el.getBoundingClientRect()
    setHover((prev) =>
      prev && prev.r === cell.r && prev.c === cell.c ? prev : { r: cell.r, c: cell.c, x: rect.left + rect.width / 2, y: rect.bottom },
    )
  }

  const hoveredRow = hover ? countryRows[hover.r] : undefined
  const hoveredInfo = hover ? hoveredRow?.cells[hover.c] : undefined

  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
      {(['working', 'weekend', 'holiday', 'custom-off', 'custom-work'] as const).map((status) => (
        <span key={status} className="flex items-center gap-1">
          <span className={cx('h-3 w-3 rounded-[3px]', DAY_STATUS_STYLES[status].swatch)} />
          {DAY_STATUS_STYLES[status].label}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="h-3 w-5 rounded-[3px] bg-indigo-500" />
        工程（稼働）
      </span>
      <span className="flex items-center gap-1">
        <span className="gantt-skip h-3 w-5 rounded-[3px] bg-indigo-300" />
        工程（スキップ）
      </span>
    </div>
  )

  return (
    <Card
      icon={<CalendarRange size={18} />}
      title="各国の稼働カレンダー＆工程ガントチャート"
      subtitle={
        <>
          各国の稼働日（緑）・週末（グレー）・祝日（赤）と工程期間を同じ日付軸で比較。祝日にカーソルを合わせると英語／現地語の名称を表示します。
          <strong className="font-semibold text-slate-700">
            国の行の日付をクリックすると、カスタム休日（旧正月・工場休暇など）を追加／解除できます。
          </strong>
        </>
      }
      actions={
        <div className="flex items-center gap-1">
          <button type="button" className={btn.ghost} onClick={() => setExtraBefore((n) => n + 2)} title="2週間前まで表示">
            <ChevronLeft size={16} />
            前へ
          </button>
          <button
            type="button"
            className={btn.ghost}
            disabled={extraBefore === 0 && extraAfter === 0}
            onClick={() => {
              setExtraBefore(0)
              setExtraAfter(0)
            }}
            title="表示期間を自動調整"
          >
            <Scan size={15} />
            自動
          </button>
          <button type="button" className={btn.ghost} onClick={() => setExtraAfter((n) => n + 2)} title="2週間後まで表示">
            次へ
            <ChevronRight size={16} />
          </button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {legend}
        <span className="text-[11px] text-slate-400 tabular-nums">
          {formatEnglishDate(rangeStart, 'dmy', { weekday: false })} – {formatEnglishDate(rangeEnd, 'dmy', { weekday: false })}（
          {days.length}日間）
        </span>
      </div>
      <div
        ref={gridRef}
        className="overflow-x-auto rounded-lg border border-slate-200 bg-white"
        onClick={onClick}
        onKeyDown={onKeyDown}
        onMouseOver={(e) => showTooltipFor(e.target)}
        onMouseLeave={() => setHover(null)}
        onFocus={(e: ReactFocusEvent) => showTooltipFor(e.target)}
        onBlur={() => setHover(null)}
        onScroll={() => setHover(null)}
      >
        <TimelineGrid
          days={days}
          months={months}
          countryRows={countryRows}
          stepRows={stepRows}
          markers={markers}
          baseWeekend={base.weekend}
          todayIndex={todayIndex >= 0 && todayIndex < days.length ? todayIndex : -1}
          activeRow={activeRow}
          activeCol={activeCol}
        />
      </div>
      {hover && hoveredRow && hoveredInfo && <Tooltip info={hoveredInfo} country={hoveredRow.country} x={hover.x} y={hover.y} />}

      <CustomHolidayManager
        countries={countries}
        overrides={overrides}
        dispatch={dispatch}
        defaultDate={hasSteps && schedule.ok ? schedule.start : anchor}
      />
    </Card>
  )
}
