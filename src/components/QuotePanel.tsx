import { ArrowRight, Check, Copy, Lightbulb, ReceiptText, RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useState, type Dispatch, type ReactNode } from 'react'
import type { ContainerCategory, ContainerId } from '../data/containers'
import { getCountryInfo } from '../data/countries'
import type { PlannerAction } from '../state/plannerReducer'
import type { CargoItem, CushionSettings, QuoteCargoMode, QuoteSettings } from '../types'
import type { ResolvedCountry } from '../utils/calendars'
import { copyToClipboard } from '../utils/clipboard'
import type { ISODate } from '../utils/dateCalc'
import { renderQuotationEmail, type ExportOptions } from '../utils/exportText'
import type { ShippingMode } from '../utils/freightRates'
import { INCOTERMS, type Incoterm } from '../utils/incotermsCalc'
import { computeQuote, linkCargo, type QuoteResult, type UnitChoice, type UnitSource } from '../utils/quotation'
import type { ScheduleReport } from '../utils/report'
import { btn, cx, focusRing } from './classes'
import { QuoteChart } from './QuoteChart'
import { QuoteSettingsForm } from './QuoteSettingsForm'
import {
  SERIES_STYLE,
  TERM_INFO,
  compactMoney,
  kgText,
  money,
  percent,
  qty,
  recommendationLabel,
  seriesAmount,
  seriesLabels,
  seriesOfTerm,
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

/** 「算定ベース：概算 7.3 m³ / 1,800 kg（課金 R/T: 7.26 RT ｜ 推奨: LCL 混載）」 + the LCL → FCL hint. */
function SummaryBar({ result, onSwitchToFcl }: { result: QuoteResult; onSwitchToFcl: () => void }) {
  const suggestion = result.fclSuggestion
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
      <div className="mt-0.5 text-[11px] text-indigo-900/80">
        見積の輸送：<span className="font-semibold">{transportLabel(result)}</span>
        {result.modeSetting === 'auto' ? '（推奨どおり）' : '（手動で選択）'}
      </div>
      {suggestion && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 ring-1 ring-amber-200">
          <Lightbulb size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">
            分岐点を超えました：{unitsText(suggestion.container)} の FCL の方が割安です（運賃＋港湾諸掛 {yen(suggestion.fclTotal)} ＜ LCL{' '}
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

function CostChip({ series, mode, amount, fresh }: { series: CostSeries; mode: ShippingMode; amount: number; fresh: boolean }) {
  const { name, badge } = seriesLabels(series, mode)
  return (
    <li
      title={`${name}：${yen(amount)}`}
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] leading-tight font-medium ring-1 ring-inset',
        fresh ? 'bg-white text-slate-700 ring-slate-300' : 'bg-slate-50 text-slate-400 ring-slate-200',
      )}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', !fresh && 'opacity-50')} style={{ background: SERIES_STYLE[series].color }} />
      <span className="min-w-0">{badge}</span>
    </li>
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

function PriceCard({ term, result, mode }: { term: Incoterm; result: QuoteResult; mode: ShippingMode }) {
  const price = result.prices[term]
  const isJpy = result.currency === 'JPY'
  const base = result.incoterms.base
  const added = TERM_INFO[term].added
  const series = seriesOfTerm(term).filter((s) => s !== 'exw' && (s !== 'packing' || result.incoterms.packing > 0))
  const perM3 = perM3Text(term, result)
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col rounded-xl border p-3',
        term === 'DDP' ? 'col-span-2 border-indigo-300 bg-indigo-50/60 @2xl:col-span-1' : 'border-slate-200 bg-white',
      )}
    >
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-sm font-bold tracking-wide text-slate-900">{term}</span>
        <span className="truncate text-[10px] text-slate-500">{TERM_INFO[term].ja}</span>
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
              ? '基準価格＋輸出梱包費'
              : '工場出荷の販売価格'
            : `基準価格比 +${base > 0 ? (((price.jpy - base) / base) * 100).toFixed(1) : '0.0'}%`}
        </div>
      </div>
      {series.length === 0 ? (
        <p className="mt-2 text-[10px] leading-snug text-slate-400">追加コストなし</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label={`${term} に含まれる追加コスト`}>
          {series.map((s) => (
            <CostChip key={s} series={s} mode={mode} amount={seriesAmount(s, result.incoterms)} fresh={added.includes(s)} />
          ))}
        </ul>
      )}
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

interface BreakdownRow {
  label: string
  basis?: string
  jpy: number
  series?: CostSeries
  /** Subtotal row of an Incoterm (or CFR). */
  total?: Incoterm | 'CFR'
}

function breakdownRows(result: QuoteResult, mode: ShippingMode): BreakdownRow[] {
  const r = result.incoterms
  const freight = result.freight
  const local = result.local
  const marketLabel = result.marketFactor === 1 ? '通常期' : result.marketFactor === 1.5 ? '繁忙期' : '高騰期'
  const entered = (m: { amount: number; currency: 'JPY' | 'USD' }) => (m.currency === 'USD' ? usd(m.amount) : yen(m.amount))
  const quantity =
    freight.basis.unit === 'container'
      ? unitsText(result.container)
      : freight.basis.unit === 'rt'
        ? `${qty(freight.basis.quantity)} R/T`
        : `${kgText(Math.ceil(freight.basis.quantity))} kg`
  const tableRate = freight.basis.minimum ? `最低料金 ${usd(freight.basis.amount)}` : `${usd(freight.basis.rate)} × ${quantity}`
  const freightBasis = freight.manual
    ? `手動上書き ${entered(freight.manual)}`
    : `${tableRate} × ${result.marketFactor.toFixed(1)}（${marketLabel}）× ${result.usdRate.toFixed(2)} 円`
  const localBasis = local.manual
    ? `手動入力 ${entered(local.manual)}`
    : `プリセット ${usd(local.autoUsd)} × ${result.usdRate.toFixed(2)} 円`
  const exportBasis =
    mode === 'lcl' ? `${qty(result.chargedRevenueTons)} R/T × CFS 単価 ＋ 基本料` : mode === 'fcl' ? `${unitsText(result.container)} × THC・バンニング ＋ 基本料` : '上屋・取扱 ＋ 基本料'
  return [
    { label: '基準価格（工場出荷の販売価格）', basis: '入力値', jpy: r.base, series: 'exw' },
    ...(r.packing > 0
      ? [{ label: '輸出梱包費（木箱・パレット）', basis: `${qty(result.volume)} m³ × ${yen(result.packing.rate)}`, jpy: r.packing, series: 'packing' as const }]
      : []),
    { label: 'EXW（工場出荷）', jpy: r.exw, total: 'EXW' },
    {
      label: '国内トラック運賃（工場〜輸出港）',
      basis: result.domestic.manual ? '手動入力' : `${unitsText(result.truck)}（${SOURCE_LABELS[result.truck.source]}）`,
      jpy: r.domestic,
      series: 'fob',
    },
    {
      label: '輸出通関・港湾諸掛（THC / CFS / B/L / バンニング）',
      basis: result.exportCharges.manual ? '手動入力' : exportBasis,
      jpy: r.exportCharges,
      series: 'fob',
    },
    { label: 'FOB（本船渡）', jpy: r.fob, total: 'FOB' },
    { label: `国際運賃（${MODE_LABELS[mode]}）`, basis: freightBasis, jpy: r.freightBase, series: 'freight' },
    { label: `運賃変動バッファ（${percent(result.freightBuffer)}）`, basis: '実勢・上書き運賃に加算', jpy: r.freightContingency, series: 'freight' },
    { label: 'CFR（運賃込）', jpy: r.cfr, total: 'CFR' },
    {
      label: '保険料',
      basis: `CIF × 110%（${yen(r.insuredValue)}）× ${percent(result.insuranceRate)}`,
      jpy: r.insurance,
      series: 'insurance',
    },
    { label: 'CIF（運賃・保険料込）', jpy: r.cif, total: 'CIF' },
    { label: '現地港湾・輸入通関・現地配送費（DAP費用）', basis: localBasis, jpy: r.localCharges, series: 'local' },
    { label: 'DAP（現地指定場所持込）', jpy: r.dap, total: 'DAP' },
    { label: '現地関税', basis: `CIF × ${percent(result.dutyRate)}`, jpy: r.duty, series: 'duty' },
    { label: 'DDP（関税込現地持込）', jpy: r.ddp, total: 'DDP' },
  ]
}

function BreakdownTable({ result, mode }: { result: QuoteResult; mode: ShippingMode }) {
  const rows = breakdownRows(result, mode)
  const isJpy = result.currency === 'JPY'
  return (
    <section aria-label="積算内訳" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">積算内訳（計算の根拠）</h2>
        <span className="text-xs text-slate-500">
          円で積み上げ、各条件の合計を {isJpy ? '円' : `社内適用レート ${result.appliedRate.toFixed(2)} 円 / ${result.currency}`} で提示価格にしています。
        </span>
      </header>
      <div className="overflow-x-auto px-4 py-3 sm:px-5">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] text-slate-500">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                項目
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                計算根拠
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                金額（円）
              </th>
              {!isJpy && (
                <th scope="col" className="py-1.5 text-right font-medium">
                  提示価格（{result.currency}）
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const total = row.total
              const quotePrice = total && total !== 'CFR' ? result.prices[total].quote : null
              return (
                <tr
                  key={row.label}
                  className={cx(
                    'border-b border-slate-100 last:border-0',
                    total && 'bg-slate-50/80 font-semibold',
                    total === 'DDP' && 'bg-indigo-50/60',
                  )}
                >
                  <td className="py-1.5 pr-3">
                    <span className="flex items-center gap-2">
                      {row.series && !total ? (
                        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: SERIES_STYLE[row.series].color }} />
                      ) : (
                        <span className="h-2.5 w-2.5 shrink-0" />
                      )}
                      <span className={total ? 'text-slate-900' : 'text-slate-700'}>{row.label}</span>
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-[11px] font-normal text-slate-500 tabular-nums">{row.basis ?? ''}</td>
                  <td className="py-1.5 pr-3 text-right text-slate-900 tabular-nums">{row.jpy.toLocaleString('en-US')}</td>
                  {!isJpy && (
                    <td className="py-1.5 text-right text-slate-900 tabular-nums">{quotePrice !== null ? money(quotePrice, result.decimals) : ''}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500 sm:px-5">
        製品原価・利益は扱わず、EXW 価格（工場出荷ベースの販売価格＋輸出梱包費）に物流諸掛・保険・関税を積み上げた提示価格です。CIF は保険料が CIF
        自身の 110% に掛かる循環を CIF ＝ CFR ÷ (1 − 1.1 × 保険料率) で解いています。DDP に輸入 VAT / GST は含みません。
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
  const result = useMemo(() => computeQuote(quote, link, destination, today), [quote, link, destination, today])
  const setQuote = useCallback((patch: Partial<QuoteSettings>) => dispatch({ type: 'setQuote', patch }), [dispatch])
  const [copied, setCopied] = useState(false)
  const mode = result.mode
  const destinationInfo = getCountryInfo(destination)

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
          {result.currency === 'JPY' ? '円建て' : `${result.currency} 建て（適用レート ${result.appliedRate.toFixed(2)} 円）`}・{MODE_LABELS[mode]}・仕向地 {destinationInfo.nameJa}
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
              概算M3・重量から梱包費・物流諸掛・保険・関税を積み上げ、EXW / FOB / CIF / DAP / DDP の提示価格を算出します（製品原価・利益は扱いません）。
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
          onChange={setQuote}
          onShowVanning={onShowVanning}
        />
        <div className="min-w-0 @min-[54rem]:sticky @min-[54rem]:top-5">{right}</div>
      </div>

      <BreakdownTable result={result} mode={mode} />
    </div>
  )
}
