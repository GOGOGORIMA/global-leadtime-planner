/**
 * Export quotation board (tab ⑥): turns the estimated volume / weight (quick size calculator,
 * direct entry, or the loading simulator of tab ⑤) into packing, trucks, containers, port charges,
 * freight and the Incoterms prices. `linkCargo` does the (heavier) packing work of tab ⑤ only when
 * it is used; `computeQuote` is cheap and runs on every keystroke. Pure functions.
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
  baseFreightUsd,
  domesticTruckJpy,
  exportChargesJpy,
  getFreightLane,
  localChargesUsd,
  type ExportChargeLine,
  type FreightBasis,
  type FreightLane,
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
  convertFromJpy,
  estimateFromSizes,
  incotermPrices,
  packingCostJpy,
  recommendContainer,
  recommendTruck,
  revenueTons,
  type Incoterm,
  type IncotermsResult,
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

/** The volume and weight every charge is based on. */
export interface CargoBasis {
  source: QuoteCargoMode
  /** Estimated gross m³ (after the packing allowance in the size calculator). */
  volume: number
  weight: number
  /** m³ before the allowance (= volume for direct entry and tab ⑤). */
  netVolume: number
  factor: number
  /** Pieces (size calculator / tab ⑤; 0 for direct entry). */
  pieces: number
}

export function cargoBasis(settings: QuoteSettings, link: CargoLink): CargoBasis {
  switch (settings.cargoMode) {
    case 'simple': {
      const e = estimateFromSizes(settings.items, settings.sizeUnit, settings.allowance)
      return { source: 'simple', volume: e.volume, weight: e.weight, netVolume: e.netVolume, factor: e.factor, pieces: e.pieces }
    }
    case 'direct':
      return { source: 'direct', volume: settings.volume, weight: settings.weight, netVolume: settings.volume, factor: 1, pieces: 0 }
    case 'vanning':
      return { source: 'vanning', volume: link.volume, weight: link.weight, netVolume: link.volume, factor: 1, pieces: link.pieces }
  }
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
  /** JPY per USD for USD freight / charges. */
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
  /** LCL costs more than the planned FCL (20ft up to 28 m³; freight + port charges): suggest switching. */
  fclSuggestion: { lclTotal: number; fclTotal: number; container: UnitChoice } | null
  container: UnitChoice
  truck: UnitChoice
  packing: { amount: number; rate: number; enabled: boolean }
  domestic: { amount: number; auto: number; manual: boolean }
  exportCharges: { amount: number; auto: number; manual: boolean; lines: ExportChargeLine[] }
  /** International freight in JPY before the contingency; `auto*` = table rate × market. */
  freight: { amount: number; autoUsd: number; autoJpy: number; basis: RatedAmount; manual: MoneyAmount | null }
  /** Destination (DAP) charges in JPY; `auto*` = regional preset. */
  local: { amount: number; autoUsd: number; autoJpy: number; basis: RatedAmount; manual: MoneyAmount | null }
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

export function computeQuote(settings: QuoteSettings, link: CargoLink, destination: string, today: ISODate): QuoteResult {
  const currency = settings.currency
  const decimals = CURRENCY_INFO[currency].decimals
  const marketRate = currency === 'JPY' ? 1 : settings.fxRate
  const rate = currency === 'JPY' ? 1 : appliedRate(settings.fxRate, settings.fxBuffer)
  const usdRate = currency === 'USD' ? settings.fxRate : settings.usdRate

  // 1. Estimated volume / weight and the billing units.
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

  const packingAmount = settings.packingCost ? packingCostJpy(volume, settings.packingRate) : 0
  const domesticAuto = domesticTruckJpy(truck.spec.id, truck.units)
  const exportAuto = exportChargesJpy(basis)

  const lane = getFreightLane(destination)
  const marketFactor = MARKET_FACTORS[settings.market]
  const freightBasis = baseFreightUsd(lane, basis)
  const freightAutoUsd = freightBasis.amount * marketFactor
  const freightAutoJpy = Math.round(freightAutoUsd * usdRate)
  const freight = settings.freight ? toJpy(settings.freight, usdRate) : freightAutoJpy

  const localBasis = localChargesUsd(lane.region, basis)
  const localAutoJpy = Math.round(localBasis.amount * usdRate)
  const local = settings.local ? toJpy(settings.local, usdRate) : localAutoJpy

  // 3. LCL ⇄ FCL break-even: freight + export and destination port charges of both (table rates).
  let fclSuggestion: QuoteResult['fclSuggestion'] = null
  if (mode === 'lcl') {
    const scenario = (b: FreightBasis) =>
      exportChargesJpy(b).total +
      Math.round(baseFreightUsd(lane, b).amount * marketFactor * usdRate) +
      Math.round(localChargesUsd(lane.region, b).amount * usdRate)
    // The FCL alternative is the planned container (20ft up to 28 m³).
    const lclTotal = scenario({ ...basis, mode: 'lcl' })
    const fclTotal = scenario({ ...basis, mode: 'fcl', container: plannedContainer.spec.id, units: plannedContainer.units })
    if (fclTotal < lclTotal) fclSuggestion = { lclTotal, fclTotal, container: plannedContainer }
  }

  const domestic = settings.domestic ?? domesticAuto
  const exportCharges = settings.exportCharges ?? exportAuto.total

  const incoterms = calculateIncoterms({
    base: settings.exw,
    packing: packingAmount,
    domestic,
    exportCharges,
    freight,
    freightBuffer: settings.freightBuffer,
    insuranceRate: settings.insuranceRate,
    localCharges: local,
    dutyRate: settings.dutyRate,
  })
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
    packing: { amount: incoterms.packing, rate: settings.packingRate, enabled: settings.packingCost },
    domestic: { amount: incoterms.domestic, auto: domesticAuto, manual: settings.domestic !== null },
    exportCharges: {
      amount: incoterms.exportCharges,
      auto: exportAuto.total,
      manual: settings.exportCharges !== null,
      lines: exportAuto.lines,
    },
    freight: { amount: freight, autoUsd: freightAutoUsd, autoJpy: freightAutoJpy, basis: freightBasis, manual: settings.freight },
    local: { amount: local, autoUsd: localBasis.amount, autoJpy: localAutoJpy, basis: localBasis, manual: settings.local },
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
): QuoteResult {
  return computeQuote(settings, linkCargo(items, selectedId, cushioning, settings.cargoMode === 'vanning'), destination, today)
}
