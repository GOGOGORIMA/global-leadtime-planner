/**
 * Shared metadata of the quotation board (tab ⑥): cost series (chart colors, badge labels),
 * Incoterms labels and money formatters. Kept out of component files for React Fast Refresh.
 */
import type { QuoteCurrency } from '../data/currencies'
import type { ShippingMode } from '../utils/freightRates'
import { FCL20_MAX_M3, FCL40_MAX_M3, LCL_MAX_M3, type Incoterm, type IncotermsResult } from '../utils/incotermsCalc'
import type { QuoteResult } from '../utils/quotation'

/** Cost blocks stacked on the base price, bottom → top. */
export type CostSeries = 'exw' | 'packing' | 'fob' | 'freight' | 'insurance' | 'local' | 'duty'

export const COST_SERIES_ORDER: readonly CostSeries[] = ['exw', 'packing', 'fob', 'freight', 'insurance', 'local', 'duty']

/**
 * Chart colors: a neutral block for the base price and the validated categorical palette, in
 * fixed order, for the costs added on top (adjacent CVD ΔE ≥ 9 on white). `ink` is the label
 * color inside the block.
 */
export const SERIES_STYLE: Readonly<Record<CostSeries, { color: string; ink: string }>> = {
  exw: { color: '#cbd5e1', ink: '#0b0b0b' },
  packing: { color: '#008300', ink: '#ffffff' },
  fob: { color: '#2a78d6', ink: '#ffffff' },
  freight: { color: '#eb6834', ink: '#ffffff' },
  insurance: { color: '#1baf7a', ink: '#ffffff' },
  local: { color: '#eda100', ink: '#0b0b0b' },
  duty: { color: '#e87ba4', ink: '#ffffff' },
}

/** Legend / table name, short name inside chart blocks, and the badge on the price cards. */
export function seriesLabels(series: CostSeries, mode: ShippingMode): { name: string; short: string; badge: string } {
  const freight = mode === 'air' ? '航空運賃' : '海上運賃'
  switch (series) {
    case 'exw':
      return { name: '基準価格', short: '基準価格', badge: '基準価格' }
    case 'packing':
      return { name: '輸出梱包費', short: '梱包費', badge: '+輸出梱包費' }
    case 'fob':
      return { name: '国内・輸出諸掛', short: '国内諸掛', badge: '+FOB諸掛' }
    case 'freight':
      return { name: `${freight}（バッファ込）`, short: freight, badge: `+${freight}(バッファ込)` }
    case 'insurance':
      return { name: '保険料', short: '保険料', badge: '+保険料' }
    case 'local':
      return { name: '現地諸掛（DAP費用）', short: '現地諸掛', badge: '+現地諸掛' }
    case 'duty':
      return { name: '現地関税', short: '現地関税', badge: '+現地関税' }
  }
}

export function seriesAmount(series: CostSeries, r: IncotermsResult): number {
  switch (series) {
    case 'exw':
      return r.base
    case 'packing':
      return r.packing
    case 'fob':
      return r.fobCharges
    case 'freight':
      return r.freight
    case 'insurance':
      return r.insurance
    case 'local':
      return r.localCharges
    case 'duty':
      return r.duty
  }
}

export const TERM_INFO: Readonly<Record<Incoterm, { ja: string; added: readonly CostSeries[] }>> = {
  EXW: { ja: '工場出荷', added: ['exw', 'packing'] },
  FOB: { ja: '本船渡', added: ['fob'] },
  CIF: { ja: '運賃・保険料込', added: ['freight', 'insurance'] },
  DAP: { ja: '現地指定場所持込', added: ['local'] },
  DDP: { ja: '関税込現地持込', added: ['duty'] },
}

/** Series included in a term's price, bottom → top. */
export function seriesOfTerm(term: Incoterm): CostSeries[] {
  const terms = Object.keys(TERM_INFO) as Incoterm[]
  return terms.slice(0, terms.indexOf(term) + 1).flatMap((t) => [...TERM_INFO[t].added])
}

/** `¥5,000,000`. */
export const yen = (n: number) => `¥${Math.round(n).toLocaleString('en-US')}`

/** `34,364.26` in the quote currency's decimals (JPY: no decimals). */
export function money(amount: number, decimals: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** `USD 34,364.26` / `¥5,000,000`. */
export function quoteMoney(amount: number, currency: QuoteCurrency, decimals: number): string {
  return currency === 'JPY' ? yen(amount) : `${currency} ${money(amount, decimals)}`
}

/** `US$350`, `US$2.80`. */
export function usd(n: number, decimals = n % 1 === 0 ? 0 : 2): string {
  return `US$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

/** `15.50` (m³ / R/T) — two decimals below 100. */
export const qty = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: n < 100 ? 2 : 1, maximumFractionDigits: n < 100 ? 2 : 1 })

/** `3,160`. */
export const kgText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })

/** `3%`, `0.2%`. */
export const percent = (n: number) => `${Number(n.toFixed(2))}%`

/** `$34` / `¥5,150` / `EUR 31` (whole units) for the per-m³ figures. */
export function compactMoney(amount: number, currency: QuoteCurrency): string {
  const n = Math.round(Math.abs(amount)).toLocaleString('en-US')
  if (currency === 'JPY') return `¥${n}`
  if (currency === 'USD') return `$${n}`
  return `${currency} ${n}`
}

/** 「LCL 混載」 / 「20ft Dry × 1本」 / 「40ft Dry × 1本（40ft HQ も可）」. */
export function recommendationLabel(r: QuoteResult): string {
  if (r.recommended.mode === 'lcl') return 'LCL 混載'
  const c = r.recommended.container
  return `${c.spec.label} × ${c.units}${c.spec.unitJa}${c.spec.id === '40dc' && c.units === 1 ? '（40ft HQ も可）' : ''}`
}

/** Why: 「14 m³ 以下」「14〜28 m³」「積載3Dの積載計画」… */
export function recommendationReason(r: QuoteResult): string {
  if (r.recommended.mode === 'lcl') return `${LCL_MAX_M3} m³ 以下`
  if (r.recommended.container.source !== 'estimated') return '積載3Dの積載計画'
  const v = r.volume
  if (v <= FCL20_MAX_M3) return `${LCL_MAX_M3}〜${FCL20_MAX_M3} m³`
  if (v <= FCL40_MAX_M3) return `${FCL20_MAX_M3}〜${FCL40_MAX_M3} m³`
  return `${FCL40_MAX_M3} m³ 超`
}

/** The transport actually priced: 「LCL 混載（12.40 R/T）」「FCL 20ft Dry × 1本」「航空便（課金 2,100 kg）」. */
export function transportLabel(r: QuoteResult): string {
  switch (r.mode) {
    case 'lcl':
      return `LCL 混載（${qty(r.chargedRevenueTons)} R/T）`
    case 'fcl':
      return `FCL ${r.container.spec.label} × ${r.container.units}${r.container.spec.unitJa}`
    case 'air':
      return `航空便（課金 ${kgText(Math.ceil(r.chargeableKg))} kg）`
  }
}
