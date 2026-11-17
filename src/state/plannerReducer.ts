import { isKnownCountry } from '../data/countries'
import { CALENDAR_DAYS, type CountrySettings, type DayOverride, type PlannerState, type Step } from '../types'
import { isISODate, normalizeStepDays, type ISODate, type ScheduleMode } from '../utils/dateCalc'
import { isValidTimeZone } from '../utils/timezone'
import { MAX_PARTNERS, MAX_STEPS, createId, type StepDefinition } from './defaults'

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
  | { type: 'replace'; state: PlannerState }

const MAX_LABEL_LENGTH = 80
const MAX_STEP_NAME_LENGTH = 80

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
    case 'replace':
      return action.state
    default:
      return state
  }
}
