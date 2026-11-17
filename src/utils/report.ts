/**
 * Turns a computed schedule into a structured, presentation-neutral report (used by the result
 * panel and the English e-mail / WhatsApp exporter).
 */
import { CALENDAR_DAYS, type OverrideMap } from '../types'
import type { ResolvedCountry } from './calendars'
import {
  addDays,
  dayOfWeek,
  diffDays,
  eachDay,
  getDayStatus,
  previousWorkingDay,
  type ISODate,
  type ScheduleMode,
  type ScheduleResult,
  type WorkCalendar,
} from './dateCalc'
import { getHolidaysOn } from './holidays'
import { getTimeZoneAbbreviation, zonedTimeToInstant } from './timezone'

export interface ReportCountry {
  code: string
  nameEn: string
  timeZone: string
  timeZoneAbbr: string
}

export interface ExcludedDay {
  date: ISODate
  kind: 'holiday' | 'custom-off'
  names: string[]
  localNames: string[]
}

export interface ReportStep {
  index: number
  name: string
  days: number
  /** `null` for calendar-day steps. */
  country: ReportCountry | null
  start: ISODate
  end: ISODate
  calendarDays: number
  /** Holidays / custom days off on otherwise-working weekdays inside the step. */
  excluded: ExcludedDay[]
  /** Weekend days inside the step. */
  weekendDays: number
}

export interface ReportHoliday {
  start: ISODate
  end: ISODate
  name: string
  localName?: string
  custom: boolean
  /** Bank holiday (e.g. Japan's 2–3 Jan): banks and most offices closed, not a statutory public holiday. */
  bank: boolean
  /** Every day of the range is a weekend day in that country (no extra impact). */
  onWeekend: boolean
}

export interface ReportHolidayGroup {
  country: ReportCountry
  holidays: ReportHoliday[]
}

export type HolidayScope = 'relevant' | 'all' | 'none'

export interface ScheduleReport {
  mode: ScheduleMode
  anchor: ISODate
  start: ISODate
  end: ISODate
  totalCalendarDays: number
  base: ReportCountry
  /** Backward: latest base-country working day on/before the required start. Forward: start. */
  orderDeadline: ISODate
  /** Backward: days between planned completion and the requested date. */
  bufferDays: number
  /** Forward: the anchor was not a working day, so work starts later. */
  startShifted: boolean
  steps: ReportStep[]
  holidayGroups: ReportHolidayGroup[]
}

export function toReportCountry(country: ResolvedCountry, onDate: ISODate): ReportCountry {
  const noon = zonedTimeToInstant(onDate, 12 * 60, country.timeZone)
  return {
    code: country.code,
    nameEn: country.info.nameEn,
    timeZone: country.timeZone,
    timeZoneAbbr: getTimeZoneAbbreviation(country.timeZone, noon),
  }
}

const CUSTOM_HOLIDAY_LABEL = 'Company holiday'

interface BuildReportInput {
  schedule: Extract<ScheduleResult, { ok: true }>
  countries: readonly ResolvedCountry[]
  calendars: ReadonlyMap<string, WorkCalendar>
  overrides: OverrideMap
  holidayScope: HolidayScope
  /** Extra country to always include in the holiday list (e.g. the recipient's country). */
  recipientCountry?: string
}

function holidayNames(country: ResolvedCountry, date: ISODate) {
  const entries = getHolidaysOn(country.code, country.region, date).filter((h) => h.blocking)
  return {
    names: entries.map((h) => h.name),
    localNames: entries.map((h) => h.localName ?? '').filter(Boolean),
    bank: entries.length > 0 && entries.every((h) => h.type === 'bank'),
  }
}

export function buildScheduleReport(input: BuildReportInput): ScheduleReport {
  const { schedule, countries, calendars, overrides, holidayScope, recipientCountry } = input
  const byCode = new Map(countries.map((c) => [c.code, c]))
  const base = countries.find((c) => c.isBase) ?? countries[0]
  const baseCalendar = calendars.get(base.code)
  const reportCountries = new Map(countries.map((c) => [c.code, toReportCountry(c, schedule.start)]))

  const steps: ReportStep[] = schedule.steps.map((step, i) => {
    const country = step.calendar === CALENDAR_DAYS ? undefined : byCode.get(step.calendar)
    const calendar = country ? calendars.get(country.code) : undefined
    const excluded: ExcludedDay[] = []
    let weekendDays = 0
    if (country && calendar) {
      for (const date of step.skippedDays) {
        const status = getDayStatus(date, calendar)
        const isWeekend = country.weekend.includes(dayOfWeek(date))
        if (isWeekend) weekendDays++
        else if (status === 'holiday') {
          const { names, localNames } = holidayNames(country, date)
          excluded.push({ date, kind: 'holiday', names, localNames })
        }
        else if (status === 'custom-off') {
          const label = overrides[country.code]?.[date]?.label || CUSTOM_HOLIDAY_LABEL
          excluded.push({ date, kind: 'custom-off', names: [label], localNames: [] })
        }
      }
    }
    return {
      index: i + 1,
      name: step.name,
      days: step.days,
      country: country ? (reportCountries.get(country.code) ?? null) : null,
      start: step.start,
      end: step.end,
      calendarDays: step.calendarDays,
      excluded,
      weekendDays,
    }
  })

  let scopeCodes: string[] = []
  if (holidayScope === 'all') scopeCodes = countries.map((c) => c.code)
  else if (holidayScope === 'relevant') {
    const used = new Set<string>([base.code])
    for (const step of schedule.steps) if (step.calendar !== CALENDAR_DAYS) used.add(step.calendar)
    if (recipientCountry) used.add(recipientCountry)
    scopeCodes = countries.map((c) => c.code).filter((code) => used.has(code))
  }

  const holidayGroups: ReportHolidayGroup[] = []
  if (schedule.steps.length > 0) {
    for (const code of scopeCodes) {
      const country = byCode.get(code)
      const calendar = calendars.get(code)
      const reportCountry = reportCountries.get(code)
      if (!country || !calendar || !reportCountry) continue
      const holidays: ReportHoliday[] = []
      for (const date of eachDay(schedule.start, schedule.end)) {
        const status = getDayStatus(date, calendar)
        let item: Omit<ReportHoliday, 'start' | 'end' | 'onWeekend'> | null = null
        if (status === 'holiday') {
          const { names, localNames, bank } = holidayNames(country, date)
          item = { name: names.join(' / '), localName: localNames.join(' / ') || undefined, custom: false, bank }
        } else if (status === 'custom-off') {
          item = { name: overrides[code]?.[date]?.label || CUSTOM_HOLIDAY_LABEL, custom: true, bank: false }
        }
        if (!item) continue
        const onWeekend = country.weekend.includes(dayOfWeek(date))
        const last = holidays[holidays.length - 1]
        if (last && last.name === item.name && last.custom === item.custom && addDays(last.end, 1) === date) {
          last.end = date
          last.onWeekend = last.onWeekend && onWeekend
        } else {
          holidays.push({ ...item, start: date, end: date, onWeekend })
        }
      }
      holidayGroups.push({ country: reportCountry, holidays })
    }
  }

  let orderDeadline = schedule.start
  if (schedule.mode === 'backward' && baseCalendar && schedule.steps.length > 0) {
    try {
      orderDeadline = previousWorkingDay(schedule.start, baseCalendar)
    } catch {
      orderDeadline = schedule.start
    }
  }

  return {
    mode: schedule.mode,
    anchor: schedule.anchor,
    start: schedule.start,
    end: schedule.end,
    totalCalendarDays: schedule.totalCalendarDays,
    base: reportCountries.get(base.code) ?? toReportCountry(base, schedule.start),
    orderDeadline,
    bufferDays:
      schedule.mode === 'backward' && schedule.steps.length > 0 ? Math.max(0, diffDays(schedule.end, schedule.anchor)) : 0,
    startShifted: schedule.mode === 'forward' && schedule.steps.length > 0 && schedule.start !== schedule.anchor,
    steps,
    holidayGroups,
  }
}
