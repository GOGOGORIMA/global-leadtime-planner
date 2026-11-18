/**
 * Quote currencies of the export quotation board (tab ⑥).
 *
 * `defaultRate` is only an indicative starting value (JPY per 1 unit); the user enters the
 * company rate (TTM etc.) of the day. Codes are ISO 4217 — currency codes, unlike country
 * codes, are the normal way to show a currency in a quotation.
 */

export const QUOTE_CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'CNY', 'HKD', 'TWD', 'THB', 'SGD', 'MYR', 'AUD'] as const
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number]

export function isQuoteCurrency(value: unknown): value is QuoteCurrency {
  return typeof value === 'string' && (QUOTE_CURRENCIES as readonly string[]).includes(value)
}

export interface CurrencyInfo {
  code: QuoteCurrency
  nameJa: string
  /** Indicative JPY per 1 unit (1 for JPY). */
  defaultRate: number
  /** Decimals shown in prices (0 for JPY). */
  decimals: number
}

export const CURRENCY_INFO: Readonly<Record<QuoteCurrency, CurrencyInfo>> = {
  JPY: { code: 'JPY', nameJa: '日本円', defaultRate: 1, decimals: 0 },
  USD: { code: 'USD', nameJa: '米ドル', defaultRate: 150, decimals: 2 },
  EUR: { code: 'EUR', nameJa: 'ユーロ', defaultRate: 172, decimals: 2 },
  GBP: { code: 'GBP', nameJa: '英ポンド', defaultRate: 198, decimals: 2 },
  CNY: { code: 'CNY', nameJa: '中国人民元', defaultRate: 21, decimals: 2 },
  HKD: { code: 'HKD', nameJa: '香港ドル', defaultRate: 19.2, decimals: 2 },
  TWD: { code: 'TWD', nameJa: '台湾ドル', defaultRate: 4.9, decimals: 2 },
  THB: { code: 'THB', nameJa: 'タイバーツ', defaultRate: 4.6, decimals: 2 },
  SGD: { code: 'SGD', nameJa: 'シンガポールドル', defaultRate: 116, decimals: 2 },
  MYR: { code: 'MYR', nameJa: 'マレーシアリンギット', defaultRate: 35, decimals: 2 },
  AUD: { code: 'AUD', nameJa: '豪ドル', defaultRate: 97, decimals: 2 },
}

export const DEFAULT_QUOTE_CURRENCY: QuoteCurrency = 'USD'
/** JPY per USD used for USD-denominated freight / charges (indicative). */
export const DEFAULT_USD_RATE = 150
