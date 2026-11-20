import { describe, expect, it } from 'vitest'
import { getCountryCatalog } from '../data/countries'
import { DEFAULT_QUOTE, SAMPLE_CARGO, createDefaultState, defaultQuoteRows, instantiateCargo } from '../state/defaults'
import type { CargoItem, QuoteSettings } from '../types'
import {
  DEDICATED_LANE_COUNTRIES,
  FREIGHT_ORIGIN,
  LCL_ORIGIN_PER_RT,
  MARKET_FACTORS,
  autoPortId,
  domesticTruckJpy,
  exportCustomsJpy,
  exportPortChargesJpy,
  freightRegion,
  getFreightLane,
  localChargesJpy,
  splitFreight,
  tableFreightJpy,
  type FreightBasis,
  type FreightLane,
  type FreightRegion,
} from './freightRates'
import {
  appliedRate,
  calculateIncoterms,
  chargeableWeight,
  chargedRevenueTons,
  checkLoad,
  convertFromJpy,
  estimateFromSizes,
  estimateGrossWeight,
  packingCostJpy,
  recommendContainer,
  recommendShipment,
  recommendTruck,
  revenueTons,
  type IncotermsInput,
} from './incotermsCalc'
import { buildQuotation, computeQuote, linkCargo, resolveDestination, resolvePort } from './quotation'

const TODAY = '2026-11-18'
const cushioning = createDefaultState(TODAY).cushioning
const sample = instantiateCargo(SAMPLE_CARGO)
const quote = (patch: Partial<QuoteSettings> = {}): QuoteSettings => ({ ...DEFAULT_QUOTE, items: defaultQuoteRows('cm'), ...patch })
const direct = (volume: number, weight: number, patch: Partial<QuoteSettings> = {}) => quote({ cargoMode: 'direct', volume, weight, ...patch })
const priced = (settings: QuoteSettings, destination = 'KR', port = '') => buildQuotation(settings, sample, '20dc', cushioning, destination, TODAY, port)
/** One row of the size calculator (cm). */
const sized = (length: number, width: number, height: number, quantity: number, weight: number, patch: Partial<QuoteSettings> = {}) =>
  quote({ items: [{ length, width, height, quantity, weight }], ...patch })

const basis = (patch: Partial<FreightBasis>): FreightBasis => ({
  mode: 'fcl',
  container: '20dc',
  units: 1,
  revenueTons: 1,
  chargeableKg: 0,
  ...patch,
})

const within = (value: number, [min, max]: readonly [number, number]) => value >= min && value <= max

describe('freight rate tables (JPY)', () => {
  it('maps every destination of the catalog to a freight region', () => {
    const missing = getCountryCatalog()
      .map((c) => c.code)
      .filter((code) => code !== FREIGHT_ORIGIN && !freightRegion(code))
    expect(missing).toEqual([])
    expect(freightRegion(FREIGHT_ORIGIN)).toBeUndefined()
  })

  it('keeps every lane and region estimate inside the planning band of its trade', () => {
    expect(DEDICATED_LANE_COUNTRIES.length).toBeGreaterThanOrEqual(40)
    const check = (lane: FreightLane, label: string) => {
      expect(lane.fcl40, label).toBeGreaterThan(lane.fcl20)
      expect(lane.fcl40hc, label).toBeGreaterThan(lane.fcl40)
      // LCL is quoted per R/T including the origin CFS / THC.
      expect(within(lane.lcl + LCL_ORIGIN_PER_RT, lane.band.lcl), `${label} LCL`).toBe(true)
      expect(within(lane.fcl20, lane.band.fcl20), `${label} 20ft`).toBe(true)
      expect(within(lane.fcl40, lane.band.fcl40) && within(lane.fcl40hc, lane.band.fcl40), `${label} 40ft`).toBe(true)
      expect(within(lane.air, lane.band.air), `${label} air`).toBe(true)
    }
    for (const code of DEDICATED_LANE_COUNTRIES) {
      const lane = getFreightLane(code)
      expect(lane.estimated, code).toBe(false)
      expect(lane.port, code).toBeTruthy()
      expect(freightRegion(code), code).toBe(lane.region)
      check(lane, code)
    }
    for (const code of ['MO', 'KH', 'NP', 'QA', 'IE', 'KZ', 'BM', 'UY', 'GH', 'FJ']) {
      const lane = getFreightLane(code)
      expect(lane.estimated, code).toBe(true)
      check(lane, code)
    }
    check(getFreightLane('US', 'west'), 'US west')
    check(getFreightLane('US', 'east'), 'US east')
  })

  it('matches the reference levels for Korea / China, India and the US / UK / Germany', () => {
    const nearAsia = { lcl: [18_000, 28_000], fcl20: [120_000, 180_000], fcl40: [190_000, 280_000], air: [600, 1_100] } as const
    const southAsia = { lcl: [28_000, 45_000], fcl20: [250_000, 420_000], fcl40: [380_000, 620_000], air: [600, 1_100] } as const
    const longHaul = { lcl: [35_000, 55_000], fcl20: [450_000, 750_000], fcl40: [650_000, 1_050_000], air: [1_300, 2_200] } as const
    const lanes: Array<[FreightLane, typeof nearAsia | typeof southAsia | typeof longHaul]> = [
      [getFreightLane('KR'), nearAsia],
      [getFreightLane('CN'), nearAsia],
      [getFreightLane('IN'), southAsia],
      [getFreightLane('US', 'west'), longHaul],
      [getFreightLane('US', 'east'), longHaul],
      [getFreightLane('GB'), longHaul],
      [getFreightLane('DE'), longHaul],
    ]
    for (const [lane, ref] of lanes) {
      expect(lane.band).toEqual(lane.region === 'southAsia' ? { ...ref, air: [700, 1_100] } : ref)
      expect(within(lane.lcl + LCL_ORIGIN_PER_RT, ref.lcl), lane.port).toBe(true)
      expect(within(lane.fcl20, ref.fcl20) && within(lane.fcl40, ref.fcl40) && within(lane.fcl40hc, ref.fcl40), lane.port).toBe(true)
      expect(within(lane.air, ref.air), lane.port).toBe(true)
    }
    expect(getFreightLane('KR')).toMatchObject({ port: 'Busan', fcl20: 140_000, fcl40: 215_000, fcl40hc: 225_000, lcl: 15_000, air: 650 })
    expect(getFreightLane('DE')).toMatchObject({ port: 'Hamburg', region: 'europe', fcl20: 620_000, fcl40: 880_000, fcl40hc: 900_000 })
    expect(getFreightLane('GB')).toMatchObject({ port: 'Felixstowe / Southampton', fcl20: 640_000, fcl40: 910_000, fcl40hc: 930_000 })
    // US East Coast and Europe are dearer than the US West Coast; long haul dearer than near Asia.
    expect(getFreightLane('US', 'east').fcl20).toBeGreaterThan(getFreightLane('US', 'west').fcl20)
    expect(getFreightLane('DE').fcl20).toBeGreaterThan(getFreightLane('US', 'west').fcl20)
    expect(getFreightLane('DE').fcl40).toBeGreaterThan(getFreightLane('KR').fcl40)
    // Smaller markets of a region cost more than its main ports.
    expect(getFreightLane('KH').fcl20).toBeGreaterThan(getFreightLane('TH').fcl20)
    expect(getFreightLane('KH').port).toBeUndefined()
  })

  it('chooses the US West / East Coast by the partner time zone unless chosen', () => {
    expect(getFreightLane('US', 'west')).toMatchObject({ port: 'Los Angeles / Long Beach', portId: 'west' })
    expect(getFreightLane('US', 'east')).toMatchObject({ port: 'New York / Savannah', portId: 'east' })
    expect(getFreightLane('US').ports.map((p) => p.id)).toEqual(['west', 'east'])
    expect(getFreightLane('US').portId).toBe('east') // unknown: the dearer East Coast
    expect(getFreightLane('KR')).toMatchObject({ ports: [], portId: '' })
    expect(autoPortId('US', 'America/Los_Angeles')).toBe('west')
    expect(autoPortId('US', 'America/Denver')).toBe('west')
    expect(autoPortId('US', 'America/New_York')).toBe('east')
    expect(autoPortId('US', 'America/Chicago')).toBe('east')
    expect(autoPortId('KR', 'Asia/Seoul')).toBe('')
    expect(resolvePort('', 'US', 'America/Los_Angeles')).toBe('west')
    expect(resolvePort('east', 'US', 'America/Los_Angeles')).toBe('east')
    expect(resolvePort('bogus', 'US', 'America/New_York')).toBe('east')
    expect(resolvePort('west', 'KR')).toBe('')
  })

  it('rates each mode by its own unit, with the air minimum per trade', () => {
    expect(MARKET_FACTORS).toEqual({ normal: 1, peak: 1.5, surge: 2.5 })
    const th = getFreightLane('TH')
    expect(tableFreightJpy(th, basis({ container: '40dc', units: 2 }))).toMatchObject({ rate: 295_000, quantity: 2, amount: 590_000 })
    expect(tableFreightJpy(th, basis({ container: '40hc', units: 2 })).amount).toBe(610_000)
    expect(tableFreightJpy(th, basis({ mode: 'lcl', revenueTons: 4.5 })).amount).toBe(87_750)
    expect(tableFreightJpy(th, basis({ mode: 'air', chargeableKg: 500 })).amount).toBe(400_000)
    expect(tableFreightJpy(th, basis({ mode: 'air', chargeableKg: 10 }))).toMatchObject({ minimum: true, amount: 12_000 })
    expect(tableFreightJpy(getFreightLane('DE'), basis({ mode: 'air', chargeableKg: 5 }))).toMatchObject({ minimum: true, amount: 18_000 })
    // Shown as base freight + surcharges (BAF / LSS …).
    expect(splitFreight(140_000)).toEqual({ base: 98_000, surcharge: 42_000 })
    expect(splitFreight(87_750)).toEqual({ base: 61_425, surcharge: 26_325 })
  })

  it('itemizes the Japanese export charges: customs, THC / CFS / B/L / vanning, advance filing', () => {
    expect(exportCustomsJpy()).toBe(11_800)
    const fcl = exportPortChargesJpy(basis({}), 'eastAsia')
    expect(fcl.lines.map((l) => l.key)).toEqual(['thc', 'vanning', 'seal', 'document'])
    expect(fcl.total).toBe(47_000 + 38_000 + 2_000 + 6_500)
    // Per container, plus the advance cargo filing to Europe / North America.
    const eu = exportPortChargesJpy(basis({ container: '40dc', units: 2 }), 'europe')
    expect(eu.lines.map((l) => l.key)).toEqual(['thc', 'vanning', 'seal', 'document', 'filing'])
    expect(eu.total).toBe((67_000 + 56_000 + 2_000) * 2 + 6_500 + 5_000)
    // LCL: CFS and THC per revenue ton.
    const lcl = exportPortChargesJpy(basis({ mode: 'lcl', revenueTons: 15.504 }), 'eastAsia')
    expect(lcl.lines.map((l) => l.key)).toEqual(['cfs', 'lclThc', 'document'])
    expect(lcl.total).toBe(Math.round(5_000 * 15.504) + Math.round(1_500 * 15.504) + 6_500)
    // Air: handling per kg with a minimum and the AWB; no sea filing.
    expect(exportPortChargesJpy(basis({ mode: 'air', chargeableKg: 1000 }), 'northAmerica').total).toBe(40_000 + 5_500)
    expect(exportPortChargesJpy(basis({ mode: 'air', chargeableKg: 20 }), 'eastAsia').total).toBe(7_000 + 5_500)
    expect(domesticTruckJpy('2t', 1)).toBe(35_000)
    expect(domesticTruckJpy('4t', 2)).toBe(110_000)
    expect(domesticTruckJpy('10t', 1)).toBe(95_000)
  })

  it('presets destination charges per region in JPY', () => {
    const local = (region: FreightRegion, b: Partial<FreightBasis>) => localChargesJpy(region, basis(b)).amount
    expect(local('southeastAsia', {})).toBe(75_000)
    expect(local('europe', { container: '40hc', units: 2 })).toBe(440_000)
    expect(local('southeastAsia', { mode: 'lcl', revenueTons: 2 })).toBe(18_000 + 15_000)
    expect(local('northAmerica', { mode: 'air', chargeableKg: 100 })).toBe(28_000 + 9_500)
  })
})

describe('estimated volume and packed weight', () => {
  it('computes the estimated gross M3 and adds the weight of the packing materials', () => {
    const rows = [{ length: 110, width: 110, height: 100, quantity: 6, weight: 300 }]
    expect(estimateFromSizes(rows, 'cm', 'none')).toEqual({
      netVolume: 7.26,
      factor: 1,
      volume: 7.26,
      baseWeightKg: 1800,
      packingKg: 0,
      packingPercent: 0,
      rule: 'none',
      estimatedGrossWeightKg: 1800,
      pieces: 6,
    })
    // 段ボール・パレット: +15 % volume, +8 % weight (pallets, bands, wrap).
    const carton = estimateFromSizes([{ length: 1100, width: 1100, height: 1000, quantity: 6, weight: 300 }], 'mm', 'carton')
    expect(carton.volume).toBeCloseTo(7.26 * 1.15)
    expect(carton).toMatchObject({ baseWeightKg: 1800, packingKg: 144, packingPercent: 8, rule: 'percent', estimatedGrossWeightKg: 1944 })
    // 輸出木箱: +25 % volume, +15 % weight …
    const crate = estimateFromSizes([...rows, { length: 50, width: 40, height: 30, quantity: 10, weight: 8 }], 'cm', 'crate')
    expect(crate.netVolume).toBeCloseTo(7.86)
    expect(crate.volume).toBeCloseTo(7.86 * 1.25)
    expect(crate).toMatchObject({ baseWeightKg: 1880, packingKg: 282, rule: 'percent', estimatedGrossWeightKg: 2162, pieces: 16 })
    // … or, for light and bulky goods, the added volume × 80 kg/m³ when that is heavier.
    const light = estimateFromSizes([{ length: 110, width: 110, height: 100, quantity: 6, weight: 50 }], 'cm', 'crate')
    expect(light).toMatchObject({ baseWeightKg: 300, packingKg: 145.2, rule: 'volume', estimatedGrossWeightKg: 445.2 })
    expect(light.packingPercent).toBeCloseTo(48.4)
  })

  it('takes the packing weight by hand as a % of the product weight or in kg', () => {
    const rows = [{ length: 110, width: 110, height: 100, quantity: 6, weight: 300 }]
    expect(estimateFromSizes(rows, 'cm', 'none', { unit: 'pct', value: 10 })).toMatchObject({
      packingKg: 180,
      packingPercent: 10,
      rule: 'manualPercent',
      estimatedGrossWeightKg: 1980,
    })
    const kg = estimateFromSizes(rows, 'cm', 'crate', { unit: 'kg', value: 250 })
    expect(kg).toMatchObject({ packingKg: 250, rule: 'manualKg', estimatedGrossWeightKg: 2050 })
    expect(kg.packingPercent).toBeCloseTo(13.889, 2)
    expect(estimateGrossWeight(1000, 'carton')).toMatchObject({ packingKg: 80, estimatedGrossWeightKg: 1080 })
    expect(estimateGrossWeight(0, 'crate', 2)).toMatchObject({ packingKg: 160, packingPercent: 0, rule: 'volume' })
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

  it('picks the smallest truck for the load and checks payload / capacity', () => {
    expect(recommendTruck(12, 2000)).toEqual({ id: '2t', units: 1 })
    expect(recommendTruck(12.01, 1000)).toEqual({ id: '4t', units: 1 })
    expect(recommendTruck(5, 2100)).toEqual({ id: '4t', units: 1 })
    expect(recommendTruck(25, 3500)).toEqual({ id: '4t', units: 1 })
    expect(recommendTruck(26, 3000)).toEqual({ id: '10t', units: 1 })
    expect(recommendTruck(45, 13000)).toEqual({ id: '10t', units: 1 })
    expect(recommendTruck(46, 1000)).toEqual({ id: '10t', units: 2 })
    expect(recommendTruck(20, 14000)).toEqual({ id: '10t', units: 2 })
    expect(packingCostJpy(7.26, 15000)).toBe(108900)
    expect(checkLoad('2t', 1, 1.15, 2052)).toMatchObject({ capacityKg: 2000, overWeight: true, overVolume: false })
    expect(checkLoad('20dc', 1, 40, 30000)).toMatchObject({ capacityKg: 24000, capacityM3: 33.2, overWeight: true, overVolume: true })
    expect(checkLoad('40hc', 2, 100, 30000)).toMatchObject({ capacityKg: 53000, overWeight: false, overVolume: false })
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
    customs: 11_800,
    portCharges: 87_800,
    freight: 36_750,
    surcharge: 15_750,
    freightBuffer: 10,
    insuranceRate: 0.2,
    localCharges: 60_000,
    dutyRate: 5,
  }

  it('stacks EXW → FOB (truck + customs + port) → CFR (freight + surcharges) → CIF → DAP → DDP', () => {
    const r = calculateIncoterms(input)
    expect(r.exw).toBe(5_000_000)
    expect(r).toMatchObject({ fobCharges: 154_600, fob: 5_154_600 })
    expect(r).toMatchObject({ baseFreight: 36_750, surcharge: 15_750, freightSubtotal: 52_500, freightContingency: 5_250 })
    expect(r.freight).toBe(57_750) // (36,750 + 15,750) × 1.10
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

  it('uses a premium or duty entered by hand instead of the rates', () => {
    const premium = calculateIncoterms({ ...input, insurance: 3_000 })
    expect(premium).toMatchObject({ insurance: 3_000, cif: 5_215_350, duty: 260_768, ddp: 5_215_350 + 60_000 + 260_768 })
    const duty = calculateIncoterms({ ...input, duty: 100_000 })
    expect(duty).toMatchObject({ cif: 5_223_842, duty: 100_000, ddp: 5_383_842 })
  })

  it('solves the insurance circular reference and keeps every step consistent', () => {
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let n = 0; n < 200; n++) {
      const i = rand() * 5
      const manual = n % 4 === 0
      const r = calculateIncoterms({
        base: Math.round(rand() * 1e9),
        packing: Math.round(rand() * 1e6),
        domestic: Math.round(rand() * 2e5),
        customs: Math.round(rand() * 3e4),
        portCharges: Math.round(rand() * 3e5),
        freight: Math.round(rand() * 2e6),
        surcharge: Math.round(rand() * 6e5),
        freightBuffer: rand() * 30,
        insuranceRate: i,
        insurance: manual ? Math.round(rand() * 1e5) : null,
        localCharges: Math.round(rand() * 5e5),
        dutyRate: rand() * 30,
        duty: manual ? Math.round(rand() * 1e6) : null,
      })
      expect(r.base <= r.exw && r.exw <= r.fob && r.fob <= r.cfr && r.cfr <= r.cif && r.cif <= r.dap && r.dap <= r.ddp).toBe(true)
      // Insurance covers 110 % of the CIF price it is part of.
      if (!manual) expect(Math.abs(r.insurance - 1.1 * (i / 100) * r.cif)).toBeLessThanOrEqual(1)
      expect(r.fob - r.exw).toBe(r.fobCharges)
      expect(r.fobCharges).toBe(r.domestic + r.customs + r.portCharges)
      expect(r.freight).toBe(r.baseFreight + r.surcharge + r.freightContingency)
      expect(r.ddp).toBe(r.base + r.packing + r.fobCharges + r.freight + r.insurance + r.localCharges + r.duty)
    }
    const noInsurance = calculateIncoterms({ ...input, insuranceRate: 0 })
    expect(noInsurance.cif).toBe(noInsurance.cfr)
    expect(noInsurance.insurance).toBe(0)
  })
})

describe('quotation', () => {
  it('prices the default size calculator row (7.26 m³ → LCL to Korea) item by item', () => {
    const q = priced(quote())
    expect(q.cargo).toMatchObject({ source: 'simple', volume: 7.26, weight: 1800, baseWeight: 1800, packingKg: 0, pieces: 6 })
    expect(q).toMatchObject({ revenueTons: 7.26, mode: 'lcl', modeSetting: 'auto', fclSuggestion: null })
    expect(q.recommended.mode).toBe('lcl')
    expect(q.truck).toMatchObject({ units: 1, source: 'estimated' })
    expect(q.truck.spec.id).toBe('2t')
    expect(q.loads).toMatchObject({ container: null, truck: { overWeight: false, overVolume: false } })
    expect(q.packing).toEqual({ amount: 108_900, auto: 108_900, manual: false, rate: 15_000, enabled: true })
    expect(q.domestic).toEqual({ amount: 35_000, auto: 35_000, manual: false })
    expect(q.customs.amount).toBe(11_800)
    // LCL: CFS ¥5,000 + THC ¥1,500 per R/T + B/L.
    expect(q.portCharges.amount).toBe(36_300 + 10_890 + 6_500)
    // Korea LCL ¥15,000 per R/T (¥21,500 incl. CFS / THC), shown as 70 % base freight + 30 % surcharges.
    expect(q.freight.tableJpy).toBe(108_900)
    expect([q.freight.base.amount, q.freight.surcharge.amount]).toEqual([76_230, 32_670])
    expect(q.local.amount).toBe(18_000 + 7_000 * 7.26)
    expect(q.incoterms).toMatchObject({ fobCharges: 100_490, freight: 119_790, insurance: 11_750, duty: 267_047 })
    expect(q.prices.EXW).toEqual({ jpy: 5_108_900, quote: 35112.71 })
    expect(q.prices.FOB).toEqual({ jpy: 5_209_390, quote: 35803.37 })
    expect(q.prices.CIF).toEqual({ jpy: 5_340_930, quote: 36707.42 })
    expect(q.prices.DAP).toEqual({ jpy: 5_409_750, quote: 37180.41 })
    expect(q.prices.DDP).toEqual({ jpy: 5_676_797, quote: 39015.79 })
    expect(q.validUntil).toBe('2026-12-02')
    expect(q.validityDays).toBe(14)
    // Packing off: EXW is the base price.
    expect(priced(quote({ packingCost: false })).prices.EXW.jpy).toBe(5_000_000)
  })

  it('bills R/T and picks trucks / containers by the packed weight', () => {
    // 1,900 kg + 8 % pallet = 2,052 kg: over a 2t truck, and 2.06 R/T (weight) instead of 1.15 m³.
    const pallet = priced(sized(100, 100, 100, 1, 1900, { allowance: 'carton' }))
    expect(pallet.cargo).toMatchObject({ baseWeight: 1900, packingKg: 152, weight: 2052 })
    expect(pallet.revenueTons).toBe(2.06)
    expect(pallet.truck.spec.id).toBe('4t')
    // 23 t + 8 % = 24.84 t: more than one 20ft can carry.
    const heavy = priced(sized(200, 100, 100, 10, 2300, { allowance: 'carton' }))
    expect(heavy.cargo.weight).toBe(24_840)
    expect([heavy.mode, heavy.container.spec.id, heavy.container.units]).toEqual(['fcl', '20dc', 2])
    // A manual choice that cannot carry the packed weight is flagged.
    const overloaded = priced(sized(100, 100, 100, 1, 1900, { allowance: 'carton', truck: { id: '2t', units: 1 } }))
    expect(overloaded.loads.truck).toMatchObject({ overWeight: true, capacityKg: 2000 })
    const box = priced(direct(40, 30000, { mode: 'fcl', container: { id: '20dc', units: 1 } }))
    expect(box.loads.container).toMatchObject({ overWeight: true, overVolume: true })
    // Direct entry and tab ⑤ add no packing weight.
    expect(priced(direct(5, 1000, { allowance: 'crate', packingWeight: { unit: 'pct', value: 50 } })).weight).toBe(1000)
  })

  it('chooses LCL / 20ft / 40ft / 40ft HQ and the trucks from the estimated volume', () => {
    const fcl20 = priced(direct(20, 4000))
    expect([fcl20.mode, fcl20.container.spec.id, fcl20.container.units, fcl20.truck.spec.id]).toEqual(['fcl', '20dc', 1, '10t'])
    expect(fcl20.freight.tableJpy).toBe(140_000)
    expect(fcl20.portCharges.amount).toBe(93_500)
    const fcl40 = priced(direct(40, 9000))
    expect([fcl40.container.spec.id, fcl40.container.units]).toEqual(['40dc', 1])
    const hq = priced(direct(100, 20000))
    expect([hq.container.spec.id, hq.container.units, hq.truck.spec.id, hq.truck.units]).toEqual(['40hc', 2, '10t', 3])
    expect(hq.packing.amount).toBe(1_500_000)
    // A forced mode overrides the recommendation: 20 m³ as LCL is billed per R/T.
    const lcl = priced(direct(20, 4000, { mode: 'lcl' }))
    expect([lcl.mode, lcl.recommended.mode, lcl.chargedRevenueTons]).toEqual(['lcl', 'fcl', 20])
  })

  it('suggests a 20ft FCL once LCL costs more (freight + port + destination charges)', () => {
    const q = priced(direct(13, 2000))
    expect(q.mode).toBe('lcl')
    expect(q.fclSuggestion).toMatchObject({ lclTotal: 395_000, fclTotal: 303_500 })
    expect(q.fclSuggestion?.container.spec.id).toBe('20dc')
    expect(priced(direct(13, 2000, { mode: 'fcl' })).fclSuggestion).toBeNull()
    expect(priced(direct(5, 1000)).fclSuggestion).toBeNull()
    // Long haul: 20ft to Germany stays dearer than 10 m³ of LCL.
    expect(priced(direct(10, 2000), 'DE').fclSuggestion).toBeNull()
  })

  it('prices the US West and East Coast', () => {
    const west = priced(direct(20, 4000), 'US', 'west')
    const east = priced(direct(20, 4000), 'US', 'east')
    expect([west.freight.tableJpy, east.freight.tableJpy]).toEqual([500_000, 700_000])
    expect(east.lane.port).toBe('New York / Savannah')
    // AMS filing to the US; same FOB on both coasts.
    expect(west.portCharges.lines.map((l) => l.key)).toContain('filing')
    expect(east.prices.FOB.jpy).toBe(west.prices.FOB.jpy)
    expect(east.prices.DDP.jpy).toBe(6_783_593)
    expect(west.prices.DDP.jpy).toBe(6_552_084)
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
    expect(q.cargo).toMatchObject({ weight: 3160, packingKg: 0 })
    expect(q.container).toMatchObject({ units: 1, source: 'selected' })
    expect(q.truck.source).toBe('suggested')
    expect(q.prices.FOB.jpy).toBe(5_000_000 + 55_000 + 11_800 + 93_500)
    expect(q.prices.DDP).toEqual({ jpy: 5_725_196, quote: 39348.43 })

    const many: CargoItem[] = [{ ...sample[1], quantity: 60 }]
    expect(linkCargo(many, '20dc', cushioning).sea?.units).toBeGreaterThan(1)
    const huge: CargoItem[] = [{ ...sample[0], length: 13000 }]
    expect(linkCargo(huge, '40hc', cushioning).sea).toMatchObject({ unavailable: true, units: 1 })
    expect(linkCargo([], '20dc', cushioning).truck).toMatchObject({ units: 1, source: 'default' })
  })

  it('applies market levels, chargeable units and every manual amount', () => {
    const link = linkCargo(sample, '20dc', cushioning, false)
    const lcl = computeQuote(direct(4, 6000, { mode: 'lcl' }), link, 'TH', TODAY)
    expect(lcl.chargedRevenueTons).toBe(6) // 6 t > 4 m³
    expect(lcl.freight.tableJpy).toBe(19_500 * 6)
    const air = computeQuote(direct(15.504, 3160, { mode: 'air', market: 'surge' }), link, 'TH', TODAY)
    expect(air.chargeableKg).toBe(3160)
    expect(air.freight.tableJpy).toBe(800 * 3160 * 2.5)
    const fcl = computeQuote(direct(20, 4000, { container: { id: '40hc', units: 2 }, truck: { id: '10t', units: 2 } }), link, 'TH', TODAY)
    expect(fcl.container).toMatchObject({ units: 2, source: 'manual' })
    expect(fcl.freight.tableJpy).toBe(305_000 * 2) // 40ft HQ rate
    expect(fcl.domestic.amount).toBe(190_000)
    // Amounts entered by hand are used as entered: no market factor on a forwarder's quote.
    const usd = computeQuote(direct(20, 4000, { market: 'peak', freight: { amount: 500, currency: 'USD' } }), link, 'TH', TODAY)
    expect(usd.freight.base).toMatchObject({ amount: 75_000, manual: true, auto: 199_500 })
    expect(usd.freight.surcharge).toMatchObject({ amount: 85_500, manual: false }) // 30 % of ¥190,000 × 1.5
    const jpy = computeQuote(
      direct(20, 4000, {
        freight: { amount: 80_000, currency: 'JPY' },
        surcharge: { amount: 0, currency: 'JPY' },
        domestic: 0,
        customs: 0,
        portCharges: 120_000,
        packingCost: false,
      }),
      link,
      'TH',
      TODAY,
    )
    expect(jpy.incoterms).toMatchObject({ freightSubtotal: 80_000, fob: 5_120_000 })
    const manual = computeQuote(direct(20, 4000, { insurance: 5000, duty: 1000, packingAmount: 150_000 }), link, 'TH', TODAY)
    expect(manual.packing).toMatchObject({ amount: 150_000, auto: 300_000, manual: true })
    expect(manual.insurance).toMatchObject({ amount: 5_000, manual: true })
    expect(manual.insurance.auto).toBeGreaterThan(10_000)
    expect(manual.duty).toMatchObject({ amount: 1_000, manual: true })
    expect(manual.prices.DDP.jpy).toBe(5_640_300)
  })

  it('converts at the applied rate of the quote currency (USD amounts entered by hand at the USD rate)', () => {
    const link = linkCargo(sample, '20dc', cushioning, false)
    const yen = computeQuote(direct(20, 4000, { currency: 'JPY', fxRate: 1 }), link, 'TH', TODAY)
    expect(yen.appliedRate).toBe(1)
    expect(yen.prices.DDP.quote).toBe(yen.prices.DDP.jpy)
    expect(yen.freight.tableJpy).toBe(190_000) // the tables are in JPY
    const eur = computeQuote(
      direct(20, 4000, { currency: 'EUR', fxRate: 170, fxBuffer: 0, usdRate: 140, local: { amount: 400, currency: 'USD' } }),
      link,
      'TH',
      TODAY,
    )
    expect(eur.freight.tableJpy).toBe(190_000)
    expect(eur.local.amount).toBe(400 * 140)
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
