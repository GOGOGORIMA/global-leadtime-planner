/**
 * Time-zone helpers built on the platform's `Intl` API (IANA database, DST-aware).
 *
 * Instants are plain epoch milliseconds; calendar dates stay `YYYY-MM-DD` strings. The conversion
 * between the two only happens here, explicitly and with an explicit time zone — never through the
 * runtime's local zone.
 */
import { addDays, formatISODate, toDayNumber, type ISODate } from './dateCalc'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsFormatterCache.set(timeZone, formatter)
  }
  return formatter
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    getPartsFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

export interface ZonedDateTime {
  /** Local calendar date in the zone. */
  date: ISODate
  hour: number
  minute: number
  second: number
  /** Minutes since local midnight. */
  minutes: number
}

/** Wall-clock date and time of an instant in a time zone. */
export function getZonedDateTime(instant: number, timeZone: string): ZonedDateTime {
  let year = 1970
  let month = 1
  let day = 1
  let hour = 0
  let minute = 0
  let second = 0
  for (const part of getPartsFormatter(timeZone).formatToParts(new Date(instant))) {
    const value = Number(part.value)
    if (part.type === 'year') year = value
    else if (part.type === 'month') month = value
    else if (part.type === 'day') day = value
    else if (part.type === 'hour') hour = value % 24 // some engines print "24" at midnight
    else if (part.type === 'minute') minute = value
    else if (part.type === 'second') second = value
  }
  return { date: formatISODate(year, month, day), hour, minute, second, minutes: hour * 60 + minute }
}

/** Offset from UTC in minutes at a given instant (e.g. `540` for JST, `-300` for EST). */
export function getTimeZoneOffset(instant: number, timeZone: string): number {
  const z = getZonedDateTime(instant, timeZone)
  const wallAsUtc = toDayNumber(z.date) * DAY_MS + ((z.hour * 60 + z.minute) * 60 + z.second) * 1000
  const wholeSecond = Math.floor(instant / 1000) * 1000
  return Math.round((wallAsUtc - wholeSecond) / MINUTE_MS)
}

/** UTC instant of the local wall time `minutes` after midnight of `date` in `timeZone`. */
export function zonedTimeToInstant(date: ISODate, minutes: number, timeZone: string): number {
  const wall = toDayNumber(date) * DAY_MS + minutes * MINUTE_MS
  const firstGuess = wall - getTimeZoneOffset(wall, timeZone) * MINUTE_MS
  // Second pass with the offset in force at the first guess — resolves DST transitions.
  return wall - getTimeZoneOffset(firstGuess, timeZone) * MINUTE_MS
}

/** Today's local date in a time zone. */
export function todayInTimeZone(timeZone: string, now: number = Date.now()): ISODate {
  return getZonedDateTime(now, timeZone).date
}

/** `UTC+9`, `UTC+5:30`, `UTC-5`. ASCII only, so it is safe in e-mails. */
export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  return `UTC${sign}${hours}${mins ? `:${String(mins).padStart(2, '0')}` : ''}`
}

/** Minutes since midnight → `HH:MM` (1440 → `24:00`). */
export function formatClock(minutes: number): string {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = ((total % 60) + 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** `HH:MM` → minutes since midnight (`24:00` allowed), or `null` when malformed. */
export function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null
  return h * 60 + min
}

/** Local `HH:MM` of an instant in a zone. */
export function formatInstantClock(instant: number, timeZone: string): string {
  return formatClock(getZonedDateTime(instant, timeZone).minutes)
}

/**
 * Well-known abbreviations for zones without daylight saving time. Zones with DST (US, EU, …) get
 * their abbreviation from `Intl` (EST/EDT, CET/CEST, …); zones without a common name fall back to
 * `UTC±h`. China and Taiwan use "CST" (China Standard Time / Chungyuan Standard Time) as is usual
 * in Asian business correspondence.
 */
const FIXED_ABBREVIATIONS: Record<string, string> = {
  'Asia/Tokyo': 'JST',
  'Asia/Seoul': 'KST',
  'Asia/Shanghai': 'CST',
  'Asia/Taipei': 'CST',
  'Asia/Hong_Kong': 'HKT',
  'Asia/Singapore': 'SGT',
  'Asia/Kuala_Lumpur': 'MYT',
  'Asia/Kuching': 'MYT',
  'Asia/Bangkok': 'ICT',
  'Asia/Ho_Chi_Minh': 'ICT',
  'Asia/Phnom_Penh': 'ICT',
  'Asia/Vientiane': 'ICT',
  'Asia/Jakarta': 'WIB',
  'Asia/Pontianak': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
  'Asia/Manila': 'PHT',
  'Asia/Kolkata': 'IST',
  'Asia/Karachi': 'PKT',
  'Asia/Yangon': 'MMT',
  'Asia/Kathmandu': 'NPT',
  'Asia/Dubai': 'GST',
  'Africa/Nairobi': 'EAT',
  'Africa/Dar_es_Salaam': 'EAT',
  'Africa/Kampala': 'EAT',
  'Africa/Addis_Ababa': 'EAT',
  'Africa/Johannesburg': 'SAST',
  'Africa/Lagos': 'WAT',
}

const shortNameFormatterCache = new Map<string, Intl.DateTimeFormat>()

function intlShortZoneName(timeZone: string, instant: number, locale: string): string | undefined {
  try {
    const key = `${locale}|${timeZone}`
    let formatter = shortNameFormatterCache.get(key)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
      shortNameFormatterCache.set(key, formatter)
    }
    return formatter.formatToParts(new Date(instant)).find((p) => p.type === 'timeZoneName')?.value
  } catch {
    return undefined
  }
}

/** Short zone label such as `JST`, `EST`, `CEST`, or `UTC+8` when no unambiguous name exists. */
export function getTimeZoneAbbreviation(timeZone: string, instant: number): string {
  const fixed = FIXED_ABBREVIATIONS[timeZone]
  if (fixed) return fixed
  for (const locale of ['en-US', 'en-GB']) {
    const name = intlShortZoneName(timeZone, instant, locale)
    if (name && /^[A-Z]{2,5}$/.test(name) && name !== 'UTC') return name
  }
  return formatUtcOffset(getTimeZoneOffset(instant, timeZone))
}

/** City part of an IANA zone for display: `America/Los_Angeles` → `Los Angeles`. */
export function timeZoneCity(timeZone: string): string {
  const city = timeZone.split('/').pop() ?? timeZone
  return city.replace(/_/g, ' ')
}

// ---------------------------------------------------------------------------------------------
// Business-hour overlap (会議可能時間帯)
// ---------------------------------------------------------------------------------------------

export interface Interval {
  /** Inclusive start instant (epoch ms). */
  start: number
  /** Exclusive end instant (epoch ms). */
  end: number
}

export interface BusinessSlot extends Interval {
  /** The participant's local date the slot belongs to. */
  localDate: ISODate
  /** `false` when that local date is a weekend / holiday / custom day off. */
  working: boolean
}

export interface Participant {
  timeZone: string
  /** Business hours as minutes since local midnight (e.g. 540–1080 for 09:00–18:00). */
  workStart: number
  workEnd: number
  isWorkingDate: (date: ISODate) => boolean
}

/** The `[00:00, 24:00)` window of a local date in a time zone (23/25 h on DST change days). */
export function getDayWindow(date: ISODate, timeZone: string): Interval {
  return {
    start: zonedTimeToInstant(date, 0, timeZone),
    end: zonedTimeToInstant(addDays(date, 1), 0, timeZone),
  }
}

/** A participant's business-hour slots clipped to a window (may span up to three local dates). */
export function getBusinessSlots(window: Interval, participant: Participant): BusinessSlot[] {
  const { timeZone, workStart, workEnd, isWorkingDate } = participant
  const first = addDays(getZonedDateTime(window.start, timeZone).date, -1)
  const last = getZonedDateTime(window.end, timeZone).date
  const slots: BusinessSlot[] = []
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const slotStart = zonedTimeToInstant(date, workStart, timeZone)
    let slotEnd = zonedTimeToInstant(date, workEnd, timeZone)
    if (slotEnd <= slotStart) slotEnd = zonedTimeToInstant(addDays(date, 1), workEnd, timeZone) // overnight shift
    const start = Math.max(slotStart, window.start)
    const end = Math.min(slotEnd, window.end)
    if (end > start) slots.push({ start, end, localDate: date, working: isWorkingDate(date) })
  }
  return slots
}

/** Sorts and merges overlapping or touching intervals. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Interval[] = []
  for (const current of sorted) {
    const last = merged[merged.length - 1]
    if (last && current.start <= last.end) last.end = Math.max(last.end, current.end)
    else merged.push({ start: current.start, end: current.end })
  }
  return merged
}

export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = []
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start)
      const end = Math.min(x.end, y.end)
      if (end > start) out.push({ start, end })
    }
  }
  return mergeIntervals(out)
}

export function totalMinutes(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start) / MINUTE_MS, 0)
}

/** Working business hours of a participant inside the window. */
export function getWorkingIntervals(window: Interval, participant: Participant): Interval[] {
  return mergeIntervals(getBusinessSlots(window, participant).filter((s) => s.working))
}

/** Time ranges inside `window` when every participant is within working business hours. */
export function findCommonIntervals(window: Interval, participants: readonly Participant[]): Interval[] {
  if (participants.length === 0) return []
  return participants
    .map((p) => getWorkingIntervals(window, p))
    .reduce((acc, list) => intersectIntervals(acc, list))
}

/**
 * Next `count` dates (in the base zone, starting at `fromDate`) on which all participants share
 * at least `minMinutes` of working business hours.
 */
export function findUpcomingMeetingDays(
  fromDate: ISODate,
  baseTimeZone: string,
  participants: readonly Participant[],
  {
    count = 3,
    maxScanDays = 21,
    minMinutes = 30,
    notBefore,
  }: {
    count?: number
    maxScanDays?: number
    minMinutes?: number
    /** Drop / trim slots before this instant (rounded up to the next quarter hour), e.g. "now". */
    notBefore?: number
  } = {},
): Array<{ date: ISODate; intervals: Interval[] }> {
  const earliest = notBefore === undefined ? undefined : Math.ceil(notBefore / (15 * MINUTE_MS)) * 15 * MINUTE_MS
  const out: Array<{ date: ISODate; intervals: Interval[] }> = []
  for (let i = 0; i < maxScanDays && out.length < count; i++) {
    const date = addDays(fromDate, i)
    const intervals = findCommonIntervals(getDayWindow(date, baseTimeZone), participants)
      .map((interval) => (earliest === undefined ? interval : { start: Math.max(interval.start, earliest), end: interval.end }))
      .filter((interval) => (interval.end - interval.start) / MINUTE_MS >= minMinutes)
    if (intervals.length > 0) out.push({ date, intervals })
  }
  return out
}
