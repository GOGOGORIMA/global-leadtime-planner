/**
 * Incoterms price build-up for the export quotation board (tab ⑥).
 *
 * The EXW price (the sales price ex works, export packing included) is the starting point —
 * there is deliberately no product cost or margin anywhere. Logistics, insurance and duty are
 * stacked on top:
 *
 *   EXW = base price
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

/** Insured value as a share of the CIF price (ICC practice: CIF + 10 %). */
export const INSURED_VALUE_RATIO = 1.1
/** Air volumetric weight: 1 m³ = 167 kg (IATA 6,000 cm³ per kg). */
export const VOLUMETRIC_KG_PER_M3 = 167
/** LCL is charged for at least one revenue ton. */
export const MIN_REVENUE_TONS = 1

export const INCOTERMS = ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'] as const
export type Incoterm = (typeof INCOTERMS)[number]

/** LCL revenue ton (W/M): the larger of volume (m³) and weight (metric tons), at least 1.0 R/T. */
export function revenueTons(volumeM3: number, weightKg: number): number {
  return Math.max(volumeM3, weightKg / 1000, MIN_REVENUE_TONS)
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
  /** EXW base price (JPY). */
  exw: number
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
  const exw = yen(input.exw)
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
