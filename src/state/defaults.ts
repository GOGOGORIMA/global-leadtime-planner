import { DEFAULT_CONTAINER } from '../data/containers'
import { DEFAULT_BASE_COUNTRY, PRESET_PARTNER_COUNTRIES } from '../data/countries'
import { CURRENCY_INFO, DEFAULT_QUOTE_CURRENCY, DEFAULT_USD_RATE } from '../data/currencies'
import {
  CALENDAR_DAYS,
  type CargoItem,
  type CushionSettings,
  type PlannerState,
  type QuoteSettings,
  type Step,
} from '../types'
import { addDays, type ISODate } from '../utils/dateCalc'

export const MAX_STEPS = 20
export const MAX_PARTNERS = 30
/** Loading simulator limits. */
export const MAX_CARGO_ITEMS = 30
export const MAX_CARGO_QUANTITY = 999
/** Largest accepted piece dimension (mm) and weight (kg). */
export const MAX_CARGO_DIMENSION = 20000
export const MAX_CARGO_WEIGHT = 100000
/** Cushioning limits (mm): gap / wall clearance / individual margin, and between tiers. */
export const MAX_CUSHION = 500
export const MAX_STACK_CUSHION = 50

/**
 * Cushioning defaults per transport mode: trucks keep 50 mm between pieces and 30 mm to the
 * side boards / front wall / doors (lashing work, no rubbing); containers start without.
 */
export const DEFAULT_CUSHIONING: Readonly<Record<'sea' | 'truck', CushionSettings>> = {
  sea: { gap: 0, wall: 0, stack: false, stackGap: 20 },
  truck: { gap: 50, wall: 30, stack: false, stackGap: 20 },
}

/** Quick-select values (mm) of the cushioning panel. */
export const GAP_PRESETS = [0, 30, 50, 100] as const
export const WALL_PRESETS = [0, 20, 50] as const
export const STACK_PRESETS = [0, 10, 20, 50] as const
/** Default requested delivery date for the backward mode: today + 60 days. */
export const DEFAULT_LEAD_DAYS = 60

/** Quotation board limits (JPY amounts, rates, percentages). */
export const MAX_QUOTE_PRICE = 100_000_000_000
export const MAX_QUOTE_CHARGE = 1_000_000_000
export const MAX_FX_RATE = 100_000
export const MAX_FX_BUFFER = 10
export const MAX_FREIGHT_BUFFER = 30
export const MAX_INSURANCE_RATE = 5
export const MAX_DUTY_RATE = 30
export const MAX_QUOTE_VOLUME = 100_000
export const MAX_QUOTE_WEIGHT = 10_000_000
export const MAX_QUOTE_UNITS = 99
/** Default quotation validity: today + 14 days. */
export const DEFAULT_VALIDITY_DAYS = 14

/**
 * Quotation board defaults: a sample EXW price in USD with a 3 % FX buffer, FCL to the schedule's
 * partner country at normal market rates, 10 % freight contingency, 0.20 % insurance, 5 % duty.
 */
export const DEFAULT_QUOTE: Readonly<QuoteSettings> = {
  exw: 5_000_000,
  currency: DEFAULT_QUOTE_CURRENCY,
  fxRate: CURRENCY_INFO[DEFAULT_QUOTE_CURRENCY].defaultRate,
  fxBuffer: 3,
  usdRate: DEFAULT_USD_RATE,
  domestic: null,
  exportCharges: null,
  mode: 'fcl',
  destination: '',
  market: 'normal',
  freight: null,
  freightBuffer: 10,
  insuranceRate: 0.2,
  local: null,
  dutyRate: 5,
  validUntil: null,
  volume: null,
  weight: null,
  container: null,
  truck: null,
}

/** Quick-select import duty rates (%). */
export const DUTY_PRESETS = [0, 3, 5, 10] as const

let idCounter = 0

/** Short unique id for React keys (not persisted in URLs). */
export function createId(): string {
  idCounter = (idCounter + 1) % 1_000_000
  return `${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export type StepDefinition = Omit<Step, 'id'>

export function instantiateSteps(definitions: readonly StepDefinition[]): Step[] {
  return definitions.map((d) => ({ ...d, id: createId() }))
}

/** The partner used for "相手国営業日" defaults in step templates: the first partner (else the base). */
export function pickDefaultPartner(base: string, partners: readonly string[]): string {
  return partners[0] ?? base
}

export interface StepTemplate {
  id: string
  label: string
  description: string
  build: (base: string, partner: string) => StepDefinition[]
}

/** Built-in step templates (names are English because they go straight into the e-mail). */
export const STEP_TEMPLATES: readonly StepTemplate[] = [
  {
    id: 'standard',
    label: '基本3工程（海上）',
    description: '国内手配・製造 → 海上輸送・通関 → 現地搬入',
    build: (base, partner) => [
      { name: 'Procurement & Production', days: 20, calendar: base },
      { name: 'Ocean Freight & Customs Clearance', days: 21, calendar: CALENDAR_DAYS },
      { name: 'Local Delivery', days: 3, calendar: partner },
    ],
  },
  {
    id: 'sea-detailed',
    label: '海上輸送（詳細）',
    description: '製造 → 輸出通関 → 海上輸送 → 輸入通関 → 現地配送',
    build: (base, partner) => [
      { name: 'Production', days: 20, calendar: base },
      { name: 'Export Customs Clearance', days: 3, calendar: base },
      { name: 'Ocean Freight', days: 18, calendar: CALENDAR_DAYS },
      { name: 'Import Customs Clearance', days: 4, calendar: partner },
      { name: 'Local Delivery', days: 2, calendar: partner },
    ],
  },
  {
    id: 'air',
    label: '航空輸送（急送）',
    description: '製造・梱包 → 航空輸送・通関 → 現地配送',
    build: (base, partner) => [
      { name: 'Production & Packing', days: 10, calendar: base },
      { name: 'Air Freight & Customs Clearance', days: 5, calendar: CALENDAR_DAYS },
      { name: 'Local Delivery', days: 2, calendar: partner },
    ],
  },
  {
    id: 'local',
    label: '現地生産',
    description: '受注処理 → 現地製造 → 検査・納品',
    build: (base, partner) => [
      { name: 'Order Processing', days: 2, calendar: base },
      { name: 'Local Production', days: 15, calendar: partner },
      { name: 'Inspection & Delivery', days: 3, calendar: partner },
    ],
  },
]

/** English step names offered as suggestions (with Japanese hints). */
export const STEP_NAME_SUGGESTIONS: ReadonlyArray<{ en: string; ja: string }> = [
  { en: 'Order Confirmation', ja: '受注確認' },
  { en: 'Procurement & Production', ja: '国内手配・製造' },
  { en: 'Raw Material Procurement', ja: '原材料調達' },
  { en: 'Production', ja: '製造' },
  { en: 'Quality Inspection', ja: '品質検査' },
  { en: 'Packing', ja: '梱包' },
  { en: 'Inland Transport to Port', ja: '港までの国内輸送' },
  { en: 'Export Customs Clearance', ja: '輸出通関' },
  { en: 'Ocean Freight', ja: '海上輸送' },
  { en: 'Ocean Freight & Customs Clearance', ja: '海上輸送・通関' },
  { en: 'Air Freight', ja: '航空輸送' },
  { en: 'Import Customs Clearance', ja: '輸入通関' },
  { en: 'Local Delivery', ja: '現地搬入' },
  { en: 'Installation & Commissioning', ja: '据付・試運転' },
  { en: 'Payment Confirmation', ja: '入金確認' },
]

export type CargoDefinition = Omit<CargoItem, 'id'>

/** Auto-assigned cargo colors (distinct hues, readable with black edges). */
export const CARGO_COLORS = [
  '#6366f1',
  '#f59e0b',
  '#10b981',
  '#ef4444',
  '#0ea5e9',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#64748b',
  '#eab308',
] as const

/** First palette color not used yet (cycles when all are taken). */
export function nextCargoColor(used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()))
  return CARGO_COLORS.find((c) => !taken.has(c)) ?? CARGO_COLORS[used.length % CARGO_COLORS.length]
}

/** Sample shipment shown on first use: a non-stackable machine crate, pallets and cartons. */
export const SAMPLE_CARGO: readonly CargoDefinition[] = [
  {
    name: 'Case #1 Main Unit (Crate)',
    length: 2200,
    width: 1500,
    height: 1800,
    weight: 1000,
    quantity: 1,
    stackable: false,
    rotatable: true,
    color: CARGO_COLORS[0],
    margin: 0,
  },
  {
    name: 'Case #2 Accessories (Pallet)',
    length: 1100,
    width: 1100,
    height: 1000,
    weight: 300,
    quantity: 6,
    stackable: true,
    rotatable: true,
    color: CARGO_COLORS[1],
    margin: 0,
  },
  {
    name: 'Case #3 Spare Parts (Carton)',
    length: 600,
    width: 400,
    height: 400,
    weight: 15,
    quantity: 24,
    stackable: true,
    rotatable: true,
    color: CARGO_COLORS[2],
    margin: 0,
  },
]

/** Defaults for a newly added cargo row (a T11 pallet). */
export function newCargoDefinition(index: number, color: string): CargoDefinition {
  return {
    name: `Case #${index + 1}`,
    length: 1100,
    width: 1100,
    height: 1000,
    weight: 300,
    quantity: 1,
    stackable: true,
    rotatable: true,
    color,
    margin: 0,
  }
}

export function instantiateCargo(definitions: readonly CargoDefinition[]): CargoItem[] {
  return definitions.map((d) => ({ ...d, id: createId() }))
}

export function createDefaultState(today: ISODate): PlannerState {
  const base = DEFAULT_BASE_COUNTRY
  const partners = [...PRESET_PARTNER_COUNTRIES]
  return {
    base,
    partners,
    settings: {},
    mode: 'backward',
    anchor: addDays(today, DEFAULT_LEAD_DAYS),
    steps: instantiateSteps(STEP_TEMPLATES[0].build(base, pickDefaultPartner(base, partners))),
    overrides: {},
    tab: 'meeting',
    container: DEFAULT_CONTAINER,
    cargo: instantiateCargo(SAMPLE_CARGO),
    cushioning: { sea: { ...DEFAULT_CUSHIONING.sea }, truck: { ...DEFAULT_CUSHIONING.truck } },
    quote: { ...DEFAULT_QUOTE },
  }
}
