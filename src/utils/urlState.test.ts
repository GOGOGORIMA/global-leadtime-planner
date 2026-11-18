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
    quote: {
      cargoMode: 'simple',
      sizeUnit: 'mm',
      items: [
        { length: 1200, width: 1000, height: 1100, quantity: 4, weight: 420.5 },
        { length: 600, width: 400, height: 300, quantity: 12, weight: 18 },
      ],
      allowance: 'crate',
      volume: 12.345,
      weight: 2500.5,
      packingCost: false,
      packingRate: 18000,
      exw: 12_345_678,
      currency: 'EUR',
      fxRate: 171.25,
      fxBuffer: 4.5,
      usdRate: 148.5,
      domestic: 60000,
      exportCharges: null,
      mode: 'lcl',
      destination: 'DE',
      market: 'peak',
      freight: { amount: 1850.5, currency: 'USD' },
      freightBuffer: 15,
      insuranceRate: 0.25,
      local: { amount: 98000, currency: 'JPY' },
      dutyRate: 2.7,
      validUntil: '2026-12-15',
      container: { id: '40hc', units: 2 },
      truck: { id: '10t', units: 1 },
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
    // Quotation board: only settings that differ from the defaults.
    const quoteParams = Object.fromEntries([...params].filter(([key]) => key.startsWith('q') && key !== 'qi'))
    expect(params.getAll('qi')).toEqual(['1200x1000x1100_4_420.5', '600x400x300_12_18'])
    expect(quoteParams).toEqual({
      qsu: 'mm',
      qal: 'crate',
      qv: '12.345',
      qw: '2500.5',
      qpc: '0',
      qpr: '18000',
      qx: '12345678',
      qcur: 'EUR',
      qfx: '171.25',
      qfb: '4.5',
      qusd: '148.5',
      qdom: '60000',
      qm: 'lcl',
      qdst: 'DE',
      qmk: 'peak',
      qfr: '1850.5USD',
      qcb: '15',
      qins: '0.25',
      qloc: '98000JPY',
      qduty: '2.7',
      qval: '2026-12-15',
      qct: '40hc.2',
      qtr: '10t.1',
    })
  })

  it('writes no quotation keys for the defaults and sanitizes quotation input', () => {
    expect([...new URLSearchParams(serializeState(fallback)).keys()].filter((k) => k.startsWith('q'))).toEqual([])
    const q = parseState(
      '?qx=-5&qcur=xyz&qfx=0&qfb=25&qusd=abc&qdom=1e12&qexp=-1&qm=ship&qdst=JP&qmk=crazy&qfr=12EUR' +
        '&qcb=55&qins=9&qloc=-5USD&qduty=45&qval=2026-02-30&qv=-3&qw=nope&qct=2t.3&qtr=40hc.1' +
        '&qcm=bogus&qsu=inch&qi=0x99999x5_0_200000&qi=bad&qal=foam&qpc=maybe&qpr=-10',
      fallback,
    ).state.quote
    expect(q).toEqual({
      ...fallback.quote,
      exw: 0,
      fxBuffer: 10,
      domestic: 1_000_000_000,
      exportCharges: 0,
      freightBuffer: 30,
      insuranceRate: 5,
      dutyRate: 30,
      volume: 0,
      // Rows are clamped (cm: 0.1–2,000, 1–999 pieces, ≤ 100,000 kg); malformed rows are dropped.
      items: [{ length: 0.1, width: 2000, height: 5, quantity: 1, weight: 100000 }],
      packingRate: 0,
    })
    // No rows → the default row in the chosen unit; the direct-entry defaults when absent.
    expect(parseState('?qsu=mm', fallback).state.quote.items).toEqual([{ length: 1100, width: 1100, height: 1000, quantity: 6, weight: 300 }])
    expect(parseState('?qcm=direct', fallback).state.quote).toMatchObject({ cargoMode: 'direct', volume: 8.5, weight: 2400, mode: 'auto' })
    // A new currency starts from its indicative rate; JPY quotes always use 1.
    expect(parseState('?qcur=EUR', fallback).state.quote).toMatchObject({ currency: 'EUR', fxRate: 172 })
    expect(parseState('?qcur=jpy&qfx=150', fallback).state.quote).toMatchObject({ currency: 'JPY', fxRate: 1 })
    // Unknown / origin destinations fall back to automatic; units are clamped to 1–99.
    expect(parseState('?qdst=ZZ&qct=40dc.500&qtr=4t.0', fallback).state.quote).toMatchObject({
      destination: '',
      container: { id: '40dc', units: 99 },
      truck: { id: '4t', units: 1 },
    })
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

  it('starts with Japan and the six preset partner countries', () => {
    expect(fallback.base).toBe('JP')
    expect(fallback.partners).toEqual(['KR', 'CN', 'US', 'GB', 'DE', 'IN'])
    // The local-delivery step of the default template uses the first partner's business days.
    expect(fallback.steps.map((s) => s.calendar)).toEqual(['JP', CALENDAR_DAYS, 'KR'])
  })

  it('keeps the reducer and URL in sync for typical edits', () => {
    let next = plannerReducer(fallback, { type: 'removePartner', code: 'KR' })
    // The step that used Korean business days falls back to the base calendar.
    expect(next.steps[2].calendar).toBe('JP')
    next = plannerReducer(next, { type: 'toggleOverride', country: 'JP', date: '2026-12-28', defaultWorking: true })
    next = plannerReducer(next, { type: 'setBase', code: 'DE' })
    expect(next.base).toBe('DE')
    expect(next.partners[0]).toBe('JP')
    expect(next.partners).not.toContain('DE')
    const parsed = parseState(serializeState(next), fallback)
    expect(withoutIds(parsed.state)).toEqual(withoutIds(next))
  })
})

describe('plannerReducer', () => {
  it('edits the quotation settings', () => {
    let next = plannerReducer(fallback, { type: 'setQuote', patch: { currency: 'THB' } })
    expect(next.quote).toMatchObject({ currency: 'THB', fxRate: 4.6 }) // indicative THB rate
    next = plannerReducer(next, { type: 'setQuote', patch: { currency: 'USD', fxRate: 152.35 } })
    expect(next.quote.fxRate).toBe(152.35)
    next = plannerReducer(next, { type: 'setQuote', patch: { dutyRate: 40, destination: 'JP', freight: { amount: 900, currency: 'USD' } } })
    expect(next.quote).toMatchObject({ dutyRate: 30, destination: '', freight: { amount: 900, currency: 'USD' } })
    next = plannerReducer(next, { type: 'setQuote', patch: { freight: null, container: { id: '4t', units: 2 } } })
    expect(next.quote.freight).toBeNull()
    expect(next.quote.container).toBeNull() // trucks are not FCL containers
    // cm ⇄ mm converts the size calculator rows (the volume stays the same).
    next = plannerReducer(next, { type: 'setQuote', patch: { sizeUnit: 'mm' } })
    expect(next.quote.items).toEqual([{ length: 1100, width: 1100, height: 1000, quantity: 6, weight: 300 }])
    next = plannerReducer(next, { type: 'setQuote', patch: { sizeUnit: 'cm', allowance: 'carton', mode: 'air', packingCost: false } })
    expect(next.quote).toMatchObject({ sizeUnit: 'cm', allowance: 'carton', mode: 'air', packingCost: false })
    expect(next.quote.items[0]).toMatchObject({ length: 110, width: 110, height: 100 })
    next = plannerReducer(next, { type: 'setQuote', patch: { items: [] } })
    expect(next.quote.items).toHaveLength(1) // at least one row
    expect(plannerReducer(next, { type: 'resetQuote' }).quote).toEqual(fallback.quote)
  })

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
