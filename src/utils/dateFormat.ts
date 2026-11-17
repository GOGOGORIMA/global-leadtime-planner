/**
 * Display formatting for `YYYY-MM-DD` dates (English for customer-facing text, Japanese for the UI).
 * Pure functions without `Date`/`Intl`, so the output never shifts with the viewer's time zone.
 */
import { dayOfWeek, parseISODate, type ISODate } from './dateCalc'

export const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
export const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * English date styles for exported text.
 * - `dmy`: `Tue, 17 Nov 2026` (international / British — unambiguous, default)
 * - `mdy`: `Tue, Nov 17, 2026` (US)
 * - `iso`: `2026-11-17 (Tue)`
 */
export type EnglishDateStyle = 'dmy' | 'mdy' | 'iso'

export interface EnglishDateOptions {
  weekday?: boolean
  year?: boolean
}

export function formatEnglishDate(
  date: ISODate,
  style: EnglishDateStyle = 'dmy',
  { weekday = true, year = true }: EnglishDateOptions = {},
): string {
  const { year: y, month, day } = parseISODate(date)
  const wd = WEEKDAYS_EN[dayOfWeek(date)]
  const mon = MONTHS_EN[month - 1]
  switch (style) {
    case 'iso': {
      const core = year ? date : date.slice(5)
      return weekday ? `${core} (${wd})` : core
    }
    case 'mdy': {
      const core = year ? `${mon} ${day}, ${y}` : `${mon} ${day}`
      return weekday ? `${wd}, ${core}` : core
    }
    default: {
      const core = year ? `${day} ${mon} ${y}` : `${day} ${mon}`
      return weekday ? `${wd}, ${core}` : core
    }
  }
}

/** `Tue, 17 Nov 2026 – Tue, 8 Dec 2026`, or a single date when start === end. */
export function formatEnglishRange(
  start: ISODate,
  end: ISODate,
  style: EnglishDateStyle = 'dmy',
  options: EnglishDateOptions = {},
): string {
  if (start === end) return formatEnglishDate(start, style, options)
  return `${formatEnglishDate(start, style, options)} – ${formatEnglishDate(end, style, options)}`
}

/** `2026/11/17(火)` — or `11/17(火)` without the year. */
export function formatJaDate(
  date: ISODate,
  { year = true, weekday = true }: { year?: boolean; weekday?: boolean } = {},
): string {
  const { year: y, month, day } = parseISODate(date)
  const md = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`
  const core = year ? `${y}/${md}` : md
  return weekday ? `${core}(${WEEKDAYS_JA[dayOfWeek(date)]})` : core
}

/** `2026年11月` */
export function formatJaMonth(date: ISODate): string {
  const { year, month } = parseISODate(date)
  return `${year}年${month}月`
}

export function weekdayJa(date: ISODate): string {
  return WEEKDAYS_JA[dayOfWeek(date)]
}

export function weekdayEn(date: ISODate): string {
  return WEEKDAYS_EN[dayOfWeek(date)]
}

/** Human list of weekdays, e.g. `[5, 6]` → `金・土` / `Fri & Sat`. */
export function formatWeekendJa(weekend: readonly number[]): string {
  if (weekend.length === 0) return 'なし'
  return [...weekend]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAYS_JA[d])
    .join('・')
}

export function formatWeekendEn(weekend: readonly number[]): string {
  if (weekend.length === 0) return 'none'
  const names = [...weekend].sort((a, b) => a - b).map((d) => WEEKDAYS_EN[d])
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}
