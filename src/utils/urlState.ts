/**
 * Planner state ⇄ URL query string.
 *
 * Human-readable, repeatable keys so that a shared link can even be edited by hand:
 *
 *   ?v=1&base=JP&c=KR,TH,US&mode=bwd&d=2027-01-15
 *   &s=20.JP.Procurement+%26+Production      ← `{days}.{calendar}.{name}` (calendar: `cal` or a country)
 *   &s=21.cal.Ocean+Freight
 *   &tz=US:America/Los_Angeles               ← per-country time zone
 *   &wk=MY:56                                ← weekly days off as digits (0 = Sun … 6 = Sat, `-` = none)
 *   &hr=JP:0830-1730                         ← business hours
 *   &rg=MY:10                                ← holiday region (state / province)
 *   &off=TH:2027-02-16..2027-02-18:Chinese+New+Year   ← custom days off (range + optional label)
 *   &work=JP:2026-12-26                      ← custom working days
 *   &tab=calendar                            ← open tab (meeting | schedule | calendar | export | vanning)
 *   &ct=20dc                                 ← loading simulator: container / truck (20dc 40dc 40hc 2t 4t 10t)
 *   &cg=1100x1100x1000_300_6_sr_f59e0b_Case+%232   ← cargo `{L}x{W}x{H}_{kg}_{qty}_{flags}_{color}_{name}`
 *                                               (flags: s = stackable, r = 90° turn allowed,
 *                                                m100 = +100 mm own cushioning, - = none;
 *                                                `cg=-` = empty cargo list)
 *   &cl=truck.50.30.20.h                     ← cushioning per mode `{sea|truck}.{gap}.{wall}.{tier mm}.{v|h}`
 *                                               (v = also between tiers, h = horizontal only; only
 *                                                written when it differs from the mode's default)
 *
 * Quotation board (tab ⑥) — each key is only written when it differs from the default:
 *   &qcm=direct          概算M3 input: simple | direct | vanning
 *   &qsu=mm              size unit of the calculator     &qal=crate  packing allowance (none | carton | crate)
 *   &qi=110x110x100_6_300   calculator row `{L}x{W}x{H}_{pieces}_{kg per piece}` (repeatable, max 3)
 *   &qpw=10pct / 120kg   packing materials by hand (% of the product weight or kg; default by the allowance)
 *   &qv=12.5 &qw=3200    direct entry: estimated volume (m³) / weight (kg)
 *   &qpc=0               no export packing cost           &qpr=18000  packing rate (JPY per m³)
 *   &qpk=150000          export packing cost by hand (JPY)
 *   &qx=5000000          EXW base price (JPY)            &qcur=EUR   quote currency
 *   &qfx=172.5           market rate (JPY per unit)      &qfb=3      FX buffer (%)
 *   &qusd=150            JPY per USD for amounts entered in USD (quote currency ≠ USD)
 *   &qdom=55000          domestic truck freight (JPY)    &qcus=11800 export customs clearance (JPY)
 *   &qport=99600         export port charges: THC / CFS / B/L / vanning (JPY)
 *   &qm=lcl              auto | fcl | lcl | air          &qdst=DE    destination country
 *   &qpod=west           port choice (US: west | east; default by the partner's time zone)
 *   &qmk=peak            normal | peak | surge
 *   &qof=1800USD         base freight (O/F) by hand      &qsc=450USD surcharges (BAF / LSS …) by hand
 *   &qcb=10              freight contingency (%)         &qins=0.2   insurance rate (%)
 *   &qprem=12000         insurance premium by hand (JPY)
 *   &qloc=450USD         destination (DAP) charges       &qduty=5    import duty (%)
 *   &qdamt=250000        import duty by hand (JPY)
 *   &qval=2027-01-15     quotation validity
 *   &qct=40hc.2          FCL containers override         &qtr=10t.1  domestic trucks override
 * Older links: `qfr` (all-in freight) is read as base freight with no surcharges, `qexp` (customs +
 * port charges) as port charges with no separate customs fee — the same totals as before.
 */
import { isContainerId, type ContainerCategory } from '../data/containers'
import { CURRENCY_INFO, DEFAULT_USD_RATE, isQuoteCurrency } from '../data/currencies'
import { DEFAULT_CUSHIONING, DEFAULT_QUOTE, defaultQuoteRows } from '../state/defaults'
import {
  CALENDAR_DAYS,
  isPlannerTab,
  type CargoItem,
  type CountrySettings,
  type CushionSettings,
  type DayOverride,
  type MoneyAmount,
  type PlannerState,
  type PlannerTab,
  type QuoteSettings,
  type Step,
  type UnitCount,
} from '../types'
import { groupOverrideRanges } from './calendars'
import type { PackingWeightSetting, SizeRow } from './incotermsCalc'
import { addDays, diffDays, isISODate, type ISODate, type OverrideKind } from './dateCalc'
import { formatClock } from './timezone'
import { sanitizeState } from '../state/plannerReducer'

export const URL_STATE_VERSION = '1'
const STEP_CALENDAR_TOKEN = 'cal'
const MAX_RANGE_DAYS = 400

/** Quotation board keys (tab ⑥). */
const QUOTE_KEYS = [
  'qcm',
  'qsu',
  'qi',
  'qal',
  'qpw',
  'qpc',
  'qpr',
  'qpk',
  'qx',
  'qcur',
  'qfx',
  'qfb',
  'qusd',
  'qdom',
  'qcus',
  'qport',
  'qexp',
  'qm',
  'qdst',
  'qpod',
  'qmk',
  'qof',
  'qsc',
  'qfr',
  'qcb',
  'qins',
  'qprem',
  'qloc',
  'qduty',
  'qdamt',
  'qval',
  'qv',
  'qw',
  'qct',
  'qtr',
]
/** Keys that mark a query string as carrying planner state. */
const STATE_KEYS = ['base', 'c', 's', 'd', 'mode', 'ct', 'cg', 'cl', ...QUOTE_KEYS]
const CUSHION_CATEGORIES: readonly ContainerCategory[] = ['sea', 'truck']
const EMPTY_CARGO_TOKEN = '-'

function hhmm(minutes: number): string {
  return formatClock(minutes).replace(':', '')
}

function parseHhmm(value: string): number | null {
  const m = /^(\d{2})(\d{2})$/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null
  return h * 60 + min
}

/** Serializes the planner state into a query string (without the leading `?`). */
export function serializeState(state: PlannerState): string {
  const params = new URLSearchParams()
  params.set('v', URL_STATE_VERSION)
  params.set('base', state.base)
  params.set('c', state.partners.join(','))
  params.set('mode', state.mode === 'forward' ? 'fwd' : 'bwd')
  params.set('d', state.anchor)
  for (const step of state.steps) {
    const calendar = step.calendar === CALENDAR_DAYS ? STEP_CALENDAR_TOKEN : step.calendar
    params.append('s', `${step.days}.${calendar}.${step.name}`)
  }

  const selected = [state.base, ...state.partners]
  for (const code of selected) {
    const s = state.settings[code]
    if (!s) continue
    if (s.timeZone) params.append('tz', `${code}:${s.timeZone}`)
    if (s.weekend) params.append('wk', `${code}:${s.weekend.length ? s.weekend.join('') : '-'}`)
    if (s.workStart !== undefined && s.workEnd !== undefined) {
      params.append('hr', `${code}:${hhmm(s.workStart)}-${hhmm(s.workEnd)}`)
    }
    if (s.region) params.append('rg', `${code}:${s.region}`)
  }
  for (const code of selected) {
    const overrides = state.overrides[code]
    if (!overrides) continue
    for (const range of groupOverrideRanges(code, overrides)) {
      const dates = range.start === range.end ? range.start : `${range.start}..${range.end}`
      params.append(range.kind, `${code}:${dates}${range.label ? `:${range.label}` : ''}`)
    }
  }
  params.set('ct', state.container)
  if (state.cargo.length === 0) params.append('cg', EMPTY_CARGO_TOKEN)
  for (const item of state.cargo) params.append('cg', serializeCargo(item))
  for (const category of CUSHION_CATEGORIES) {
    const c = state.cushioning[category]
    const d = DEFAULT_CUSHIONING[category]
    if (c.gap === d.gap && c.wall === d.wall && c.stack === d.stack && c.stackGap === d.stackGap) continue
    params.append('cl', `${category}.${c.gap}.${c.wall}.${c.stackGap}.${c.stack ? 'v' : 'h'}`)
  }
  serializeQuote(state.quote, params)
  params.set('tab', state.tab)
  return params.toString()
}

const moneyText = (m: MoneyAmount) => `${m.amount}${m.currency}`
const unitsText = (u: UnitCount) => `${u.id}.${u.units}`

/** Writes the quotation settings that differ from the defaults. */
function serializeQuote(q: QuoteSettings, params: URLSearchParams): void {
  const d = DEFAULT_QUOTE
  const set = (key: string, value: string | number | null | undefined, skip: boolean) => {
    if (!skip && value !== null && value !== undefined) params.set(key, String(value))
  }
  set('qcm', q.cargoMode, q.cargoMode === d.cargoMode)
  set('qsu', q.sizeUnit, q.sizeUnit === d.sizeUnit)
  if (JSON.stringify(q.items) !== JSON.stringify(defaultQuoteRows(q.sizeUnit))) {
    for (const row of q.items) params.append('qi', `${row.length}x${row.width}x${row.height}_${row.quantity}_${row.weight}`)
  }
  set('qal', q.allowance, q.allowance === d.allowance)
  set('qpw', q.packingWeight && `${q.packingWeight.value}${q.packingWeight.unit}`, false)
  set('qv', q.volume, q.volume === d.volume)
  set('qw', q.weight, q.weight === d.weight)
  set('qpc', q.packingCost ? '1' : '0', q.packingCost === d.packingCost)
  set('qpr', q.packingRate, q.packingRate === d.packingRate)
  set('qpk', q.packingAmount, false)
  set('qx', q.exw, q.exw === d.exw)
  set('qcur', q.currency, q.currency === d.currency)
  set('qfx', q.fxRate, q.currency === 'JPY' || q.fxRate === CURRENCY_INFO[q.currency].defaultRate)
  set('qfb', q.fxBuffer, q.fxBuffer === d.fxBuffer)
  set('qusd', q.usdRate, q.usdRate === DEFAULT_USD_RATE)
  set('qdom', q.domestic, false)
  set('qcus', q.customs, false)
  set('qport', q.portCharges, false)
  set('qm', q.mode, q.mode === d.mode)
  set('qdst', q.destination, !q.destination)
  set('qpod', q.port, !q.port)
  set('qmk', q.market, q.market === d.market)
  set('qof', q.freight && moneyText(q.freight), false)
  set('qsc', q.surcharge && moneyText(q.surcharge), false)
  set('qcb', q.freightBuffer, q.freightBuffer === d.freightBuffer)
  set('qins', q.insuranceRate, q.insuranceRate === d.insuranceRate)
  set('qprem', q.insurance, false)
  set('qloc', q.local && moneyText(q.local), false)
  set('qduty', q.dutyRate, q.dutyRate === d.dutyRate)
  set('qdamt', q.duty, false)
  set('qval', q.validUntil, false)
  set('qct', q.container && unitsText(q.container), false)
  set('qtr', q.truck && unitsText(q.truck), false)
}

/** `1800USD` / `250000JPY` → amount + currency. */
function parseMoney(value: string | null): MoneyAmount | null {
  const m = /^(\d+(?:\.\d+)?)(JPY|USD)$/i.exec(value ?? '')
  return m ? { amount: Number(m[1]), currency: m[2].toUpperCase() as MoneyAmount['currency'] } : null
}

/** `40hc.2` → container / truck type + count (the category is checked by the sanitizer). */
function parseUnits(value: string | null): UnitCount | null {
  const [id, units] = (value ?? '').split('.')
  return isContainerId(id) ? { id, units: Number(units ?? 1) } : null
}

/** `10pct` / `120kg` → packing materials by hand. */
function parsePackingWeight(value: string | null): PackingWeightSetting | null {
  const m = /^(\d+(?:\.\d+)?)(pct|kg)$/i.exec(value ?? '')
  return m ? { value: Number(m[1]), unit: m[2].toLowerCase() as PackingWeightSetting['unit'] } : null
}

/** `110x110x100_6_300` → size calculator row (sizes in the row unit, pieces, kg per piece). */
function parseSizeRow(value: string): SizeRow | null {
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)_(\d+)_(\d+(?:\.\d+)?)$/i.exec(value)
  if (!m) return null
  return { length: Number(m[1]), width: Number(m[2]), height: Number(m[3]), quantity: Number(m[4]), weight: Number(m[5]) }
}

/** Quotation settings from the query; missing keys use the defaults (they are not written). */
function parseQuote(params: URLSearchParams): Partial<QuoteSettings> {
  const num = (key: string, fallback: number | null): number | null => {
    const value = params.get(key)
    return value === null || value.trim() === '' ? fallback : Number(value)
  }
  const currencyParam = params.get('qcur')?.toUpperCase()
  const currency = isQuoteCurrency(currencyParam) ? currencyParam : DEFAULT_QUOTE.currency
  const sizeUnit = params.get('qsu') === 'mm' ? 'mm' : 'cm'
  const rows = params.getAll('qi').map(parseSizeRow).filter((row): row is SizeRow => row !== null)
  // Older links: `qfr` was the all-in freight and `qexp` customs + port charges together.
  const legacyFreight = params.has('qof') || params.has('qsc') ? null : parseMoney(params.get('qfr'))
  const legacyExport = params.has('qport') || params.has('qcus') ? null : num('qexp', null)
  return {
    cargoMode: (params.get('qcm') ?? DEFAULT_QUOTE.cargoMode) as QuoteSettings['cargoMode'],
    sizeUnit,
    items: rows.length ? rows : defaultQuoteRows(sizeUnit),
    allowance: (params.get('qal') ?? DEFAULT_QUOTE.allowance) as QuoteSettings['allowance'],
    packingWeight: parsePackingWeight(params.get('qpw')),
    volume: num('qv', DEFAULT_QUOTE.volume) ?? DEFAULT_QUOTE.volume,
    weight: num('qw', DEFAULT_QUOTE.weight) ?? DEFAULT_QUOTE.weight,
    packingCost: params.has('qpc') ? params.get('qpc') !== '0' : DEFAULT_QUOTE.packingCost,
    packingRate: num('qpr', DEFAULT_QUOTE.packingRate) ?? DEFAULT_QUOTE.packingRate,
    packingAmount: num('qpk', null),
    exw: num('qx', DEFAULT_QUOTE.exw) ?? DEFAULT_QUOTE.exw,
    currency,
    fxRate: num('qfx', CURRENCY_INFO[currency].defaultRate) ?? CURRENCY_INFO[currency].defaultRate,
    fxBuffer: num('qfb', DEFAULT_QUOTE.fxBuffer) ?? DEFAULT_QUOTE.fxBuffer,
    usdRate: num('qusd', DEFAULT_USD_RATE) ?? DEFAULT_USD_RATE,
    domestic: num('qdom', null),
    customs: legacyExport !== null ? 0 : num('qcus', null),
    portCharges: legacyExport ?? num('qport', null),
    mode: (params.get('qm') ?? DEFAULT_QUOTE.mode) as QuoteSettings['mode'],
    destination: (params.get('qdst') ?? '').toUpperCase(),
    port: (params.get('qpod') ?? '').toLowerCase(),
    market: (params.get('qmk') ?? DEFAULT_QUOTE.market) as QuoteSettings['market'],
    freight: legacyFreight ?? parseMoney(params.get('qof')),
    surcharge: legacyFreight ? { amount: 0, currency: legacyFreight.currency } : parseMoney(params.get('qsc')),
    freightBuffer: num('qcb', DEFAULT_QUOTE.freightBuffer) ?? DEFAULT_QUOTE.freightBuffer,
    insuranceRate: num('qins', DEFAULT_QUOTE.insuranceRate) ?? DEFAULT_QUOTE.insuranceRate,
    insurance: num('qprem', null),
    local: parseMoney(params.get('qloc')),
    dutyRate: num('qduty', DEFAULT_QUOTE.dutyRate) ?? DEFAULT_QUOTE.dutyRate,
    duty: num('qdamt', null),
    validUntil: params.get('qval'),
    container: parseUnits(params.get('qct')),
    truck: parseUnits(params.get('qtr')),
  }
}

/** `1100x1100x1000_300_6_sr_f59e0b_Case #2` (the name goes last so it may contain `_`). */
function serializeCargo(item: CargoItem): string {
  const flags = `${item.stackable ? 's' : ''}${item.rotatable ? 'r' : ''}${item.margin > 0 ? `m${item.margin}` : ''}` || '-'
  const weight = String(Math.round(item.weight * 10) / 10)
  return `${item.length}x${item.width}x${item.height}_${weight}_${item.quantity}_${flags}_${item.color.replace('#', '')}_${item.name}`
}

function parseCargo(value: string): Partial<CargoItem> | null {
  const parts: string[] = []
  let rest = value
  for (let i = 0; i < 5; i++) {
    const index = rest.indexOf('_')
    if (index < 0) return null
    parts.push(rest.slice(0, index))
    rest = rest.slice(index + 1)
  }
  const [dims, weight, quantity, flags, color] = parts
  const m = /^(\d+)x(\d+)x(\d+)$/i.exec(dims)
  if (!m) return null
  return {
    length: Number(m[1]),
    width: Number(m[2]),
    height: Number(m[3]),
    weight: Number(weight),
    quantity: Number(quantity),
    stackable: flags.includes('s'),
    rotatable: flags.includes('r'),
    margin: Number(/m(\d+)/.exec(flags)?.[1] ?? 0),
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : '',
    name: rest,
  }
}

/** `truck.50.30.20.h` → cushioning of one transport mode. */
function parseCushion(value: string): { category: ContainerCategory; settings: Partial<CushionSettings> } | null {
  const [category, gap, wall, stackGap, flag] = value.split('.')
  if (category !== 'sea' && category !== 'truck') return null
  return {
    category,
    settings: { gap: Number(gap), wall: Number(wall), stackGap: Number(stackGap), stack: flag === 'v' },
  }
}

/** The `tab` parameter alone (a link may open a tab without carrying planner state). */
export function readTabParam(search: string): PlannerTab | undefined {
  const tab = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab')
  return isPlannerTab(tab) ? tab : undefined
}

/** Splits `CODE:rest` → `[CODE, rest]` (only the first colon). */
function splitCountry(value: string): [string, string] | null {
  const index = value.indexOf(':')
  if (index !== 2) return null
  const code = value.slice(0, 2).toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? [code, value.slice(3)] : null
}

function parseStep(value: string): Partial<Step> | null {
  const first = value.indexOf('.')
  const second = first < 0 ? -1 : value.indexOf('.', first + 1)
  if (first < 0 || second < 0) return null
  const days = Number(value.slice(0, first))
  if (!Number.isFinite(days)) return null
  const calendarToken = value.slice(first + 1, second)
  const calendar = calendarToken === STEP_CALENDAR_TOKEN ? CALENDAR_DAYS : calendarToken.toUpperCase()
  return { days, calendar, name: value.slice(second + 1) }
}

function parseOverride(value: string, kind: OverrideKind): { code: string; dates: ISODate[]; override: DayOverride } | null {
  const split = splitCountry(value)
  if (!split) return null
  const [code, rest] = split
  const colon = rest.indexOf(':')
  const datePart = colon < 0 ? rest : rest.slice(0, colon)
  const label = colon < 0 ? '' : rest.slice(colon + 1)
  const [start, end = start] = datePart.split('..')
  if (!isISODate(start) || !isISODate(end) || end < start || diffDays(start, end) > MAX_RANGE_DAYS) return null
  const dates: ISODate[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d)
  return { code, dates, override: label ? { kind, label } : { kind } }
}

export interface ParsedUrlState {
  /** `true` when the query string contained planner state. */
  recognized: boolean
  state: PlannerState
}

/** Parses a query string (with or without `?`). Invalid parts fall back to `fallback`. */
export function parseState(search: string, fallback: PlannerState): ParsedUrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const recognized = STATE_KEYS.some((key) => params.has(key))
  if (!recognized) return { recognized: false, state: fallback }

  const base = (params.get('base') ?? fallback.base).toUpperCase()
  const partners = params.has('c')
    ? (params.get('c') ?? '')
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    : fallback.partners

  const modeParam = params.get('mode')
  const mode =
    modeParam === 'fwd' || modeParam === 'forward'
      ? 'forward'
      : modeParam === 'bwd' || modeParam === 'backward'
        ? 'backward'
        : fallback.mode

  const anchor = params.get('d') ?? fallback.anchor

  const stepValues = params.getAll('s')
  const steps = stepValues.length
    ? stepValues.map(parseStep).filter((s): s is Partial<Step> => s !== null)
    : fallback.steps

  const settings: Record<string, CountrySettings> = {}
  const settingsFor = (code: string) => (settings[code] ??= {})
  for (const value of params.getAll('tz')) {
    const split = splitCountry(value)
    if (split) settingsFor(split[0]).timeZone = split[1]
  }
  for (const value of params.getAll('wk')) {
    const split = splitCountry(value)
    if (!split) continue
    const weekend = split[1] === '-' ? [] : [...split[1]].map(Number).filter((d) => Number.isInteger(d) && d <= 6)
    settingsFor(split[0]).weekend = weekend
  }
  for (const value of params.getAll('hr')) {
    const split = splitCountry(value)
    if (!split) continue
    const [from, to] = split[1].split('-')
    const workStart = parseHhmm(from ?? '')
    const workEnd = parseHhmm(to ?? '')
    if (workStart !== null && workEnd !== null) Object.assign(settingsFor(split[0]), { workStart, workEnd })
  }
  for (const value of params.getAll('rg')) {
    const split = splitCountry(value)
    if (split && split[1]) settingsFor(split[0]).region = split[1]
  }

  const overrides: PlannerState['overrides'] = {}
  for (const kind of ['off', 'work'] as const) {
    for (const value of params.getAll(kind)) {
      const parsed = parseOverride(value, kind)
      if (!parsed) continue
      const map = (overrides[parsed.code] ??= {})
      for (const date of parsed.dates) map[date] = parsed.override
    }
  }

  const containerParam = params.get('ct')
  const container = isContainerId(containerParam) ? containerParam : fallback.container
  const cargoValues = params.getAll('cg')
  const cargo = cargoValues.length
    ? cargoValues.map(parseCargo).filter((c): c is Partial<CargoItem> => c !== null)
    : fallback.cargo
  // Modes without a `cl` parameter use their defaults (not the fallback's settings).
  const cushioning: Record<ContainerCategory, CushionSettings> = {
    sea: { ...DEFAULT_CUSHIONING.sea },
    truck: { ...DEFAULT_CUSHIONING.truck },
  }
  for (const value of params.getAll('cl')) {
    const parsed = parseCushion(value)
    if (parsed) cushioning[parsed.category] = { ...cushioning[parsed.category], ...parsed.settings }
  }

  const state = sanitizeState(
    {
      base,
      partners,
      settings,
      mode,
      anchor,
      steps: steps as Step[],
      overrides,
      tab: readTabParam(search) ?? fallback.tab,
      container,
      cargo: cargo as CargoItem[],
      cushioning,
      quote: parseQuote(params) as QuoteSettings,
    },
    fallback,
  )
  return { recognized: true, state }
}
