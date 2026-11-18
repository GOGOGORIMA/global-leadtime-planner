/**
 * Incoterms price build-up for the export quotation board (tab ⑥).
 *
 * Everything starts from an estimated volume V (m³) and gross weight W (kg) — from a quick size
 * calculator with a packing allowance, typed in directly, or taken from the loading simulator.
 * The EXW base price is the sales price ex works; there is deliberately no product cost or margin
 * anywhere. Packing, logistics, insurance and duty are stacked on top:
 *
 *   EXW = base price + export packing (V × packing rate, optional)
 *   FOB = EXW + domestic truck freight + export clearance & port charges
 *   CFR = FOB + freight × (1 + freight contingency)
 *   CIF = CFR / (1 − 1.1 × i)            ← insurance on 110 % of CIF, solved without a loop
 *   insurance = CIF − CFR
 *   DAP = CIF + destination (DAP) charges
 *   duty = CIF × d
 *   DDP = DAP + duty
 *
 * All amounts are JPY, rounded to whole yen at every step so the increments add up exactly.
 * Pure functions.
 */
import { getContainerSpec, type ContainerId } from '../data/containers'

/** Insured value as a share of the CIF price (ICC practice: CIF + 10 %). */
export const INSURED_VALUE_RATIO = 1.1
/** Air volumetric weight: 1 m³ = 167 kg (IATA 6,000 cm³ per kg). */
export const VOLUMETRIC_KG_PER_M3 = 167
/** LCL is charged for at least one revenue ton. */
export const MIN_REVENUE_TONS = 1

export const INCOTERMS = ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'] as const
export type Incoterm = (typeof INCOTERMS)[number]

// ---------------------------------------------------------------------------------------------
// Estimated volume (概算M3) and weight
// ---------------------------------------------------------------------------------------------

/** Packing allowance on bare product sizes: as measured, carton / pallet (+15 %), export crate / skid (+25 %). */
export const PACKING_ALLOWANCES = { none: 1, carton: 1.15, crate: 1.25 } as const
export type PackingAllowance = keyof typeof PACKING_ALLOWANCES

export function isPackingAllowance(value: unknown): value is PackingAllowance {
  return typeof value === 'string' && Object.hasOwn(PACKING_ALLOWANCES, value)
}

export type SizeUnit = 'cm' | 'mm'

/** One line of the quick size calculator: sizes in cm or mm, weight per piece in kg. */
export interface SizeRow {
  length: number
  width: number
  height: number
  quantity: number
  weight: number
}

/** m³ of all pieces of one row. */
export function rowVolume(row: SizeRow, unit: SizeUnit): number {
  const perMetre = unit === 'cm' ? 100 : 1000
  return (row.length / perMetre) * (row.width / perMetre) * (row.height / perMetre) * row.quantity
}

export interface SizeEstimate {
  /** m³ of the entered (bare or packed) sizes. */
  netVolume: number
  /** Allowance factor applied (1.0 / 1.15 / 1.25). */
  factor: number
  /** netVolume × factor = estimated gross m³ used for every charge. */
  volume: number
  /** kg (unit weight × quantity; the allowance does not change the weight). */
  weight: number
  pieces: number
}

/** m³ rounded to cm³ (avoids floating-point noise such as 7.260000000000002). */
const roundM3 = (m3: number) => Math.round(m3 * 1e6) / 1e6

/** Bare M3 × packing allowance = estimated gross M3 (Estimated Gross M3). */
export function estimateFromSizes(rows: readonly SizeRow[], unit: SizeUnit, allowance: PackingAllowance): SizeEstimate {
  const netVolume = roundM3(rows.reduce((sum, row) => sum + rowVolume(row, unit), 0))
  const factor = PACKING_ALLOWANCES[allowance]
  return {
    netVolume,
    factor,
    volume: roundM3(netVolume * factor),
    weight: rows.reduce((sum, row) => sum + row.weight * row.quantity, 0),
    pieces: rows.reduce((sum, row) => sum + row.quantity, 0),
  }
}

/** Revenue ton (W/M): the larger of volume (m³) and weight (metric tons), rounded up to 2 decimals. */
export function revenueTons(volumeM3: number, weightKg: number): number {
  const rt = Math.max(volumeM3, weightKg / 1000, 0)
  return Math.ceil(rt * 100 - 1e-9) / 100
}

/** R/T billed for LCL: at least {@link MIN_REVENUE_TONS}. */
export function chargedRevenueTons(rt: number): number {
  return Math.max(rt, MIN_REVENUE_TONS)
}

/** Recommended shipment by volume: LCL up to 14 m³, 20ft up to 28 m³, 40ft up to 58 m³, then 40ft HQ. */
export const LCL_MAX_M3 = 14
export const FCL20_MAX_M3 = 28
export const FCL40_MAX_M3 = 58
/** Practical load of one 40ft HQ (≈ 86 % of 76.4 m³) when several are needed. */
export const FCL40HQ_LOAD_M3 = 66

/** A container / truck type and how many (estimated from V and W). */
export interface UnitEstimate {
  id: ContainerId
  units: number
}

const ceilUnits = (value: number) => Math.ceil(value - 1e-9)

/**
 * Containers for V m³ / W kg: 20ft up to 28 m³, 40ft Dry up to 58 m³, beyond that 40ft HQ × ⌈V / 66⌉ —
 * and never fewer than the maximum payload requires.
 */
export function recommendContainer(volumeM3: number, weightKg: number): UnitEstimate {
  const byWeight = (id: ContainerId) => ceilUnits(weightKg / getContainerSpec(id).maxPayload)
  if (volumeM3 <= FCL20_MAX_M3) return { id: '20dc', units: Math.max(1, byWeight('20dc')) }
  if (volumeM3 <= FCL40_MAX_M3) return { id: '40dc', units: Math.max(1, byWeight('40dc')) }
  return { id: '40hc', units: Math.max(1, ceilUnits(volumeM3 / FCL40HQ_LOAD_M3), byWeight('40hc')) }
}

export type ShipmentRecommendation = { mode: 'lcl' } | { mode: 'fcl'; plan: UnitEstimate }

/** LCL up to 14 m³, otherwise FCL with {@link recommendContainer}. */
export function recommendShipment(volumeM3: number, weightKg: number): ShipmentRecommendation {
  return volumeM3 <= LCL_MAX_M3 ? { mode: 'lcl' } : { mode: 'fcl', plan: recommendContainer(volumeM3, weightKg) }
}

/** Domestic trucks by load: 2t up to 12 m³ / 2 t, 4t up to 25 m³ / 3.5 t, 10t up to 45 m³ / 13 t. */
export const TRUCK_CAPACITY: ReadonlyArray<{ id: ContainerId; volume: number; weight: number }> = [
  { id: '2t', volume: 12, weight: 2000 },
  { id: '4t', volume: 25, weight: 3500 },
  { id: '10t', volume: 45, weight: 13000 },
]

/** The smallest truck that carries V and W, else as many 10t trucks as volume or weight need. */
export function recommendTruck(volumeM3: number, weightKg: number): UnitEstimate {
  const fit = TRUCK_CAPACITY.find((truck) => volumeM3 <= truck.volume && weightKg <= truck.weight)
  if (fit) return { id: fit.id, units: 1 }
  const largest = TRUCK_CAPACITY[TRUCK_CAPACITY.length - 1]
  return { id: largest.id, units: Math.max(1, ceilUnits(volumeM3 / largest.volume), ceilUnits(weightKg / largest.weight)) }
}

/** Export packing (crates / pallets) per m³ of estimated volume (JPY). */
export const DEFAULT_PACKING_RATE = 15000

export function packingCostJpy(volumeM3: number, ratePerM3: number): number {
  return Math.round(Math.max(0, volumeM3) * Math.max(0, ratePerM3))
}

/** Air chargeable weight: the larger of the actual weight and the volumetric weight (V × 167 kg). */
export function chargeableWeight(volumeM3: number, weightKg: number): number {
  return Math.max(weightKg, volumeM3 * VOLUMETRIC_KG_PER_M3)
}

/**
 * Company rate for converting JPY into the quote currency: the market rate lowered by the FX
 * buffer (JPY per unit). A lower rate gives a higher foreign-currency price, protecting the
 * quotation against a stronger yen until payment.
 */
export function appliedRate(marketRate: number, bufferPercent: number): number {
  return marketRate * (1 - bufferPercent / 100)
}

/** JPY → quote currency at `rate` JPY per unit, rounded to the currency's decimals. */
export function convertFromJpy(jpy: number, rate: number, decimals: number): number {
  if (!(rate > 0)) return 0
  const factor = 10 ** decimals
  return Math.round((jpy / rate) * factor) / factor
}

export interface IncotermsInput {
  /** EXW base price (JPY, before export packing when packing is added separately). */
  base: number
  /** Export packing added to EXW (JPY, 0 = none). */
  packing: number
  /** Domestic truck freight factory → port / airport (JPY). */
  domestic: number
  /** Export clearance & port charges (JPY). */
  exportCharges: number
  /** International freight before the contingency (JPY). */
  freight: number
  /** Freight contingency (%), e.g. 10. */
  freightBuffer: number
  /** Marine insurance rate (%) on 110 % of CIF, e.g. 0.2. */
  insuranceRate: number
  /** Destination charges (JPY). */
  localCharges: number
  /** Import duty rate (%) on CIF, e.g. 5. */
  dutyRate: number
}

export interface IncotermsResult {
  /** Base price and export packing; EXW = base + packing. */
  base: number
  packing: number
  exw: number
  fob: number
  cfr: number
  cif: number
  dap: number
  ddp: number
  domestic: number
  exportCharges: number
  /** domestic + export charges (FOB − EXW). */
  fobCharges: number
  /** Freight before / of / including the contingency. */
  freightBase: number
  freightContingency: number
  freight: number
  insurance: number
  /** Sum insured (110 % of CIF). */
  insuredValue: number
  localCharges: number
  duty: number
}

const yen = (n: number) => Math.round(Number.isFinite(n) ? Math.max(0, n) : 0)

export function calculateIncoterms(input: IncotermsInput): IncotermsResult {
  const base = yen(input.base)
  const packing = yen(input.packing)
  const exw = base + packing
  const domestic = yen(input.domestic)
  const exportCharges = yen(input.exportCharges)
  const fob = exw + domestic + exportCharges

  const freightBase = yen(input.freight)
  const freight = yen(freightBase * (1 + Math.max(0, input.freightBuffer) / 100))
  const cfr = fob + freight

  // CIF = CFR + 1.1 × i × CIF  ⇔  CIF = CFR / (1 − 1.1 × i)
  const share = INSURED_VALUE_RATIO * (Math.max(0, input.insuranceRate) / 100)
  const cif = share > 0 && share < 1 ? yen(cfr / (1 - share)) : cfr
  const insurance = cif - cfr

  const localCharges = yen(input.localCharges)
  const dap = cif + localCharges
  const duty = yen(cif * (Math.max(0, input.dutyRate) / 100))
  const ddp = dap + duty

  return {
    base,
    packing,
    exw,
    fob,
    cfr,
    cif,
    dap,
    ddp,
    domestic,
    exportCharges,
    fobCharges: domestic + exportCharges,
    freightBase,
    freightContingency: freight - freightBase,
    freight,
    insurance,
    insuredValue: yen(cif * INSURED_VALUE_RATIO),
    localCharges,
    duty,
  }
}

/** Price of each Incoterm (JPY). */
export function incotermPrices(result: IncotermsResult): Record<Incoterm, number> {
  return { EXW: result.exw, FOB: result.fob, CIF: result.cif, DAP: result.dap, DDP: result.ddp }
}
