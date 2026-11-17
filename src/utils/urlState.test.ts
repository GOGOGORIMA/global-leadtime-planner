import { describe, expect, it } from 'vitest'
import { createDefaultState } from '../state/defaults'
import { plannerReducer } from '../state/plannerReducer'
import { CALENDAR_DAYS, type PlannerState } from '../types'
import { parseState, serializeState } from './urlState'

const fallback = createDefaultState('2026-11-17')

const withoutIds = (state: PlannerState) => ({ ...state, steps: state.steps.map(({ id: _id, ...rest }) => rest) })

describe('URL state', () => {
  const state: PlannerState = {
    base: 'JP',
    partners: ['TH', 'US', 'MY'],
    settings: {
      US: { timeZone: 'America/Los_Angeles' },
      MY: { weekend: [5, 6], region: '03' },
      JP: { workStart: 510, workEnd: 1050 },
      TH: { weekend: [] },
    },
    mode: 'forward',
    anchor: '2026-12-01',
    steps: [
      { id: 'a', name: 'Production & Packing. Phase 1', days: 12, calendar: 'JP' },
      { id: 'b', name: 'Ocean Freight', days: 18, calendar: CALENDAR_DAYS },
      { id: 'c', name: 'Delivery: final mile', days: 2, calendar: 'TH' },
    ],
    overrides: {
      TH: {
        '2027-02-16': { kind: 'off', label: 'Chinese New Year: shutdown' },
        '2027-02-17': { kind: 'off', label: 'Chinese New Year: shutdown' },
        '2027-02-18': { kind: 'off', label: 'Chinese New Year: shutdown' },
        '2027-02-20': { kind: 'off' },
      },
      JP: { '2026-12-26': { kind: 'work' } },
    },
  }

  it('round-trips the full planner state', () => {
    const query = serializeState(state)
    const parsed = parseState(`?${query}`, fallback)
    expect(parsed.recognized).toBe(true)
    expect(withoutIds(parsed.state)).toEqual(withoutIds(state))
  })

  it('writes compact, readable parameters', () => {
    const params = new URLSearchParams(serializeState(state))
    expect(params.get('base')).toBe('JP')
    expect(params.get('c')).toBe('TH,US,MY')
    expect(params.get('mode')).toBe('fwd')
    expect(params.getAll('s')).toEqual([
      '12.JP.Production & Packing. Phase 1',
      '18.cal.Ocean Freight',
      '2.TH.Delivery: final mile',
    ])
    expect(params.getAll('off')).toEqual(['TH:2027-02-16..2027-02-18:Chinese New Year: shutdown', 'TH:2027-02-20'])
    expect(params.getAll('work')).toEqual(['JP:2026-12-26'])
    expect(params.getAll('wk')).toEqual(['TH:-', 'MY:56'])
    expect(params.getAll('hr')).toEqual(['JP:0830-1730'])
  })

  it('ignores queries without planner state', () => {
    expect(parseState('?utm_source=mail', fallback)).toEqual({ recognized: false, state: fallback })
    expect(parseState('', fallback).recognized).toBe(false)
  })

  it('sanitizes malformed or hostile input', () => {
    const parsed = parseState(
      '?base=XX&c=th,ZZ,TH,JP&mode=sideways&d=2026-02-30&s=0.JP.Too+short&s=5000.cal.Too+long&s=3.DE.Unknown+calendar&s=garbage' +
        '&tz=TH:Mars/Base&hr=TH:1800-0900&off=TH:2026-12-31..2026-12-01&off=TH:2027-01-05:Ok&work=QQ:2026-01-01',
      fallback,
    )
    const s = parsed.state
    expect(s.base).toBe('JP') // unknown base → fallback
    expect(s.partners).toEqual(['TH']) // de-duplicated, unknown + base removed
    expect(s.mode).toBe(fallback.mode)
    expect(s.anchor).toBe(fallback.anchor)
    expect(s.steps.map((st) => [st.days, st.calendar])).toEqual([
      [1, 'JP'],
      [999, CALENDAR_DAYS],
      [3, 'JP'], // DE is not selected → base calendar
    ])
    expect(s.settings).toEqual({})
    expect(s.overrides).toEqual({ TH: { '2027-01-05': { kind: 'off', label: 'Ok' } } })
  })

  it('keeps the reducer and URL in sync for typical edits', () => {
    let next = plannerReducer(fallback, { type: 'removePartner', code: 'TH' })
    // The step that used Thai business days falls back to the base calendar.
    expect(next.steps[2].calendar).toBe('JP')
    next = plannerReducer(next, { type: 'toggleOverride', country: 'JP', date: '2026-12-28', defaultWorking: true })
    next = plannerReducer(next, { type: 'setBase', code: 'KR' })
    expect(next.base).toBe('KR')
    expect(next.partners[0]).toBe('JP')
    expect(next.partners).not.toContain('KR')
    const parsed = parseState(serializeState(next), fallback)
    expect(withoutIds(parsed.state)).toEqual(withoutIds(next))
  })
})

describe('plannerReducer', () => {
  it('toggles overrides on and off', () => {
    const on = plannerReducer(fallback, { type: 'toggleOverride', country: 'TH', date: '2026-12-08', defaultWorking: true })
    expect(on.overrides.TH['2026-12-08']).toEqual({ kind: 'off' })
    const weekendShift = plannerReducer(on, { type: 'toggleOverride', country: 'TH', date: '2026-12-12', defaultWorking: false })
    expect(weekendShift.overrides.TH['2026-12-12']).toEqual({ kind: 'work' })
    const off = plannerReducer(on, { type: 'toggleOverride', country: 'TH', date: '2026-12-08', defaultWorking: true })
    expect(off.overrides.TH).toBeUndefined()
  })

  it('merges and clears country settings', () => {
    let s = plannerReducer(fallback, { type: 'updateSettings', code: 'US', patch: { timeZone: 'America/Chicago' } })
    s = plannerReducer(s, { type: 'updateSettings', code: 'US', patch: { weekend: [0] } })
    expect(s.settings.US).toEqual({ timeZone: 'America/Chicago', weekend: [0] })
    s = plannerReducer(s, { type: 'updateSettings', code: 'US', patch: { timeZone: undefined, weekend: undefined } })
    expect(s.settings.US).toBeUndefined()
  })

  it('adds, moves, updates and removes steps', () => {
    let s = plannerReducer(fallback, { type: 'addStep' })
    expect(s.steps).toHaveLength(4)
    const added = s.steps[3]
    s = plannerReducer(s, { type: 'moveStep', id: added.id, direction: -1 })
    expect(s.steps[2].id).toBe(added.id)
    s = plannerReducer(s, { type: 'updateStep', id: added.id, patch: { days: 0, calendar: 'ZZ' } })
    expect(s.steps[2]).toMatchObject({ days: 1, calendar: 'JP' })
    s = plannerReducer(s, { type: 'removeStep', id: added.id })
    expect(s.steps).toHaveLength(3)
  })
})
