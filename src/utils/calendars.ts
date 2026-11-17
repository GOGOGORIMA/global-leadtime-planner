/**
 * Bridges app state and the pure date engine: resolves effective per-country settings and builds
 * `WorkCalendar`s (weekend + date-holidays + manual overrides).
 */
import {
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  getCountryInfo,
  getDefaultWeekend,
  getRegionName,
  getRegionOptions,
  getTimeZoneOptions,
  type CountryInfo,
} from '../data/countries'
import { CALENDAR_DAYS, type CountrySettings, type DayOverride, type OverrideMap, type PlannerState } from '../types'
import {
  ALL_DAYS_CALENDAR,
  addDays,
  dayOfWeek,
  getBaseDayStatus,
  getDayStatus,
  type DayStatus,
  type ISODate,
  type OverrideKind,
  type WorkCalendar,
} from './dateCalc'
import { getHolidaysOn, isBlockingHoliday, type HolidayEntry } from './holidays'
import { isValidTimeZone, type Participant } from './timezone'

export interface ResolvedCountry {
  code: string
  info: CountryInfo
  timeZone: string
  weekend: readonly number[]
  workStart: number
  workEnd: number
  region?: string
  regionName?: string
  isBase: boolean
}

export function resolveCountry(code: string, settings: CountrySettings | undefined, isBase = false): ResolvedCountry {
  const region =
    settings?.region && getRegionOptions(code).some((r) => r.code === settings.region) ? settings.region : undefined
  const timeZone =
    settings?.timeZone && isValidTimeZone(settings.timeZone) ? settings.timeZone : getTimeZoneOptions(code, region)[0]
  let workStart = settings?.workStart ?? DEFAULT_WORK_START
  let workEnd = settings?.workEnd ?? DEFAULT_WORK_END
  if (!(workStart >= 0 && workEnd <= 1440 && workEnd > workStart)) {
    workStart = DEFAULT_WORK_START
    workEnd = DEFAULT_WORK_END
  }
  return {
    code,
    info: getCountryInfo(code),
    timeZone,
    weekend: settings?.weekend ?? getDefaultWeekend(code, region),
    workStart,
    workEnd,
    region,
    regionName: getRegionName(code, region),
    isBase,
  }
}

/** Base country first, then partners — each with effective settings. */
export function resolveSelectedCountries(state: Pick<PlannerState, 'base' | 'partners' | 'settings'>): ResolvedCountry[] {
  return [state.base, ...state.partners].map((code) => resolveCountry(code, state.settings[code], code === state.base))
}

export function buildCountryCalendar(
  country: ResolvedCountry,
  overrides: Readonly<Record<ISODate, DayOverride>> | undefined,
): WorkCalendar {
  const kinds: Record<ISODate, OverrideKind> = {}
  for (const [date, override] of Object.entries(overrides ?? {})) kinds[date] = override.kind
  return {
    weekend: country.weekend,
    isHoliday: (date) => isBlockingHoliday(country.code, country.region, date),
    overrides: kinds,
  }
}

export function buildCalendarMap(countries: readonly ResolvedCountry[], overrides: OverrideMap): Map<string, WorkCalendar> {
  return new Map(countries.map((c) => [c.code, buildCountryCalendar(c, overrides[c.code])]))
}

/** Resolves a step calendar id; unknown ids fall back to the base country's calendar. */
export function makeCalendarResolver(calendars: ReadonlyMap<string, WorkCalendar>, baseCode: string) {
  return (calendarId: string): WorkCalendar => {
    if (calendarId === CALENDAR_DAYS) return ALL_DAYS_CALENDAR
    return calendars.get(calendarId) ?? calendars.get(baseCode) ?? ALL_DAYS_CALENDAR
  }
}

export interface DayInfo {
  date: ISODate
  status: DayStatus
  /** Status without the manual override (what a click would toggle back to). */
  baseStatus: DayStatus
  /** All holiday entries of the date — blocking and informational (observances, half-days). */
  holidays: HolidayEntry[]
  override?: DayOverride
  isWeekend: boolean
}

export function getDayInfo(
  country: ResolvedCountry,
  calendar: WorkCalendar,
  overrides: Readonly<Record<ISODate, DayOverride>> | undefined,
  date: ISODate,
): DayInfo {
  return {
    date,
    status: getDayStatus(date, calendar),
    baseStatus: getBaseDayStatus(date, calendar),
    holidays: country.info.hasHolidayData ? getHolidaysOn(country.code, country.region, date) : [],
    override: overrides?.[date],
    isWeekend: country.weekend.includes(dayOfWeek(date)),
  }
}

export function toParticipant(country: ResolvedCountry, calendar: WorkCalendar): Participant {
  return {
    timeZone: country.timeZone,
    workStart: country.workStart,
    workEnd: country.workEnd,
    isWorkingDate: (date) => {
      const status = getDayStatus(date, calendar)
      return status === 'working' || status === 'custom-work'
    },
  }
}

export interface OverrideRange {
  country: string
  kind: OverrideKind
  start: ISODate
  end: ISODate
  label: string
  dates: ISODate[]
}

/** Groups consecutive dates with the same kind and label into ranges (for lists and URLs). */
export function groupOverrideRanges(country: string, overrides: Readonly<Record<ISODate, DayOverride>>): OverrideRange[] {
  const ranges: OverrideRange[] = []
  for (const date of Object.keys(overrides).sort()) {
    const { kind, label = '' } = overrides[date]
    const last = ranges[ranges.length - 1]
    if (last && last.kind === kind && last.label === label && addDays(last.end, 1) === date) {
      last.end = date
      last.dates.push(date)
    } else {
      ranges.push({ country, kind, start: date, end: date, label, dates: [date] })
    }
  }
  return ranges
}
