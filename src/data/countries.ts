/**
 * Country catalog: every country supported by `date-holidays` (≈200) plus a few trade partners
 * without holiday data (time zone / weekend only), with English + Japanese names, flag, default
 * time zone and default weekly days off.
 */
import { getHolidayRegions, getHolidayTimeZones, getSupportedHolidayCountries, hasHolidayData } from '../utils/holidays'
import { isValidTimeZone } from '../utils/timezone'

export interface CountryInfo {
  /** ISO 3166-1 alpha-2 code — internal identifier only; never shown in the UI (flag + name instead). */
  code: string
  nameEn: string
  nameJa: string
  /** `false` for countries without holiday rules (only weekends + custom holidays apply). */
  hasHolidayData: boolean
}

/** Base country used on first visit. */
export const DEFAULT_BASE_COUNTRY = 'JP'

/**
 * Partner countries pre-selected on first visit, in this order (also offered as one-click presets):
 * Korea, China, United States, United Kingdom, Germany, India. Every other catalog country (Taiwan,
 * Thailand, Malaysia, Vietnam, Singapore …) can still be added from the search box.
 */
export const PRESET_PARTNER_COUNTRIES = ['KR', 'CN', 'US', 'GB', 'DE', 'IN'] as const

/**
 * Holiday region used when none is chosen. UK bank holidays differ by nation and the UK-wide data has
 * no August bank holiday, so the United Kingdom uses England's bank holidays (England & Wales) by default.
 */
const DEFAULT_HOLIDAY_REGIONS: Readonly<Record<string, string>> = { GB: 'ENG' }

export function getDefaultRegion(code: string): string | undefined {
  return DEFAULT_HOLIDAY_REGIONS[code]
}

/** Default business hours: 09:00–18:00 local time. */
export const DEFAULT_WORK_START = 9 * 60
export const DEFAULT_WORK_END = 18 * 60

/** Default weekly days off (0 = Sunday … 6 = Saturday). */
export const DEFAULT_WEEKEND: readonly number[] = [0, 6]

const FRI_SAT = [5, 6]

/**
 * Countries whose standard weekend is not Saturday/Sunday. Can be overridden per country in the UI
 * (e.g. for companies that work on Saturdays).
 */
const WEEKEND_BY_COUNTRY: Record<string, readonly number[]> = {
  SA: FRI_SAT, // Saudi Arabia
  EG: FRI_SAT, // Egypt
  QA: FRI_SAT, // Qatar
  KW: FRI_SAT, // Kuwait
  BH: FRI_SAT, // Bahrain
  OM: FRI_SAT, // Oman
  JO: FRI_SAT, // Jordan
  IL: FRI_SAT, // Israel
  BD: FRI_SAT, // Bangladesh
  DZ: FRI_SAT, // Algeria
  IQ: FRI_SAT, // Iraq
  LY: FRI_SAT, // Libya
  SD: FRI_SAT, // Sudan
  MV: FRI_SAT, // Maldives
  IR: [5], // Iran: Friday (many offices also close on Thursday)
  BN: [0, 5], // Brunei: Friday & Sunday
  NP: [6], // Nepal: Saturday
}

/** States with a different weekend than the rest of the country (Malaysia: Kedah, Kelantan, Terengganu). */
const WEEKEND_BY_REGION: Record<string, readonly number[]> = {
  'MY-02': FRI_SAT,
  'MY-03': FRI_SAT,
  'MY-11': FRI_SAT,
}

/** Trade partners without date-holidays rules: time zone (+ weekend via WEEKEND_BY_COUNTRY). */
const EXTRA_COUNTRIES: Record<string, readonly string[]> = {
  KH: ['Asia/Phnom_Penh'],
  LA: ['Asia/Vientiane'],
  MM: ['Asia/Yangon'],
  NP: ['Asia/Kathmandu'],
  MN: ['Asia/Ulaanbaatar'],
  QA: ['Asia/Qatar'],
  KW: ['Asia/Kuwait'],
  OM: ['Asia/Muscat'],
  JO: ['Asia/Amman'],
  IQ: ['Asia/Baghdad'],
  MV: ['Indian/Maldives'],
}

/** Readable shortlists for countries with many zones (the first entry is the default). */
const CURATED_TIME_ZONES: Record<string, readonly string[]> = {
  US: [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
  ],
  CA: [
    'America/Toronto',
    'America/Vancouver',
    'America/Edmonton',
    'America/Winnipeg',
    'America/Regina',
    'America/Halifax',
    'America/St_Johns',
  ],
  AU: [
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Darwin',
    'Australia/Perth',
    'Australia/Hobart',
  ],
  BR: [
    'America/Sao_Paulo',
    'America/Manaus',
    'America/Fortaleza',
    'America/Recife',
    'America/Belem',
    'America/Cuiaba',
    'America/Rio_Branco',
    'America/Noronha',
  ],
  MX: [
    'America/Mexico_City',
    'America/Monterrey',
    'America/Tijuana',
    'America/Hermosillo',
    'America/Cancun',
    'America/Chihuahua',
    'America/Mazatlan',
  ],
  RU: [
    'Europe/Moscow',
    'Europe/Kaliningrad',
    'Europe/Samara',
    'Asia/Yekaterinburg',
    'Asia/Novosibirsk',
    'Asia/Krasnoyarsk',
    'Asia/Irkutsk',
    'Asia/Vladivostok',
    'Asia/Magadan',
    'Asia/Kamchatka',
  ],
}

/** English names that read better than the CLDR default. */
const NAME_EN_OVERRIDES: Record<string, string> = {
  HK: 'Hong Kong',
  MO: 'Macao',
}

/** Japanese names that read better than the CLDR short form (`英国` → `イギリス`). */
const NAME_JA_OVERRIDES: Record<string, string> = {
  GB: 'イギリス',
}

function safeDisplayNames(locale: string, style: 'long' | 'short'): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'region', style })
  } catch {
    return null
  }
}


let catalogCache: { list: CountryInfo[]; byCode: Map<string, CountryInfo> } | null = null

function getCatalog() {
  if (catalogCache) return catalogCache
  const en = safeDisplayNames('en', 'long')
  const ja = safeDisplayNames('ja', 'short')
  const codes = new Set<string>([...getSupportedHolidayCountries(), ...Object.keys(EXTRA_COUNTRIES)])
  const list: CountryInfo[] = []
  for (const code of codes) {
    let nameEn = NAME_EN_OVERRIDES[code] ?? code
    let nameJa = code
    try {
      if (!NAME_EN_OVERRIDES[code]) nameEn = en?.of(code) ?? code
      nameJa = NAME_JA_OVERRIDES[code] ?? ja?.of(code) ?? nameEn
    } catch {
      // keep fallbacks
    }
    list.push({ code, nameEn, nameJa, hasHolidayData: hasHolidayData(code) })
  }
  list.sort((a, b) => a.nameJa.localeCompare(b.nameJa, 'ja'))
  catalogCache = { list, byCode: new Map(list.map((c) => [c.code, c])) }
  return catalogCache
}

/** All selectable countries, sorted by Japanese name. */
export function getCountryCatalog(): readonly CountryInfo[] {
  return getCatalog().list
}

export function getCountryInfo(code: string): CountryInfo {
  return (
    getCatalog().byCode.get(code) ?? {
      code,
      nameEn: code,
      nameJa: code,
      hasHolidayData: false,
    }
  )
}

export function isKnownCountry(code: string): boolean {
  return getCatalog().byCode.has(code)
}

/** Time zones offered for a country (valid IANA names only, default first). */
export function getTimeZoneOptions(code: string, region?: string): string[] {
  const regional = region ? getHolidayTimeZones(code, region) : []
  const pool = [
    ...regional.slice(0, 1),
    ...(CURATED_TIME_ZONES[code] ?? EXTRA_COUNTRIES[code] ?? getHolidayTimeZones(code)),
  ]
  const unique = [...new Set(pool)].filter(isValidTimeZone)
  return unique.length > 0 ? unique : ['UTC']
}

export function getDefaultTimeZone(code: string, region?: string): string {
  return getTimeZoneOptions(code, region)[0]
}

export function getDefaultWeekend(code: string, region?: string): readonly number[] {
  return (region && WEEKEND_BY_REGION[`${code}-${region}`]) || WEEKEND_BY_COUNTRY[code] || DEFAULT_WEEKEND
}

export function getRegionOptions(code: string): Array<{ code: string; name: string }> {
  return getHolidayRegions(code)
}

export function getRegionName(code: string, region: string | undefined): string | undefined {
  if (!region) return undefined
  return getHolidayRegions(code).find((r) => r.code === region)?.name
}
