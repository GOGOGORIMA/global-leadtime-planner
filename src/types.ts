import type { ContainerCategory, ContainerId } from './data/containers'
import type { QuoteCurrency } from './data/currencies'
import type { ISODate, OverrideKind, ScheduleMode } from './utils/dateCalc'
import type { FreightMarket, QuoteMode } from './utils/freightRates'
import type { PackingAllowance, SizeRow, SizeUnit } from './utils/incotermsCalc'

/** Calendar id for steps counted in calendar days (every day is a working day). */
export const CALENDAR_DAYS = 'calendar'

/** Right-pane tabs (also the `?tab=` URL parameter). */
export const PLANNER_TABS = ['meeting', 'schedule', 'calendar', 'export', 'vanning', 'quote'] as const
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
  /** Extra cushioning needed around this cargo only (mm, on all four sides; 0 = none). */
  margin: number
}

/** Cushioning / clearance of the loading simulator (one set per transport mode). */
export interface CushionSettings {
  /** 貨物間の緩衝材厚み: cushioning between neighbouring pieces (mm, 0–500). */
  gap: number
  /** 壁面・周囲クリアランス: clearance to the walls / front wall / door (mm, 0–500). */
  wall: number
  /** 上下段の間にも緩衝材を適用する. */
  stack: boolean
  /** Cushioning between stacked tiers (mm, 0–50), used when `stack` is on. */
  stackGap: number
}

/** An amount entered in JPY or USD (freight / destination charge overrides). */
export interface MoneyAmount {
  amount: number
  currency: 'JPY' | 'USD'
}

/** A container / truck type and how many of them. */
export interface UnitCount {
  id: ContainerId
  units: number
}

/** Where the quotation's volume and weight come from. */
export type QuoteCargoMode = 'simple' | 'direct' | 'vanning'

/**
 * Export quotation board (tab ⑥). Percentages are stored as percent values (3 = 3 %).
 * `null` means "automatic" (estimated from the volume / weight or taken from the rate tables).
 */
export interface QuoteSettings {
  /** 概算M3 input: quick size calculator (default), direct entry, or the loading simulator (tab ⑤). */
  cargoMode: QuoteCargoMode
  /** Size calculator: unit of the rows, 1–3 rows, packing allowance on the sizes. */
  sizeUnit: SizeUnit
  items: SizeRow[]
  allowance: PackingAllowance
  /** Direct entry: estimated gross volume (m³) and weight (kg). */
  volume: number
  weight: number
  /** Add export packing (crates / pallets) to EXW at `packingRate` JPY per m³. */
  packingCost: boolean
  packingRate: number
  /** EXW base price (JPY): the sales price ex works (before export packing when `packingCost` is on). */
  exw: number
  currency: QuoteCurrency
  /** Market rate: JPY per 1 unit of the quote currency (ignored for JPY). */
  fxRate: number
  /** FX safety buffer (%, 0–10): applied rate = market rate × (1 − buffer). */
  fxBuffer: number
  /** JPY per USD for USD freight / charges when the quote currency is not USD. */
  usdRate: number
  /** Domestic truck freight factory → port (JPY). */
  domestic: number | null
  /** Export clearance & port charges: THC / B/L / vanning (JPY). */
  exportCharges: number | null
  /** `auto` = LCL / FCL recommended from the estimated volume. */
  mode: QuoteMode
  /** Destination country ('' = the schedule's partner country). */
  destination: string
  market: FreightMarket
  /** Freight override, e.g. a forwarder's actual quote (`null` = table rate × market). */
  freight: MoneyAmount | null
  /** Freight contingency (%, 0–30) added to the market / override freight. */
  freightBuffer: number
  /** Marine insurance rate (%) on 110 % of CIF. */
  insuranceRate: number
  /** Destination port / import clearance / delivery charges (DAP). */
  local: MoneyAmount | null
  /** Import duty (%, 0–30) on CIF. */
  dutyRate: number
  /** Quotation validity (`null` = today + 14 days). */
  validUntil: ISODate | null
  /** FCL containers (sea sizes only). */
  container: UnitCount | null
  /** Domestic trucks (truck sizes only). */
  truck: UnitCount | null
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
  /** Loading simulator: cushioning / clearance per transport mode. */
  cushioning: Record<ContainerCategory, CushionSettings>
  /** Export quotation board (tab ⑥). */
  quote: QuoteSettings
}
