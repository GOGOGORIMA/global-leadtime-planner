/**
 * Thin, cached wrapper around `date-holidays`.
 *
 * - Only the `date` string returned by date-holidays (local calendar date of the country, e.g.
 *   `"2026-11-23 00:00:00"`) is used to place a holiday, never the `start`/`end` Date instants,
 *   so placement is independent of the viewer's time zone.
 * - Multi-day holidays (e.g. Korean Seollal "P3D", Vietnamese Tết "P5D", Eid) are expanded into
 *   one entry per day.
 * - Holidays that start mid-day (e.g. German Christmas Eve from 14:00, Chinese Women's Day
 *   afternoon) are kept for information but do not block a working day.
 * - English and local-language names are matched by `date + rule` (index matching is unsafe
 *   because each language list may contain different observances).
 */
import Holidays from 'date-holidays'
import type { HolidaysTypes } from 'date-holidays'
import { addDays, eachDay, isISODate, yearOf, type ISODate } from './dateCalc'

export type HolidayType = HolidaysTypes.HolidayType

export interface HolidayEntry {
  date: ISODate
  /** English name. */
  name: string
  /** Name in the country's primary local language (omitted when unavailable or identical). */
  localName?: string
  type: HolidayType
  substitute: boolean
  /** Closes businesses for the whole day (`public` / `bank` holiday starting at 00:00). */
  blocking: boolean
  /** Starts during the day (e.g. 14:00) — informational only. */
  partial: boolean
  /** date-holidays rule — stable identifier used for de-duplication. */
  rule: string
}

/** Holiday types that make a full day non-working. */
export const BLOCKING_HOLIDAY_TYPES: ReadonlySet<HolidayType> = new Set<HolidayType>(['public', 'bank'])

const DAY_MS = 86_400_000

let supportedCountries: ReadonlySet<string> | null = null

/** ISO 3166-1 alpha-2 codes for which date-holidays has rules. */
export function getSupportedHolidayCountries(): ReadonlySet<string> {
  if (!supportedCountries) supportedCountries = new Set(Object.keys(new Holidays().getCountries('en')))
  return supportedCountries
}

export function hasHolidayData(code: string): boolean {
  return getSupportedHolidayCountries().has(code)
}

const regionCache = new Map<string, Array<{ code: string; name: string }>>()

/** States / provinces with their own holiday rules (e.g. `MY` → `10` Selangor, `DE` → `BY`). */
export function getHolidayRegions(code: string): Array<{ code: string; name: string }> {
  let regions = regionCache.get(code)
  if (!regions) {
    const states = hasHolidayData(code) ? new Holidays().getStates(code, 'en') : undefined
    regions = Object.entries(states ?? {})
      .map(([regionCode, name]) => ({ code: regionCode, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    regionCache.set(code, regions)
  }
  return regions
}

function isValidRegion(code: string, region: string | undefined): region is string {
  return !!region && getHolidayRegions(code).some((r) => r.code === region)
}

const instanceCache = new Map<string, Holidays | null>()

function getInstance(code: string, region?: string): Holidays | null {
  const validRegion = isValidRegion(code, region) ? region : undefined
  const key = validRegion ? `${code}-${validRegion}` : code
  const cached = instanceCache.get(key)
  if (cached !== undefined) return cached
  let instance: Holidays | null = null
  if (hasHolidayData(code)) {
    try {
      instance = validRegion ? new Holidays(code, validRegion) : new Holidays(code)
    } catch {
      instance = null
    }
  }
  instanceCache.set(key, instance)
  return instance
}

/** IANA time zones listed by date-holidays for a country (or a state of it). */
export function getHolidayTimeZones(code: string, region?: string): string[] {
  return getInstance(code, region)?.getTimezones() ?? []
}

/** Primary non-English language of the holiday data (e.g. `jp`, `ko`, `th`), if any. */
export function getLocalHolidayLanguage(code: string): string | undefined {
  const languages = getInstance(code)?.getLanguages() ?? []
  return languages.find((lang) => !/^en(-|$)/i.test(lang))
}

type YearMap = ReadonlyMap<ISODate, HolidayEntry[]>
const yearCache = new Map<string, YearMap>()

function buildYearMap(code: string, region: string | undefined, year: number): YearMap {
  const instance = getInstance(code, region)
  const map = new Map<ISODate, HolidayEntry[]>()
  if (!instance) return map

  const english = instance.getHolidays(year, 'en')
  const localLanguage = getLocalHolidayLanguage(code)
  const localNames = new Map<string, string>()
  if (localLanguage) {
    for (const h of instance.getHolidays(year, localLanguage)) localNames.set(`${h.date}|${h.rule}`, h.name)
  }

  for (const h of english) {
    const start = h.date.slice(0, 10)
    if (!isISODate(start)) continue
    const partial = h.date.slice(11, 19) !== '00:00:00'
    const span = partial ? 1 : Math.max(1, Math.round((h.end.getTime() - h.start.getTime()) / DAY_MS))
    const localName = localNames.get(`${h.date}|${h.rule}`)
    for (let i = 0; i < span; i++) {
      const date = addDays(start, i)
      const entry: HolidayEntry = {
        date,
        name: h.name,
        localName: localName && localName !== h.name ? localName : undefined,
        type: h.type,
        substitute: Boolean(h.substitute),
        blocking: !partial && BLOCKING_HOLIDAY_TYPES.has(h.type),
        partial,
        rule: h.rule,
      }
      const list = map.get(date)
      if (list) {
        if (!list.some((e) => e.rule === entry.rule && e.name === entry.name)) list.push(entry)
      } else {
        map.set(date, [entry])
      }
    }
  }
  return map
}

function getYearMap(code: string, region: string | undefined, year: number): YearMap {
  const key = `${code}|${isValidRegion(code, region) ? region : ''}|${year}`
  let map = yearCache.get(key)
  if (!map) {
    map = buildYearMap(code, region, year)
    yearCache.set(key, map)
  }
  return map
}

/** All holiday entries (blocking or informational) on a date for a country / region. */
export function getHolidaysOn(code: string, region: string | undefined, date: ISODate): HolidayEntry[] {
  const year = yearOf(date)
  const own = getYearMap(code, region, year).get(date) ?? []
  // Multi-day holidays that start in late December spill into the first days of January.
  if (date.slice(5) > '01-14') return own
  const spill = getYearMap(code, region, year - 1).get(date)
  if (!spill?.length) return own
  return [...own, ...spill.filter((s) => !own.some((o) => o.rule === s.rule && o.name === s.name))]
}

/** `true` if the date is a full-day public/bank holiday in the country / region. */
export function isBlockingHoliday(code: string, region: string | undefined, date: ISODate): boolean {
  return getHolidaysOn(code, region, date).some((h) => h.blocking)
}

/** Holiday entries in `[start, end]`, chronologically. */
export function getHolidaysInRange(
  code: string,
  region: string | undefined,
  start: ISODate,
  end: ISODate,
  { blockingOnly = false }: { blockingOnly?: boolean } = {},
): HolidayEntry[] {
  return eachDay(start, end).flatMap((date) =>
    getHolidaysOn(code, region, date).filter((h) => !blockingOnly || h.blocking),
  )
}
