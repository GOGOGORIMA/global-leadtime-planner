/**
 * Indicative logistics rates for the export quotation board (tab ⑥) — every amount in JPY.
 *
 * Origin: Japanese main ports / airports (Tokyo, Yokohama, Nagoya, Osaka, Kobe / Narita, Haneda,
 * Kansai). Values are "normal market" (通常期) planning levels, deliberately not optimistic: sea and
 * air freight include the carriers' surcharges (BAF / LSS / EBS …, air: fuel / security), and the
 * origin charges (customs, THC, CFS, B/L, vanning …) and destination charges are added separately.
 * The board multiplies the table freight by the market level (1.0x / 1.5x / 2.5x) and every amount
 * can be overwritten with a forwarder's actual quote.
 *
 * Planning bands (min–max per unit, normal market) the lanes are calibrated to:
 *
 *   near Asia (KR, CN …)        LCL ¥18,000–28,000 per R/T incl. the origin CFS / THC
 *                               20ft ¥120,000–180,000, 40ft / HQ ¥190,000–280,000
 *   South Asia (IN …)           LCL ¥28,000–45,000, 20ft ¥250,000–420,000, 40ft / HQ ¥380,000–620,000
 *   North America / Europe      LCL ¥35,000–55,000, 20ft ¥450,000–750,000, 40ft / HQ ¥650,000–1,050,000
 *                               (US East Coast and Europe at the upper end)
 *   Air                         Asia ¥600–1,100 / kg, North America / Europe ¥1,300–2,200 / kg
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

/** Freight market level (市況): applied as a factor to the table freight. */
export const FREIGHT_MARKETS = ['normal', 'peak', 'surge'] as const
export type FreightMarket = (typeof FREIGHT_MARKETS)[number]

export function isFreightMarket(value: unknown): value is FreightMarket {
  return typeof value === 'string' && (FREIGHT_MARKETS as readonly string[]).includes(value)
}

export const MARKET_FACTORS: Readonly<Record<FreightMarket, number>> = { normal: 1, peak: 1.5, surge: 2.5 }

/** Country the board quotes from (the freight table starts in Japan). */
export const FREIGHT_ORIGIN = 'JP'

/**
 * Share of the table freight shown as surcharges (BAF / LSS / EBS …, air: fuel / security) next to
 * the base freight (O/F). Both parts can be overwritten separately, like the lines of a forwarder's quote.
 */
export const SURCHARGE_SHARE = 0.3

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

/** Sea / air freight per unit (JPY, normal market). */
export interface FreightRates {
  /** Sea freight per container incl. surcharges, excl. origin / destination charges. */
  fcl20: number
  fcl40: number
  fcl40hc: number
  /** LCL sea freight incl. surcharges per revenue ton (W/M), excl. the origin CFS / THC. */
  lcl: number
  /** Air freight per chargeable kg incl. fuel / security surcharges. */
  air: number
}

/** Planning band of a trade: min–max per unit (JPY, normal market). */
export interface RateBand {
  /** LCL per R/T including the origin CFS / THC. */
  lcl: readonly [number, number]
  fcl20: readonly [number, number]
  /** 40ft Dry and 40ft HQ. */
  fcl40: readonly [number, number]
  /** Air per chargeable kg. */
  air: readonly [number, number]
}

/** A representative port to choose from (US West / East Coast). */
export interface PortOption {
  id: string
  /** Japanese label of the choice, e.g. 西海岸. */
  label: string
  port: string
}

export interface FreightLane extends FreightRates {
  region: FreightRegion
  /** Representative port of discharge (English), or `undefined` for a region estimate. */
  port?: string
  /** `true` when no dedicated lane exists and the region's estimate is used. */
  estimated: boolean
  /** Planning band of the trade (the table rates sit inside it). */
  band: RateBand
  /** Port choices of the destination (empty when it has one representative port) and the one used. */
  ports: readonly PortOption[]
  portId: string
}

type LaneData = FreightRates & { port: string; band?: RateBand }

const band = (lcl: [number, number], fcl20: [number, number], fcl40: [number, number], air: [number, number]): RateBand => ({
  lcl,
  fcl20,
  fcl40,
  air,
})

/** Planning bands of the regions (main ports; the user's reference levels for KR / CN, IN, US / GB / DE). */
const REGION_BANDS: Readonly<Record<FreightRegion, RateBand>> = {
  eastAsia: band([18_000, 28_000], [120_000, 180_000], [190_000, 280_000], [600, 1_100]),
  southeastAsia: band([22_000, 35_000], [160_000, 260_000], [250_000, 400_000], [700, 1_100]),
  southAsia: band([28_000, 45_000], [250_000, 420_000], [380_000, 620_000], [700, 1_100]),
  middleEast: band([30_000, 48_000], [300_000, 520_000], [480_000, 800_000], [900, 1_500]),
  europe: band([35_000, 55_000], [450_000, 750_000], [650_000, 1_050_000], [1_300, 2_200]),
  russiaCis: band([35_000, 60_000], [400_000, 800_000], [600_000, 1_200_000], [1_300, 2_400]),
  northAmerica: band([35_000, 55_000], [450_000, 750_000], [650_000, 1_050_000], [1_300, 2_200]),
  latinAmerica: band([45_000, 70_000], [600_000, 1_000_000], [900_000, 1_500_000], [1_800, 2_800]),
  africa: band([45_000, 70_000], [600_000, 1_050_000], [900_000, 1_550_000], [1_800, 2_800]),
  oceania: band([30_000, 50_000], [280_000, 650_000], [450_000, 950_000], [1_000, 2_000]),
}

/** US West Coast (default where the partner works on Pacific / Mountain time) and East Coast. */
const US_WEST: LaneData = { port: 'Los Angeles / Long Beach', fcl20: 500_000, fcl40: 700_000, fcl40hc: 720_000, lcl: 32_500, air: 1_500 }
const US_EAST: LaneData = { port: 'New York / Savannah', fcl20: 700_000, fcl40: 990_000, fcl40hc: 1_010_000, lcl: 45_500, air: 1_700 }

/** Dedicated lanes from Japan (normal market, JPY). LCL excludes the origin CFS / THC (¥6,500 per R/T). */
const LANES: Readonly<Record<string, LaneData>> = {
  KR: { port: 'Busan', fcl20: 140_000, fcl40: 215_000, fcl40hc: 225_000, lcl: 15_000, air: 650 },
  CN: { port: 'Shanghai', fcl20: 150_000, fcl40: 230_000, fcl40hc: 240_000, lcl: 16_000, air: 700 },
  TW: { port: 'Keelung / Kaohsiung', fcl20: 160_000, fcl40: 245_000, fcl40hc: 255_000, lcl: 17_500, air: 750 },
  HK: { port: 'Hong Kong', fcl20: 160_000, fcl40: 245_000, fcl40hc: 255_000, lcl: 17_500, air: 750 },
  MN: {
    port: 'Ulaanbaatar (via Tianjin)',
    fcl20: 560_000,
    fcl40: 860_000,
    fcl40hc: 880_000,
    lcl: 42_000,
    air: 1_300,
    // Landlocked: sea to Tianjin and rail to Ulaanbaatar.
    band: band([40_000, 65_000], [450_000, 700_000], [700_000, 1_050_000], [1_100, 1_600]),
  },
  TH: { port: 'Laem Chabang', fcl20: 190_000, fcl40: 295_000, fcl40hc: 305_000, lcl: 19_500, air: 800 },
  VN: { port: 'Ho Chi Minh City / Haiphong', fcl20: 190_000, fcl40: 295_000, fcl40hc: 305_000, lcl: 19_500, air: 800 },
  SG: { port: 'Singapore', fcl20: 175_000, fcl40: 275_000, fcl40hc: 285_000, lcl: 18_000, air: 750 },
  MY: { port: 'Port Klang', fcl20: 200_000, fcl40: 310_000, fcl40hc: 320_000, lcl: 20_500, air: 820 },
  ID: { port: 'Jakarta', fcl20: 220_000, fcl40: 340_000, fcl40hc: 350_000, lcl: 22_500, air: 880 },
  PH: { port: 'Manila', fcl20: 220_000, fcl40: 340_000, fcl40hc: 350_000, lcl: 22_500, air: 880 },
  IN: { port: 'Nhava Sheva / Chennai', fcl20: 330_000, fcl40: 500_000, fcl40hc: 515_000, lcl: 29_500, air: 950 },
  PK: { port: 'Karachi', fcl20: 380_000, fcl40: 570_000, fcl40hc: 585_000, lcl: 33_500, air: 1_050 },
  BD: { port: 'Chittagong', fcl20: 390_000, fcl40: 585_000, fcl40hc: 600_000, lcl: 34_500, air: 1_050 },
  LK: { port: 'Colombo', fcl20: 300_000, fcl40: 460_000, fcl40hc: 475_000, lcl: 27_500, air: 950 },
  AE: { port: 'Jebel Ali', fcl20: 360_000, fcl40: 560_000, fcl40hc: 575_000, lcl: 29_500, air: 1_100 },
  SA: { port: 'Dammam / Jeddah', fcl20: 420_000, fcl40: 650_000, fcl40hc: 665_000, lcl: 33_500, air: 1_250 },
  US: US_WEST,
  CA: { port: 'Vancouver', fcl20: 520_000, fcl40: 730_000, fcl40hc: 750_000, lcl: 34_500, air: 1_550 },
  MX: { port: 'Manzanillo', fcl20: 620_000, fcl40: 900_000, fcl40hc: 920_000, lcl: 40_500, air: 1_800 },
  BR: { port: 'Santos', fcl20: 820_000, fcl40: 1_230_000, fcl40hc: 1_250_000, lcl: 55_500, air: 2_400 },
  CL: { port: 'San Antonio', fcl20: 760_000, fcl40: 1_140_000, fcl40hc: 1_160_000, lcl: 51_500, air: 2_200 },
  PE: { port: 'Callao', fcl20: 740_000, fcl40: 1_110_000, fcl40hc: 1_130_000, lcl: 50_500, air: 2_200 },
  CO: { port: 'Buenaventura / Cartagena', fcl20: 780_000, fcl40: 1_170_000, fcl40hc: 1_190_000, lcl: 52_500, air: 2_250 },
  AR: { port: 'Buenos Aires', fcl20: 880_000, fcl40: 1_320_000, fcl40hc: 1_340_000, lcl: 58_500, air: 2_500 },
  DE: { port: 'Hamburg', fcl20: 620_000, fcl40: 880_000, fcl40hc: 900_000, lcl: 39_500, air: 1_700 },
  NL: { port: 'Rotterdam', fcl20: 620_000, fcl40: 880_000, fcl40hc: 900_000, lcl: 39_500, air: 1_700 },
  BE: { port: 'Antwerp', fcl20: 620_000, fcl40: 880_000, fcl40hc: 900_000, lcl: 39_500, air: 1_700 },
  GB: { port: 'Felixstowe / Southampton', fcl20: 640_000, fcl40: 910_000, fcl40hc: 930_000, lcl: 41_500, air: 1_750 },
  FR: { port: 'Le Havre', fcl20: 640_000, fcl40: 910_000, fcl40hc: 930_000, lcl: 41_500, air: 1_750 },
  IT: { port: 'Genoa', fcl20: 670_000, fcl40: 950_000, fcl40hc: 970_000, lcl: 43_500, air: 1_800 },
  ES: { port: 'Valencia / Barcelona', fcl20: 670_000, fcl40: 950_000, fcl40hc: 970_000, lcl: 43_500, air: 1_800 },
  PL: { port: 'Gdansk', fcl20: 660_000, fcl40: 940_000, fcl40hc: 960_000, lcl: 43_500, air: 1_800 },
  TR: { port: 'Istanbul / Mersin', fcl20: 690_000, fcl40: 990_000, fcl40hc: 1_010_000, lcl: 45_500, air: 1_850 },
  RU: { port: 'Vladivostok', fcl20: 450_000, fcl40: 680_000, fcl40hc: 700_000, lcl: 36_500, air: 1_600 },
  ZA: { port: 'Durban', fcl20: 720_000, fcl40: 1_070_000, fcl40hc: 1_090_000, lcl: 49_500, air: 2_100 },
  EG: { port: 'Alexandria / Port Said', fcl20: 650_000, fcl40: 960_000, fcl40hc: 980_000, lcl: 45_500, air: 1_900 },
  KE: { port: 'Mombasa', fcl20: 780_000, fcl40: 1_160_000, fcl40hc: 1_180_000, lcl: 53_500, air: 2_300 },
  NG: { port: 'Lagos (Apapa)', fcl20: 920_000, fcl40: 1_380_000, fcl40hc: 1_400_000, lcl: 59_500, air: 2_600 },
  AU: { port: 'Sydney / Melbourne', fcl20: 320_000, fcl40: 500_000, fcl40hc: 515_000, lcl: 27_500, air: 1_200 },
  NZ: { port: 'Auckland', fcl20: 380_000, fcl40: 590_000, fcl40hc: 605_000, lcl: 31_500, air: 1_350 },
}

/** Destinations with more than one representative port (the user can choose; see {@link autoPortId}). */
const PORT_VARIANTS: Readonly<Record<string, ReadonlyArray<{ id: string; label: string; lane: LaneData }>>> = {
  US: [
    { id: 'west', label: '西海岸', lane: US_WEST },
    { id: 'east', label: '東海岸', lane: US_EAST },
  ],
}

/** Port choice ids of every destination (for the URL sanitizer). */
export const PORT_IDS: ReadonlySet<string> = new Set(Object.values(PORT_VARIANTS).flatMap((variants) => variants.map((v) => v.id)))

/** Estimates for the other countries of each region (upper part of the band: smaller markets cost more). */
const REGION_RATES: Readonly<Record<FreightRegion, FreightRates>> = {
  eastAsia: { fcl20: 175_000, fcl40: 270_000, fcl40hc: 280_000, lcl: 20_500, air: 1_000 },
  southeastAsia: { fcl20: 250_000, fcl40: 385_000, fcl40hc: 395_000, lcl: 27_000, air: 1_050 },
  southAsia: { fcl20: 410_000, fcl40: 600_000, fcl40hc: 615_000, lcl: 37_500, air: 1_100 },
  middleEast: { fcl20: 490_000, fcl40: 760_000, fcl40hc: 775_000, lcl: 39_500, air: 1_450 },
  europe: { fcl20: 720_000, fcl40: 1_020_000, fcl40hc: 1_040_000, lcl: 47_500, air: 2_100 },
  russiaCis: { fcl20: 760_000, fcl40: 1_140_000, fcl40hc: 1_160_000, lcl: 51_500, air: 2_300 },
  northAmerica: { fcl20: 720_000, fcl40: 1_020_000, fcl40hc: 1_040_000, lcl: 47_500, air: 2_100 },
  latinAmerica: { fcl20: 950_000, fcl40: 1_420_000, fcl40hc: 1_440_000, lcl: 61_500, air: 2_700 },
  africa: { fcl20: 1_000_000, fcl40: 1_500_000, fcl40hc: 1_520_000, lcl: 62_500, air: 2_750 },
  oceania: { fcl20: 600_000, fcl40: 900_000, fcl40hc: 920_000, lcl: 41_500, air: 1_900 },
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

/** IANA zones on the US West Coast side (Pacific / Mountain / Alaska / Hawaii) → West Coast ports. */
const US_WEST_ZONES: ReadonlySet<string> = new Set([
  'America/Los_Angeles',
  'America/Denver',
  'America/Boise',
  'America/Phoenix',
  'America/Anchorage',
  'America/Juneau',
  'America/Sitka',
  'America/Nome',
  'America/Yakutat',
  'America/Metlakatla',
  'America/Adak',
  'Pacific/Honolulu',
])

/**
 * Port used when none is chosen: for the United States the coast of the partner's time zone (Pacific /
 * Mountain → West Coast, otherwise the dearer East Coast); '' for destinations with one port.
 */
export function autoPortId(country: string, timeZone?: string): string {
  const variants = PORT_VARIANTS[country]
  if (!variants) return ''
  if (country === 'US') return timeZone && US_WEST_ZONES.has(timeZone) ? 'west' : 'east'
  return variants[0].id
}

/**
 * Rates from Japan to `country` (its dedicated lane — at the chosen port — else the region estimate).
 * Countries outside the region map (none in the catalog) use the most conservative region (Africa).
 */
export function getFreightLane(country: string, portId = ''): FreightLane {
  const region = REGION_BY_COUNTRY.get(country) ?? 'africa'
  const variants = PORT_VARIANTS[country]
  const variant = variants ? (variants.find((v) => v.id === portId) ?? variants.find((v) => v.id === autoPortId(country)) ?? variants[0]) : undefined
  const ports = variants ? variants.map((v) => ({ id: v.id, label: v.label, port: v.lane.port })) : []
  const lane = variant?.lane ?? LANES[country]
  if (lane) {
    const { band: laneBand, ...rates } = lane
    return { ...rates, region, estimated: false, band: laneBand ?? REGION_BANDS[region], ports, portId: variant?.id ?? '' }
  }
  return { ...REGION_RATES[region], region, estimated: true, band: REGION_BANDS[region], ports, portId: '' }
}

export type ContainerSize = '20' | '40'

/** 20ft Dry → '20', 40ft Dry / 40ft HQ → '40' (port charges and DAP presets treat HQ like a 40ft). */
export function containerSize(id: ContainerId): ContainerSize {
  return id === '20dc' ? '20' : '40'
}

/** Quantity × rate of a freight / charge amount (JPY). */
export interface RatedAmount {
  rate: number
  quantity: number
  /** `container` = per container, `rt` = per revenue ton, `kg` = per chargeable kg. */
  unit: 'container' | 'rt' | 'kg'
  /** Fixed part per shipment (destination charges), 0 if none. */
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

/** Air freight minimum per shipment (JPY): within Asia, and on the long-haul trades. */
const ASIA_REGIONS: ReadonlySet<FreightRegion> = new Set(['eastAsia', 'southeastAsia', 'southAsia'])

export function airMinimumJpy(region: FreightRegion): number {
  return ASIA_REGIONS.has(region) ? 12_000 : 18_000
}

/** Table freight incl. surcharges (JPY, normal market — multiply by the market factor). */
export function tableFreightJpy(lane: FreightLane, basis: FreightBasis): RatedAmount {
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
        amount: Math.round(lane.lcl * basis.revenueTons),
      }
    case 'air': {
      const amount = Math.round(lane.air * basis.chargeableKg)
      const min = airMinimumJpy(lane.region)
      return { rate: lane.air, quantity: basis.chargeableKg, unit: 'kg', base: 0, minimum: amount < min, amount: Math.max(amount, min) }
    }
  }
}

/** Splits freight into base freight (O/F) and surcharges ({@link SURCHARGE_SHARE}). */
export function splitFreight(totalJpy: number): { base: number; surcharge: number } {
  const surcharge = Math.round(totalJpy * SURCHARGE_SHARE)
  return { base: totalJpy - surcharge, surcharge }
}

/** Destination charges (DAP): terminal handling, D/O, import clearance and delivery (JPY). */
interface LocalChargeRates {
  fcl20: number
  fcl40: number
  lclBase: number
  lclPerRt: number
  airBase: number
  airPerKg: number
}

const LOCAL_CHARGES: Readonly<Record<FreightRegion, LocalChargeRates>> = {
  eastAsia: { fcl20: 70_000, fcl40: 95_000, lclBase: 18_000, lclPerRt: 7_000, airBase: 15_000, airPerKg: 50 },
  southeastAsia: { fcl20: 75_000, fcl40: 100_000, lclBase: 18_000, lclPerRt: 7_500, airBase: 15_000, airPerKg: 50 },
  southAsia: { fcl20: 85_000, fcl40: 115_000, lclBase: 20_000, lclPerRt: 8_000, airBase: 18_000, airPerKg: 55 },
  middleEast: { fcl20: 100_000, fcl40: 135_000, lclBase: 22_000, lclPerRt: 9_000, airBase: 20_000, airPerKg: 60 },
  europe: { fcl20: 170_000, fcl40: 220_000, lclBase: 30_000, lclPerRt: 12_000, airBase: 28_000, airPerKg: 90 },
  russiaCis: { fcl20: 160_000, fcl40: 210_000, lclBase: 28_000, lclPerRt: 11_000, airBase: 26_000, airPerKg: 80 },
  northAmerica: { fcl20: 180_000, fcl40: 230_000, lclBase: 30_000, lclPerRt: 13_000, airBase: 28_000, airPerKg: 95 },
  latinAmerica: { fcl20: 165_000, fcl40: 215_000, lclBase: 28_000, lclPerRt: 11_000, airBase: 26_000, airPerKg: 80 },
  africa: { fcl20: 165_000, fcl40: 215_000, lclBase: 28_000, lclPerRt: 11_000, airBase: 26_000, airPerKg: 80 },
  oceania: { fcl20: 165_000, fcl40: 215_000, lclBase: 30_000, lclPerRt: 12_000, airBase: 28_000, airPerKg: 90 },
}

/** Preset destination (DAP) charges in JPY for the lane's region. */
export function localChargesJpy(region: FreightRegion, basis: FreightBasis): RatedAmount {
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
        amount: Math.round(r.lclBase + r.lclPerRt * basis.revenueTons),
      }
    case 'air':
      return {
        rate: r.airPerKg,
        quantity: basis.chargeableKg,
        unit: 'kg',
        base: r.airBase,
        minimum: false,
        amount: Math.round(r.airBase + r.airPerKg * basis.chargeableKg),
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
  /** B/L 作成料・書類費 (sea) / AWB 作成料 (air), per shipment. */
  billOfLading: 6500,
  airwayBill: 5500,
  /** Advance cargo filing (US AMS, Canada ACI, EU ENS / UK S&S) per B/L. */
  advanceFiling: 5000,
  /** Per container: terminal handling, vanning at the port warehouse, seal. */
  fcl: {
    '20': { thc: 47000, vanning: 38000, seal: 2000 },
    '40': { thc: 67000, vanning: 56000, seal: 2000 },
  },
  /** LCL per revenue ton (at least 1 R/T): CFS charge and THC. */
  lcl: { cfs: 5000, thc: 1500 },
  /** Air: terminal handling incl. X-ray screening per chargeable kg, with a minimum. */
  airPerKg: 40,
  airMin: 7000,
} as const

/** Origin CFS + THC per revenue ton of LCL (part of the LCL all-in rate per R/T). */
export const LCL_ORIGIN_PER_RT = EXPORT_CHARGE_RATES.lcl.cfs + EXPORT_CHARGE_RATES.lcl.thc

/** Regions whose customs require an advance cargo filing by the shipper's forwarder (sea). */
const ADVANCE_FILING_REGIONS: ReadonlySet<FreightRegion> = new Set(['northAmerica', 'europe'])

export type PortChargeKey = 'thc' | 'vanning' | 'seal' | 'cfs' | 'lclThc' | 'airHandling' | 'document' | 'filing'

export interface PortChargeLine {
  key: PortChargeKey
  /** Unit price (JPY) and quantity (containers / R/T / kg; 1 for per-shipment items). */
  rate: number
  quantity: number
  amount: number
}

/**
 * Export port / airport charges for one shipment (JPY): FCL per container (THC, vanning, seal),
 * LCL per revenue ton (CFS, THC), air per kg (terminal handling), plus the B/L / AWB and, to North
 * America and Europe, the advance cargo filing. Customs clearance is a separate item.
 */
export function exportPortChargesJpy(basis: FreightBasis, region: FreightRegion): { lines: PortChargeLine[]; total: number } {
  const r = EXPORT_CHARGE_RATES
  const lines: PortChargeLine[] = []
  const add = (key: PortChargeKey, rate: number, quantity: number, amount = rate * quantity) =>
    lines.push({ key, rate, quantity, amount: Math.round(amount) })
  if (basis.mode === 'fcl') {
    const c = r.fcl[containerSize(basis.container)]
    add('thc', c.thc, basis.units)
    add('vanning', c.vanning, basis.units)
    add('seal', c.seal, basis.units)
  } else if (basis.mode === 'lcl') {
    add('cfs', r.lcl.cfs, basis.revenueTons)
    add('lclThc', r.lcl.thc, basis.revenueTons)
  } else {
    add('airHandling', r.airPerKg, basis.chargeableKg, Math.max(r.airMin, r.airPerKg * basis.chargeableKg))
  }
  add('document', basis.mode === 'air' ? r.airwayBill : r.billOfLading, 1)
  if (basis.mode !== 'air' && ADVANCE_FILING_REGIONS.has(region)) add('filing', r.advanceFiling, 1)
  return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0) }
}

/** Export customs clearance for one declaration (JPY). */
export function exportCustomsJpy(): number {
  return EXPORT_CHARGE_RATES.customs
}
