import { afterAll, describe, expect, it } from 'vitest'
import {
  ALL_DAYS_CALENDAR,
  addDays,
  addWorkingDays,
  computeSchedule,
  countWorkingDays,
  createWorkCalendar,
  dayOfWeek,
  diffDays,
  eachDay,
  endOfMonth,
  formatISODate,
  fromDayNumber,
  getDayStatus,
  isISODate,
  isWorkingDay,
  nextWorkingDay,
  nonWorkingDaysBetween,
  normalizeStepDays,
  previousWorkingDay,
  startOfWeek,
  subtractWorkingDays,
  toDayNumber,
  type ScheduleStepInput,
  type WorkCalendar,
} from './dateCalc'
import { formatEnglishDate, formatEnglishRange, formatJaDate, formatWeekendEn } from './dateFormat'

/** Japan-like calendar: Sat/Sun weekend, Labour Thanksgiving Day (Mon 23 Nov 2026) as holiday. */
const JP = createWorkCalendar({ weekend: [0, 6], holidays: ['2026-11-23'] })
/** Thailand-like calendar: Sat/Sun weekend, Constitution Day (Thu 10 Dec 2026). */
const TH = createWorkCalendar({ weekend: [0, 6], holidays: ['2026-12-10'] })
/** Saudi-like calendar: Fri/Sat weekend. */
const SA = createWorkCalendar({ weekend: [5, 6] })

const calendars: Record<string, WorkCalendar> = { JP, TH, SA, calendar: ALL_DAYS_CALENDAR }
const resolveCalendar = (id: string) => calendars[id]

const STEPS: ScheduleStepInput[] = [
  { id: 'a', name: 'Production', days: 5, calendar: 'JP' },
  { id: 'b', name: 'Ocean freight', days: 14, calendar: 'calendar' },
  { id: 'c', name: 'Local delivery', days: 3, calendar: 'TH' },
]

describe('calendar-date primitives', () => {
  it('validates ISO dates strictly', () => {
    expect(isISODate('2026-11-17')).toBe(true)
    expect(isISODate('2028-02-29')).toBe(true)
    expect(isISODate('2026-02-29')).toBe(false)
    expect(isISODate('2100-02-29')).toBe(false)
    expect(isISODate('2000-02-29')).toBe(true)
    expect(isISODate('2026-13-01')).toBe(false)
    expect(isISODate('2026-00-10')).toBe(false)
    expect(isISODate('2026-1-01')).toBe(false)
    expect(isISODate(' 2026-01-01')).toBe(false)
    expect(isISODate('2026-01-01T00:00:00Z')).toBe(false)
    expect(isISODate(20260101)).toBe(false)
    expect(isISODate(undefined)).toBe(false)
  })

  it('converts known dates to day numbers', () => {
    expect(toDayNumber('1970-01-01')).toBe(0)
    expect(toDayNumber('1969-12-31')).toBe(-1)
    expect(toDayNumber('2000-03-01')).toBe(11017)
    expect(toDayNumber('2026-11-17')).toBe(20774)
  })

  it('round-trips every day 1900–2100 and agrees with a Date.UTC oracle', () => {
    const start = toDayNumber('1900-01-01')
    const end = toDayNumber('2100-12-31')
    for (let n = start; n <= end; n++) {
      const iso = fromDayNumber(n)
      expect(toDayNumber(iso)).toBe(n)
      // Date.UTC is time-zone independent, so it is a safe oracle for the test only.
      expect(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000).toBe(n)
    }
  })

  it('adds days across month, year and leap-year boundaries', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01')
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-11-17', 365)).toBe('2027-11-17')
    expect(diffDays('2026-11-17', '2026-12-14')).toBe(27)
    expect(diffDays('2026-12-14', '2026-11-17')).toBe(-27)
  })

  it('computes the day of week', () => {
    expect(dayOfWeek('1970-01-01')).toBe(4) // Thursday
    expect(dayOfWeek('2000-01-01')).toBe(6) // Saturday
    expect(dayOfWeek('1969-12-28')).toBe(0) // Sunday
    expect(dayOfWeek('2026-11-17')).toBe(2) // Tuesday
    expect(dayOfWeek('2027-01-01')).toBe(5) // Friday
  })

  it('handles week/month helpers and ranges', () => {
    expect(startOfWeek('2026-11-17')).toBe('2026-11-16')
    expect(startOfWeek('2026-11-17', 0)).toBe('2026-11-15')
    expect(startOfWeek('2026-11-16')).toBe('2026-11-16')
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(eachDay('2026-12-30', '2026-12-29')).toEqual([])
    expect(() => formatISODate(2026, 2, 30)).toThrow(RangeError)
  })

  it('normalizes step durations', () => {
    expect(normalizeStepDays(0)).toBe(1)
    expect(normalizeStepDays(-5)).toBe(1)
    expect(normalizeStepDays(2.6)).toBe(3)
    expect(normalizeStepDays(5000)).toBe(999)
    expect(normalizeStepDays(Number.NaN)).toBe(1)
  })
})

describe('working-day calendars', () => {
  it('classifies days with override > holiday > weekend precedence', () => {
    const cal = createWorkCalendar({
      weekend: [0, 6],
      holidays: ['2026-11-23', '2026-11-28'],
      overrides: { '2026-11-18': 'off', '2026-11-21': 'work', '2026-11-28': 'work' },
    })
    expect(getDayStatus('2026-11-17', cal)).toBe('working')
    expect(getDayStatus('2026-11-18', cal)).toBe('custom-off')
    expect(getDayStatus('2026-11-21', cal)).toBe('custom-work')
    expect(getDayStatus('2026-11-22', cal)).toBe('weekend')
    expect(getDayStatus('2026-11-23', cal)).toBe('holiday')
    expect(getDayStatus('2026-11-28', cal)).toBe('custom-work') // holiday on Saturday, overridden
    expect(getDayStatus('2026-11-29', ALL_DAYS_CALENDAR)).toBe('working')
    expect(isWorkingDay('2026-11-21', cal)).toBe(true)
    expect(isWorkingDay('2026-11-18', cal)).toBe(false)
  })

  it('finds next / previous working days', () => {
    expect(nextWorkingDay('2026-11-21', JP)).toBe('2026-11-24') // Sat → (Sun, Mon holiday) → Tue
    expect(nextWorkingDay('2026-11-24', JP)).toBe('2026-11-24')
    expect(previousWorkingDay('2026-11-23', JP)).toBe('2026-11-20') // holiday Mon → Fri
    expect(nextWorkingDay('2026-11-20', SA)).toBe('2026-11-22') // Fri → Sun (Fri/Sat weekend)
    expect(previousWorkingDay('2026-11-21', SA)).toBe('2026-11-19') // Sat → Thu
  })

  it('adds and subtracts working days symmetrically', () => {
    expect(addWorkingDays('2026-11-17', 1, JP)).toBe('2026-11-17')
    expect(addWorkingDays('2026-11-17', 5, JP)).toBe('2026-11-24')
    expect(subtractWorkingDays('2026-11-24', 5, JP)).toBe('2026-11-17')
    expect(addWorkingDays('2026-11-21', 1, JP)).toBe('2026-11-24') // non-working start is skipped
    expect(subtractWorkingDays('2026-11-22', 1, JP)).toBe('2026-11-20')
    expect(addWorkingDays('2026-11-17', 10, ALL_DAYS_CALENDAR)).toBe('2026-11-26')
  })

  it('honours manual working-day overrides', () => {
    const cal = createWorkCalendar({ weekend: [0, 6], overrides: { '2026-11-21': 'work' } })
    expect(addWorkingDays('2026-11-19', 3, cal)).toBe('2026-11-21')
    const shutdown = createWorkCalendar({ weekend: [0, 6], overrides: { '2026-11-18': 'off', '2026-11-19': 'off' } })
    expect(addWorkingDays('2026-11-17', 2, shutdown)).toBe('2026-11-20')
  })

  it('counts working days and lists skipped days', () => {
    expect(countWorkingDays('2026-11-16', '2026-11-29', JP)).toBe(9)
    expect(countWorkingDays('2026-11-29', '2026-11-16', JP)).toBe(0)
    expect(nonWorkingDaysBetween('2026-11-20', '2026-11-24', JP)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23'])
  })
})

describe('computeSchedule', () => {
  it('computes a forward (順算) multi-step schedule', () => {
    const result = computeSchedule({ mode: 'forward', anchor: '2026-11-17', steps: STEPS, resolveCalendar })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.steps.map((s) => [s.start, s.end])).toEqual([
      ['2026-11-17', '2026-11-24'],
      ['2026-11-25', '2026-12-08'],
      ['2026-12-09', '2026-12-14'],
    ])
    expect(result.steps[0].skippedDays).toEqual(['2026-11-21', '2026-11-22', '2026-11-23'])
    expect(result.steps[1].skippedDays).toEqual([])
    expect(result.steps[2].skippedDays).toEqual(['2026-12-10', '2026-12-12', '2026-12-13'])
    expect(result.steps.map((s) => s.calendarDays)).toEqual([8, 14, 6])
    expect(result.start).toBe('2026-11-17')
    expect(result.end).toBe('2026-12-14')
    expect(result.totalCalendarDays).toBe(28)
  })

  it('computes a backward (逆算) schedule that mirrors the forward one', () => {
    const result = computeSchedule({ mode: 'backward', anchor: '2026-12-14', steps: STEPS, resolveCalendar })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.steps.map((s) => [s.start, s.end])).toEqual([
      ['2026-11-17', '2026-11-24'],
      ['2026-11-25', '2026-12-08'],
      ['2026-12-09', '2026-12-14'],
    ])
  })

  it('backs off from a non-working requested delivery date', () => {
    const result = computeSchedule({ mode: 'backward', anchor: '2026-12-13', steps: STEPS, resolveCalendar })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.end).toBe('2026-12-11') // Sunday target → Friday completion
    expect(result.steps.map((s) => [s.start, s.end])).toEqual([
      ['2026-11-16', '2026-11-20'],
      ['2026-11-24', '2026-12-07'],
      ['2026-12-08', '2026-12-11'],
    ])
  })

  it('snaps a non-working forward start date to the next working day', () => {
    const result = computeSchedule({ mode: 'forward', anchor: '2026-11-21', steps: STEPS.slice(0, 1), resolveCalendar })
    expect(result.ok && result.start).toBe('2026-11-24')
  })

  it('returns an empty schedule when there are no steps', () => {
    const result = computeSchedule({ mode: 'forward', anchor: '2026-11-17', steps: [], resolveCalendar })
    expect(result).toMatchObject({ ok: true, start: '2026-11-17', end: '2026-11-17', totalCalendarDays: 0 })
  })

  it('reports calendars without any working day instead of looping', () => {
    const never = createWorkCalendar({ weekend: [0, 1, 2, 3, 4, 5, 6] })
    const result = computeSchedule({
      mode: 'forward',
      anchor: '2026-11-17',
      steps: [{ id: 'x', name: 'Impossible', days: 2, calendar: 'never' }],
      resolveCalendar: () => never,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stepId).toBe('x')
    expect(result.error).toMatch(/No working day/)
  })

  it('rejects invalid anchors', () => {
    const result = computeSchedule({ mode: 'forward', anchor: '2026-02-30', steps: STEPS, resolveCalendar })
    expect(result.ok).toBe(false)
  })

  it('satisfies the forward/backward invariants for many anchors and step mixes', () => {
    const calendarIds = Object.keys(calendars)
    let seed = 42
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % n
    }
    for (let i = 0; i < 400; i++) {
      const anchor = addDays('2026-01-01', rand(730))
      const steps: ScheduleStepInput[] = Array.from({ length: 1 + rand(4) }, (_, j) => ({
        id: `s${j}`,
        name: `Step ${j}`,
        days: 1 + rand(25),
        calendar: calendarIds[rand(calendarIds.length)],
      }))

      const fwd = computeSchedule({ mode: 'forward', anchor, steps, resolveCalendar })
      const bwd = computeSchedule({ mode: 'backward', anchor, steps, resolveCalendar })
      if (!fwd.ok || !bwd.ok) throw new Error('unexpected schedule failure')

      for (const result of [fwd, bwd]) {
        result.steps.forEach((step, k) => {
          const cal = resolveCalendar(step.calendar)
          expect(isWorkingDay(step.start, cal)).toBe(true)
          expect(isWorkingDay(step.end, cal)).toBe(true)
          expect(countWorkingDays(step.start, step.end, cal)).toBe(step.days)
          if (k > 0) expect(step.start > result.steps[k - 1].end).toBe(true)
        })
      }
      // Forward never starts before the anchor; backward never ends after it.
      expect(fwd.start >= anchor).toBe(true)
      expect(bwd.end <= anchor).toBe(true)
      // Greedy/lazy mirror properties.
      const fwdFromLatest = computeSchedule({ mode: 'forward', anchor: bwd.start, steps, resolveCalendar })
      expect(fwdFromLatest.ok && fwdFromLatest.end <= anchor).toBe(true)
      const bwdFromDelivery = computeSchedule({ mode: 'backward', anchor: fwd.end, steps, resolveCalendar })
      expect(bwdFromDelivery.ok && bwdFromDelivery.start >= fwd.start).toBe(true)
    }
  })
})

describe('time-zone independence', () => {
  const originalTZ = process.env.TZ
  afterAll(() => {
    if (originalTZ === undefined) delete process.env.TZ
    else process.env.TZ = originalTZ
  })

  it('produces identical results whatever the runtime time zone is', () => {
    process.env.TZ = 'UTC'
    const baseline = computeSchedule({ mode: 'backward', anchor: '2027-01-15', steps: STEPS, resolveCalendar })
    for (const tz of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Tokyo', 'Asia/Kolkata']) {
      process.env.TZ = tz
      // Sanity check that the TZ switch is effective: the naive Date approach drifts…
      const naive = new Date('2026-11-23').getDate()
      if (tz === 'America/Los_Angeles') expect(naive).toBe(22)
      // …while the string-based engine does not.
      expect(computeSchedule({ mode: 'backward', anchor: '2027-01-15', steps: STEPS, resolveCalendar })).toEqual(baseline)
      expect(dayOfWeek('2026-11-23')).toBe(1)
      expect(addDays('2026-11-23', 1)).toBe('2026-11-24')
    }
  })
})

describe('dateFormat', () => {
  it('formats English dates in all styles', () => {
    expect(formatEnglishDate('2026-11-17')).toBe('Tue, 17 Nov 2026')
    expect(formatEnglishDate('2026-11-17', 'mdy')).toBe('Tue, Nov 17, 2026')
    expect(formatEnglishDate('2026-11-17', 'iso')).toBe('2026-11-17 (Tue)')
    expect(formatEnglishDate('2026-11-17', 'dmy', { year: false })).toBe('Tue, 17 Nov')
    expect(formatEnglishDate('2026-11-17', 'dmy', { weekday: false })).toBe('17 Nov 2026')
    expect(formatEnglishRange('2026-11-17', '2026-12-08')).toBe('Tue, 17 Nov 2026 – Tue, 8 Dec 2026')
    expect(formatEnglishRange('2026-11-17', '2026-11-17')).toBe('Tue, 17 Nov 2026')
  })

  it('formats Japanese dates and weekend lists', () => {
    expect(formatJaDate('2026-11-17')).toBe('2026/11/17(火)')
    expect(formatJaDate('2026-11-07', { year: false })).toBe('11/07(土)')
    expect(formatWeekendEn([6, 5])).toBe('Fri & Sat')
    expect(formatWeekendEn([0])).toBe('Sun')
  })
})
