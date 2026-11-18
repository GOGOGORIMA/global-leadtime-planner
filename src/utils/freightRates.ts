/**
 * Indicative logistics rates for the export quotation board (tab ⑥).
 *
 * Origin: Japanese main ports / airports (Tokyo, Yokohama, Nagoya, Osaka, Kobe / Narita, Haneda,
 * Kansai). Every value is a rough "normal market" planning level — actual quotes vary with the
 * carrier, the port pair, the season and the cargo. The board multiplies the base freight by the
 * market level (通常期 1.0x / 繁忙期 1.5x / 高騰期 2.5x) and every amount can be overwritten.
 *
 * Pure data + pure functions (no Date / Intl / global state).
 */
import type { ContainerId } from '../data/containers'

/** International transport: full container, consolidated sea freight, or air. */
export const SHIPPING_MODES = ['fcl', 'lcl', 'air'] as const
export type ShippingMode = (typeof SHIPPING_MODES)[number]

export function isShippingMode(value: unknown): value is ShippingMode {
  return typeof value === 'string' && (SHIPPING_MODES as readonly string[]).includes(value)
}

/** Transport mode setting of the quotation: `auto` follows the recommendation from the estimated volume. */
export const QUOTE_MODES = ['auto', ...SHIPPING_MODES] as const
export type QuoteMode = (typeof QUOTE_MODES)[number]

export function isQuoteMode(value: unknown): value is QuoteMode {
  return typeof value === 'string' && (QUOTE_MODES as readonly string[]).includes(value)
}

/** Freight market level (市況): applied as a factor to the base freight of the table. */
export const FREIGHT_MARKETS = ['normal', 'peak', 'surge'] as const
export type FreightMarket = (typeof FREIGHT_MARKETS)[number]

export function isFreightMarket(value: unknown): value is FreightMarket {
  return typeof value === 'string' && (FREIGHT_MARKETS as readonly string[]).includes(value)
}

export const MARKET_FACTORS: Readonly<Record<FreightMarket, number>> = { normal: 1, peak: 1.5, surge: 2.5 }

/** Country the board quotes from (the freight table starts in Japan). */
export const FREIGHT_ORIGIN = 'JP'

/** Minimum air freight per shipment (USD, before the market factor). */
export const AIR_MIN_CHARGE_USD = 80

export type FreightRegion =
  | 'eastAsia'
  | 'southeastAsia'
  | 'southAsia'
  | 'middleEast'
  | 'europe'
  | 'russiaCis'
  | 'northAmerica'
  | 'latinAmerica'
  | 'africa'
  | 'oceania'

export const FREIGHT_REGION_LABELS: Readonly<Record<FreightRegion, string>> = {
  eastAsia: '東アジア',
  southeastAsia: '東南アジア',
  southAsia: '南アジア',
  middleEast: '中東',
  europe: '欧州',
  russiaCis: 'ロシア・CIS',
  northAmerica: '北米',
  latinAmerica: '中南米',
  africa: 'アフリカ',
  oceania: 'オセアニア',
}

export interface FreightRates {
  /** Ocean freight per container (USD; base rate incl. BAF, excl. origin / destination charges). */
  fcl20: number
  fcl40: number
  /** 40ft High Cube: 40ft + US$50 within Asia, + US$100 on the other trades. */
  fcl40hc: number
  /** LCL ocean freight per revenue ton (USD / R/T, W/M). */
  lcl: number
  /** Air freight per chargeable kg (USD, incl. fuel / security surcharges, +100 kg break). */
  air: number
}

export interface FreightLane extends FreightRates {
  region: FreightRegion
  /** Representative port of discharge (English), or `undefined` for a region estimate. */
  port?: string
  /** `true` when no dedicated lane exists and the region's estimate is used. */
  estimated: boolean
}

/** Dedicated lanes from Japan (normal market). */
const LANES: Readonly<Record<string, FreightRates & { port: string }>> = {
  KR: { port: 'Busan', fcl20: 200, fcl40: 350, fcl40hc: 400, lcl: 15, air: 2.2 },
  CN: { port: 'Shanghai', fcl20: 250, fcl40: 450, fcl40hc: 500, lcl: 15, air: 2.5 },
  TW: { port: 'Keelung / Kaohsiung', fcl20: 280, fcl40: 500, fcl40hc: 550, lcl: 25, air: 2.4 },
  HK: { port: 'Hong Kong', fcl20: 300, fcl40: 550, fcl40hc: 600, lcl: 25, air: 2.6 },
  MN: { port: 'Ulaanbaatar (via Tianjin)', fcl20: 1800, fcl40: 3000, fcl40hc: 3100, lcl: 120, air: 4.5 },
  TH: { port: 'Laem Chabang', fcl20: 350, fcl40: 650, fcl40hc: 700, lcl: 30, air: 2.8 },
  VN: { port: 'Ho Chi Minh City / Haiphong', fcl20: 350, fcl40: 650, fcl40hc: 700, lcl: 30, air: 2.8 },
  SG: { port: 'Singapore', fcl20: 300, fcl40: 550, fcl40hc: 600, lcl: 25, air: 2.6 },
  MY: { port: 'Port Klang', fcl20: 380, fcl40: 700, fcl40hc: 750, lcl: 30, air: 2.8 },
  ID: { port: 'Jakarta', fcl20: 450, fcl40: 800, fcl40hc: 850, lcl: 35, air: 3 },
  PH: { port: 'Manila', fcl20: 450, fcl40: 800, fcl40hc: 850, lcl: 35, air: 3 },
  IN: { port: 'Nhava Sheva / Chennai', fcl20: 800, fcl40: 1400, fcl40hc: 1500, lcl: 55, air: 3.8 },
  PK: { port: 'Karachi', fcl20: 1000, fcl40: 1700, fcl40hc: 1800, lcl: 65, air: 4.2 },
  BD: { port: 'Chittagong', fcl20: 1000, fcl40: 1800, fcl40hc: 1900, lcl: 65, air: 4.2 },
  LK: { port: 'Colombo', fcl20: 800, fcl40: 1400, fcl40hc: 1500, lcl: 55, air: 3.8 },
  AE: { port: 'Jebel Ali', fcl20: 1200, fcl40: 2000, fcl40hc: 2100, lcl: 65, air: 4.2 },
  SA: { port: 'Dammam / Jeddah', fcl20: 1400, fcl40: 2400, fcl40hc: 2500, lcl: 75, air: 4.5 },
  US: { port: 'Los Angeles / Long Beach', fcl20: 1700, fcl40: 2200, fcl40hc: 2300, lcl: 75, air: 4.8 },
  CA: { port: 'Vancouver', fcl20: 1800, fcl40: 2400, fcl40hc: 2500, lcl: 80, air: 5 },
  MX: { port: 'Manzanillo', fcl20: 1900, fcl40: 2800, fcl40hc: 2900, lcl: 95, air: 5.5 },
  BR: { port: 'Santos', fcl20: 2600, fcl40: 4200, fcl40hc: 4300, lcl: 130, air: 7 },
  CL: { port: 'San Antonio', fcl20: 2300, fcl40: 3800, fcl40hc: 3900, lcl: 120, air: 6.5 },
  PE: { port: 'Callao', fcl20: 2200, fcl40: 3600, fcl40hc: 3700, lcl: 115, air: 6.5 },
  CO: { port: 'Buenaventura / Cartagena', fcl20: 2400, fcl40: 3900, fcl40hc: 4000, lcl: 120, air: 6.5 },
  AR: { port: 'Buenos Aires', fcl20: 2800, fcl40: 4500, fcl40hc: 4600, lcl: 140, air: 7.5 },
  DE: { port: 'Hamburg', fcl20: 1500, fcl40: 2600, fcl40hc: 2700, lcl: 80, air: 4.8 },
  NL: { port: 'Rotterdam', fcl20: 1500, fcl40: 2600, fcl40hc: 2700, lcl: 80, air: 4.8 },
  BE: { port: 'Antwerp', fcl20: 1500, fcl40: 2600, fcl40hc: 2700, lcl: 80, air: 4.8 },
  GB: { port: 'Felixstowe / Southampton', fcl20: 1600, fcl40: 2800, fcl40hc: 2900, lcl: 85, air: 4.8 },
  FR: { port: 'Le Havre', fcl20: 1600, fcl40: 2800, fcl40hc: 2900, lcl: 85, air: 4.8 },
  IT: { port: 'Genoa', fcl20: 1700, fcl40: 3000, fcl40hc: 3100, lcl: 90, air: 4.8 },
  ES: { port: 'Valencia / Barcelona', fcl20: 1700, fcl40: 3000, fcl40hc: 3100, lcl: 90, air: 4.8 },
  PL: { port: 'Gdansk', fcl20: 1700, fcl40: 2900, fcl40hc: 3000, lcl: 90, air: 5 },
  TR: { port: 'Istanbul / Mersin', fcl20: 1800, fcl40: 3100, fcl40hc: 3200, lcl: 95, air: 5 },
  RU: { port: 'Vladivostok', fcl20: 1500, fcl40: 2500, fcl40hc: 2600, lcl: 90, air: 6 },
  ZA: { port: 'Durban', fcl20: 2200, fcl40: 3600, fcl40hc: 3700, lcl: 110, air: 6 },
  EG: { port: 'Alexandria / Port Said', fcl20: 1900, fcl40: 3200, fcl40hc: 3300, lcl: 100, air: 5.5 },
  KE: { port: 'Mombasa', fcl20: 2400, fcl40: 3900, fcl40hc: 4000, lcl: 120, air: 6 },
  NG: { port: 'Lagos (Apapa)', fcl20: 2800, fcl40: 4600, fcl40hc: 4700, lcl: 140, air: 7 },
  AU: { port: 'Sydney / Melbourne', fcl20: 900, fcl40: 1600, fcl40hc: 1700, lcl: 60, air: 4 },
  NZ: { port: 'Auckland', fcl20: 1100, fcl40: 1900, fcl40hc: 2000, lcl: 70, air: 4.5 },
}

/** Estimates for the other countries of each region (smaller / less served markets cost more). */
const REGION_RATES: Readonly<Record<FreightRegion, FreightRates>> = {
  eastAsia: { fcl20: 400, fcl40: 700, fcl40hc: 750, lcl: 35, air: 3 },
  southeastAsia: { fcl20: 600, fcl40: 1100, fcl40hc: 1150, lcl: 45, air: 3.5 },
  southAsia: { fcl20: 1500, fcl40: 2600, fcl40hc: 2700, lcl: 90, air: 5 },
  middleEast: { fcl20: 1600, fcl40: 2800, fcl40hc: 2900, lcl: 85, air: 5 },
  europe: { fcl20: 1900, fcl40: 3300, fcl40hc: 3400, lcl: 100, air: 5.2 },
  russiaCis: { fcl20: 2500, fcl40: 4000, fcl40hc: 4100, lcl: 130, air: 6.5 },
  northAmerica: { fcl20: 2800, fcl40: 4200, fcl40hc: 4300, lcl: 130, air: 6 },
  latinAmerica: { fcl20: 3000, fcl40: 4800, fcl40hc: 4900, lcl: 150, air: 7.5 },
  africa: { fcl20: 3000, fcl40: 5000, fcl40hc: 5100, lcl: 150, air: 7.5 },
  oceania: { fcl20: 2000, fcl40: 3500, fcl40hc: 3600, lcl: 120, air: 6 },
}

/** Freight region of every destination (ISO 3166-1 alpha-2). */
const REGION_COUNTRIES: Readonly<Record<FreightRegion, string>> = {
  eastAsia: 'KR CN TW HK MO MN',
  southeastAsia: 'TH VN MY SG ID PH BN KH LA MM TL',
  southAsia: 'IN PK BD LK NP MV BT AF',
  middleEast: 'AE SA QA BH KW OM JO IQ IL IR YE LB SY PS',
  europe:
    'DE NL BE LU FR GB IE IT ES PT GR MT CY AT CH LI DK SE NO FI IS FO AX SJ PL CZ SK HU SI HR BA RS ME MK AL XK RO BG MD UA EE LV LT AD MC SM VA GI GG JE IM TR IC GL',
  russiaCis: 'RU BY KZ UZ KG TJ TM AZ GE AM',
  northAmerica: 'US CA BM PM',
  latinAmerica:
    'MX GT BZ SV HN NI CR PA CU JM HT DO PR BS TC KY BB TT AG DM GD KN LC VC AI MS VG VI AW BQ CW SX GP MQ MF BL CO VE GY SR GF EC PE BO BR PY UY AR CL',
  africa:
    'EG LY TN DZ MA EH SD SS ET ER DJ SO KE UG TZ RW BI CD CG GA GQ CM CF TD NE NG BJ TG GH CI BF ML SN GM GW GN SL LR MR CV ST AO ZM ZW MW MZ BW NA ZA LS SZ MG KM YT RE MU SC SH',
  oceania: 'AU NZ FJ NC PF VU GU NF AS CK TO WF CX CC PG WS SB KI FM MH PW NR TV',
}

const REGION_BY_COUNTRY: ReadonlyMap<string, FreightRegion> = new Map(
  (Object.entries(REGION_COUNTRIES) as Array<[FreightRegion, string]>).flatMap(([region, codes]) =>
    codes.split(' ').map((code) => [code, region] as const),
  ),
)

/** Freight region of a destination (`undefined` for the origin and unknown codes). */
export function freightRegion(country: string): FreightRegion | undefined {
  return REGION_BY_COUNTRY.get(country)
}

/** `true` when the country has a dedicated lane (not only a region estimate). */
export function hasDedicatedLane(country: string): boolean {
  return country in LANES
}

/** Countries with a dedicated lane, in table order (grouped by region). */
export const DEDICATED_LANE_COUNTRIES: readonly string[] = Object.keys(LANES)

/**
 * Rates from Japan to `country`: its dedicated lane, else the region estimate. Countries outside
 * the region map (none in the catalog) use the most conservative region estimate (Africa).
 */
export function getFreightLane(country: string): FreightLane {
  const lane = LANES[country]
  const region = REGION_BY_COUNTRY.get(country) ?? 'africa'
  if (lane) return { ...lane, region, estimated: false }
  return { ...REGION_RATES[region], region, estimated: true }
}

export type ContainerSize = '20' | '40'

/** 20ft Dry → '20', 40ft Dry / 40ft HQ → '40' (port charges and DAP presets treat HQ like a 40ft). */
export function containerSize(id: ContainerId): ContainerSize {
  return id === '20dc' ? '20' : '40'
}

/** Quantity × rate of a freight / charge amount (USD or JPY). */
export interface RatedAmount {
  rate: number
  quantity: number
  /** `container` = per container, `rt` = per revenue ton, `kg` = per chargeable kg. */
  unit: 'container' | 'rt' | 'kg'
  /** Fixed part per shipment (local charges), 0 if none. */
  base: number
  /** `true` when a minimum charge replaced rate × quantity. */
  minimum: boolean
  amount: number
}

export interface FreightBasis {
  mode: ShippingMode
  /** FCL: container type and count. */
  container: ContainerId
  units: number
  /** LCL: revenue tons (already at least 1.0). */
  revenueTons: number
  /** Air: chargeable weight (kg). */
  chargeableKg: number
}

/** Base international freight (USD, normal market — multiply by the market factor). */
export function baseFreightUsd(lane: FreightRates, basis: FreightBasis): RatedAmount {
  switch (basis.mode) {
    case 'fcl': {
      const rate = basis.container === '20dc' ? lane.fcl20 : basis.container === '40hc' ? lane.fcl40hc : lane.fcl40
      return { rate, quantity: basis.units, unit: 'container', base: 0, minimum: false, amount: rate * basis.units }
    }
    case 'lcl':
      return {
        rate: lane.lcl,
        quantity: basis.revenueTons,
        unit: 'rt',
        base: 0,
        minimum: false,
        amount: lane.lcl * basis.revenueTons,
      }
    case 'air': {
      const amount = lane.air * basis.chargeableKg
      const minimum = amount < AIR_MIN_CHARGE_USD
      return {
        rate: lane.air,
        quantity: basis.chargeableKg,
        unit: 'kg',
        base: 0,
        minimum,
        amount: minimum ? AIR_MIN_CHARGE_USD : amount,
      }
    }
  }
}

/** Destination charges (DAP): terminal handling, D/O, import clearance and delivery (USD). */
interface LocalChargeRates {
  fcl20: number
  fcl40: number
  lclPerRt: number
  lclBase: number
  airPerKg: number
  airBase: number
}

const LOCAL_CHARGES: Readonly<Record<FreightRegion, LocalChargeRates>> = {
  eastAsia: { fcl20: 380, fcl40: 520, lclPerRt: 40, lclBase: 90, airPerKg: 0.3, airBase: 90 },
  southeastAsia: { fcl20: 400, fcl40: 550, lclPerRt: 40, lclBase: 90, airPerKg: 0.3, airBase: 90 },
  southAsia: { fcl20: 450, fcl40: 620, lclPerRt: 45, lclBase: 110, airPerKg: 0.35, airBase: 110 },
  middleEast: { fcl20: 550, fcl40: 750, lclPerRt: 50, lclBase: 120, airPerKg: 0.4, airBase: 120 },
  europe: { fcl20: 950, fcl40: 1250, lclPerRt: 70, lclBase: 160, airPerKg: 0.55, airBase: 160 },
  russiaCis: { fcl20: 850, fcl40: 1150, lclPerRt: 65, lclBase: 150, airPerKg: 0.5, airBase: 150 },
  northAmerica: { fcl20: 1000, fcl40: 1300, lclPerRt: 75, lclBase: 160, airPerKg: 0.6, airBase: 160 },
  latinAmerica: { fcl20: 900, fcl40: 1200, lclPerRt: 65, lclBase: 150, airPerKg: 0.5, airBase: 150 },
  africa: { fcl20: 900, fcl40: 1200, lclPerRt: 65, lclBase: 150, airPerKg: 0.5, airBase: 150 },
  oceania: { fcl20: 900, fcl40: 1200, lclPerRt: 70, lclBase: 160, airPerKg: 0.55, airBase: 160 },
}

/** Preset destination (DAP) charges in USD for the lane's region. */
export function localChargesUsd(region: FreightRegion, basis: FreightBasis): RatedAmount {
  const r = LOCAL_CHARGES[region]
  switch (basis.mode) {
    case 'fcl': {
      const rate = containerSize(basis.container) === '20' ? r.fcl20 : r.fcl40
      return { rate, quantity: basis.units, unit: 'container', base: 0, minimum: false, amount: rate * basis.units }
    }
    case 'lcl':
      return {
        rate: r.lclPerRt,
        quantity: basis.revenueTons,
        unit: 'rt',
        base: r.lclBase,
        minimum: false,
        amount: r.lclBase + r.lclPerRt * basis.revenueTons,
      }
    case 'air':
      return {
        rate: r.airPerKg,
        quantity: basis.chargeableKg,
        unit: 'kg',
        base: r.airBase,
        minimum: false,
        amount: r.airBase + r.airPerKg * basis.chargeableKg,
      }
  }
}

/** Domestic truck freight factory → port / airport (JPY per truck). */
export const DOMESTIC_TRUCK_RATES: Readonly<Partial<Record<ContainerId, number>>> = {
  '2t': 35000,
  '4t': 55000,
  '10t': 95000,
}

export function domesticTruckJpy(truck: ContainerId, units: number): number {
  return (DOMESTIC_TRUCK_RATES[truck] ?? DOMESTIC_TRUCK_RATES['10t'] ?? 0) * units
}

/** Japanese export charges (JPY). */
export const EXPORT_CHARGE_RATES = {
  /** 輸出通関料 (per declaration). */
  customs: 11800,
  /** B/L 作成料 (sea) / AWB 作成料 (air), per shipment. */
  billOfLading: 6000,
  airwayBill: 5000,
  /** Per container: terminal handling, vanning at the port warehouse, seal. */
  fcl: {
    '20': { thc: 45000, vanning: 35000, seal: 1800 },
    '40': { thc: 64000, vanning: 52000, seal: 1800 },
  },
  /** LCL: CFS charge incl. THC per revenue ton (at least 1 R/T). */
  lclPerRt: 6000,
  /** Air: terminal handling incl. X-ray screening per chargeable kg, with a minimum. */
  airPerKg: 35,
  airMin: 6000,
} as const

export type ExportChargeKey = 'thc' | 'vanning' | 'seal' | 'cfs' | 'airHandling' | 'customs' | 'document'

export interface ExportChargeLine {
  key: ExportChargeKey
  /** Unit price (JPY) and quantity (containers / R/T / kg; 1 for per-shipment items). */
  rate: number
  quantity: number
  amount: number
}

/** Export clearance & port charges (THC / B/L / vanning …) for one shipment, JPY. */
export function exportChargesJpy(basis: FreightBasis): { lines: ExportChargeLine[]; total: number } {
  const r = EXPORT_CHARGE_RATES
  const lines: ExportChargeLine[] = []
  const add = (key: ExportChargeKey, rate: number, quantity: number, amount = rate * quantity) =>
    lines.push({ key, rate, quantity, amount: Math.round(amount) })
  if (basis.mode === 'fcl') {
    const c = r.fcl[containerSize(basis.container)]
    add('thc', c.thc, basis.units)
    add('vanning', c.vanning, basis.units)
    add('seal', c.seal, basis.units)
  } else if (basis.mode === 'lcl') {
    add('cfs', r.lclPerRt, basis.revenueTons)
  } else {
    add('airHandling', r.airPerKg, basis.chargeableKg, Math.max(r.airMin, r.airPerKg * basis.chargeableKg))
  }
  add('customs', r.customs, 1)
  add('document', basis.mode === 'air' ? r.airwayBill : r.billOfLading, 1)
  return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0) }
}
