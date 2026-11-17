/**
 * Pure, time-zone-independent date arithmetic on `YYYY-MM-DD` strings.
 *
 * Why strings? A JavaScript `Date` is an *instant* that is rendered in the *runtime's* local zone,
 * which is the classic source of "off-by-one-day" bugs (`new Date('2026-11-23')` is UTC midnight,
 * i.e. still the 22nd in New York). Every function in this module works on calendar dates only and
 * converts them to an integer "day number" (days since 1970-01-01) with plain integer arithmetic,
 * so the results are identical in every browser / server time zone.
 *
 * Nothing in this module touches `Date`, `Intl`, the clock or any global state: all functions are
 * pure and deterministic, which also makes them trivial to unit-test.
 */

/** A calendar date formatted as `YYYY-MM-DD` (ISO 8601 extended, no time, no zone). */
export type ISODate = string

/** Day of week: 0 = Sunday … 6 = Saturday (same convention as `Date#getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MIN_YEAR = 1000
const MAX_YEAR = 9999

/**
 * Upper bound for scanning forward/backward for a working day. A calendar that has no working day
 * within ~10 years (e.g. all 7 weekdays marked as weekend) is reported as an error instead of
 * looping forever.
 */
export const MAX_SCAN_DAYS = 3660

/** Allowed range for the duration of a single step (in days of its calendar). */
export const MIN_STEP_DAYS = 1
export const MAX_STEP_DAYS = 999

// ---------------------------------------------------------------------------------------------
// Calendar-date primitives
// ---------------------------------------------------------------------------------------------

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28
    case 4:
    case 6:
    case 9:
    case 11:
      return 30
    default:
      return 31
  }
}

/** Type guard: `true` for a well-formed, existing calendar date such as `2028-02-29`. */
export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false
  const m = ISO_DATE_RE.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  return (
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  )
}

export interface DateParts {
  year: number
  month: number
  day: number
}

/** Splits a `YYYY-MM-DD` string into numbers. Throws `RangeError` for invalid input. */
export function parseISODate(date: ISODate): DateParts {
  if (!isISODate(date)) throw new RangeError(`Invalid ISO date: "${String(date)}"`)
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  }
}

/** Builds a zero-padded `YYYY-MM-DD` string. Throws `RangeError` for non-existent dates. */
export function formatISODate(year: number, month: number, day: number): ISODate {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!isISODate(iso)) throw new RangeError(`Date out of range: ${year}-${month}-${day}`)
  return iso
}

/**
 * Converts a date to the number of days since 1970-01-01 (which is day 0).
 * Algorithm: Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms" (days_from_civil).
 */
export function toDayNumber(date: ISODate): number {
  const { year, month, day } = parseISODate(date)
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400 // [0, 399]
  const mp = (month + 9) % 12 // March = 0 … February = 11
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1 // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy // [0, 146096]
  return era * 146097 + doe - 719468
}

/** Inverse of {@link toDayNumber} (Hinnant's civil_from_days). */
export function fromDayNumber(dayNumber: number): ISODate {
  if (!Number.isInteger(dayNumber)) throw new RangeError(`Day number must be an integer: ${dayNumber}`)
  const z = dayNumber + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097 // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ) // [0, 399]
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)) // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153) // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1 // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9 // [1, 12]
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return formatISODate(year, month, day)
}

/** `date + days` (days may be negative). */
export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days)
}

/** Signed number of days from `from` to `to` (`to - from`). */
export function diffDays(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from)
}

/** Day of week for a date (0 = Sunday … 6 = Saturday). 1970-01-01 was a Thursday. */
export function dayOfWeek(date: ISODate): Weekday {
  return ((((toDayNumber(date) + 4) % 7) + 7) % 7) as Weekday
}

/** Comparator for ISO dates (lexicographic order equals chronological order for 4-digit years). */
export function compareISODate(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function minISODate(first: ISODate, ...rest: ISODate[]): ISODate {
  return rest.reduce((min, d) => (d < min ? d : min), first)
}

export function maxISODate(first: ISODate, ...rest: ISODate[]): ISODate {
  return rest.reduce((max, d) => (d > max ? d : max), first)
}

/** All dates from `start` to `end`, both inclusive. Empty when `end < start`. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const from = toDayNumber(start)
  const to = toDayNumber(end)
  const out: ISODate[] = []
  for (let n = from; n <= to; n++) out.push(fromDayNumber(n))
  return out
}

/** First day of the week containing `date` (default: weeks start on Monday). */
export function startOfWeek(date: ISODate, weekStartsOn: Weekday = 1): ISODate {
  const offset = (dayOfWeek(date) - weekStartsOn + 7) % 7
  return addDays(date, -offset)
}

/** Last day of the week containing `date` (default: weeks start on Monday, end on Sunday). */
export function endOfWeek(date: ISODate, weekStartsOn: Weekday = 1): ISODate {
  return addDays(startOfWeek(date, weekStartsOn), 6)
}

export function startOfMonth(date: ISODate): ISODate {
  const { year, month } = parseISODate(date)
  return formatISODate(year, month, 1)
}

export function endOfMonth(date: ISODate): ISODate {
  const { year, month } = parseISODate(date)
  return formatISODate(year, month, daysInMonth(year, month))
}

export function yearOf(date: ISODate): number {
  return parseISODate(date).year
}

/** Clamps a requested step duration to an integer within [MIN_STEP_DAYS, MAX_STEP_DAYS]. */
export function normalizeStepDays(days: number): number {
  if (!Number.isFinite(days)) return MIN_STEP_DAYS
  return Math.min(MAX_STEP_DAYS, Math.max(MIN_STEP_DAYS, Math.round(days)))
}

// ---------------------------------------------------------------------------------------------
// Working-day calendars
// ---------------------------------------------------------------------------------------------

/** Manual override for a single date: force a day off (`off`) or force a working day (`work`). */
export type OverrideKind = 'off' | 'work'

/**
 * Describes which dates count as working days.
 *
 * Precedence (highest first): manual override → public holiday → weekly weekend → working day.
 * `allDays: true` means "calendar days": every date counts and nothing else is consulted.
 */
export interface WorkCalendar {
  /** Every day is a working day (暦日カウント). */
  readonly allDays?: boolean
  /** Weekly non-working weekdays, 0 = Sunday … 6 = Saturday (e.g. `[0, 6]` or `[5, 6]`). */
  readonly weekend: readonly number[]
  /** Pure predicate: `true` if the date is a (full-day) public holiday. */
  readonly isHoliday?: (date: ISODate) => boolean
  /** Manual per-date overrides, e.g. Lunar New Year factory shutdown or a Saturday shift. */
  readonly overrides?: Readonly<Record<ISODate, OverrideKind>>
}

/** Calendar used for "calendar days" steps (ocean transit etc.): every date is counted. */
export const ALL_DAYS_CALENDAR: WorkCalendar = Object.freeze({ allDays: true, weekend: [] })

/** Convenience factory, mainly for tests and simple callers: holidays given as a list of dates. */
export function createWorkCalendar(options: {
  weekend?: readonly number[]
  holidays?: Iterable<ISODate>
  overrides?: Readonly<Record<ISODate, OverrideKind>>
  allDays?: boolean
}): WorkCalendar {
  const holidays = new Set(options.holidays ?? [])
  return {
    allDays: options.allDays,
    weekend: options.weekend ?? [0, 6],
    isHoliday: (date) => holidays.has(date),
    overrides: options.overrides,
  }
}

export type DayStatus = 'working' | 'weekend' | 'holiday' | 'custom-off' | 'custom-work'

/** Classifies a date for a calendar. A holiday that falls on a weekend is reported as `holiday`. */
export function getDayStatus(date: ISODate, calendar: WorkCalendar): DayStatus {
  if (calendar.allDays) return 'working'
  const override = calendar.overrides?.[date]
  if (override === 'work') return 'custom-work'
  if (override === 'off') return 'custom-off'
  if (calendar.isHoliday?.(date)) return 'holiday'
  if (calendar.weekend.includes(dayOfWeek(date))) return 'weekend'
  return 'working'
}

/** Status ignoring manual overrides (what the day would be without a custom setting). */
export function getBaseDayStatus(date: ISODate, calendar: WorkCalendar): DayStatus {
  return getDayStatus(date, { ...calendar, overrides: undefined })
}

export function isWorkingStatus(status: DayStatus): boolean {
  return status === 'working' || status === 'custom-work'
}

export function isWorkingDay(date: ISODate, calendar: WorkCalendar): boolean {
  return isWorkingStatus(getDayStatus(date, calendar))
}

/** Raised when a calendar has no working day within {@link MAX_SCAN_DAYS}. */
export class CalendarError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalendarError'
  }
}

function scanForWorkingDay(date: ISODate, calendar: WorkCalendar, direction: 1 | -1): ISODate {
  let dayNumber = toDayNumber(date)
  for (let i = 0; i <= MAX_SCAN_DAYS; i++) {
    const candidate = fromDayNumber(dayNumber)
    if (isWorkingDay(candidate, calendar)) return candidate
    dayNumber += direction
  }
  throw new CalendarError(
    `No working day found within ${MAX_SCAN_DAYS} days ${direction > 0 ? 'after' : 'before'} ${date}`,
  )
}

/** The first working day on or after `date`. */
export function nextWorkingDay(date: ISODate, calendar: WorkCalendar): ISODate {
  return scanForWorkingDay(date, calendar, 1)
}

/** The last working day on or before `date`. */
export function previousWorkingDay(date: ISODate, calendar: WorkCalendar): ISODate {
  return scanForWorkingDay(date, calendar, -1)
}

/**
 * Date of the `count`-th working day when work starts on `start`.
 * `start` itself counts as day 1 if it is a working day; otherwise counting begins at the next
 * working day. Example (Sat/Sun weekend): start Fri, count 2 → the following Monday.
 */
export function addWorkingDays(start: ISODate, count: number, calendar: WorkCalendar): ISODate {
  const n = normalizeStepDays(count)
  let current = nextWorkingDay(start, calendar)
  for (let remaining = n - 1; remaining > 0; remaining--) {
    current = nextWorkingDay(addDays(current, 1), calendar)
  }
  return current
}

/**
 * Mirror image of {@link addWorkingDays}: the start date of a `count`-working-day block that must
 * finish on (or, if `end` is not a working day, before) `end`.
 */
export function subtractWorkingDays(end: ISODate, count: number, calendar: WorkCalendar): ISODate {
  const n = normalizeStepDays(count)
  let current = previousWorkingDay(end, calendar)
  for (let remaining = n - 1; remaining > 0; remaining--) {
    current = previousWorkingDay(addDays(current, -1), calendar)
  }
  return current
}

/** Number of working days in `[start, end]` (inclusive). 0 when `end < start`. */
export function countWorkingDays(start: ISODate, end: ISODate, calendar: WorkCalendar): number {
  let count = 0
  for (const date of eachDay(start, end)) if (isWorkingDay(date, calendar)) count++
  return count
}

/** Non-working dates in `[start, end]` (inclusive) for a calendar. */
export function nonWorkingDaysBetween(start: ISODate, end: ISODate, calendar: WorkCalendar): ISODate[] {
  return eachDay(start, end).filter((date) => !isWorkingDay(date, calendar))
}

// ---------------------------------------------------------------------------------------------
// Multi-step schedule (順算 / 逆算)
// ---------------------------------------------------------------------------------------------

/**
 * `forward`  (順算): steps run one after another starting on the anchor date → delivery date.
 * `backward` (逆算): the last step must finish by the anchor date (requested delivery) → the
 *                    latest possible start of the first step (order deadline).
 */
export type ScheduleMode = 'forward' | 'backward'

export interface ScheduleStepInput {
  id: string
  name: string
  /** Duration in days of the step's own calendar (working days, or calendar days). */
  days: number
  /** Calendar identifier, resolved through `resolveCalendar` (e.g. `'calendar'`, `'JP'`, `'TH'`). */
  calendar: string
}

export interface ScheduledStep extends ScheduleStepInput {
  /** First day of the step (always a working day of the step's calendar). */
  start: ISODate
  /** Last day of the step, inclusive (always a working day of the step's calendar). */
  end: ISODate
  /** Elapsed calendar days, `end - start + 1`. */
  calendarDays: number
  /** Non-working dates inside `[start, end]` that were skipped by this step's calendar. */
  skippedDays: ISODate[]
}

export type ScheduleResult =
  | {
      ok: true
      mode: ScheduleMode
      anchor: ISODate
      steps: ScheduledStep[]
      /** Start of the first step (forward: actual work start; backward: latest possible start). */
      start: ISODate
      /** End of the last step (forward: delivery date; backward: completion on/before the anchor). */
      end: ISODate
      /** Calendar days from `start` to `end`, inclusive (0 when there are no steps). */
      totalCalendarDays: number
    }
  | {
      ok: false
      mode: ScheduleMode
      anchor: ISODate
      error: string
      /** Step whose calendar could not be satisfied, when known. */
      stepId?: string
    }

export interface ScheduleInput {
  mode: ScheduleMode
  anchor: ISODate
  steps: readonly ScheduleStepInput[]
  resolveCalendar: (calendarId: string) => WorkCalendar
}

function buildStep(step: ScheduleStepInput, start: ISODate, end: ISODate, calendar: WorkCalendar): ScheduledStep {
  return {
    ...step,
    days: normalizeStepDays(step.days),
    start,
    end,
    calendarDays: diffDays(start, end) + 1,
    skippedDays: nonWorkingDaysBetween(start, end, calendar),
  }
}

/**
 * Computes a finish-to-start chain of steps. Each step starts the day after the previous step
 * ends (snapped to the next working day of its own calendar) and occupies `days` working days.
 *
 * Forward:  cursor = anchor;  start = nextWorkingDay(cursor); end = addWorkingDays(start, days)
 * Backward: cursor = anchor;  end = previousWorkingDay(cursor); start = subtractWorkingDays(end, days)
 *
 * The two modes are mirror images. Forward is greedy (earliest possible dates), backward is lazy
 * (latest possible dates), therefore for any anchor T and start S:
 *   computeSchedule(forward, backward(T).start).end <= T
 *   computeSchedule(backward, forward(S).end).start >= forward(S).start
 * Equality holds when no step boundary falls on a day that only one of the adjacent calendars
 * treats as a working day.
 */
export function computeSchedule(input: ScheduleInput): ScheduleResult {
  const { mode, anchor, steps, resolveCalendar } = input
  if (!isISODate(anchor)) {
    return { ok: false, mode, anchor, error: `Invalid anchor date: "${String(anchor)}"` }
  }
  if (steps.length === 0) {
    return { ok: true, mode, anchor, steps: [], start: anchor, end: anchor, totalCalendarDays: 0 }
  }

  const scheduled: ScheduledStep[] = []
  let currentStep: ScheduleStepInput | undefined
  try {
    if (mode === 'forward') {
      let cursor = anchor
      for (const step of steps) {
        currentStep = step
        const calendar = resolveCalendar(step.calendar)
        const start = nextWorkingDay(cursor, calendar)
        const end = addWorkingDays(start, step.days, calendar)
        scheduled.push(buildStep(step, start, end, calendar))
        cursor = addDays(end, 1)
      }
    } else {
      let cursor = anchor
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i]
        currentStep = step
        const calendar = resolveCalendar(step.calendar)
        const end = previousWorkingDay(cursor, calendar)
        const start = subtractWorkingDays(end, step.days, calendar)
        scheduled.unshift(buildStep(step, start, end, calendar))
        cursor = addDays(start, -1)
      }
    }
  } catch (error) {
    if (error instanceof CalendarError || error instanceof RangeError) {
      return { ok: false, mode, anchor, error: error.message, stepId: currentStep?.id }
    }
    throw error
  }

  const start = scheduled[0].start
  const end = scheduled[scheduled.length - 1].end
  return {
    ok: true,
    mode,
    anchor,
    steps: scheduled,
    start,
    end,
    totalCalendarDays: diffDays(start, end) + 1,
  }
}
