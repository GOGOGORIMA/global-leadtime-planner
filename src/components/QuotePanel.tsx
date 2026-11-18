import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  Container,
  Copy,
  Link2,
  Package,
  PencilLine,
  Plane,
  ReceiptText,
  RotateCcw,
  Ship,
  Truck,
  Weight,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useMemo, useState, type Dispatch, type ReactNode } from 'react'
import { getContainerSpec, specsOfCategory, type ContainerCategory, type ContainerId } from '../data/containers'
import { getCountryInfo } from '../data/countries'
import { MAX_QUOTE_UNITS, MAX_QUOTE_VOLUME, MAX_QUOTE_WEIGHT } from '../state/defaults'
import type { PlannerAction } from '../state/plannerReducer'
import type { CargoItem, CushionSettings, QuoteSettings, UnitCount } from '../types'
import type { ResolvedCountry } from '../utils/calendars'
import { copyToClipboard } from '../utils/clipboard'
import type { ISODate } from '../utils/dateCalc'
import { renderQuotationEmail, type ExportOptions } from '../utils/exportText'
import type { ShippingMode } from '../utils/freightRates'
import { INCOTERMS, VOLUMETRIC_KG_PER_M3, type Incoterm } from '../utils/incotermsCalc'
import { computeQuote, linkCargo, type QuoteResult, type UnitChoice, type UnitSource } from '../utils/quotation'
import type { ScheduleReport } from '../utils/report'
import { btn, cx, focusRing, inputClass } from './classes'
import { NumberField } from './NumberField'
import { QuoteChart } from './QuoteChart'
import { QuoteSettingsForm } from './QuoteSettingsForm'
import {
  SERIES_STYLE,
  TERM_INFO,
  kgText,
  money,
  percent,
  qty,
  seriesAmount,
  seriesLabels,
  seriesOfTerm,
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

/** Badge text and tooltip of where a container / truck choice comes from. */
const SOURCE_LABELS: Readonly<Record<UnitSource, string>> = {
  manual: '手動',
  selected: '選択中',
  suggested: '自動判定',
  default: '既定',
}

const SOURCE_NOTES: Readonly<Record<UnitSource, string>> = {
  manual: '手動で指定した規格・数量',
  selected: '「積載3D」タブで選択中の規格。数量は全貨物を積むのに必要な本数・台数',
  suggested: '「積載3D」タブの自動判定（本数・台数が最少の規格）',
  default: '貨物が無いため既定の規格',
}

const MODE_LABELS: Readonly<Record<ShippingMode, string>> = { fcl: '海上・FCL', lcl: '海上・LCL', air: '航空' }

function unitsText(choice: Pick<UnitChoice, 'spec' | 'units'>): string {
  return `${choice.spec.label} × ${choice.units}${choice.spec.unitJa}`
}

/** One figure of the linked cargo strip. */
function SpecBadge({
  icon: Icon,
  label,
  value,
  state,
  tone = 'linked',
  active,
  note,
}: {
  icon: LucideIcon
  label: string
  value: string
  state?: string
  tone?: 'linked' | 'manual' | 'info'
  active?: boolean
  note?: string
}) {
  return (
    <div
      className={cx(
        'min-w-0 rounded-lg border px-2.5 py-1.5',
        active ? 'border-indigo-300 bg-indigo-50/70 ring-1 ring-indigo-300' : 'border-slate-200 bg-white',
      )}
      title={note}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-slate-500">
          <Icon size={13} className={cx('shrink-0', active ? 'text-indigo-600' : 'text-slate-400')} />
          <span className="truncate">{label}</span>
        </span>
        {state && (
          <span
            className={cx(
              'shrink-0 rounded px-1 py-px text-[9px] leading-tight font-semibold whitespace-nowrap ring-1',
              tone === 'linked' && 'bg-emerald-50 text-emerald-700 ring-emerald-200',
              tone === 'manual' && 'bg-amber-50 text-amber-800 ring-amber-200',
              tone === 'info' && 'bg-slate-50 text-slate-600 ring-slate-200',
            )}
          >
            {state}
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate text-[13px] font-bold text-slate-900 tabular-nums">{value}</div>
    </div>
  )
}

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className={cx(btn.icon, 'shrink-0')} onClick={onClick} title={label} aria-label={label}>
      <RotateCcw size={14} />
    </button>
  )
}

/** Container / truck type + count override. */
function UnitsEditor({
  label,
  category,
  value,
  linked,
  onChange,
}: {
  label: string
  category: ContainerCategory
  value: UnitCount | null
  linked: UnitChoice
  onChange: (value: UnitCount | null) => void
}) {
  const current = value ?? { id: linked.spec.id, units: linked.units }
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[10px] font-medium text-slate-500">{label}</span>
      <div className="flex items-center gap-1">
        <select
          aria-label={`${label}の規格`}
          className={cx(inputClass, 'min-w-0 flex-1 px-2 py-1.5 text-[13px]')}
          value={current.id}
          onChange={(e) => onChange({ id: e.target.value as ContainerId, units: current.units })}
        >
          {specsOfCategory(category).map((spec) => (
            <option key={spec.id} value={spec.id}>
              {spec.label}
            </option>
          ))}
        </select>
        <NumberField
          className="w-16 shrink-0"
          compact
          value={current.units}
          onChange={(units) => onChange({ id: current.id, units })}
          min={1}
          max={MAX_QUOTE_UNITS}
          ariaLabel={`${label}の数量`}
          suffix={getContainerSpec(current.id).unitJa}
        />
        {value && <ResetButton onClick={() => onChange(null)} label={`${label}を積載3Dの値に戻す`} />}
      </div>
    </div>
  )
}

function LinkedSpecs({
  quote,
  result,
  cargoCount,
  linkedVolume,
  linkedWeight,
  linkedSea,
  linkedTruck,
  selectedLabel,
  onChange,
  onShowVanning,
}: {
  quote: QuoteSettings
  result: QuoteResult
  cargoCount: number
  linkedVolume: number
  linkedWeight: number
  linkedSea: UnitChoice
  linkedTruck: UnitChoice
  selectedLabel: string
  onChange: (patch: Partial<QuoteSettings>) => void
  onShowVanning: () => void
}) {
  const hasOverride = quote.volume !== null || quote.weight !== null || quote.container !== null || quote.truck !== null
  const [editing, setEditing] = useState(hasOverride)
  const mode = quote.mode
  const volumetric = result.volume * VOLUMETRIC_KG_PER_M3

  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <Link2 size={14} className="text-indigo-600" />
          連動中の貨物スペック
        </span>
        <span className="text-[11px] text-slate-500">「積載3D」タブの貨物リスト・規格から自動取得（手動で上書きできます）</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" className={cx(btn.ghost, 'py-1 text-xs text-indigo-700')} onClick={onShowVanning}>
            積載3Dで確認 <ArrowRight size={13} />
          </button>
          <button
            type="button"
            className={cx(btn.secondary, 'py-1 text-xs', editing && 'border-indigo-300 bg-indigo-50 text-indigo-800')}
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            <PencilLine size={13} />
            手動で上書き
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 @xl:grid-cols-4 @[70rem]:grid-cols-7">
        <SpecBadge
          icon={Package}
          label="純粋貨物容積（Net）"
          value={`${qty(result.volume)} m³`}
          state={result.volumeLinked ? '連動' : '手動'}
          tone={result.volumeLinked ? 'linked' : 'manual'}
        />
        <SpecBadge
          icon={Weight}
          label="総重量（Gross）"
          value={`${kgText(result.weight)} kg`}
          state={result.weightLinked ? '連動' : '手動'}
          tone={result.weightLinked ? 'linked' : 'manual'}
        />
        <SpecBadge icon={Container} label="積載3Dの選択規格" value={selectedLabel} state="連動" />
        <SpecBadge
          icon={Ship}
          label="FCL コンテナ"
          value={unitsText(result.container)}
          state={SOURCE_LABELS[result.container.source]}
          tone={result.container.source === 'manual' ? 'manual' : result.container.source === 'selected' ? 'linked' : 'info'}
          active={mode === 'fcl'}
          note={SOURCE_NOTES[result.container.source]}
        />
        <SpecBadge
          icon={Truck}
          label="国内トラック"
          value={unitsText(result.truck)}
          state={SOURCE_LABELS[result.truck.source]}
          tone={result.truck.source === 'manual' ? 'manual' : result.truck.source === 'selected' ? 'linked' : 'info'}
          note={SOURCE_NOTES[result.truck.source]}
        />
        <SpecBadge
          icon={Boxes}
          label="LCL 課金（R/T）"
          value={`${qty(result.revenueTons)} R/T`}
          active={mode === 'lcl'}
          note={`容積 ${qty(result.volume)} m³ と重量 ${qty(result.weight / 1000)} t の大きい方（最小 1.0 R/T）`}
        />
        <SpecBadge
          icon={Plane}
          label="Air 課金重量"
          value={`${kgText(Math.ceil(result.chargeableKg))} kg`}
          active={mode === 'air'}
          note={`実重量 ${kgText(result.weight)} kg と容積重量 ${kgText(Math.round(volumetric))} kg（${qty(result.volume)} m³ × ${VOLUMETRIC_KG_PER_M3}）の大きい方`}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500 tabular-nums">
        課金単位：FCL ＝ コンテナ本数／LCL ＝ max(容積 {qty(result.volume)} m³, 重量 {qty(result.weight / 1000)} t)・最小 1.0 R/T／Air ＝ max(実重量{' '}
        {kgText(result.weight)} kg, 容積重量 {kgText(Math.round(volumetric))} kg)
      </p>

      {editing && (
        <div className="mt-2.5 grid gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 @xl:grid-cols-2 @4xl:grid-cols-4">
          <div className="min-w-0">
            <span className="mb-0.5 block text-[10px] font-medium text-slate-500">純粋貨物容積（m³）</span>
            <div className="flex items-center gap-1">
              <NumberField
                className="flex-1"
                compact
                value={quote.volume ?? Math.round(linkedVolume * 1000) / 1000}
                onChange={(volume) => onChange({ volume })}
                min={0}
                max={MAX_QUOTE_VOLUME}
                step={0.01}
                ariaLabel="純粋貨物容積の上書き（m³）"
                suffix="m³"
              />
              {quote.volume !== null && <ResetButton onClick={() => onChange({ volume: null })} label="容積を積載3Dの値に戻す" />}
            </div>
          </div>
          <div className="min-w-0">
            <span className="mb-0.5 block text-[10px] font-medium text-slate-500">総重量（kg）</span>
            <div className="flex items-center gap-1">
              <NumberField
                className="flex-1"
                compact
                value={quote.weight ?? Math.round(linkedWeight * 10) / 10}
                onChange={(weight) => onChange({ weight })}
                min={0}
                max={MAX_QUOTE_WEIGHT}
                step={0.1}
                ariaLabel="総重量の上書き（kg）"
                suffix="kg"
              />
              {quote.weight !== null && <ResetButton onClick={() => onChange({ weight: null })} label="重量を積載3Dの値に戻す" />}
            </div>
          </div>
          <UnitsEditor label="FCL コンテナ" category="sea" value={quote.container} linked={linkedSea} onChange={(container) => onChange({ container })} />
          <UnitsEditor label="国内トラック" category="truck" value={quote.truck} linked={linkedTruck} onChange={(truck) => onChange({ truck })} />
        </div>
      )}

      {cargoCount === 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          「積載3D」タブに貨物が登録されていません。容積・重量を手動で入力するか、積載3D タブで貨物を追加してください。
        </p>
      )}
      {mode === 'fcl' && result.container.unavailable && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-800 ring-1 ring-rose-200">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          標準の海上コンテナに収まらない貨物があります（オープントップ・フラットラック等の特殊コンテナ：運賃を手動で入力してください）。
        </p>
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

function PriceCard({ term, result, mode }: { term: Incoterm; result: QuoteResult; mode: ShippingMode }) {
  const price = result.prices[term]
  const isJpy = result.currency === 'JPY'
  const exw = result.prices.EXW.jpy
  const added = TERM_INFO[term].added
  const series = seriesOfTerm(term).filter((s) => s !== 'exw')
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
          {term === 'EXW' ? '梱包込・工場出荷の販売価格' : `EXW比 +${exw > 0 ? (((price.jpy - exw) / exw) * 100).toFixed(1) : '0.0'}%`}
        </div>
      </div>
      {term === 'EXW' ? (
        <p className="mt-2 text-[10px] leading-snug text-slate-400">基準価格（追加コストなし）</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label={`${term} に含まれる追加コスト`}>
          {series.map((s) => (
            <CostChip key={s} series={s} mode={mode} amount={seriesAmount(s, result.incoterms)} fresh={added.includes(s)} />
          ))}
        </ul>
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
  return [
    { label: 'EXW 基準価格（梱包込の工場出荷価格）', basis: '入力値', jpy: r.exw, series: 'exw', total: 'EXW' },
    {
      label: '国内トラック運賃（工場〜輸出港）',
      basis: result.domestic.manual ? '手動入力' : `${unitsText(result.truck)}（${SOURCE_LABELS[result.truck.source]}）`,
      jpy: r.domestic,
      series: 'fob',
    },
    {
      label: '輸出通関・港湾諸掛（THC / B/L / バンニング）',
      basis: result.exportCharges.manual ? '手動入力' : `${MODE_LABELS[mode]}の目安`,
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
              <th scope="col" className="py-1.5 pr-3 font-medium">項目</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">計算根拠</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">金額（円）</th>
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
                      <span className={total ? 'text-slate-900' : 'text-slate-700'}>{total === 'EXW' ? 'EXW（工場出荷）＝ 基準価格' : row.label}</span>
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
        製品原価・利益は扱わず、EXW 価格（工場出荷ベースの販売価格）に物流諸掛・保険・関税を積み上げた提示価格です。CIF は保険料が CIF 自身の 110% に掛かる循環を
        CIF ＝ CFR ÷ (1 − 1.1 × 保険料率) で解いています。DDP に輸入 VAT / GST は含みません。
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
  const link = useMemo(() => linkCargo(cargo, container, cushioning), [cargo, container, cushioning])
  const result = useMemo(() => computeQuote(quote, link, destination, today), [quote, link, destination, today])
  const setQuote = useCallback((patch: Partial<QuoteSettings>) => dispatch({ type: 'setQuote', patch }), [dispatch])
  const [copied, setCopied] = useState(false)
  const mode = quote.mode
  const destinationInfo = getCountryInfo(destination)

  const copy = async () => {
    const text = renderQuotationEmail({ ...exportOptions, format: 'quote' }, { quote: result, destinationName: destinationInfo.nameEn }, report)
    const ok = await copyToClipboard(text)
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 2000)
  }
  const reset = () => {
    if (window.confirm('見積ボードの入力（EXW 価格・通貨・運賃条件など）を初期値に戻しますか？')) dispatch({ type: 'resetQuote' })
  }

  const right: ReactNode = (
    <section aria-label="インコタームズ別 見積価格比較" className="rounded-xl border border-slate-200 bg-white shadow-sm @container">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">2. インコタームズ別 見積価格</h2>
        <span className="text-xs text-slate-500 tabular-nums">
          {result.currency === 'JPY' ? '円建て' : `${result.currency} 建て（適用レート ${result.appliedRate.toFixed(2)} 円）`}・{MODE_LABELS[mode]}・仕向地 {destinationInfo.nameJa}
        </span>
      </header>
      <div className="space-y-5 p-4">
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
      <section aria-label="Incoterms 輸出見積・コスト積算ボード" className="rounded-xl border border-slate-200 bg-white shadow-sm @container">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <ReceiptText size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Incoterms 輸出見積・コスト積算ボード</h2>
            <p className="text-xs text-slate-500">EXW 価格に物流諸掛・保険・関税を積み上げ、EXW / FOB / CIF / DAP / DDP の提示価格を算出します（製品原価・利益は扱いません）。</p>
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
        <LinkedSpecs
          quote={quote}
          result={result}
          cargoCount={cargo.length}
          linkedVolume={link.volume}
          linkedWeight={link.weight}
          linkedSea={link.sea}
          linkedTruck={link.truck}
          selectedLabel={link.selected.label}
          onChange={setQuote}
          onShowVanning={onShowVanning}
        />
      </section>

      {/* Container query: two columns once the right pane is ≥ 54rem (window ≈ 1270px), like `xl:grid-cols-[420px_1fr]`. */}
      <div className="grid grid-cols-1 items-start gap-6 @min-[54rem]:grid-cols-[420px_minmax(0,1fr)]">
        <QuoteSettingsForm quote={quote} result={result} countries={countries} autoDestination={autoDestination} onChange={setQuote} />
        <div className="min-w-0 @min-[54rem]:sticky @min-[54rem]:top-5">{right}</div>
      </div>

      <BreakdownTable result={result} mode={mode} />
    </div>
  )
}
