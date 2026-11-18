import { describe, expect, it } from 'vitest'
import { createDefaultState } from '../state/defaults'
import { plannerReducer } from '../state/plannerReducer'
import { CALENDAR_DAYS, type PlannerState } from '../types'
import { parseState, readTabParam, serializeState } from './urlState'

const fallback = createDefaultState('2026-11-17')

const withoutIds = (state: PlannerState) => ({
  ...state,
  steps: state.steps.map(({ id: _id, ...rest }) => rest),
  cargo: state.cargo.map(({ id: _id, ...rest }) => rest),
})

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
    tab: 'calendar',
    container: '40hc',
    cargo: [
      {
        id: 'x',
        name: 'Case #1 本体木箱_v2 (No.1)',
        length: 2200,
        width: 1500,
        height: 2400,
        weight: 1250.5,
        quantity: 1,
        stackable: false,
        rotatable: false,
        color: '#ef4444',
        margin: 80,
      },
      {
        id: 'y',
        name: 'Accessories pallet',
        length: 1100,
        width: 1100,
        height: 1000,
        weight: 300,
        quantity: 6,
        stackable: true,
        rotatable: true,
        color: '#f59e0b',
        margin: 0,
      },
    ],
    cushioning: {
      sea: { gap: 0, wall: 0, stack: false, stackGap: 20 },
      truck: { gap: 100, wall: 20, stack: true, stackGap: 15 },
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
    expect(params.get('tab')).toBe('calendar')
    expect(params.get('ct')).toBe('40hc')
    expect(params.getAll('cg')).toEqual([
      '2200x1500x2400_1250.5_1_m80_ef4444_Case #1 本体木箱_v2 (No.1)',
      '1100x1100x1000_300_6_sr_f59e0b_Accessories pallet',
    ])
    // Only modes that differ from their defaults are written.
    expect(params.getAll('cl')).toEqual(['truck.100.20.15.v'])
  })

  it('reads cushioning per transport mode and clamps it', () => {
    const parsed = parseState('?ct=4t&cl=sea.30.20.10.v&cl=truck.900.-5.99.h&cl=air.1.1.1.v', fallback).state
    expect(parsed.cushioning).toEqual({
      sea: { gap: 30, wall: 20, stack: true, stackGap: 10 },
      truck: { gap: 500, wall: 0, stack: false, stackGap: 50 }, // gap/wall ≤ 500 mm, tiers ≤ 50 mm
    })
    // Without `cl` the defaults apply: containers 0 mm, trucks 50 mm between pieces / 30 mm to the walls.
    expect(parseState('?ct=4t', fallback).state.cushioning).toEqual({
      sea: { gap: 0, wall: 0, stack: false, stackGap: 20 },
      truck: { gap: 50, wall: 30, stack: false, stackGap: 20 },
    })
    // Links from before the per-cargo margin still parse (no `m` flag → 0 mm).
    expect(parseState('?cg=1100x1100x1000_300_6_sr_f59e0b_Pallet', fallback).state.cargo[0].margin).toBe(0)
  })

  it('keeps an empty cargo list and drops malformed cargo rows', () => {
    const empty = parseState(`?${serializeState({ ...state, cargo: [] })}`, fallback)
    expect(empty.state.cargo).toEqual([])
    const parsed = parseState(
      '?ct=xl&cg=10x20_5_1_s_ffffff_Bad+dims&cg=0x50000x300_-7_5000_r_zzz_&cg=600x400x400_15.25_24_sr_10B981_Carton',
      fallback,
    ).state
    expect(parsed.container).toBe(fallback.container) // unknown container id → default
    expect(parsed.cargo.map(({ id: _id, ...rest }) => rest)).toEqual([
      // clamped to 1–20,000 mm, 0 kg, 999 pcs; default name and a palette color
      { name: 'Case #1', length: 1, width: 20000, height: 300, weight: 0, quantity: 999, stackable: false, rotatable: true, color: '#6366f1', margin: 0 },
      { name: 'Carton', length: 600, width: 400, height: 400, weight: 15.3, quantity: 24, stackable: true, rotatable: true, color: '#10b981', margin: 0 },
    ])
    // A link without cargo parameters keeps the default sample shipment.
    expect(parseState('?base=JP', fallback).state.cargo.length).toBe(fallback.cargo.length)
  })

  it('reads and validates the tab parameter', () => {
    expect(readTabParam('?tab=export')).toBe('export')
    expect(readTabParam('tab=schedule&base=JP')).toBe('schedule')
    expect(readTabParam('?tab=admin')).toBeUndefined()
    expect(parseState('?base=JP&tab=nope', fallback).state.tab).toBe('meeting')
    expect(plannerReducer(fallback, { type: 'setTab', tab: 'calendar' }).tab).toBe('calendar')
    expect(readTabParam('?tab=vanning')).toBe('vanning')
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

  it('edits the cargo list and the container', () => {
    let s = plannerReducer(fallback, { type: 'setContainer', container: '4t' })
    expect(s.container).toBe('4t')
    s = plannerReducer(s, { type: 'setCargo', cargo: [] })
    s = plannerReducer(s, { type: 'addCargo' })
    s = plannerReducer(s, { type: 'addCargo', cargo: { name: 'Euro pallet', length: 1200, width: 800 } })
    expect(s.cargo.map((c) => [c.name, c.length, c.width, c.color])).toEqual([
      ['Case #1', 1100, 1100, '#6366f1'],
      ['Euro pallet', 1200, 800, '#f59e0b'],
    ])
    const id = s.cargo[1].id
    s = plannerReducer(s, { type: 'updateCargo', id, patch: { quantity: 0, weight: 12.345, name: '' } })
    expect(s.cargo[1]).toMatchObject({ quantity: 1, weight: 12.3, name: '' }) // name stays empty while typing
    s = plannerReducer(s, { type: 'duplicateCargo', id })
    expect(s.cargo).toHaveLength(3)
    expect(s.cargo[2]).toMatchObject({ length: 1200, width: 800, color: '#10b981' })
    expect(s.cargo[2].id).not.toBe(id)
    s = plannerReducer(s, { type: 'removeCargo', id })
    expect(s.cargo.map((c) => c.color)).toEqual(['#6366f1', '#10b981'])
    s = plannerReducer(s, { type: 'updateCargo', id: s.cargo[0].id, patch: { margin: 1200 } })
    expect(s.cargo[0].margin).toBe(500)
  })

  it('keeps cushioning per transport mode', () => {
    expect(fallback.cushioning.truck).toEqual({ gap: 50, wall: 30, stack: false, stackGap: 20 })
    let s = plannerReducer(fallback, { type: 'setCushioning', category: 'truck', patch: { gap: 0, stack: true, stackGap: 80 } })
    expect(s.cushioning.truck).toEqual({ gap: 0, wall: 30, stack: true, stackGap: 50 })
    expect(s.cushioning.sea).toEqual(fallback.cushioning.sea)
    s = plannerReducer(s, { type: 'resetCushioning', category: 'truck' })
    expect(s.cushioning.truck).toEqual({ gap: 50, wall: 30, stack: false, stackGap: 20 })
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
