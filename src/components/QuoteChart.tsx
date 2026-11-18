import { useState } from 'react'
import type { QuoteCurrency } from '../data/currencies'
import type { ShippingMode } from '../utils/freightRates'
import { INCOTERMS, type Incoterm } from '../utils/incotermsCalc'
import type { QuoteResult } from '../utils/quotation'
import { cx, focusRing } from './classes'
import {
  COST_SERIES_ORDER,
  SERIES_STYLE,
  TERM_INFO,
  money,
  quoteMoney,
  seriesAmount,
  seriesLabels,
  seriesOfTerm,
  type CostSeries,
} from './quoteStyles'

/** Bar area height, the EXW block height in the zoomed scale, and the space for the price caps. */
const PLOT_H = 220
const EXW_ZOOM_H = 56
const CAP_H = 30
/** Surface gap between stacked blocks (px). */
const GAP = 2
/** Minimum block heights for a two-line (name + value) / one-line (value) label inside. */
const LABEL_TWO_LINES = 30
const LABEL_ONE_LINE = 16
/** Column width inside its grid track, and half of it (for the step connectors). */
const COL_W = 'min(78%, 88px)'
const HALF_W = 'min(39%, 44px)'

type Scale = 'zoom' | 'full'
type LabelMode = 'amount' | 'share'

interface Block {
  series: CostSeries
  /** JPY. */
  amount: number
  bottom: number
  height: number
  /** Added at this term (labelled inside the block). */
  isNew: boolean
}

function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string; title: string }>
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition',
            focusRing,
            option.value === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** White zig-zag near the top of the EXW block: its height is not to scale in the zoomed view. */
function BreakMark() {
  return (
    <svg className="pointer-events-none absolute inset-x-0" style={{ bottom: 38 }} height="10" width="100%" viewBox="0 0 96 10" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points="0,7 8,3 16,7 24,3 32,7 40,3 48,7 56,3 64,7 72,3 80,7 88,3 96,7"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * Staircase of the Incoterms prices (CSS only): one stacked column per term, the EXW price at
 * the bottom and each added cost on top, so every term steps up from the previous one. The zoomed
 * scale shortens the EXW block (marked with a break) so the added costs can be read.
 */
export function QuoteChart({ result, mode }: { result: QuoteResult; mode: ShippingMode }) {
  const [scale, setScale] = useState<Scale>('zoom')
  const [labelMode, setLabelMode] = useState<LabelMode>('amount')
  const [active, setActive] = useState<Incoterm | null>(null)

  const r = result.incoterms
  const currency: QuoteCurrency = result.currency
  // Everything above the base price (packing included) is drawn to scale in the zoomed view.
  const addOns = r.ddp - r.base
  const zoom = scale === 'zoom' && r.base > 0 && addOns > 0
  const toQuote = (jpy: number) => (currency === 'JPY' ? jpy : jpy / result.appliedRate)
  const share = (jpy: number) => (r.ddp > 0 ? `${((jpy / r.ddp) * 100).toFixed(1)}%` : '0%')

  const heightOf = (series: CostSeries, amount: number) => {
    if (zoom) return series === 'exw' ? EXW_ZOOM_H : (amount / addOns) * (PLOT_H - EXW_ZOOM_H)
    return r.ddp > 0 ? (amount / r.ddp) * PLOT_H : 0
  }
  const columns = INCOTERMS.map((term) => {
    let bottom = 0
    const blocks: Block[] = seriesOfTerm(term).map((series) => {
      const amount = seriesAmount(series, r)
      const height = heightOf(series, amount)
      const block = { series, amount, bottom, height, isNew: TERM_INFO[term].added.includes(series) }
      bottom += height
      return block
    })
    return { term, blocks, top: bottom, price: result.prices[term] }
  })

  if (r.ddp <= 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        EXW 基準価格を入力すると、コストの積上げチャートを表示します。
      </div>
    )
  }

  const describe = (term: Incoterm) =>
    `${term} ${quoteMoney(result.prices[term].quote, currency, result.decimals)}：` +
    columns
      .find((c) => c.term === term)!
      .blocks.map((b) => `${seriesLabels(b.series, mode).name} ${quoteMoney(toQuote(b.amount), currency, 0)}`)
      .join('、')

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold text-slate-800">コスト積上げ階段チャート</h3>
        <span className="text-[11px] text-slate-500">
          EXW → FOB → CIF → DAP → DDP（金額：{currency === 'JPY' ? '円' : currency}・構成比は DDP に対する割合）
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <ToggleGroup
            ariaLabel="縮尺"
            value={scale}
            onChange={setScale}
            options={[
              { value: 'zoom', label: '上乗せを拡大', title: 'EXW 部分を省略表示して、上乗せコストを大きく表示' },
              { value: 'full', label: '実寸', title: '0 円を起点に、比率どおりの高さで表示' },
            ]}
          />
          <ToggleGroup
            ariaLabel="ラベル"
            value={labelMode}
            onChange={setLabelMode}
            options={[
              { value: 'amount', label: '金額', title: 'ブロック内に金額を表示' },
              { value: 'share', label: '構成比', title: 'ブロック内に DDP に対する構成比を表示' },
            ]}
          />
        </div>
      </div>

      <div role="group" aria-label="コスト積上げ階段チャート" className="relative mt-3" style={{ height: CAP_H + PLOT_H }}>
        <div className="absolute inset-x-0 bottom-0 h-px bg-slate-300" aria-hidden="true" />
        <div className="absolute inset-0 grid grid-cols-5">
          {columns.map((col, i) => {
            const previousTop = i > 0 ? columns[i - 1].top : 0
            const tooltipLeft = i < 3
            return (
              <div
                key={col.term}
                role="img"
                tabIndex={0}
                aria-label={describe(col.term)}
                className={cx('relative h-full rounded-md outline-none', 'focus-visible:ring-2 focus-visible:ring-indigo-500')}
                onPointerEnter={() => setActive(col.term)}
                onPointerLeave={() => setActive((current) => (current === col.term ? null : current))}
                onFocus={() => setActive(col.term)}
                onBlur={() => setActive((current) => (current === col.term ? null : current))}
              >
                {/* Step connectors: previous top → this column, this top → next column. */}
                {i > 0 && (
                  <div
                    className="absolute left-0 h-px bg-slate-300"
                    style={{ bottom: previousTop, right: `calc(50% + ${HALF_W})` }}
                    aria-hidden="true"
                  />
                )}
                {i < columns.length - 1 && (
                  <div
                    className="absolute right-0 h-px bg-slate-300"
                    style={{ bottom: col.top, left: `calc(50% + ${HALF_W})` }}
                    aria-hidden="true"
                  />
                )}

                <div
                  className={cx('absolute bottom-0 left-1/2 -translate-x-1/2 transition-opacity', active && active !== col.term && 'opacity-60')}
                  style={{ width: COL_W, height: PLOT_H }}
                  aria-hidden="true"
                >
                  {col.blocks.map((b, index) => {
                    const height = Math.max(0, b.height - GAP)
                    const style = SERIES_STYLE[b.series]
                    const showLabel = b.isNew && height >= LABEL_ONE_LINE
                    const value = labelMode === 'amount' ? money(toQuote(b.amount), 0) : share(b.amount)
                    return (
                      <div
                        key={b.series}
                        className={cx('absolute inset-x-0 overflow-visible rounded-[3px]', index === 0 && 'rounded-b-none')}
                        style={{ bottom: b.bottom, height, background: style.color, color: style.ink }}
                      >
                        {b.series === 'exw' && zoom && <BreakMark />}
                        {showLabel && (
                          // The zoomed EXW block keeps its label below the break mark.
                          <div
                            className={cx(
                              'flex h-full flex-col items-center px-1 text-center leading-tight',
                              b.series === 'exw' && zoom ? 'justify-end pb-1.5' : 'justify-center',
                            )}
                          >
                            {height >= LABEL_TWO_LINES && !(b.series === 'exw' && zoom) && (
                              <span className="text-[10px] font-medium whitespace-nowrap">{seriesLabels(b.series, mode).short}</span>
                            )}
                            <span className="text-[11px] font-semibold whitespace-nowrap tabular-nums">{value}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Price cap */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 text-center text-[11px] font-bold whitespace-nowrap text-slate-900 tabular-nums"
                  style={{ bottom: col.top + 4 }}
                  aria-hidden="true"
                >
                  {currency === 'JPY' ? `¥${money(col.price.quote, 0)}` : money(col.price.quote, result.decimals)}
                </div>

                {active === col.term && (
                  <div
                    className="pointer-events-none absolute top-1 z-30 w-56 rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-lg"
                    style={tooltipLeft ? { left: `calc(50% + ${HALF_W} + 6px)` } : { right: `calc(50% + ${HALF_W} + 6px)` }}
                  >
                    <div className="text-[11px] text-slate-500">
                      <span className="font-bold text-slate-900">{col.term}</span> {TERM_INFO[col.term].ja}
                    </div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">{quoteMoney(col.price.quote, currency, result.decimals)}</div>
                    <ul className="mt-1.5 space-y-0.5">
                      {[...col.blocks].reverse().map((b) => (
                        <li key={b.series} className="flex items-center gap-1.5 text-[11px]">
                          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: SERIES_STYLE[b.series].color }} />
                          <span className="font-semibold text-slate-900 tabular-nums">{money(toQuote(b.amount), 0)}</span>
                          <span className="min-w-0 truncate text-slate-500">{seriesLabels(b.series, mode).name}</span>
                          <span className="ml-auto text-slate-400 tabular-nums">{share(b.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* x axis */}
      <div className="mt-1.5 grid grid-cols-5 text-center" aria-hidden="true">
        {columns.map((col) => (
          <div key={col.term} className="min-w-0 leading-tight">
            <div className="text-xs font-bold text-slate-800">{col.term}</div>
            <div className="truncate text-[10px] text-slate-500">{TERM_INFO[col.term].ja}</div>
          </div>
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1" aria-label="凡例">
        {COST_SERIES_ORDER.filter((series) => series !== 'packing' || r.packing > 0).map((series) => (
          <li key={series} className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: SERIES_STYLE[series].color }} />
            {seriesLabels(series, mode).name}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
        {zoom
          ? '白い波線のある基準価格の部分は高さを省略して表示しています（梱包費から上の上乗せコストを拡大）。比率どおりに見るには「実寸」を選択してください。'
          : '0 円を起点に比率どおりの高さで表示しています。'}
        各列にカーソルを合わせると内訳を表示します（下の積算内訳表にも同じ数値があります）。
      </p>
    </div>
  )
}
