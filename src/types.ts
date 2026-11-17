import type { ContainerId } from './data/containers'
import type { ISODate, OverrideKind, ScheduleMode } from './utils/dateCalc'

/** Calendar id for steps counted in calendar days (every day is a working day). */
export const CALENDAR_DAYS = 'calendar'

/** Right-pane tabs (also the `?tab=` URL parameter). */
export const PLANNER_TABS = ['meeting', 'schedule', 'calendar', 'export', 'vanning'] as const
export type PlannerTab = (typeof PLANNER_TABS)[number]

export function isPlannerTab(value: unknown): value is PlannerTab {
  return typeof value === 'string' && (PLANNER_TABS as readonly string[]).includes(value)
}

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

/** One cargo type (case / SKU) of the loading simulator. Sizes in mm, weight in kg per piece. */
export interface CargoItem {
  id: string
  /** Case / SKU name — also used in the English packing summary, so English is recommended. */
  name: string
  /** Footprint: `length` × `width`. Pieces are never tipped over, so `height` stays vertical. */
  length: number
  width: number
  height: number
  /** Gross weight of one piece (kg). */
  weight: number
  quantity: number
  /** `false` = 上積み厳禁: nothing may be placed on top of this piece. */
  stackable: boolean
  /** Allow a 90° turn on the floor (length ⇄ width). */
  rotatable: boolean
  /** Display color `#rrggbb`. */
  color: string
}

export interface PlannerState {
  base: string
  partners: string[]
  settings: Record<string, CountrySettings>
  mode: ScheduleMode
  /** forward: start date (開始日) / backward: requested delivery date (希望納品日). */
  anchor: ISODate
  steps: Step[]
  overrides: OverrideMap
  /** Open tab of the right pane. */
  tab: PlannerTab
  /** Loading simulator: selected container / truck. */
  container: ContainerId
  /** Loading simulator: cargo list. */
  cargo: CargoItem[]
}
