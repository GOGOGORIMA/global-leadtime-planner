/**
 * Export quotation board (tab ⑥): turns the estimated volume / weight (quick size calculator with
 * its packing allowance and packing weight, direct entry, or the loading simulator of tab ⑤) into
 * packing, trucks, containers, port charges, freight and the Incoterms prices. Every cost item is
 * automatic (rate tables, JPY) until entered by hand. `linkCargo` does the (heavier) packing work
 * of tab ⑤ only when it is used; `computeQuote` is cheap and runs on every keystroke. Pure functions.
 */
import { getContainerSpec, specsOfCategory, type ContainerCategory, type ContainerId, type ContainerSpec } from '../data/containers'
import { CURRENCY_INFO, type QuoteCurrency } from '../data/currencies'
import { DEFAULT_VALIDITY_DAYS } from '../state/defaults'
import type { CargoItem, CushionSettings, MoneyAmount, QuoteCargoMode, QuoteSettings } from '../types'
import { expandPieces, planUnits, suggestForCategory, toClearance } from './binPacking'
import { addDays, diffDays, type ISODate } from './dateCalc'
import {
  FREIGHT_ORIGIN,
  MARKET_FACTORS,
  autoPortId,
  domesticTruckJpy,
  exportCustomsJpy,
  exportPortChargesJpy,
  getFreightLane,
  localChargesJpy,
  splitFreight,
  tableFreightJpy,
  type FreightBasis,
  type FreightLane,
  type PortChargeLine,
  type QuoteMode,
  type RatedAmount,
  type ShippingMode,
} from './freightRates'
import {
  INCOTERMS,
  LCL_MAX_M3,
  appliedRate,
  calculateIncoterms,
  chargeableWeight,
  chargedRevenueTons,
  checkLoad,
  convertFromJpy,
  estimateFromSizes,
  incotermPrices,
  packingCostJpy,
  recommendContainer,
  recommendTruck,
  revenueTons,
  type Incoterm,
  type IncotermsInput,
  type IncotermsResult,
  type LoadCheck,
  type PackingWeightRule,
  type UnitEstimate,
} from './incotermsCalc'

/** Where a container / truck choice comes from. */
export type UnitSource = 'manual' | 'selected' | 'suggested' | 'estimated' | 'default'

export interface UnitChoice {
  spec: ContainerSpec
  units: number
  source: UnitSource
  /** No standard size of this kind can carry the cargo (special equipment, quote separately). */
  unavailable: boolean
}

/** Cargo figures of the loading simulator (tab ⑤). */
export interface CargoLink {
  /** Pieces and cargo rows. */
  pieces: number
  types: number
  /** Net cargo volume (m³, the packages themselves) and gross weight (kg). */
  volume: number
  weight: number
  /** Container / truck selected in the simulator. */
  selected: ContainerSpec
  /** Packing plans (only computed when the quotation uses tab ⑤): containers / trucks for all cargo. */
  sea: UnitChoice | null
  truck: UnitChoice | null
}

function chooseUnits(
  category: ContainerCategory,
  items: readonly CargoItem[],
  selected: ContainerSpec,
  cushioning: CushionSettings,
): UnitChoice {
  const sizes = specsOfCategory(category)
  const isSelected = selected.category === category
  const { pieces } = expandPieces(items)
  if (pieces.length === 0) {
    return isSelected
      ? { spec: selected, units: 1, source: 'selected', unavailable: false }
      : { spec: sizes[0], units: 1, source: 'default', unavailable: false }
  }
  const clearance = toClearance(cushioning)
  if (isSelected) {
    const plan = planUnits(selected, pieces, clearance)
    if (plan.units) return { spec: selected, units: plan.units, source: 'selected', unavailable: false }
  }
  const best = suggestForCategory(items, category, clearance).best
  if (best?.units) return { spec: best.spec, units: best.units, source: 'suggested', unavailable: false }
  return isSelected
    ? { spec: selected, units: 1, source: 'selected', unavailable: true }
    : { spec: sizes[sizes.length - 1], units: 1, source: 'default', unavailable: true }
}

/**
 * Volume and weight of the loading simulator's cargo; with `withPlans` also the containers and
 * trucks it needs (the selected size, else the simulator's suggestion).
 */
export function linkCargo(
  items: readonly CargoItem[],
  selectedId: ContainerId,
  cushioning: Record<ContainerCategory, CushionSettings>,
  withPlans = true,
): CargoLink {
  const selected = getContainerSpec(selectedId)
  return {
    pieces: items.reduce((sum, item) => sum + item.quantity, 0),
    types: items.length,
    volume: items.reduce((sum, item) => sum + ((item.length * item.width * item.height) / 1e9) * item.quantity, 0),
    weight: items.reduce((sum, item) => sum + item.weight * item.quantity, 0),
    selected,
    sea: withPlans ? chooseUnits('sea', items, selected, cushioning.sea) : null,
    truck: withPlans ? chooseUnits('truck', items, selected, cushioning.truck) : null,
  }
}

/**
 * Destination of the quotation: the explicit choice, else the schedule's partner country,
 * else the first partner that is not the origin (Japan), else the United States.
 */
export function resolveDestination(explicit: string, preferred: string, partners: readonly string[]): string {
  if (explicit && explicit !== FREIGHT_ORIGIN) return explicit
  if (preferred && preferred !== FREIGHT_ORIGIN) return preferred
  return partners.find((code) => code !== FREIGHT_ORIGIN) ?? 'US'
}

/**
 * Port of discharge of destinations with several representative ports (US West / East Coast): the
 * explicit choice, else the coast of the partner's time zone. '' for every other destination.
 */
export function resolvePort(explicit: string, destination: string, timeZone?: string): string {
  const { ports } = getFreightLane(destination)
  if (ports.length === 0) return ''
  return ports.some((p) => p.id === explicit) ? explicit : autoPortId(destination, timeZone)
}

/** The volume and weight every charge is based on. */
export interface CargoBasis {
  source: QuoteCargoMode
  /** Estimated gross m³ (梱包後概算M3: after the packing allowance in the size calculator). */
  volume: number
  /** Estimated gross weight (梱包後概算重量: product + packing materials in the size calculator). */
  weight: number
  /** m³ before the allowance (= volume for direct entry and tab ⑤). */
  netVolume: number
  factor: number
  /** Product weight and packing materials (direct entry and tab ⑤: as entered, no packing added). */
  baseWeight: number
  packingKg: number
  packingPercent: number
  packingRule: PackingWeightRule
  /** Pieces (size calculator / tab ⑤; 0 for direct entry). */
  pieces: number
}

export function cargoBasis(settings: QuoteSettings, link: CargoLink): CargoBasis {
  const asEntered = (source: QuoteCargoMode, volume: number, weight: number, pieces: number): CargoBasis => ({
    source,
    volume,
    weight,
    netVolume: volume,
    factor: 1,
    baseWeight: weight,
    packingKg: 0,
    packingPercent: 0,
    packingRule: 'none',
    pieces,
  })
  switch (settings.cargoMode) {
    case 'simple': {
      const e = estimateFromSizes(settings.items, settings.sizeUnit, settings.allowance, settings.packingWeight)
      return {
        source: 'simple',
        volume: e.volume,
        weight: e.estimatedGrossWeightKg,
        netVolume: e.netVolume,
        factor: e.factor,
        baseWeight: e.baseWeightKg,
        packingKg: e.packingKg,
        packingPercent: e.packingPercent,
        packingRule: e.rule,
        pieces: e.pieces,
      }
    }
    case 'direct':
      return asEntered('direct', settings.volume, settings.weight, 0)
    case 'vanning':
      return asEntered('vanning', link.volume, link.weight, link.pieces)
  }
}

/** A cost item that is automatic (rate tables) until entered by hand. */
export interface Charge {
  /** Amount used (JPY). */
  amount: number
  /** Automatic amount (JPY). */
  auto: number
  manual: boolean
}

/** A charge that can be entered in USD or JPY. */
export interface MoneyCharge extends Charge {
  /** The amount entered by hand in its currency, `null` while automatic. */
  entered: MoneyAmount | null
}

export interface QuoteMoney {
  /** JPY (whole yen). */
  jpy: number
  /** Quote currency at the applied rate (rounded to its decimals; equals `jpy` for JPY). */
  quote: number
}

export interface QuoteResult {
  currency: QuoteCurrency
  decimals: number
  /** JPY per unit: market rate and the applied (buffered) rate; 1 for JPY quotes. */
  marketRate: number
  appliedRate: number
  /** JPY per USD for amounts entered in USD. */
  usdRate: number
  destination: string
  lane: FreightLane
  marketFactor: number
  /** Estimated volume / weight and where they come from. */
  cargo: CargoBasis
  volume: number
  weight: number
  /** R/T = max(V, W / 1000) to 2 decimals; LCL is billed for at least 1.0 R/T. */
  revenueTons: number
  chargedRevenueTons: number
  chargeableKg: number
  /** Transport mode setting and the mode used (`auto` resolves to the recommendation). */
  modeSetting: QuoteMode
  mode: ShippingMode
  /** LCL up to 14 m³, else FCL with these containers. */
  recommended: { mode: 'lcl' | 'fcl'; container: UnitChoice }
  /** LCL costs more than the planned FCL (20ft up to 28 m³; freight + port + destination charges): suggest switching. */
  fclSuggestion: { lclTotal: number; fclTotal: number; container: UnitChoice } | null
  container: UnitChoice
  truck: UnitChoice
  /** Payload / capacity of the containers (FCL only) and trucks against the packed weight and volume. */
  loads: { container: LoadCheck | null; truck: LoadCheck }
  /** Export packing (EXW): V × rate unless entered by hand; 0 when switched off. */
  packing: Charge & { rate: number; enabled: boolean }
  /** FOB: domestic truck, export customs clearance, export port charges (with their lines). */
  domestic: Charge
  customs: Charge
  portCharges: Charge & { lines: PortChargeLine[] }
  /** CFR: table freight incl. surcharges (normal market) × market level, split into base freight and surcharges. */
  freight: {
    table: RatedAmount
    tableJpy: number
    base: MoneyCharge
    surcharge: MoneyCharge
  }
  /** CIF: insurance premium (CIF × 110 % × rate unless entered by hand). */
  insurance: Charge
  /** DAP: destination charges (regional preset unless entered). */
  local: MoneyCharge & { basis: RatedAmount }
  /** DDP: import duty (CIF × rate unless entered by hand). */
  duty: Charge
  incoterms: IncotermsResult
  prices: Record<Incoterm, QuoteMoney>
  /** Rates used (%), echoed from the settings. */
  freightBuffer: number
  insuranceRate: number
  dutyRate: number
  validUntil: ISODate
  /** Days from today to the validity date (negative = expired). */
  validityDays: number
}

const toJpy = (money: MoneyAmount, usdRate: number) =>
  Math.round(money.currency === 'JPY' ? money.amount : money.amount * usdRate)

const estimated = (plan: UnitEstimate): UnitChoice => ({
  spec: getContainerSpec(plan.id),
  units: plan.units,
  source: 'estimated',
  unavailable: false,
})

const manual = (value: { id: ContainerId; units: number }): UnitChoice => ({
  spec: getContainerSpec(value.id),
  units: value.units,
  source: 'manual',
  unavailable: false,
})

const charge = (manualAmount: number | null, auto: number): Charge => ({
  amount: manualAmount ?? auto,
  auto,
  manual: manualAmount !== null,
})

const moneyCharge = (entered: MoneyAmount | null, auto: number, usdRate: number): MoneyCharge => ({
  amount: entered ? toJpy(entered, usdRate) : auto,
  auto,
  manual: entered !== null,
  entered,
})

/**
 * Prices the quotation. `port` is the resolved port choice of the destination ({@link resolvePort};
 * '' for destinations with one representative port).
 */
export function computeQuote(settings: QuoteSettings, link: CargoLink, destination: string, today: ISODate, port = ''): QuoteResult {
  const currency = settings.currency
  const decimals = CURRENCY_INFO[currency].decimals
  const marketRate = currency === 'JPY' ? 1 : settings.fxRate
  const rate = currency === 'JPY' ? 1 : appliedRate(settings.fxRate, settings.fxBuffer)
  const usdRate = currency === 'USD' ? settings.fxRate : settings.usdRate

  // 1. Estimated (packed) volume / weight and the billing units.
  const cargo = cargoBasis(settings, link)
  const { volume, weight } = cargo
  const rt = revenueTons(volume, weight)
  const chargedRt = chargedRevenueTons(rt)
  const chargeableKg = chargeableWeight(volume, weight)

  // 2. Containers / trucks: tab ⑤'s packing plan when its cargo is used, else estimated from V and W.
  const useVanningPlan = cargo.source === 'vanning' && link.pieces > 0
  const plannedContainer = useVanningPlan && link.sea ? link.sea : estimated(recommendContainer(volume, weight))
  const recommended = { mode: volume <= LCL_MAX_M3 ? ('lcl' as const) : ('fcl' as const), container: plannedContainer }
  const mode: ShippingMode = settings.mode === 'auto' ? recommended.mode : settings.mode
  const container = settings.container ? manual(settings.container) : plannedContainer
  const truck = settings.truck
    ? manual(settings.truck)
    : useVanningPlan && link.truck
      ? link.truck
      : estimated(recommendTruck(volume, weight))

  const basis: FreightBasis = {
    mode,
    container: container.spec.id,
    units: container.units,
    revenueTons: chargedRt,
    chargeableKg,
  }
  const lane = getFreightLane(destination, port)
  const marketFactor = MARKET_FACTORS[settings.market]

  // 3. EXW packing and the FOB charges.
  const packingAuto = packingCostJpy(volume, settings.packingRate)
  const packing = settings.packingCost ? charge(settings.packingAmount, packingAuto) : { amount: 0, auto: packingAuto, manual: false }
  const domestic = charge(settings.domestic, domesticTruckJpy(truck.spec.id, truck.units))
  const customs = charge(settings.customs, exportCustomsJpy())
  const portAuto = exportPortChargesJpy(basis, lane.region)
  const portCharges = { ...charge(settings.portCharges, portAuto.total), lines: portAuto.lines }

  // 4. Freight: table rate incl. surcharges × market level, shown as base freight (O/F) + surcharges.
  const table = tableFreightJpy(lane, basis)
  const tableJpy = Math.round(table.amount * marketFactor)
  const split = splitFreight(tableJpy)
  const freightBase = moneyCharge(settings.freight, split.base, usdRate)
  const surcharge = moneyCharge(settings.surcharge, split.surcharge, usdRate)

  const localBasis = localChargesJpy(lane.region, basis)
  const local = { ...moneyCharge(settings.local, localBasis.amount, usdRate), basis: localBasis }

  // 5. LCL ⇄ FCL break-even: port charges + freight + destination charges of both (table rates).
  let fclSuggestion: QuoteResult['fclSuggestion'] = null
  if (mode === 'lcl') {
    const scenario = (b: FreightBasis) =>
      exportPortChargesJpy(b, lane.region).total +
      Math.round(tableFreightJpy(lane, b).amount * marketFactor) +
      localChargesJpy(lane.region, b).amount
    // The FCL alternative is the planned container (20ft up to 28 m³).
    const lclTotal = scenario({ ...basis, mode: 'lcl' })
    const fclTotal = scenario({ ...basis, mode: 'fcl', container: plannedContainer.spec.id, units: plannedContainer.units })
    if (fclTotal < lclTotal) fclSuggestion = { lclTotal, fclTotal, container: plannedContainer }
  }

  const input: IncotermsInput = {
    base: settings.exw,
    packing: packing.amount,
    domestic: domestic.amount,
    customs: customs.amount,
    portCharges: portCharges.amount,
    freight: freightBase.amount,
    surcharge: surcharge.amount,
    freightBuffer: settings.freightBuffer,
    insuranceRate: settings.insuranceRate,
    insurance: settings.insurance,
    localCharges: local.amount,
    dutyRate: settings.dutyRate,
    duty: settings.duty,
  }
  const incoterms = calculateIncoterms(input)
  const insuranceAuto = calculateIncoterms({ ...input, insurance: null, duty: null }).insurance
  const dutyAuto = Math.round(incoterms.cif * (Math.max(0, settings.dutyRate) / 100))

  const jpyPrices = incotermPrices(incoterms)
  const prices = Object.fromEntries(
    INCOTERMS.map((term) => [
      term,
      { jpy: jpyPrices[term], quote: currency === 'JPY' ? jpyPrices[term] : convertFromJpy(jpyPrices[term], rate, decimals) },
    ]),
  ) as Record<Incoterm, QuoteMoney>

  const validUntil = settings.validUntil ?? addDays(today, DEFAULT_VALIDITY_DAYS)
  return {
    currency,
    decimals,
    marketRate,
    appliedRate: rate,
    usdRate,
    destination,
    lane,
    marketFactor,
    cargo,
    volume,
    weight,
    revenueTons: rt,
    chargedRevenueTons: chargedRt,
    chargeableKg,
    modeSetting: settings.mode,
    mode,
    recommended,
    fclSuggestion,
    container,
    truck,
    loads: {
      container: mode === 'fcl' ? checkLoad(container.spec.id, container.units, volume, weight) : null,
      truck: checkLoad(truck.spec.id, truck.units, volume, weight),
    },
    packing: { ...packing, amount: incoterms.packing, rate: settings.packingRate, enabled: settings.packingCost },
    domestic,
    customs,
    portCharges,
    freight: { table, tableJpy, base: freightBase, surcharge },
    insurance: { amount: incoterms.insurance, auto: insuranceAuto, manual: settings.insurance !== null },
    local,
    duty: { amount: incoterms.duty, auto: dutyAuto, manual: settings.duty !== null },
    incoterms,
    prices,
    freightBuffer: settings.freightBuffer,
    insuranceRate: settings.insuranceRate,
    dutyRate: settings.dutyRate,
    validUntil,
    validityDays: diffDays(today, validUntil),
  }
}

/** `linkCargo` + `computeQuote` in one call (for the English output). */
export function buildQuotation(
  settings: QuoteSettings,
  items: readonly CargoItem[],
  selectedId: ContainerId,
  cushioning: Record<ContainerCategory, CushionSettings>,
  destination: string,
  today: ISODate,
  port = '',
): QuoteResult {
  return computeQuote(settings, linkCargo(items, selectedId, cushioning, settings.cargoMode === 'vanning'), destination, today, port)
}
