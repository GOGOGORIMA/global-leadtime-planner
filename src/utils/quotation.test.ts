import { describe, expect, it } from 'vitest'
import { getCountryCatalog } from '../data/countries'
import { DEFAULT_QUOTE, SAMPLE_CARGO, createDefaultState, instantiateCargo } from '../state/defaults'
import type { CargoItem, QuoteSettings } from '../types'
import {
  AIR_MIN_CHARGE_USD,
  DEDICATED_LANE_COUNTRIES,
  FREIGHT_ORIGIN,
  MARKET_FACTORS,
  baseFreightUsd,
  domesticTruckJpy,
  exportChargesJpy,
  freightRegion,
  getFreightLane,
  localChargesUsd,
  type FreightBasis,
} from './freightRates'
import {
  appliedRate,
  calculateIncoterms,
  chargeableWeight,
  convertFromJpy,
  revenueTons,
  type IncotermsInput,
} from './incotermsCalc'
import { buildQuotation, computeQuote, linkCargo, resolveDestination } from './quotation'

const TODAY = '2026-11-18'
const cushioning = createDefaultState(TODAY).cushioning
const sample = instantiateCargo(SAMPLE_CARGO)
const quote = (patch: Partial<QuoteSettings> = {}): QuoteSettings => ({ ...DEFAULT_QUOTE, ...patch })

const basis = (patch: Partial<FreightBasis>): FreightBasis => ({
  mode: 'fcl',
  container: '20dc',
  units: 1,
  revenueTons: 1,
  chargeableKg: 0,
  ...patch,
})

describe('freight rate tables', () => {
  it('maps every destination of the catalog to a freight region', () => {
    const missing = getCountryCatalog()
      .map((c) => c.code)
      .filter((code) => code !== FREIGHT_ORIGIN && !freightRegion(code))
    expect(missing).toEqual([])
    expect(freightRegion(FREIGHT_ORIGIN)).toBeUndefined()
  })

  it('has plausible dedicated lanes and region estimates', () => {
    expect(DEDICATED_LANE_COUNTRIES.length).toBeGreaterThanOrEqual(40)
    for (const code of DEDICATED_LANE_COUNTRIES) {
      const lane = getFreightLane(code)
      expect(lane.estimated, code).toBe(false)
      expect(lane.port, code).toBeTruthy()
      expect(freightRegion(code), code).toBe(lane.region)
      expect(lane.fcl40, code).toBeGreaterThan(lane.fcl20)
      expect(lane.fcl40hc, code).toBeGreaterThan(lane.fcl40)
      expect(lane.lcl, code).toBeGreaterThan(0)
      expect(lane.air, code).toBeGreaterThan(0)
    }
    expect(getFreightLane('TH')).toMatchObject({ port: 'Laem Chabang', fcl20: 350, fcl40: 650, fcl40hc: 700, estimated: false })
    // European lanes of the presets: Felixstowe / Southampton and Hamburg.
    expect(getFreightLane('GB')).toMatchObject({ port: 'Felixstowe / Southampton', region: 'europe', fcl20: 1600, fcl40: 2800, fcl40hc: 2900, lcl: 85, air: 4.8 })
    expect(getFreightLane('DE')).toMatchObject({ port: 'Hamburg', region: 'europe', fcl20: 1500, fcl40: 2600, fcl40hc: 2700, lcl: 80, air: 4.8 })
    // Cambodia has no dedicated lane → Southeast Asia estimate (dearer than Thailand).
    const kh = getFreightLane('KH')
    expect(kh).toMatchObject({ region: 'southeastAsia', estimated: true })
    expect(kh.port).toBeUndefined()
    expect(kh.fcl20).toBeGreaterThan(getFreightLane('TH').fcl20)
    // Long haul costs more than the neighbours.
    expect(getFreightLane('DE').fcl40).toBeGreaterThan(getFreightLane('KR').fcl40)
  })

  it('multiplies by the market level and rates each mode by its own unit', () => {
    expect(MARKET_FACTORS).toEqual({ normal: 1, peak: 1.5, surge: 2.5 })
    const th = getFreightLane('TH')
    expect(baseFreightUsd(th, basis({ container: '40dc', units: 2 }))).toMatchObject({ rate: 650, quantity: 2, amount: 1300 })
    expect(baseFreightUsd(th, basis({ container: '40hc', units: 2 }))).toMatchObject({ rate: 700, quantity: 2, amount: 1400 })
    expect(baseFreightUsd(th, basis({ mode: 'lcl', revenueTons: 4.5 })).amount).toBeCloseTo(135)
    expect(baseFreightUsd(th, basis({ mode: 'air', chargeableKg: 500 })).amount).toBeCloseTo(1400)
    // Air minimum charge for small shipments.
    expect(baseFreightUsd(th, basis({ mode: 'air', chargeableKg: 10 }))).toMatchObject({ minimum: true, amount: AIR_MIN_CHARGE_USD })
  })

  it('computes Japanese export charges and domestic truck freight', () => {
    expect(exportChargesJpy(basis({})).total).toBe(45000 + 35000 + 1800 + 11800 + 6000)
    expect(exportChargesJpy(basis({ container: '40dc', units: 2 })).total).toBe((64000 + 52000 + 1800) * 2 + 17800)
    // LCL: CFS / THC per revenue ton.
    const lcl = exportChargesJpy(basis({ mode: 'lcl', revenueTons: 15.504 }))
    expect(lcl.lines.map((l) => l.key)).toEqual(['cfs', 'customs', 'document'])
    expect(lcl.total).toBe(Math.round(6000 * 15.504) + 17800)
    // Air: handling per kg with a minimum, AWB instead of B/L.
    expect(exportChargesJpy(basis({ mode: 'air', chargeableKg: 1000 })).total).toBe(35000 + 11800 + 5000)
    expect(exportChargesJpy(basis({ mode: 'air', chargeableKg: 20 })).total).toBe(6000 + 11800 + 5000)
    expect(domesticTruckJpy('2t', 1)).toBe(35000)
    expect(domesticTruckJpy('4t', 2)).toBe(110000)
    expect(domesticTruckJpy('10t', 1)).toBe(95000)
  })

  it('presets destination charges per region', () => {
    expect(localChargesUsd('southeastAsia', basis({})).amount).toBe(400)
    expect(localChargesUsd('europe', basis({ container: '40hc', units: 2 })).amount).toBe(2500)
    expect(localChargesUsd('southeastAsia', basis({ mode: 'lcl', revenueTons: 2 })).amount).toBe(90 + 80)
    expect(localChargesUsd('northAmerica', basis({ mode: 'air', chargeableKg: 100 })).amount).toBeCloseTo(160 + 60)
  })
})

describe('Incoterms build-up', () => {
  it('derives revenue tons, chargeable weight and the applied FX rate', () => {
    expect(revenueTons(15.5, 3160)).toBe(15.5)
    expect(revenueTons(2, 4500)).toBe(4.5) // heavy cargo: weight tons
    expect(revenueTons(0.3, 120)).toBe(1) // at least 1.0 R/T
    expect(chargeableWeight(15.504, 3160)).toBe(3160)
    expect(chargeableWeight(10, 500)).toBe(1670) // volumetric 10 m³ × 167 kg
    expect(appliedRate(150, 3)).toBeCloseTo(145.5)
    expect(convertFromJpy(5_000_000, 145.5, 2)).toBe(34364.26)
    expect(convertFromJpy(1000, 0, 2)).toBe(0)
  })

  const input: IncotermsInput = {
    exw: 5_000_000,
    domestic: 55_000,
    exportCharges: 99_600,
    freight: 52_500,
    freightBuffer: 10,
    insuranceRate: 0.2,
    localCharges: 60_000,
    dutyRate: 5,
  }

  it('stacks EXW → FOB → CFR → CIF → DAP → DDP', () => {
    const r = calculateIncoterms(input)
    expect(r.fob).toBe(5_154_600)
    expect(r.freight).toBe(57_750) // 52,500 × 1.10
    expect(r.cfr).toBe(5_212_350)
    expect(r.cif).toBe(5_223_842) // 5,212,350 / (1 − 1.1 × 0.002)
    expect(r.insurance).toBe(11_492)
    expect(r.dap).toBe(5_283_842)
    expect(r.duty).toBe(261_192) // 5 % of CIF
    expect(r.ddp).toBe(5_545_034)
    expect(r.insuredValue).toBe(5_746_226)
  })

  it('solves the insurance circular reference and keeps every step consistent', () => {
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let n = 0; n < 200; n++) {
      const i = rand() * 5
      const r = calculateIncoterms({
        exw: Math.round(rand() * 1e9),
        domestic: Math.round(rand() * 2e5),
        exportCharges: Math.round(rand() * 3e5),
        freight: Math.round(rand() * 2e6),
        freightBuffer: rand() * 30,
        insuranceRate: i,
        localCharges: Math.round(rand() * 5e5),
        dutyRate: rand() * 30,
      })
      expect(r.exw <= r.fob && r.fob <= r.cfr && r.cfr <= r.cif && r.cif <= r.dap && r.dap <= r.ddp).toBe(true)
      // Insurance covers 110 % of the CIF price it is part of.
      expect(Math.abs(r.insurance - 1.1 * (i / 100) * r.cif)).toBeLessThanOrEqual(1)
      expect(r.fob - r.exw).toBe(r.fobCharges)
      expect(r.ddp).toBe(r.exw + r.fobCharges + r.freight + r.insurance + r.localCharges + r.duty)
    }
    const noInsurance = calculateIncoterms({ ...input, insuranceRate: 0 })
    expect(noInsurance.cif).toBe(noInsurance.cfr)
    expect(noInsurance.insurance).toBe(0)
  })
})

describe('quotation', () => {
  it('takes the cargo over from the loading simulator', () => {
    const link = linkCargo(sample, '20dc', cushioning)
    expect(link.pieces).toBe(31)
    expect(link.volume).toBeCloseTo(15.504)
    expect(link.weight).toBe(3160)
    expect(link.sea).toMatchObject({ units: 1, source: 'selected', unavailable: false })
    expect(link.sea.spec.id).toBe('20dc')
    // No truck selected → the road suggestion (3,160 kg needs the 3.5 t payload of a 4t truck).
    expect(link.truck.spec.id).toBe('4t')
    expect(link.truck).toMatchObject({ units: 1, source: 'suggested' })

    const truckSelected = linkCargo(sample, '4t', cushioning)
    expect(truckSelected.truck).toMatchObject({ units: 1, source: 'selected' })
    expect(truckSelected.sea.spec.id).toBe('20dc')
    expect(truckSelected.sea.source).toBe('suggested')
  })

  it('counts several containers and flags cargo that fits no standard size', () => {
    const many: CargoItem[] = [{ ...sample[1], quantity: 60 }]
    const link = linkCargo(many, '20dc', cushioning)
    expect(link.sea.spec.id).toBe('20dc')
    expect(link.sea.units).toBeGreaterThan(1)
    const huge: CargoItem[] = [{ ...sample[0], length: 13000 }]
    const blocked = linkCargo(huge, '40hc', cushioning)
    expect(blocked.sea).toMatchObject({ unavailable: true, units: 1 })
    expect(blocked.truck.unavailable).toBe(true)
    const empty = linkCargo([], '20dc', cushioning)
    expect(empty).toMatchObject({ pieces: 0, volume: 0, weight: 0 })
    expect(empty.sea.spec.id).toBe('20dc')
    expect(empty.truck).toMatchObject({ units: 1, source: 'default' })
  })

  it('prices the sample shipment in every Incoterm', () => {
    const q = buildQuotation(quote(), sample, '20dc', cushioning, 'TH', TODAY)
    expect(q.appliedRate).toBeCloseTo(145.5)
    expect(q.domestic).toEqual({ amount: 55_000, auto: 55_000, manual: false })
    expect(q.exportCharges.amount).toBe(99_600)
    expect(q.freight.amount).toBe(52_500) // US$350 × 150
    expect(q.local.amount).toBe(60_000) // US$400 × 150
    expect(q.prices.EXW).toEqual({ jpy: 5_000_000, quote: 34364.26 })
    expect(q.prices.FOB).toEqual({ jpy: 5_154_600, quote: 35426.8 })
    expect(q.prices.CIF).toEqual({ jpy: 5_223_842, quote: 35902.69 })
    expect(q.prices.DAP).toEqual({ jpy: 5_283_842, quote: 36315.07 })
    expect(q.prices.DDP).toEqual({ jpy: 5_545_034, quote: 38110.2 })
    expect(q.validUntil).toBe('2026-12-02')
    expect(q.validityDays).toBe(14)
  })

  it('applies overrides, market levels and the chargeable units of each mode', () => {
    const link = linkCargo(sample, '20dc', cushioning)
    const lcl = computeQuote(quote({ mode: 'lcl', volume: 4, weight: 6000 }), link, 'TH', TODAY)
    expect(lcl.revenueTons).toBe(6) // 6 t > 4 m³
    expect(lcl.volumeLinked).toBe(false)
    expect(lcl.freight.amount).toBe(30 * 6 * 150)
    const air = computeQuote(quote({ mode: 'air', market: 'surge' }), link, 'TH', TODAY)
    expect(air.chargeableKg).toBe(3160)
    expect(air.freight.amount).toBe(Math.round(2.8 * 3160 * 2.5 * 150))
    const fcl = computeQuote(quote({ container: { id: '40hc', units: 2 }, truck: { id: '10t', units: 2 } }), link, 'TH', TODAY)
    expect(fcl.container).toMatchObject({ units: 2, source: 'manual' })
    expect(fcl.freight.amount).toBe(700 * 2 * 150) // 40ft HQ rate
    expect(fcl.domestic.amount).toBe(190_000)
    // Overrides are used as entered: no market factor on a forwarder's actual quote.
    const usd = computeQuote(quote({ market: 'peak', freight: { amount: 500, currency: 'USD' } }), link, 'TH', TODAY)
    expect(usd.freight.amount).toBe(75_000)
    expect(usd.freight.autoJpy).toBe(Math.round(350 * 1.5 * 150))
    const jpy = computeQuote(quote({ freight: { amount: 80_000, currency: 'JPY' }, domestic: 0, exportCharges: 120_000 }), link, 'TH', TODAY)
    expect(jpy.incoterms.freightBase).toBe(80_000)
    expect(jpy.incoterms.fob).toBe(5_120_000)
  })

  it('converts at the applied rate of the quote currency', () => {
    const link = linkCargo(sample, '20dc', cushioning)
    const yen = computeQuote(quote({ currency: 'JPY', fxRate: 1 }), link, 'TH', TODAY)
    expect(yen.appliedRate).toBe(1)
    expect(yen.prices.DDP.quote).toBe(yen.prices.DDP.jpy)
    expect(yen.freight.amount).toBe(52_500) // USD freight still uses the USD rate
    const eur = computeQuote(quote({ currency: 'EUR', fxRate: 170, fxBuffer: 0, usdRate: 140 }), link, 'TH', TODAY)
    expect(eur.freight.amount).toBe(350 * 140)
    expect(eur.prices.EXW.quote).toBe(convertFromJpy(5_000_000, 170, 2))
    const explicit = computeQuote(quote({ validUntil: '2026-11-25' }), link, 'TH', TODAY)
    expect(explicit.validityDays).toBe(7)
  })

  it('resolves the destination without ever quoting to the origin', () => {
    expect(resolveDestination('DE', 'TH', ['TH'])).toBe('DE')
    expect(resolveDestination('', 'TH', ['KR', 'TH'])).toBe('TH')
    expect(resolveDestination('', 'JP', ['JP', 'VN'])).toBe('VN')
    expect(resolveDestination('', 'JP', [])).toBe('US')
  })
})
