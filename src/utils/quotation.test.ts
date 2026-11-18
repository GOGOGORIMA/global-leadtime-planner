import { describe, expect, it } from 'vitest'
import { getCountryCatalog } from '../data/countries'
import { DEFAULT_QUOTE, SAMPLE_CARGO, createDefaultState, defaultQuoteRows, instantiateCargo } from '../state/defaults'
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
  chargedRevenueTons,
  convertFromJpy,
  estimateFromSizes,
  packingCostJpy,
  recommendContainer,
  recommendShipment,
  recommendTruck,
  revenueTons,
  type IncotermsInput,
} from './incotermsCalc'
import { buildQuotation, computeQuote, linkCargo, resolveDestination } from './quotation'

const TODAY = '2026-11-18'
const cushioning = createDefaultState(TODAY).cushioning
const sample = instantiateCargo(SAMPLE_CARGO)
const quote = (patch: Partial<QuoteSettings> = {}): QuoteSettings => ({ ...DEFAULT_QUOTE, items: defaultQuoteRows('cm'), ...patch })
const direct = (volume: number, weight: number, patch: Partial<QuoteSettings> = {}) => quote({ cargoMode: 'direct', volume, weight, ...patch })
const priced = (settings: QuoteSettings, destination = 'KR') => buildQuotation(settings, sample, '20dc', cushioning, destination, TODAY)

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

describe('estimated volume (概算M3) and the automatic choices', () => {
  it('computes the estimated gross M3 from sizes and the packing allowance', () => {
    const rows = [{ length: 110, width: 110, height: 100, quantity: 6, weight: 300 }]
    expect(estimateFromSizes(rows, 'cm', 'none')).toEqual({ netVolume: 7.26, factor: 1, volume: 7.26, weight: 1800, pieces: 6 })
    const mm = estimateFromSizes([{ length: 1100, width: 1100, height: 1000, quantity: 6, weight: 300 }], 'mm', 'carton')
    expect(mm.netVolume).toBeCloseTo(7.26)
    expect(mm.volume).toBeCloseTo(7.26 * 1.15) // 段ボール・パレット +15 %
    const crate = estimateFromSizes([...rows, { length: 50, width: 40, height: 30, quantity: 10, weight: 8 }], 'cm', 'crate')
    expect(crate.netVolume).toBeCloseTo(7.26 + 0.6)
    expect(crate.volume).toBeCloseTo((7.26 + 0.6) * 1.25) // 輸出木箱 +25 %
    expect(crate).toMatchObject({ weight: 1880, pieces: 16 }) // weight is not inflated
  })

  it('rounds revenue tons up to two decimals and bills LCL for at least 1 R/T', () => {
    expect(revenueTons(15.504, 3160)).toBe(15.51)
    expect(revenueTons(15.5, 3160)).toBe(15.5)
    expect(revenueTons(2, 4500)).toBe(4.5) // heavy cargo: weight tons
    expect(revenueTons(0.3, 120)).toBe(0.3)
    expect(chargedRevenueTons(0.3)).toBe(1)
    expect(chargeableWeight(15.504, 3160)).toBe(3160)
    expect(chargeableWeight(10, 500)).toBe(1670) // volumetric 10 m³ × 167 kg
  })

  it('recommends LCL up to 14 m³, then 20ft, 40ft and 40ft HQ by volume (and payload)', () => {
    expect(recommendShipment(14, 3000)).toEqual({ mode: 'lcl' })
    expect(recommendShipment(14.01, 3000)).toEqual({ mode: 'fcl', plan: { id: '20dc', units: 1 } })
    expect(recommendContainer(28, 8000)).toEqual({ id: '20dc', units: 1 })
    expect(recommendContainer(28.01, 8000)).toEqual({ id: '40dc', units: 1 })
    expect(recommendContainer(58, 20000)).toEqual({ id: '40dc', units: 1 })
    expect(recommendContainer(58.01, 20000)).toEqual({ id: '40hc', units: 1 })
    expect(recommendContainer(66, 20000)).toEqual({ id: '40hc', units: 1 })
    expect(recommendContainer(66.01, 20000)).toEqual({ id: '40hc', units: 2 })
    expect(recommendContainer(140, 30000)).toEqual({ id: '40hc', units: 3 })
    // Heavy cargo needs more boxes than its volume suggests.
    expect(recommendContainer(20, 30000)).toEqual({ id: '20dc', units: 2 })
    expect(recommendContainer(40, 60000)).toEqual({ id: '40dc', units: 3 })
  })

  it('picks the smallest truck for the load, else several 10t trucks', () => {
    expect(recommendTruck(12, 2000)).toEqual({ id: '2t', units: 1 })
    expect(recommendTruck(12.01, 1000)).toEqual({ id: '4t', units: 1 })
    expect(recommendTruck(5, 2100)).toEqual({ id: '4t', units: 1 })
    expect(recommendTruck(25, 3500)).toEqual({ id: '4t', units: 1 })
    expect(recommendTruck(26, 3000)).toEqual({ id: '10t', units: 1 })
    expect(recommendTruck(45, 13000)).toEqual({ id: '10t', units: 1 })
    expect(recommendTruck(46, 1000)).toEqual({ id: '10t', units: 2 })
    expect(recommendTruck(20, 14000)).toEqual({ id: '10t', units: 2 })
    expect(packingCostJpy(7.26, 15000)).toBe(108900)
  })
})

describe('Incoterms build-up', () => {
  it('derives the applied FX rate and converts prices', () => {
    expect(appliedRate(150, 3)).toBeCloseTo(145.5)
    expect(convertFromJpy(5_000_000, 145.5, 2)).toBe(34364.26)
    expect(convertFromJpy(1000, 0, 2)).toBe(0)
  })

  const input: IncotermsInput = {
    base: 5_000_000,
    packing: 0,
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
    expect(r.exw).toBe(5_000_000)
    expect(r.fob).toBe(5_154_600)
    expect(r.freight).toBe(57_750) // 52,500 × 1.10
    expect(r.cfr).toBe(5_212_350)
    expect(r.cif).toBe(5_223_842) // 5,212,350 / (1 − 1.1 × 0.002)
    expect(r.insurance).toBe(11_492)
    expect(r.dap).toBe(5_283_842)
    expect(r.duty).toBe(261_192) // 5 % of CIF
    expect(r.ddp).toBe(5_545_034)
    expect(r.insuredValue).toBe(5_746_226)
    // Export packing is part of EXW.
    const packed = calculateIncoterms({ ...input, packing: 108_900 })
    expect(packed).toMatchObject({ base: 5_000_000, packing: 108_900, exw: 5_108_900, fob: 5_263_500 })
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
        base: Math.round(rand() * 1e9),
        packing: Math.round(rand() * 1e6),
        domestic: Math.round(rand() * 2e5),
        exportCharges: Math.round(rand() * 3e5),
        freight: Math.round(rand() * 2e6),
        freightBuffer: rand() * 30,
        insuranceRate: i,
        localCharges: Math.round(rand() * 5e5),
        dutyRate: rand() * 30,
      })
      expect(r.base <= r.exw && r.exw <= r.fob && r.fob <= r.cfr && r.cfr <= r.cif && r.cif <= r.dap && r.dap <= r.ddp).toBe(true)
      // Insurance covers 110 % of the CIF price it is part of.
      expect(Math.abs(r.insurance - 1.1 * (i / 100) * r.cif)).toBeLessThanOrEqual(1)
      expect(r.fob - r.exw).toBe(r.fobCharges)
      expect(r.ddp).toBe(r.base + r.packing + r.fobCharges + r.freight + r.insurance + r.localCharges + r.duty)
    }
    const noInsurance = calculateIncoterms({ ...input, insuranceRate: 0 })
    expect(noInsurance.cif).toBe(noInsurance.cfr)
    expect(noInsurance.insurance).toBe(0)
  })
})

describe('quotation', () => {
  it('prices the default size calculator row (7.26 m³ → LCL) with export packing', () => {
    const q = priced(quote())
    expect(q.cargo).toMatchObject({ source: 'simple', volume: 7.26, weight: 1800, pieces: 6 })
    expect(q).toMatchObject({ revenueTons: 7.26, mode: 'lcl', modeSetting: 'auto', fclSuggestion: null })
    expect(q.recommended.mode).toBe('lcl')
    expect(q.truck).toMatchObject({ units: 1, source: 'estimated' })
    expect(q.truck.spec.id).toBe('2t')
    expect(q.packing).toEqual({ amount: 108_900, rate: 15_000, enabled: true })
    expect(q.domestic.amount).toBe(35_000)
    expect(q.exportCharges.amount).toBe(Math.round(6000 * 7.26) + 17_800) // R/T × CFS + base fees
    expect(q.freight.amount).toBe(Math.round(15 * 7.26 * 150)) // Korea LCL US$15 / R/T
    expect(q.local.amount).toBe(Math.round((90 + 40 * 7.26) * 150))
    expect(q.prices.EXW).toEqual({ jpy: 5_108_900, quote: 35112.71 })
    expect(q.prices.FOB).toEqual({ jpy: 5_205_260, quote: 35774.98 })
    expect(q.prices.CIF).toEqual({ jpy: 5_234_745, quote: 35977.63 })
    expect(q.prices.DAP).toEqual({ jpy: 5_291_805, quote: 36369.79 })
    expect(q.prices.DDP).toEqual({ jpy: 5_553_542, quote: 38168.67 })
    expect(q.validUntil).toBe('2026-12-02')
    expect(q.validityDays).toBe(14)
    // Packing off: EXW is the base price.
    expect(priced(quote({ packingCost: false })).prices.EXW.jpy).toBe(5_000_000)
  })

  it('chooses LCL / 20ft / 40ft / 40ft HQ and the trucks from the estimated volume', () => {
    const fcl20 = priced(direct(20, 4000))
    expect([fcl20.mode, fcl20.container.spec.id, fcl20.container.units, fcl20.truck.spec.id]).toEqual(['fcl', '20dc', 1, '10t'])
    expect(fcl20.freight.amount).toBe(200 * 150)
    const fcl40 = priced(direct(40, 9000))
    expect([fcl40.container.spec.id, fcl40.container.units]).toEqual(['40dc', 1])
    const hq = priced(direct(100, 20000))
    expect([hq.container.spec.id, hq.container.units, hq.truck.spec.id, hq.truck.units]).toEqual(['40hc', 2, '10t', 3])
    expect(hq.packing.amount).toBe(1_500_000)
    // A forced mode overrides the recommendation: 20 m³ as LCL is billed per R/T.
    const lcl = priced(direct(20, 4000, { mode: 'lcl' }))
    expect([lcl.mode, lcl.recommended.mode, lcl.chargedRevenueTons]).toEqual(['lcl', 'fcl', 20])
  })

  it('suggests a 20ft FCL once LCL costs more (freight + port charges)', () => {
    const q = priced(direct(13, 2000))
    expect(q.mode).toBe('lcl')
    expect(q.fclSuggestion).toMatchObject({ fclTotal: 186_600, lclTotal: 216_550 })
    expect(q.fclSuggestion?.container.spec.id).toBe('20dc')
    expect(priced(direct(13, 2000, { mode: 'fcl' })).fclSuggestion).toBeNull()
    expect(priced(direct(5, 1000)).fclSuggestion).toBeNull()
    // Long haul: 20ft to Germany stays dearer than 10 m³ of LCL.
    expect(priced(direct(10, 2000), 'DE').fclSuggestion).toBeNull()
  })

  it('takes the volume, weight and packing plans over from the loading simulator', () => {
    const link = linkCargo(sample, '20dc', cushioning)
    expect(link).toMatchObject({ pieces: 31, weight: 3160 })
    expect(link.volume).toBeCloseTo(15.504)
    expect(link.sea).toMatchObject({ units: 1, source: 'selected' })
    expect(link.truck?.spec.id).toBe('4t')
    expect(linkCargo(sample, '20dc', cushioning, false)).toMatchObject({ sea: null, truck: null })

    const q = priced(quote({ cargoMode: 'vanning', packingCost: false }), 'TH')
    expect(q).toMatchObject({ revenueTons: 15.51, mode: 'fcl' })
    expect(q.container).toMatchObject({ units: 1, source: 'selected' })
    expect(q.truck.source).toBe('suggested')
    // Same shipment as before the 概算M3 block: FCL 20ft to Thailand without packing.
    expect(q.prices.FOB.jpy).toBe(5_154_600)
    expect(q.prices.DDP).toEqual({ jpy: 5_545_034, quote: 38110.2 })

    const many: CargoItem[] = [{ ...sample[1], quantity: 60 }]
    expect(linkCargo(many, '20dc', cushioning).sea?.units).toBeGreaterThan(1)
    const huge: CargoItem[] = [{ ...sample[0], length: 13000 }]
    expect(linkCargo(huge, '40hc', cushioning).sea).toMatchObject({ unavailable: true, units: 1 })
    expect(linkCargo([], '20dc', cushioning).truck).toMatchObject({ units: 1, source: 'default' })
  })

  it('applies overrides, market levels and the chargeable units of each mode', () => {
    const link = linkCargo(sample, '20dc', cushioning, false)
    const lcl = computeQuote(direct(4, 6000, { mode: 'lcl' }), link, 'TH', TODAY)
    expect(lcl.chargedRevenueTons).toBe(6) // 6 t > 4 m³
    expect(lcl.freight.amount).toBe(30 * 6 * 150)
    const air = computeQuote(direct(15.504, 3160, { mode: 'air', market: 'surge' }), link, 'TH', TODAY)
    expect(air.chargeableKg).toBe(3160)
    expect(air.freight.amount).toBe(Math.round(2.8 * 3160 * 2.5 * 150))
    const fcl = computeQuote(direct(20, 4000, { container: { id: '40hc', units: 2 }, truck: { id: '10t', units: 2 } }), link, 'TH', TODAY)
    expect(fcl.container).toMatchObject({ units: 2, source: 'manual' })
    expect(fcl.freight.amount).toBe(700 * 2 * 150) // 40ft HQ rate
    expect(fcl.domestic.amount).toBe(190_000)
    // Overrides are used as entered: no market factor on a forwarder's actual quote.
    const usd = computeQuote(direct(20, 4000, { market: 'peak', freight: { amount: 500, currency: 'USD' } }), link, 'TH', TODAY)
    expect(usd.freight.amount).toBe(75_000)
    expect(usd.freight.autoJpy).toBe(Math.round(350 * 1.5 * 150))
    const jpy = computeQuote(
      direct(20, 4000, { freight: { amount: 80_000, currency: 'JPY' }, domestic: 0, exportCharges: 120_000, packingCost: false }),
      link,
      'TH',
      TODAY,
    )
    expect(jpy.incoterms.freightBase).toBe(80_000)
    expect(jpy.incoterms.fob).toBe(5_120_000)
  })

  it('converts at the applied rate of the quote currency', () => {
    const link = linkCargo(sample, '20dc', cushioning, false)
    const yen = computeQuote(direct(20, 4000, { currency: 'JPY', fxRate: 1 }), link, 'TH', TODAY)
    expect(yen.appliedRate).toBe(1)
    expect(yen.prices.DDP.quote).toBe(yen.prices.DDP.jpy)
    expect(yen.freight.amount).toBe(52_500) // USD freight still uses the USD rate
    const eur = computeQuote(direct(20, 4000, { currency: 'EUR', fxRate: 170, fxBuffer: 0, usdRate: 140 }), link, 'TH', TODAY)
    expect(eur.freight.amount).toBe(350 * 140)
    expect(eur.prices.EXW.quote).toBe(convertFromJpy(5_300_000, 170, 2))
    const explicit = computeQuote(direct(20, 4000, { validUntil: '2026-11-25' }), link, 'TH', TODAY)
    expect(explicit.validityDays).toBe(7)
  })

  it('resolves the destination without ever quoting to the origin', () => {
    expect(resolveDestination('DE', 'TH', ['TH'])).toBe('DE')
    expect(resolveDestination('', 'TH', ['KR', 'TH'])).toBe('TH')
    expect(resolveDestination('', 'JP', ['JP', 'VN'])).toBe('VN')
    expect(resolveDestination('', 'JP', [])).toBe('US')
  })
})
