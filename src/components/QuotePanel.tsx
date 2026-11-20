import { AlertTriangle, ArrowRight, Check, Copy, Lightbulb, ReceiptText, RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useState, type Dispatch, type ReactNode } from 'react'
import type { ContainerCategory, ContainerId } from '../data/containers'
import { getCountryInfo } from '../data/countries'
import { MAX_DUTY_RATE, MAX_FREIGHT_BUFFER, MAX_INSURANCE_RATE, MAX_PACKING_RATE, MAX_QUOTE_PRICE } from '../state/defaults'
import type { PlannerAction } from '../state/plannerReducer'
import type { CargoItem, CushionSettings, QuoteCargoMode, QuoteSettings } from '../types'
import type { ResolvedCountry } from '../utils/calendars'
import { copyToClipboard } from '../utils/clipboard'
import type { ISODate } from '../utils/dateCalc'
import { renderQuotationEmail, type ExportOptions } from '../utils/exportText'
import { DOMESTIC_TRUCK_RATES, FREIGHT_REGION_LABELS, SURCHARGE_SHARE, type ShippingMode } from '../utils/freightRates'
import { INCOTERMS, type Incoterm } from '../utils/incotermsCalc'
import { computeQuote, linkCargo, type QuoteResult, type UnitChoice, type UnitSource } from '../utils/quotation'
import type { ScheduleReport } from '../utils/report'
import { btn, cx, focusRing } from './classes'
import { NumberField } from './NumberField'
import { QuoteChart } from './QuoteChart'
import { AutoState } from './quoteFormParts'
import { QuoteSettingsForm } from './QuoteSettingsForm'
import {
  MARKET_LABELS,
  SERIES_STYLE,
  compactMoney,
  kgText,
  money,
  portLinesText,
  qty,
  rateText,
  recommendationLabel,
  seriesLabels,
  transportLabel,
  usd,
  yen,
  type CostSeries,
} from './quoteStyles'

interface QuotePanelProps {
  quote: QuoteSettings
  cargo: readonly CargoItem[]
  container: ContainerId
  cushioning: Record<ContainerCategory, CushionSettings>
  countries: readonly ResolvedCountry[]
  /** Destination in use, and the automatic one (the schedule's partner country). */
  destination: string
  autoDestination: string
  /** Port in use (US West / East Coast; '' otherwise) and the automatic one. */
  port: string
  autoPort: string
  today: ISODate
  report: ScheduleReport | null
  /** Recipient / signature of the English output (for the quotation copied from here). */
  exportOptions: ExportOptions
  dispatch: Dispatch<PlannerAction>
  onShowVanning: () => void
  /** Opens tab ④ with the Price Quotation format. */
  onShowExport: () => void
}

/** Where a container / truck choice comes from (breakdown table). */
const SOURCE_LABELS: Readonly<Record<UnitSource, string>> = {
  manual: '手動指定',
  selected: '積載3Dで選択中',
  suggested: '積載3Dの自動判定',
  estimated: '概算M3から自動',
  default: '既定',
}

const CARGO_SOURCE_LABELS: Readonly<Record<QuoteCargoMode, string>> = {
  simple: '簡易サイズから計算',
  direct: '直接入力',
  vanning: '積載3Dの結果を引用',
}

const MODE_LABELS: Readonly<Record<ShippingMode, string>> = { fcl: '海上・FCL', lcl: '海上・LCL', air: '航空' }

/** The term each card's increment is measured from. */
const PREVIOUS_TERM: Readonly<Partial<Record<Incoterm, Incoterm>>> = { FOB: 'EXW', CIF: 'FOB', DAP: 'CIF', DDP: 'DAP' }

const m3One = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function unitsText(choice: Pick<UnitChoice, 'spec' | 'units'>): string {
  return `${choice.spec.label} × ${choice.units}${choice.spec.unitJa}`
}

const isOverloaded = (check: { overWeight: boolean; overVolume: boolean } | null) => !!check && (check.overWeight || check.overVolume)

/** 「算定ベース：概算 7.3 m³ / 1,800 kg（課金 R/T: 7.26 RT ｜ 推奨: LCL 混載）」 + overloads + the LCL → FCL hint. */
function SummaryBar({ result, onSwitchToFcl }: { result: QuoteResult; onSwitchToFcl: () => void }) {
  const suggestion = result.fclSuggestion
  const overloaded = [
    isOverloaded(result.loads.container) && unitsText(result.container),
    isOverloaded(result.loads.truck) && unitsText(result.truck),
  ].filter(Boolean)
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] text-indigo-950 tabular-nums">
        <span className="font-semibold text-indigo-800">算定ベース：</span>
        <span>
          概算 <span className="font-bold">{m3One(result.volume)} m³</span> / <span className="font-bold">{kgText(Math.round(result.weight))} kg</span>
        </span>
        <span className="text-indigo-900/80">
          （課金 R/T: {qty(result.revenueTons)} RT ｜ 推奨: <span className="font-semibold text-indigo-950">{recommendationLabel(result)}</span>）
        </span>
        <span className="ml-auto text-[11px] text-indigo-900/60">{CARGO_SOURCE_LABELS[result.cargo.source]}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-indigo-900/80 tabular-nums">
        見積の輸送：<span className="font-semibold">{transportLabel(result)}</span>
        {result.modeSetting === 'auto' ? '（推奨どおり）' : '（手動で選択）'}
        {result.cargo.packingKg > 0 && ` ・ 重量は梱包材 ${kgText(Math.round(result.cargo.packingKg))} kg 込み（梱包後）`}
      </div>
      {overloaded.length > 0 && (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800 ring-1 ring-rose-200">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            重量・容積オーバー：{overloaded.join('、')} では梱包後の貨物（{kgText(Math.round(result.weight))} kg / {qty(result.volume)} m³）を運べません。③・④ で規格・数量を見直してください。
          </span>
        </p>
      )}
      {suggestion && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 ring-1 ring-amber-200">
          <Lightbulb size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">
            分岐点を超えました：{unitsText(suggestion.container)} の FCL の方が割安です（運賃＋港湾・現地諸掛 {yen(suggestion.fclTotal)} ＜ LCL{' '}
            {yen(suggestion.lclTotal)}）
          </span>
          <button
            type="button"
            onClick={onSwitchToFcl}
            className={cx('rounded-md bg-white px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100', focusRing)}
          >
            {suggestion.container.spec.label} FCL に切り替え
          </button>
        </div>
      )}
    </div>
  )
}

/** Added cost per m³ of estimated volume (quote currency): 「FOB→CIF +$27 / m³」. */
function perM3Text(term: Incoterm, result: QuoteResult): string | null {
  if (!(result.volume > 0)) return null
  const toQuote = (jpy: number) => (result.currency === 'JPY' ? jpy : jpy / result.appliedRate)
  const previous = PREVIOUS_TERM[term]
  if (!previous) {
    return result.incoterms.packing > 0 ? `梱包費 +${compactMoney(toQuote(result.incoterms.packing) / result.volume, result.currency)} / m³` : null
  }
  const increase = (result.prices[term].quote - result.prices[previous].quote) / result.volume
  return `${previous}→${term} +${compactMoney(increase, result.currency)} / m³`
}

interface CardItem {
  series: CostSeries
  amount: number
  /** Parts of a category (FOB charges, freight). */
  detail?: string
}

/** The cost items each term adds to the previous one (EXW: the product base and packing). */
function cardItems(term: Incoterm, result: QuoteResult): CardItem[] {
  const r = result.incoterms
  switch (term) {
    case 'EXW':
      return [{ series: 'exw', amount: r.base }, ...(r.packing > 0 ? [{ series: 'packing' as const, amount: r.packing }] : [])]
    case 'FOB':
      return [{ series: 'fob', amount: r.fobCharges, detail: `トラック ${yen(r.domestic)}・通関 ${yen(r.customs)}・港湾 ${yen(r.portCharges)}` }]
    case 'CIF':
      return [
        {
          series: 'freight',
          amount: r.freight,
          detail: `運賃 ${yen(r.baseFreight)}・サーチャージ ${yen(r.surcharge)}・バッファ ${yen(r.freightContingency)}`,
        },
        { series: 'insurance', amount: r.insurance },
      ]
    case 'DAP':
      return [{ series: 'local', amount: r.localCharges }]
    case 'DDP':
      return [{ series: 'duty', amount: r.duty }]
  }
}

const TERM_JA: Readonly<Record<Incoterm, string>> = {
  EXW: '工場出荷',
  FOB: '本船渡',
  CIF: '運賃・保険料込',
  DAP: '現地指定場所持込',
  DDP: '関税込現地持込',
}

function PriceCard({ term, result, mode }: { term: Incoterm; result: QuoteResult; mode: ShippingMode }) {
  const price = result.prices[term]
  const isJpy = result.currency === 'JPY'
  const base = result.incoterms.base
  const items = cardItems(term, result)
  const perM3 = perM3Text(term, result)
  const previous = PREVIOUS_TERM[term]
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col rounded-xl border p-3',
        term === 'DDP' ? 'col-span-2 border-indigo-300 bg-indigo-50/60 @2xl:col-span-1' : 'border-slate-200 bg-white',
      )}
    >
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-sm font-bold tracking-wide text-slate-900">{term}</span>
        <span className="truncate text-[10px] text-slate-500">{TERM_JA[term]}</span>
      </div>
      <div className="mt-2">
        {!isJpy && <div className="text-[10px] font-semibold text-slate-500">{result.currency}</div>}
        <div className="text-lg leading-tight font-bold break-all text-slate-900 @2xl:text-base @4xl:text-lg">
          {isJpy ? yen(price.jpy) : money(price.quote, result.decimals)}
        </div>
        {!isJpy && <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">{yen(price.jpy)}</div>}
        <div className="mt-0.5 text-[10px] text-slate-400 tabular-nums">
          {term === 'EXW'
            ? result.incoterms.packing > 0
              ? '製品ベース＋梱包費'
              : '工場出荷の販売価格'
            : `基準価格比 +${base > 0 ? (((price.jpy - base) / base) * 100).toFixed(1) : '0.0'}%`}
        </div>
      </div>
      <ul className="mt-2 space-y-1 border-t border-slate-200/80 pt-2" aria-label={previous ? `${term} で ${previous} に加算する費用` : 'EXW の内訳'}>
        {items.map((item) => (
          <li key={item.series} className="text-[10px] leading-tight">
            <div className="flex flex-wrap items-baseline gap-x-1">
              <span className="inline-flex min-w-0 items-center gap-1 text-slate-600">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SERIES_STYLE[item.series].color }} />
                {item.series === 'exw' ? '' : '+'}
                {seriesLabels(item.series, mode).item}
              </span>
              <span className="ml-auto font-semibold text-slate-800 tabular-nums">{yen(item.amount)}</span>
            </div>
            {item.detail && <p className="mt-0.5 pl-2.5 text-slate-400 tabular-nums">{item.detail}</p>}
          </li>
        ))}
      </ul>
      {perM3 && (
        <div className="mt-auto pt-2">
          <div className="border-t border-slate-200/80 pt-1.5 text-[10px] leading-tight text-slate-500 tabular-nums" title="概算M3 1 m³ あたりの輸送コスト増分">
            <span className="block text-slate-400">1 m³ あたり</span>
            <span className="font-medium text-slate-700">{perM3}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Itemized breakdown (6 categories, every amount editable)
// ---------------------------------------------------------------------------------------------

/** A cost item of the breakdown: its amount is edited in place (`edit`), or follows a rate (`readOnly`). */
interface ItemRow {
  kind: 'item'
  key: string
  label: string
  basis: ReactNode
  amount: number
  edit?: { manual: boolean; onChange: (value: number) => void; onReset?: () => void }
}
interface GroupRow {
  kind: 'group'
  key: string
  label: string
  note: string
  amount: number
  series: readonly CostSeries[]
}
interface TotalRow {
  kind: 'total'
  key: string
  label: string
  amount: number
  term: Incoterm | 'CFR'
}
type BreakdownRow = ItemRow | GroupRow | TotalRow

/** Small rate input inside the basis text: 「7.26 m³ × [15,000 円/m³]」. */
function InlineRate(props: { value: number; onChange: (value: number) => void; max: number; step: number; suffix: string; label: string; width?: string }) {
  return (
    <span className={cx('mx-0.5 inline-block align-middle', props.width ?? 'w-20')}>
      <NumberField
        compact
        value={props.value}
        onChange={props.onChange}
        min={0}
        max={props.max}
        step={props.step}
        ariaLabel={`積算内訳：${props.label}`}
        suffix={props.suffix}
      />
    </span>
  )
}

function breakdownRows(quote: QuoteSettings, result: QuoteResult, mode: ShippingMode, set: (patch: Partial<QuoteSettings>) => void): BreakdownRow[] {
  const r = result.incoterms
  const marketLabel = MARKET_LABELS[quote.market]
  const surchargePercent = Math.round(SURCHARGE_SHARE * 100)
  const freightName = mode === 'air' ? '航空運賃' : '海上運賃'
  const entered = (m: { amount: number; currency: 'JPY' | 'USD' } | null) => (m ? (m.currency === 'USD' ? `手動 ${usd(m.amount)}` : '手動入力') : null)
  const tableText = rateText(result.freight.table, { value: result.marketFactor, label: marketLabel })
  const yenMoney = (amount: number) => ({ amount, currency: 'JPY' as const })
  return [
    { kind: 'group', key: 'g-base', label: '製品ベース', note: 'EXW 基準価格', amount: r.base, series: ['exw'] },
    {
      kind: 'item',
      key: 'base',
      label: 'EXW 基準価格（工場出荷の販売価格）',
      basis: '入力値（製品原価・利益は扱いません）',
      amount: r.base,
      edit: { manual: true, onChange: (exw) => set({ exw }) },
    },
    { kind: 'group', key: 'g-packing', label: '梱包費', note: 'EXW に加算', amount: r.packing, series: ['packing'] },
    {
      kind: 'item',
      key: 'packing',
      label: '輸出梱包費（木箱・パレット）',
      basis: quote.packingCost ? (
        <>
          {qty(result.volume)} m³ ×
          <InlineRate value={quote.packingRate} onChange={(packingRate) => set({ packingRate })} max={MAX_PACKING_RATE} step={500} suffix="円" label="梱包単価（円 / m³）" width="w-24" />
          / m³{result.packing.manual && `（自動 ${yen(result.packing.auto)}）`}
        </>
      ) : (
        '自動算入 OFF（金額を入力すると ON）'
      ),
      amount: r.packing,
      edit: {
        manual: result.packing.manual,
        onChange: (packingAmount) => set({ packingAmount, packingCost: true }),
        onReset: () => set({ packingAmount: null }),
      },
    },
    { kind: 'total', key: 't-exw', label: 'EXW（工場出荷）', amount: r.exw, term: 'EXW' },
    { kind: 'group', key: 'g-fob', label: '国内・港湾諸掛', note: 'FOB 加算分', amount: r.fobCharges, series: ['fob'] },
    {
      kind: 'item',
      key: 'domestic',
      label: '国内トラック運賃（工場〜輸出港）',
      basis: `${unitsText(result.truck)}（${SOURCE_LABELS[result.truck.source]}）× ${yen(DOMESTIC_TRUCK_RATES[result.truck.spec.id] ?? 0)}`,
      amount: r.domestic,
      edit: { manual: result.domestic.manual, onChange: (domestic) => set({ domestic }), onReset: () => set({ domestic: null }) },
    },
    {
      kind: 'item',
      key: 'customs',
      label: '輸出通関料',
      basis: `輸出申告 1 件 ${yen(result.customs.auto)}`,
      amount: r.customs,
      edit: { manual: result.customs.manual, onChange: (customs) => set({ customs }), onReset: () => set({ customs: null }) },
    },
    {
      kind: 'item',
      key: 'port',
      label: '輸出港湾諸掛（THC・CFS・B/L・バンニング等）',
      basis: portLinesText(result.portCharges.lines, mode),
      amount: r.portCharges,
      edit: { manual: result.portCharges.manual, onChange: (portCharges) => set({ portCharges }), onReset: () => set({ portCharges: null }) },
    },
    { kind: 'total', key: 't-fob', label: 'FOB（本船渡）', amount: r.fob, term: 'FOB' },
    {
      kind: 'group',
      key: 'g-freight',
      label: `国際運賃・サーチャージ`,
      note: `CFR 加算分（${MODE_LABELS[mode]}）`,
      amount: r.freight,
      series: ['freight'],
    },
    {
      kind: 'item',
      key: 'freight',
      label: `基本運賃（${mode === 'air' ? 'A/F' : 'O/F'}）`,
      basis: entered(result.freight.base.entered) ?? `テーブル運賃 ${tableText} ＝ ${yen(result.freight.tableJpy)} の ${100 - surchargePercent}%`,
      amount: r.baseFreight,
      edit: {
        manual: result.freight.base.manual,
        onChange: (amount) => set({ freight: yenMoney(amount) }),
        onReset: () => set({ freight: null }),
      },
    },
    {
      kind: 'item',
      key: 'surcharge',
      label: mode === 'air' ? 'サーチャージ（燃油・保安）' : 'サーチャージ（BAF / LSS / EBS 等）',
      basis: entered(result.freight.surcharge.entered) ?? `テーブル運賃（${freightName}・サーチャージ込）${yen(result.freight.tableJpy)} の ${surchargePercent}%`,
      amount: r.surcharge,
      edit: {
        manual: result.freight.surcharge.manual,
        onChange: (amount) => set({ surcharge: yenMoney(amount) }),
        onReset: () => set({ surcharge: null }),
      },
    },
    {
      kind: 'item',
      key: 'buffer',
      label: '運賃変動バッファ',
      basis: (
        <>
          （基本運賃 ＋ サーチャージ）×
          <InlineRate value={quote.freightBuffer} onChange={(freightBuffer) => set({ freightBuffer })} max={MAX_FREIGHT_BUFFER} step={1} suffix="%" label="運賃変動バッファ（%）" />
        </>
      ),
      amount: r.freightContingency,
    },
    { kind: 'total', key: 't-cfr', label: 'CFR（運賃込）', amount: r.cfr, term: 'CFR' },
    { kind: 'group', key: 'g-insurance', label: '保険料', note: 'CIF 加算分', amount: r.insurance, series: ['insurance'] },
    {
      kind: 'item',
      key: 'insurance',
      label: mode === 'air' ? '貨物保険料' : '海上保険料',
      basis: (
        <>
          CIF の 110%（{yen(r.insuredValue)}）×
          <InlineRate value={quote.insuranceRate} onChange={(insuranceRate) => set({ insuranceRate })} max={MAX_INSURANCE_RATE} step={0.01} suffix="%" label="保険料率（%）" />
          {result.insurance.manual && `（料率から ${yen(result.insurance.auto)}）`}
        </>
      ),
      amount: r.insurance,
      edit: { manual: result.insurance.manual, onChange: (insurance) => set({ insurance }), onReset: () => set({ insurance: null }) },
    },
    { kind: 'total', key: 't-cif', label: 'CIF（運賃・保険料込）', amount: r.cif, term: 'CIF' },
    {
      kind: 'group',
      key: 'g-local',
      label: '現地諸掛・関税',
      note: 'DAP / DDP 加算分',
      amount: r.localCharges + r.duty,
      series: ['local', 'duty'],
    },
    {
      kind: 'item',
      key: 'local',
      label: '現地港湾・輸入通関・配送費（DAP 費用）',
      basis: entered(result.local.entered) ?? `${FREIGHT_REGION_LABELS[result.lane.region]}のプリセット：${rateText(result.local.basis)}`,
      amount: r.localCharges,
      edit: { manual: result.local.manual, onChange: (amount) => set({ local: yenMoney(amount) }), onReset: () => set({ local: null }) },
    },
    { kind: 'total', key: 't-dap', label: 'DAP（現地指定場所持込）', amount: r.dap, term: 'DAP' },
    {
      kind: 'item',
      key: 'duty',
      label: '現地関税',
      basis: (
        <>
          CIF {yen(r.cif)} ×
          <InlineRate value={quote.dutyRate} onChange={(dutyRate) => set({ dutyRate })} max={MAX_DUTY_RATE} step={0.1} suffix="%" label="輸入関税率（%）" />
          {result.duty.manual && `（税率から ${yen(result.duty.auto)}）`}
        </>
      ),
      amount: r.duty,
      edit: { manual: result.duty.manual, onChange: (duty) => set({ duty }), onReset: () => set({ duty: null }) },
    },
    { kind: 'total', key: 't-ddp', label: 'DDP（関税込現地持込）', amount: r.ddp, term: 'DDP' },
  ]
}

function Swatches({ series }: { series: readonly CostSeries[] }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {series.map((s) => (
        <span key={s} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SERIES_STYLE[s].color }} />
      ))}
    </span>
  )
}

function BreakdownTable({ quote, result, mode, onChange }: { quote: QuoteSettings; result: QuoteResult; mode: ShippingMode; onChange: (patch: Partial<QuoteSettings>) => void }) {
  const rows = breakdownRows(quote, result, mode, onChange)
  const isJpy = result.currency === 'JPY'
  /** Amount in the quote currency (non-JPY quotes only). */
  const inQuote = (jpy: number) => money(Math.round((jpy / result.appliedRate) * 10 ** result.decimals) / 10 ** result.decimals, result.decimals)
  const r = result.incoterms
  const share = (jpy: number) => (r.ddp > 0 ? `DDP の ${((jpy / r.ddp) * 100).toFixed(1)}%` : '')
  return (
    <section aria-label="積算内訳" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">積算内訳（6 項目・金額はすべて直接編集できます）</h2>
        <span className="text-xs text-slate-500">
          円で積み上げ、各条件の合計を {isJpy ? '円' : `社内適用レート ${result.appliedRate.toFixed(2)} 円 / ${result.currency}`} で提示価格にしています。「手動」の項目は ↺ で自動計算に戻せます。
        </span>
      </header>
      <div className="overflow-x-auto px-4 py-3 sm:px-5">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] text-slate-500">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                項目・計算根拠（自動の場合）
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                金額（円）
              </th>
              {!isJpy && (
                <th scope="col" className="py-1.5 text-right font-medium whitespace-nowrap">
                  {result.currency}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === 'group') {
                return (
                  <tr key={row.key} className="border-b border-slate-100 bg-slate-50/60">
                    <td className="pt-2.5 pb-1 pr-3">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Swatches series={row.series} />
                        <span className="font-semibold text-slate-900">{row.label}</span>
                        <span className="text-[11px] text-slate-500">
                          {row.note}・{share(row.amount)}
                        </span>
                      </span>
                    </td>
                    <td className="pt-2.5 pb-1 pr-3 text-right font-semibold text-slate-900 tabular-nums">{row.amount.toLocaleString('en-US')}</td>
                    {!isJpy && <td className="pt-2.5 pb-1 text-right text-[11px] font-semibold text-slate-600 tabular-nums">{inQuote(row.amount)}</td>}
                  </tr>
                )
              }
              if (row.kind === 'total') {
                return (
                  <tr key={row.key} className={cx('border-b border-slate-200 font-semibold', row.term === 'DDP' ? 'bg-indigo-50/70' : 'bg-white')}>
                    <td className="py-1.5 pr-3 text-slate-900">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0" />＝ {row.label}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-slate-900 tabular-nums">{row.amount.toLocaleString('en-US')}</td>
                    {!isJpy && (
                      <td className="py-1.5 text-right text-slate-900 tabular-nums">
                        {row.term !== 'CFR' ? money(result.prices[row.term].quote, result.decimals) : ''}
                      </td>
                    )}
                  </tr>
                )
              }
              return (
                <tr key={row.key} className="border-b border-slate-100 align-middle">
                  <td className="py-1.5 pr-3 pl-5">
                    <span className="block text-slate-700">{row.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 tabular-nums">{row.basis}</span>
                  </td>
                  <td className="py-1.5 pr-3">
                    {row.edit ? (
                      <div className="flex items-center justify-end gap-1.5">
                        {row.edit.onReset && <AutoState compact manual={row.edit.manual} onReset={row.edit.onReset} resetLabel={`${row.label}を自動計算に戻す`} />}
                        <span className="w-32 shrink-0">
                          <NumberField
                            compact
                            value={row.amount}
                            onChange={row.edit.onChange}
                            min={0}
                            max={MAX_QUOTE_PRICE}
                            step={1000}
                            ariaLabel={`積算内訳：${row.label}（円）`}
                            suffix="円"
                          />
                        </span>
                      </div>
                    ) : (
                      <div className="pr-1 text-right text-slate-900 tabular-nums">{row.amount.toLocaleString('en-US')}</div>
                    )}
                  </td>
                  {!isJpy && <td className="py-1.5 text-right text-[11px] text-slate-500 tabular-nums">{inQuote(row.amount)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500 sm:px-5">
        FOB ＝ EXW ＋ 国内トラック ＋ 輸出通関料 ＋ 輸出港湾諸掛 ／ CIF ＝ FOB ＋ 国際運賃・サーチャージ × 市況係数 × (1 ＋ 運賃変動バッファ) ＋ 保険料（CIF × 110% ×
        料率。循環は CIF ＝ CFR ÷ (1 − 1.1 × 料率) で解いています）／ DDP ＝ CIF ＋ 現地諸掛 ＋ 関税（CIF × 税率）。手動の運賃・サーチャージには市況係数を掛けません。DDP に輸入 VAT /
        GST は含みません。製品原価・利益は扱いません。
      </p>
    </section>
  )
}

/** Tab ⑥: Incoterms export quotation & cost build-up board. */
export function QuotePanel({
  quote,
  cargo,
  container,
  cushioning,
  countries,
  destination,
  autoDestination,
  port,
  autoPort,
  today,
  report,
  exportOptions,
  dispatch,
  onShowVanning,
  onShowExport,
}: QuotePanelProps) {
  // Tab ⑤'s packing plans are only computed when the quotation uses its cargo.
  const withPlans = quote.cargoMode === 'vanning'
  const link = useMemo(() => linkCargo(cargo, container, cushioning, withPlans), [cargo, container, cushioning, withPlans])
  const result = useMemo(() => computeQuote(quote, link, destination, today, port), [quote, link, destination, today, port])
  const setQuote = useCallback((patch: Partial<QuoteSettings>) => dispatch({ type: 'setQuote', patch }), [dispatch])
  const [copied, setCopied] = useState(false)
  const mode = result.mode
  const destinationInfo = getCountryInfo(destination)
  const portLabel = result.lane.ports.find((p) => p.id === result.lane.portId)?.label

  const copy = async () => {
    const text = renderQuotationEmail({ ...exportOptions, format: 'quote' }, { quote: result, destinationName: destinationInfo.nameEn }, report)
    const ok = await copyToClipboard(text)
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 2000)
  }
  const reset = () => {
    if (window.confirm('見積ボードの入力（概算M3・EXW 価格・通貨・運賃条件など）を初期値に戻しますか？')) dispatch({ type: 'resetQuote' })
  }

  const right: ReactNode = (
    <section aria-label="インコタームズ別 見積価格比較" className="rounded-xl border border-slate-200 bg-white shadow-sm @container">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">2. インコタームズ別 見積価格</h2>
        <span className="text-xs text-slate-500 tabular-nums">
          {result.currency === 'JPY' ? '円建て' : `${result.currency} 建て（適用レート ${result.appliedRate.toFixed(2)} 円）`}・{MODE_LABELS[mode]}・仕向地{' '}
          {destinationInfo.nameJa}
          {portLabel && `（${portLabel}）`}
        </span>
      </header>
      <div className="space-y-4 p-4">
        <SummaryBar result={result} onSwitchToFcl={() => setQuote({ mode: 'fcl' })} />
        {/* 2 / 3 / 5 per row (DDP fills the rest of the last row). */}
        <div className="grid grid-cols-2 gap-2 @md:grid-cols-3 @2xl:grid-cols-5">
          {INCOTERMS.map((term) => (
            <PriceCard key={term} term={term} result={result} mode={mode} />
          ))}
        </div>
        <QuoteChart result={result} mode={mode} />
      </div>
    </section>
  )

  return (
    <div className="space-y-4 @container">
      <section aria-label="Incoterms 輸出見積・コスト積算ボード" className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <ReceiptText size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Incoterms 輸出見積・コスト積算ボード</h2>
            <p className="text-xs text-slate-500">
              梱包後の概算M3・重量から梱包費・物流諸掛・サーチャージ・保険・関税を積み上げ、EXW / FOB / CIF / DAP / DDP の提示価格を算出します（製品原価・利益は扱いません）。
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className={cx(btn.primary, 'min-w-44')} onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'コピーしました' : '英文見積をコピー'}
            </button>
            <button type="button" className={btn.secondary} onClick={onShowExport}>
              英文出力タブで編集 <ArrowRight size={15} />
            </button>
            <button type="button" className={cx(btn.icon, focusRing)} onClick={reset} title="見積ボードの入力を初期値に戻す" aria-label="見積ボードの入力を初期値に戻す">
              <RotateCcw size={16} />
            </button>
          </div>
        </header>
      </section>

      {/* Container query: two columns once the right pane is ≥ 54rem (window ≈ 1270px), like `xl:grid-cols-[420px_1fr]`. */}
      <div className="grid grid-cols-1 items-start gap-6 @min-[54rem]:grid-cols-[420px_minmax(0,1fr)]">
        <QuoteSettingsForm
          quote={quote}
          result={result}
          link={link}
          countries={countries}
          autoDestination={autoDestination}
          autoPort={autoPort}
          onChange={setQuote}
          onShowVanning={onShowVanning}
        />
        <div className="min-w-0 @min-[54rem]:sticky @min-[54rem]:top-5">{right}</div>
      </div>

      <BreakdownTable quote={quote} result={result} mode={mode} onChange={setQuote} />
    </div>
  )
}
