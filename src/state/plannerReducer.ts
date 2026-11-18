import { getContainerSpec, isContainerId, type ContainerCategory, type ContainerId } from '../data/containers'
import { isKnownCountry } from '../data/countries'
import { CURRENCY_INFO, DEFAULT_USD_RATE, isQuoteCurrency } from '../data/currencies'
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
import { isISODate, normalizeStepDays, type ISODate, type ScheduleMode } from '../utils/dateCalc'
import { FREIGHT_ORIGIN, isFreightMarket, isShippingMode } from '../utils/freightRates'
import { isValidTimeZone } from '../utils/timezone'
import {
  DEFAULT_CUSHIONING,
  DEFAULT_QUOTE,
  MAX_CARGO_DIMENSION,
  MAX_CARGO_ITEMS,
  MAX_CARGO_QUANTITY,
  MAX_CARGO_WEIGHT,
  MAX_CUSHION,
  MAX_DUTY_RATE,
  MAX_FREIGHT_BUFFER,
  MAX_FX_BUFFER,
  MAX_FX_RATE,
  MAX_INSURANCE_RATE,
  MAX_PARTNERS,
  MAX_QUOTE_CHARGE,
  MAX_QUOTE_PRICE,
  MAX_QUOTE_UNITS,
  MAX_QUOTE_VOLUME,
  MAX_QUOTE_WEIGHT,
  MAX_STACK_CUSHION,
  MAX_STEPS,
  createId,
  newCargoDefinition,
  nextCargoColor,
  type CargoDefinition,
  type StepDefinition,
} from './defaults'

export type PlannerAction =
  | { type: 'setBase'; code: string }
  | { type: 'addPartner'; code: string }
  | { type: 'removePartner'; code: string }
  | { type: 'setPartners'; codes: string[] }
  | { type: 'movePartner'; code: string; direction: -1 | 1 }
  | { type: 'updateSettings'; code: string; patch: Partial<CountrySettings> }
  | { type: 'resetSettings'; code: string }
  | { type: 'setMode'; mode: ScheduleMode; anchor?: ISODate }
  | { type: 'setAnchor'; anchor: ISODate }
  | { type: 'addStep'; step?: Partial<StepDefinition> }
  | { type: 'updateStep'; id: string; patch: Partial<StepDefinition> }
  | { type: 'removeStep'; id: string }
  | { type: 'moveStep'; id: string; direction: -1 | 1 }
  | { type: 'setSteps'; steps: StepDefinition[] }
  | { type: 'toggleOverride'; country: string; date: ISODate; defaultWorking: boolean; label?: string }
  | { type: 'setOverrides'; country: string; dates: ISODate[]; override: DayOverride | null }
  | { type: 'clearOverrides'; country?: string }
  | { type: 'setTab'; tab: PlannerTab }
  | { type: 'setContainer'; container: ContainerId }
  | { type: 'addCargo'; cargo?: Partial<CargoDefinition> }
  | { type: 'updateCargo'; id: string; patch: Partial<CargoDefinition> }
  | { type: 'duplicateCargo'; id: string }
  | { type: 'removeCargo'; id: string }
  | { type: 'setCargo'; cargo: ReadonlyArray<Partial<CargoDefinition>> }
  | { type: 'setCushioning'; category: ContainerCategory; patch: Partial<CushionSettings> }
  | { type: 'resetCushioning'; category: ContainerCategory }
  | { type: 'setQuote'; patch: Partial<QuoteSettings> }
  | { type: 'resetQuote' }
  | { type: 'replace'; state: PlannerState }

const MAX_LABEL_LENGTH = 80
const MAX_STEP_NAME_LENGTH = 80
const MAX_CARGO_NAME_LENGTH = 60
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Makes one cargo row safe: sizes 1–20,000 mm, weight 0–100,000 kg (0.1 kg), quantity 1–999. */
function sanitizeCargo(item: Partial<CargoItem>, index: number, usedColors: readonly string[]): CargoItem {
  const name = (item.name ?? '').slice(0, MAX_CARGO_NAME_LENGTH)
  const weight = Number(item.weight)
  return {
    id: item.id || createId(),
    name: name.trim() ? name : `Case #${index + 1}`,
    length: clampInt(item.length, 1, MAX_CARGO_DIMENSION, 1000),
    width: clampInt(item.width, 1, MAX_CARGO_DIMENSION, 1000),
    height: clampInt(item.height, 1, MAX_CARGO_DIMENSION, 1000),
    weight: Number.isFinite(weight) ? Math.min(MAX_CARGO_WEIGHT, Math.max(0, Math.round(weight * 10) / 10)) : 0,
    quantity: clampInt(item.quantity, 1, MAX_CARGO_QUANTITY, 1),
    stackable: item.stackable !== false,
    rotatable: item.rotatable !== false,
    color: typeof item.color === 'string' && HEX_COLOR.test(item.color) ? item.color.toLowerCase() : nextCargoColor(usedColors),
    margin: clampInt(item.margin, 0, MAX_CUSHION, 0),
  }
}

/** Cushioning: gap / wall 0–500 mm, tier cushioning 0–50 mm (whole millimetres). */
export function sanitizeCushion(input: Partial<CushionSettings> | undefined, fallback: CushionSettings): CushionSettings {
  return {
    gap: clampInt(input?.gap, 0, MAX_CUSHION, fallback.gap),
    wall: clampInt(input?.wall, 0, MAX_CUSHION, fallback.wall),
    stack: typeof input?.stack === 'boolean' ? input.stack : fallback.stack,
    stackGap: clampInt(input?.stackGap, 0, MAX_STACK_CUSHION, fallback.stackGap),
  }
}

/** A finite number clamped to [min, max] and rounded to `decimals`, else `fallback`. */
function clampNumber(value: unknown, min: number, max: number, decimals: number, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const factor = 10 ** decimals
  return Math.min(max, Math.max(min, Math.round(n * factor) / factor))
}

/** `null` stays `null` ("automatic"); anything else is clamped like {@link clampNumber}. */
function optionalNumber(value: unknown, max: number, decimals: number): number | null {
  if (value === null || value === undefined) return null
  const n = clampNumber(value, 0, max, decimals, Number.NaN)
  return Number.isNaN(n) ? null : n
}

/** Exchange rate (JPY per unit): positive, at most 100,000, 4 decimals; otherwise `fallback`. */
function sanitizeRate(value: unknown, fallback: number): number {
  const n = Number(value)
  return value !== null && value !== '' && Number.isFinite(n) && n > 0 ? clampNumber(n, 0.0001, MAX_FX_RATE, 4, fallback) : fallback
}

function sanitizeMoney(value: Partial<MoneyAmount> | null | undefined): MoneyAmount | null {
  if (!value || (value.currency !== 'JPY' && value.currency !== 'USD')) return null
  const amount = optionalNumber(value.amount, MAX_QUOTE_CHARGE, value.currency === 'JPY' ? 0 : 2)
  return amount === null ? null : { amount, currency: value.currency }
}

function sanitizeUnits(value: Partial<UnitCount> | null | undefined, category: ContainerCategory): UnitCount | null {
  if (!value || !isContainerId(value.id) || getContainerSpec(value.id).category !== category) return null
  return { id: value.id, units: clampInt(value.units, 1, MAX_QUOTE_UNITS, 1) }
}

/**
 * Makes the quotation settings safe: amounts 0–1,000 億円 / 10 億円, rates > 0, FX buffer 0–10 %,
 * freight contingency 0–30 %, insurance 0–5 %, duty 0–30 %, known destination (never the origin).
 * The FX rate of JPY quotes is always 1.
 */
export function sanitizeQuote(input: Partial<QuoteSettings> | undefined, fallback: QuoteSettings = DEFAULT_QUOTE): QuoteSettings {
  const q = input ?? {}
  const currency = isQuoteCurrency(q.currency) ? q.currency : fallback.currency
  const defaultRate = CURRENCY_INFO[currency].defaultRate
  const destination =
    typeof q.destination === 'string' && q.destination !== FREIGHT_ORIGIN && isKnownCountry(q.destination)
      ? q.destination
      : ''
  return {
    exw: clampNumber(q.exw, 0, MAX_QUOTE_PRICE, 0, fallback.exw),
    currency,
    fxRate: currency === 'JPY' ? 1 : sanitizeRate(q.fxRate, defaultRate),
    fxBuffer: clampNumber(q.fxBuffer, 0, MAX_FX_BUFFER, 1, fallback.fxBuffer),
    usdRate: sanitizeRate(q.usdRate, DEFAULT_USD_RATE),
    domestic: optionalNumber(q.domestic, MAX_QUOTE_CHARGE, 0),
    exportCharges: optionalNumber(q.exportCharges, MAX_QUOTE_CHARGE, 0),
    mode: isShippingMode(q.mode) ? q.mode : fallback.mode,
    destination,
    market: isFreightMarket(q.market) ? q.market : fallback.market,
    freight: sanitizeMoney(q.freight),
    freightBuffer: clampNumber(q.freightBuffer, 0, MAX_FREIGHT_BUFFER, 1, fallback.freightBuffer),
    insuranceRate: clampNumber(q.insuranceRate, 0, MAX_INSURANCE_RATE, 3, fallback.insuranceRate),
    local: sanitizeMoney(q.local),
    dutyRate: clampNumber(q.dutyRate, 0, MAX_DUTY_RATE, 2, fallback.dutyRate),
    validUntil: isISODate(q.validUntil) ? q.validUntil : null,
    volume: optionalNumber(q.volume, MAX_QUOTE_VOLUME, 3),
    weight: optionalNumber(q.weight, MAX_QUOTE_WEIGHT, 1),
    container: sanitizeUnits(q.container, 'sea'),
    truck: sanitizeUnits(q.truck, 'truck'),
  }
}

/** Sanitizes a cargo list (max 30 rows); rows without a valid color get distinct palette colors. */
export function sanitizeCargoList(items: ReadonlyArray<Partial<CargoItem>>): CargoItem[] {
  const colors: string[] = []
  return items.slice(0, MAX_CARGO_ITEMS).map((item, index) => {
    const clean = sanitizeCargo(item, index, colors)
    colors.push(clean.color)
    return clean
  })
}

function selectedCodes(state: Pick<PlannerState, 'base' | 'partners'>): Set<string> {
  return new Set([state.base, ...state.partners])
}

/** Reassigns steps whose calendar country is no longer selected to the base country. */
function fixStepCalendars(steps: Step[], base: string, partners: readonly string[]): Step[] {
  const allowed = new Set([base, ...partners])
  let changed = false
  const next = steps.map((s) => {
    if (s.calendar === CALENDAR_DAYS || allowed.has(s.calendar)) return s
    changed = true
    return { ...s, calendar: base }
  })
  return changed ? next : steps
}

function sanitizeWeekend(weekend: unknown): number[] | undefined {
  if (!Array.isArray(weekend)) return undefined
  const days = [...new Set(weekend.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))]
  return days.sort((a, b) => a - b)
}

function sanitizeSettings(settings: CountrySettings | undefined): CountrySettings | undefined {
  if (!settings) return undefined
  const out: CountrySettings = {}
  if (settings.timeZone && isValidTimeZone(settings.timeZone)) out.timeZone = settings.timeZone
  const weekend = sanitizeWeekend(settings.weekend)
  if (weekend) out.weekend = weekend
  const { workStart, workEnd } = settings
  if (
    Number.isInteger(workStart) &&
    Number.isInteger(workEnd) &&
    (workStart as number) >= 0 &&
    (workEnd as number) <= 1440 &&
    (workEnd as number) > (workStart as number)
  ) {
    out.workStart = workStart
    out.workEnd = workEnd
  }
  if (typeof settings.region === 'string' && settings.region) out.region = settings.region
  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeStep(step: Partial<Step>, index: number, base: string, allowed: Set<string>): Step {
  const calendar =
    step.calendar === CALENDAR_DAYS || (step.calendar && allowed.has(step.calendar)) ? step.calendar : base
  const name = (step.name ?? '').slice(0, MAX_STEP_NAME_LENGTH)
  return {
    id: step.id || createId(),
    name: name.trim() ? name : `Step ${index + 1}`,
    days: normalizeStepDays(Number(step.days)),
    calendar,
  }
}

/** Makes any (possibly hand-edited / outdated) state safe to use. */
export function sanitizeState(input: PlannerState, fallback: PlannerState): PlannerState {
  const base = isKnownCountry(input.base) ? input.base : fallback.base
  const partners = [...new Set(input.partners ?? [])]
    .filter((code) => code !== base && isKnownCountry(code))
    .slice(0, MAX_PARTNERS)
  const allowed = new Set([base, ...partners])

  const settings: Record<string, CountrySettings> = {}
  for (const [code, value] of Object.entries(input.settings ?? {})) {
    const clean = sanitizeSettings(value)
    if (clean && isKnownCountry(code)) settings[code] = clean
  }

  const overrides: PlannerState['overrides'] = {}
  for (const [code, map] of Object.entries(input.overrides ?? {})) {
    if (!isKnownCountry(code)) continue
    const clean: Record<ISODate, DayOverride> = {}
    for (const [date, override] of Object.entries(map ?? {})) {
      if (!isISODate(date) || (override?.kind !== 'off' && override?.kind !== 'work')) continue
      const label = override.label?.slice(0, MAX_LABEL_LENGTH).trim()
      clean[date] = label ? { kind: override.kind, label } : { kind: override.kind }
    }
    if (Object.keys(clean).length > 0) overrides[code] = clean
  }

  const steps = (input.steps ?? []).slice(0, MAX_STEPS).map((s, i) => sanitizeStep(s, i, base, allowed))

  return {
    base,
    partners,
    settings,
    mode: input.mode === 'forward' || input.mode === 'backward' ? input.mode : fallback.mode,
    anchor: isISODate(input.anchor) ? input.anchor : fallback.anchor,
    steps,
    overrides,
    tab: isPlannerTab(input.tab) ? input.tab : fallback.tab,
    container: isContainerId(input.container) ? input.container : fallback.container,
    cargo: sanitizeCargoList(input.cargo ?? fallback.cargo),
    cushioning: {
      sea: sanitizeCushion(input.cushioning?.sea, fallback.cushioning?.sea ?? DEFAULT_CUSHIONING.sea),
      truck: sanitizeCushion(input.cushioning?.truck, fallback.cushioning?.truck ?? DEFAULT_CUSHIONING.truck),
    },
    quote: sanitizeQuote(input.quote ?? fallback.quote),
  }
}

function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || target < 0 || target >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'setBase': {
      if (action.code === state.base || !isKnownCountry(action.code)) return state
      // The previous base country stays in the comparison as the first partner.
      const partners = [state.base, ...state.partners.filter((c) => c !== action.code && c !== state.base)].slice(
        0,
        MAX_PARTNERS,
      )
      return { ...state, base: action.code, partners, steps: fixStepCalendars(state.steps, action.code, partners) }
    }
    case 'addPartner': {
      if (!isKnownCountry(action.code) || selectedCodes(state).has(action.code)) return state
      if (state.partners.length >= MAX_PARTNERS) return state
      return { ...state, partners: [...state.partners, action.code] }
    }
    case 'removePartner': {
      if (!state.partners.includes(action.code)) return state
      const partners = state.partners.filter((c) => c !== action.code)
      return { ...state, partners, steps: fixStepCalendars(state.steps, state.base, partners) }
    }
    case 'setPartners': {
      const partners = [...new Set(action.codes)]
        .filter((c) => c !== state.base && isKnownCountry(c))
        .slice(0, MAX_PARTNERS)
      return { ...state, partners, steps: fixStepCalendars(state.steps, state.base, partners) }
    }
    case 'movePartner': {
      const index = state.partners.indexOf(action.code)
      if (index < 0) return state
      return { ...state, partners: moveItem(state.partners, index, action.direction) }
    }
    case 'updateSettings': {
      const merged: CountrySettings = { ...state.settings[action.code], ...action.patch }
      for (const key of Object.keys(merged) as Array<keyof CountrySettings>) {
        if (merged[key] === undefined) delete merged[key]
      }
      const clean = sanitizeSettings(merged)
      const settings = { ...state.settings }
      if (clean) settings[action.code] = clean
      else delete settings[action.code]
      return { ...state, settings }
    }
    case 'resetSettings': {
      if (!state.settings[action.code]) return state
      const settings = { ...state.settings }
      delete settings[action.code]
      return { ...state, settings }
    }
    case 'setMode': {
      if (action.mode === state.mode) return state
      const anchor = action.anchor && isISODate(action.anchor) ? action.anchor : state.anchor
      return { ...state, mode: action.mode, anchor }
    }
    case 'setAnchor':
      return isISODate(action.anchor) ? { ...state, anchor: action.anchor } : state
    case 'addStep': {
      if (state.steps.length >= MAX_STEPS) return state
      const step = sanitizeStep(
        { name: `Step ${state.steps.length + 1}`, days: 5, calendar: state.base, ...action.step },
        state.steps.length,
        state.base,
        selectedCodes(state),
      )
      return { ...state, steps: [...state.steps, step] }
    }
    case 'updateStep': {
      const allowed = selectedCodes(state)
      return {
        ...state,
        steps: state.steps.map((s) => {
          if (s.id !== action.id) return s
          const next = { ...s, ...action.patch }
          if (action.patch.days !== undefined) next.days = normalizeStepDays(Number(action.patch.days))
          if (action.patch.name !== undefined) next.name = action.patch.name.slice(0, MAX_STEP_NAME_LENGTH)
          if (next.calendar !== CALENDAR_DAYS && !allowed.has(next.calendar)) next.calendar = s.calendar
          return next
        }),
      }
    }
    case 'removeStep':
      return { ...state, steps: state.steps.filter((s) => s.id !== action.id) }
    case 'moveStep': {
      const index = state.steps.findIndex((s) => s.id === action.id)
      if (index < 0) return state
      return { ...state, steps: moveItem(state.steps, index, action.direction) }
    }
    case 'setSteps': {
      const allowed = selectedCodes(state)
      return {
        ...state,
        steps: action.steps.slice(0, MAX_STEPS).map((s, i) => sanitizeStep(s, i, state.base, allowed)),
      }
    }
    case 'toggleOverride': {
      if (!isISODate(action.date)) return state
      const current = { ...state.overrides[action.country] }
      if (current[action.date]) delete current[action.date]
      else {
        const label = action.label?.trim().slice(0, MAX_LABEL_LENGTH)
        current[action.date] = {
          kind: action.defaultWorking ? 'off' : 'work',
          ...(label ? { label } : {}),
        }
      }
      const overrides = { ...state.overrides }
      if (Object.keys(current).length > 0) overrides[action.country] = current
      else delete overrides[action.country]
      return { ...state, overrides }
    }
    case 'setOverrides': {
      const current = { ...state.overrides[action.country] }
      for (const date of action.dates) {
        if (!isISODate(date)) continue
        if (action.override) {
          const label = action.override.label?.trim().slice(0, MAX_LABEL_LENGTH)
          current[date] = { kind: action.override.kind, ...(label ? { label } : {}) }
        } else {
          delete current[date]
        }
      }
      const overrides = { ...state.overrides }
      if (Object.keys(current).length > 0) overrides[action.country] = current
      else delete overrides[action.country]
      return { ...state, overrides }
    }
    case 'clearOverrides': {
      if (!action.country) return { ...state, overrides: {} }
      const overrides = { ...state.overrides }
      delete overrides[action.country]
      return { ...state, overrides }
    }
    case 'setTab':
      return isPlannerTab(action.tab) && action.tab !== state.tab ? { ...state, tab: action.tab } : state
    case 'setContainer':
      return isContainerId(action.container) && action.container !== state.container
        ? { ...state, container: action.container }
        : state
    case 'addCargo': {
      if (state.cargo.length >= MAX_CARGO_ITEMS) return state
      const colors = state.cargo.map((c) => c.color)
      const definition = { ...newCargoDefinition(state.cargo.length, nextCargoColor(colors)), ...action.cargo }
      return { ...state, cargo: [...state.cargo, sanitizeCargo(definition, state.cargo.length, colors)] }
    }
    case 'updateCargo': {
      const index = state.cargo.findIndex((c) => c.id === action.id)
      if (index < 0) return state
      const current = state.cargo[index]
      const next = sanitizeCargo({ ...current, ...action.patch, id: current.id }, index, [])
      // Keep the name exactly as typed (an empty field must stay empty while editing).
      next.name = (action.patch.name ?? current.name).slice(0, MAX_CARGO_NAME_LENGTH)
      const cargo = [...state.cargo]
      cargo[index] = next
      return { ...state, cargo }
    }
    case 'duplicateCargo': {
      if (state.cargo.length >= MAX_CARGO_ITEMS) return state
      const index = state.cargo.findIndex((c) => c.id === action.id)
      if (index < 0) return state
      const copy = { ...state.cargo[index], id: createId(), color: nextCargoColor(state.cargo.map((c) => c.color)) }
      const cargo = [...state.cargo]
      cargo.splice(index + 1, 0, copy)
      return { ...state, cargo }
    }
    case 'removeCargo':
      return { ...state, cargo: state.cargo.filter((c) => c.id !== action.id) }
    case 'setCargo':
      return { ...state, cargo: sanitizeCargoList(action.cargo) }
    case 'setCushioning': {
      const current = state.cushioning[action.category]
      const next = sanitizeCushion({ ...current, ...action.patch }, current)
      return { ...state, cushioning: { ...state.cushioning, [action.category]: next } }
    }
    case 'resetCushioning':
      return {
        ...state,
        cushioning: { ...state.cushioning, [action.category]: { ...DEFAULT_CUSHIONING[action.category] } },
      }
    case 'setQuote': {
      const merged = { ...state.quote, ...action.patch }
      // A new quote currency starts from its indicative rate unless a rate comes with it.
      if (action.patch.currency && action.patch.currency !== state.quote.currency && action.patch.fxRate === undefined) {
        merged.fxRate = isQuoteCurrency(action.patch.currency) ? CURRENCY_INFO[action.patch.currency].defaultRate : state.quote.fxRate
      }
      return { ...state, quote: sanitizeQuote(merged, state.quote) }
    }
    case 'resetQuote':
      return { ...state, quote: { ...DEFAULT_QUOTE } }
    case 'replace':
      return action.state
    default:
      return state
  }
}
