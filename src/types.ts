import type { ISODate, OverrideKind, ScheduleMode } from './utils/dateCalc'

/** Calendar id for steps counted in calendar days (every day is a working day). */
export const CALENDAR_DAYS = 'calendar'

export interface Step {
  id: string
  /** Step name — used verbatim in the English e-mail, so English is recommended. */
  name: string
  /** Duration in days of the step's calendar (working days, or calendar days). */
  days: number
  /** `CALENDAR_DAYS` or a selected country code (that country's business days). */
  calendar: string
}

/** Per-country user settings. Every field is optional; missing fields use catalog defaults. */
export interface CountrySettings {
  timeZone?: string
  /** Weekly days off, 0 = Sunday … 6 = Saturday. */
  weekend?: number[]
  /** Business hours in minutes since local midnight. */
  workStart?: number
  workEnd?: number
  /** date-holidays state / province code (adds regional holidays). */
  region?: string
}

export interface DayOverride {
  kind: OverrideKind
  label?: string
}

/** country code → date → manual override. */
export type OverrideMap = Record<string, Record<ISODate, DayOverride>>

export interface PlannerState {
  base: string
  partners: string[]
  settings: Record<string, CountrySettings>
  mode: ScheduleMode
  /** forward: start date (開始日) / backward: requested delivery date (希望納品日). */
  anchor: ISODate
  steps: Step[]
  overrides: OverrideMap
}
