/**
 * Shared metadata of the quotation board (tab ⑥): cost series (chart colors, badge labels),
 * Incoterms labels and money formatters. Kept out of component files for React Fast Refresh.
 */
import type { QuoteCurrency } from '../data/currencies'
import { EXPORT_CHARGE_RATES, type FreightMarket, type PortChargeKey, type PortChargeLine, type RatedAmount, type ShippingMode } from '../utils/freightRates'
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

/**
 * Legend / table name, short name inside chart blocks, and the label of the item on the price cards
 * (製品ベース・梱包費・国内・港湾諸掛・国際運賃・サーチャージ・保険料・現地諸掛・関税).
 */
export function seriesLabels(series: CostSeries, mode: ShippingMode): { name: string; short: string; item: string } {
  const freight = mode === 'air' ? '航空運賃' : '海上運賃'
  switch (series) {
    case 'exw':
      return { name: '製品ベース（基準価格）', short: '製品ベース', item: '製品ベース' }
    case 'packing':
      return { name: '梱包費', short: '梱包費', item: '梱包費' }
    case 'fob':
      return { name: '国内・港湾諸掛', short: '国内・港湾', item: '国内・港湾諸掛' }
    case 'freight':
      return { name: `${freight}・サーチャージ（バッファ込）`, short: freight, item: `${freight}・サーチャージ` }
    case 'insurance':
      return { name: '保険料', short: '保険料', item: '保険料' }
    case 'local':
      return { name: '現地諸掛（DAP 費用）', short: '現地諸掛', item: '現地諸掛' }
    case 'duty':
      return { name: '現地関税', short: '現地関税', item: '現地関税' }
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

/** `¥1,500` per unit with its unit: `¥140,000/本`, `¥15,000/R/T`, `¥650/kg`. */
export const yenPer = (n: number, unit: string) => `${yen(n)}/${unit}`

/** `¥120,000〜¥180,000`. */
export const yenRange = ([min, max]: readonly [number, number]) => `${yen(min)}〜${yen(max)}`

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

export const MARKET_LABELS: Readonly<Record<FreightMarket, string>> = { normal: '通常期', peak: '繁忙期', surge: '高騰期' }

const UNIT_TEXT: Readonly<Record<RatedAmount['unit'], (q: number) => string>> = {
  container: (q) => `${q}本`,
  rt: (q) => `${qty(q)} R/T`,
  kg: (q) => `${kgText(Math.ceil(q))} kg`,
}

/** `¥15,000 × 7.26 R/T × 1.0（通常期）`, `¥18,000 ＋ ¥7,000 × 7.26 R/T`, `最低料金 ¥12,000`. */
export function rateText(rated: RatedAmount, factor?: { value: number; label: string }): string {
  const core = rated.minimum
    ? `最低料金 ${yen(rated.amount)}`
    : `${rated.base ? `${yen(rated.base)} ＋ ` : ''}${yen(rated.rate)} × ${UNIT_TEXT[rated.unit](rated.quantity)}`
  return factor ? `${core} × ${factor.value.toFixed(1)}（${factor.label}）` : core
}

const PORT_LINE_LABELS: Readonly<Record<PortChargeKey, string>> = {
  thc: 'THC',
  vanning: 'バンニング',
  seal: 'シール',
  cfs: 'CFS',
  lclThc: 'THC',
  airHandling: '上屋・取扱・X線検査',
  document: 'B/L・書類作成料',
  filing: '事前申告（AMS / ENS 等）',
}

/** `CFS ¥5,000 × 7.26 R/T ＋ THC ¥1,500 × 7.26 R/T ＋ B/L・書類作成料 ¥6,500`. */
export function portLinesText(lines: readonly PortChargeLine[], mode: ShippingMode): string {
  return lines
    .map((line) => {
      const label = line.key === 'document' && mode === 'air' ? 'AWB 作成料' : PORT_LINE_LABELS[line.key]
      if (line.key === 'airHandling') {
        return `${label} ${line.rate}円 × ${UNIT_TEXT.kg(line.quantity)}（最低 ${yen(EXPORT_CHARGE_RATES.airMin)}）`
      }
      if (line.key === 'document' || line.key === 'filing') return `${label} ${yen(line.amount)}`
      const unit = mode === 'lcl' ? UNIT_TEXT.rt(line.quantity) : UNIT_TEXT.container(line.quantity)
      return `${label} ${yen(line.rate)} × ${unit}`
    })
    .join(' ＋ ')
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
