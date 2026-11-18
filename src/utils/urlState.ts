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
 */
import { isContainerId, type ContainerCategory } from '../data/containers'
import { DEFAULT_CUSHIONING } from '../state/defaults'
import {
  CALENDAR_DAYS,
  isPlannerTab,
  type CargoItem,
  type CountrySettings,
  type CushionSettings,
  type DayOverride,
  type PlannerState,
  type PlannerTab,
  type Step,
} from '../types'
import { groupOverrideRanges } from './calendars'
import { addDays, diffDays, isISODate, type ISODate, type OverrideKind } from './dateCalc'
import { formatClock } from './timezone'
import { sanitizeState } from '../state/plannerReducer'

export const URL_STATE_VERSION = '1'
const STEP_CALENDAR_TOKEN = 'cal'
const MAX_RANGE_DAYS = 400

/** Keys that mark a query string as carrying planner state. */
const STATE_KEYS = ['base', 'c', 's', 'd', 'mode', 'ct', 'cg', 'cl']
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
  params.set('tab', state.tab)
  return params.toString()
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
    },
    fallback,
  )
  return { recognized: true, state }
}
