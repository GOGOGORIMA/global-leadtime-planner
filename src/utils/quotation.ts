/**
 * Export quotation board (tab ⑥): links the loading simulator (tab ⑤) to the Incoterms price
 * build-up. `linkCargo` does the (heavier) packing work once per cargo change; `computeQuote` is
 * cheap and runs on every keystroke. Pure functions.
 */
import { getContainerSpec, specsOfCategory, type ContainerCategory, type ContainerId, type ContainerSpec } from '../data/containers'
import { CURRENCY_INFO, type QuoteCurrency } from '../data/currencies'
import { DEFAULT_VALIDITY_DAYS } from '../state/defaults'
import type { CargoItem, CushionSettings, MoneyAmount, QuoteSettings } from '../types'
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
  type RatedAmount,
} from './freightRates'
import {
  INCOTERMS,
  appliedRate,
  calculateIncoterms,
  chargeableWeight,
  convertFromJpy,
  incotermPrices,
  revenueTons,
  type Incoterm,
  type IncotermsResult,
} from './incotermsCalc'

/** Where a container / truck choice comes from. */
export type UnitSource = 'manual' | 'selected' | 'suggested' | 'default'

export interface UnitChoice {
  spec: ContainerSpec
  units: number
  source: UnitSource
  /** No standard size of this kind can carry the cargo (special equipment, quote separately). */
  unavailable: boolean
}

/** Cargo figures taken over from the loading simulator. */
export interface CargoLink {
  /** Pieces and cargo rows. */
  pieces: number
  types: number
  /** Net cargo volume (m³, the packages themselves) and gross weight (kg). */
  volume: number
  weight: number
  /** Container / truck selected in the simulator. */
  selected: ContainerSpec
  /** FCL containers: the selected container when it is a sea container, else the sea suggestion. */
  sea: UnitChoice
  /** Domestic trucks: the selected truck, else the road suggestion. */
  truck: UnitChoice
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

/** Volume, weight, containers and trucks of the loading simulator's cargo. */
export function linkCargo(
  items: readonly CargoItem[],
  selectedId: ContainerId,
  cushioning: Record<ContainerCategory, CushionSettings>,
): CargoLink {
  const selected = getContainerSpec(selectedId)
  return {
    pieces: items.reduce((sum, item) => sum + item.quantity, 0),
    types: items.length,
    volume: items.reduce((sum, item) => sum + ((item.length * item.width * item.height) / 1e9) * item.quantity, 0),
    weight: items.reduce((sum, item) => sum + item.weight * item.quantity, 0),
    selected,
    sea: chooseUnits('sea', items, selected, cushioning.sea),
    truck: chooseUnits('truck', items, selected, cushioning.truck),
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
  /** Cargo after overrides. */
  volume: number
  weight: number
  volumeLinked: boolean
  weightLinked: boolean
  pieces: number
  revenueTons: number
  chargeableKg: number
  container: UnitChoice
  truck: UnitChoice
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

export function computeQuote(settings: QuoteSettings, link: CargoLink, destination: string, today: ISODate): QuoteResult {
  const currency = settings.currency
  const decimals = CURRENCY_INFO[currency].decimals
  const marketRate = currency === 'JPY' ? 1 : settings.fxRate
  const rate = currency === 'JPY' ? 1 : appliedRate(settings.fxRate, settings.fxBuffer)
  const usdRate = currency === 'USD' ? settings.fxRate : settings.usdRate

  const volume = settings.volume ?? link.volume
  const weight = settings.weight ?? link.weight
  const rt = revenueTons(volume, weight)
  const chargeableKg = chargeableWeight(volume, weight)

  const container: UnitChoice = settings.container
    ? { spec: getContainerSpec(settings.container.id), units: settings.container.units, source: 'manual', unavailable: false }
    : link.sea
  const truck: UnitChoice = settings.truck
    ? { spec: getContainerSpec(settings.truck.id), units: settings.truck.units, source: 'manual', unavailable: false }
    : link.truck

  const basis: FreightBasis = {
    mode: settings.mode,
    container: container.spec.id,
    units: container.units,
    revenueTons: rt,
    chargeableKg,
  }

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

  const domestic = settings.domestic ?? domesticAuto
  const exportCharges = settings.exportCharges ?? exportAuto.total

  const incoterms = calculateIncoterms({
    exw: settings.exw,
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
    volume,
    weight,
    volumeLinked: settings.volume === null,
    weightLinked: settings.weight === null,
    pieces: link.pieces,
    revenueTons: rt,
    chargeableKg,
    container,
    truck,
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
  return computeQuote(settings, linkCargo(items, selectedId, cushioning), destination, today)
}
