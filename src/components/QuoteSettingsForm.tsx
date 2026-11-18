import { AlertTriangle, Boxes, CalendarClock, Container, Info, Plane, RotateCcw } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { getCountryCatalog, getCountryInfo } from '../data/countries'
import { CURRENCY_INFO, QUOTE_CURRENCIES, type QuoteCurrency } from '../data/currencies'
import {
  DUTY_PRESETS,
  MAX_DUTY_RATE,
  MAX_FREIGHT_BUFFER,
  MAX_FX_BUFFER,
  MAX_FX_RATE,
  MAX_INSURANCE_RATE,
  MAX_QUOTE_CHARGE,
  MAX_QUOTE_PRICE,
} from '../state/defaults'
import type { MoneyAmount, QuoteSettings } from '../types'
import type { ResolvedCountry } from '../utils/calendars'
import type { ISODate } from '../utils/dateCalc'
import { formatJaDate } from '../utils/dateFormat'
import {
  DEDICATED_LANE_COUNTRIES,
  EXPORT_CHARGE_RATES,
  FREIGHT_ORIGIN,
  FREIGHT_REGION_LABELS,
  type ExportChargeLine,
  type FreightMarket,
  type RatedAmount,
  type ShippingMode,
} from '../utils/freightRates'
import type { QuoteResult } from '../utils/quotation'
import { cx, focusRing, inputClass } from './classes'
import { CountryFlag } from './CountryFlag'
import { NumberField } from './NumberField'
import { kgText, percent, qty, usd, yen } from './quoteStyles'
import { Segmented } from './ui'

interface QuoteSettingsFormProps {
  quote: QuoteSettings
  result: QuoteResult
  /** Selected countries (left pane) — offered first as destinations. */
  countries: readonly ResolvedCountry[]
  /** Destination used when `quote.destination` is '' (the schedule's partner country). */
  autoDestination: string
  onChange: (patch: Partial<QuoteSettings>) => void
}

const MARKETS: ReadonlyArray<{ value: FreightMarket; label: string; factor: string; title: string; active: string }> = [
  {
    value: 'normal',
    label: '通常期',
    factor: '1.0x',
    title: '平常時の運賃水準',
    active: 'border-indigo-500 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-500',
  },
  {
    value: 'peak',
    label: '繁忙期',
    factor: '1.5x',
    title: '旧正月前・年末・夏季などの繁忙期（PSS・GRI が加算される時期）',
    active: 'border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-500',
  },
  {
    value: 'surge',
    label: '高騰期',
    factor: '2.5x',
    title: 'スエズ・紅海の迂回、港湾混雑などで運賃が高騰している時期',
    active: 'border-rose-500 bg-rose-50 text-rose-800 ring-1 ring-rose-500',
  },
]

const EXPORT_LINE_LABELS: Readonly<Record<ExportChargeLine['key'], string>> = {
  thc: 'THC',
  vanning: 'バンニング',
  seal: 'シール',
  cfs: 'CFS・THC',
  airHandling: '上屋・取扱・X線検査',
  customs: '輸出通関料',
  document: 'B/L・AWB 作成料',
}

const UNIT_TEXT: Readonly<Record<RatedAmount['unit'], (q: number) => string>> = {
  container: (q) => `${q}本`,
  rt: (q) => `${qty(q)} R/T`,
  kg: (q) => `${kgText(Math.ceil(q))} kg`,
}

function SectionHeader({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
        {n}
      </span>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {note && <span className="text-[11px] text-slate-500">{note}</span>}
    </div>
  )
}

function FieldLabel({ htmlFor, children, extra }: { htmlFor?: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-1 flex items-end justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs leading-snug font-medium text-slate-600">
        {children}
      </label>
      {extra}
    </div>
  )
}

function Hint({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'error' }) {
  return (
    <p
      className={cx(
        'mt-1 text-[11px] leading-relaxed',
        tone === 'muted' && 'text-slate-500',
        tone === 'warn' && 'text-amber-800',
        tone === 'error' && 'text-rose-700',
      )}
    >
      {children}
    </p>
  )
}

/** 「自動」/「手動」 chip with a reset button for manual values. */
function AutoState({ manual, onReset, autoLabel = '自動' }: { manual: boolean; onReset: () => void; autoLabel?: string }) {
  if (!manual) {
    return (
      <span className="rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        {autoLabel}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">手動</span>
      <button
        type="button"
        onClick={onReset}
        className={cx('inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-50', focusRing)}
        title="自動計算の値に戻す"
      >
        <RotateCcw size={11} />
        自動に戻す
      </button>
    </span>
  )
}

/** Slider with the current value on the right. */
function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  children,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  display: string
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          {label}
        </label>
        <span className="text-sm font-semibold text-slate-900 tabular-nums">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-5 w-full cursor-pointer accent-indigo-600"
      />
      <div className="flex justify-between text-[10px] text-slate-400 tabular-nums">
        <span>{min}%</span>
        <span>{max}%</span>
      </div>
      {children}
    </div>
  )
}

function CurrencyToggle({ value, onChange, label }: { value: 'JPY' | 'USD'; onChange: (value: 'JPY' | 'USD') => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
      {(['USD', 'JPY'] as const).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={cx(
            'rounded-md px-2 py-1 text-[11px] font-semibold transition',
            focusRing,
            value === c ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {c === 'USD' ? 'USD' : '円'}
        </button>
      ))}
    </div>
  )
}

/**
 * Amount in USD or JPY that is automatic (table / preset) until edited. Switching the currency
 * converts a manual amount at the USD rate; an automatic amount is just shown in the other currency.
 */
function MoneyField({
  label,
  value,
  autoUsd,
  autoJpy,
  usdRate,
  onChange,
  autoLabel,
  children,
}: {
  label: string
  value: MoneyAmount | null
  autoUsd: number
  autoJpy: number
  usdRate: number
  onChange: (value: MoneyAmount | null) => void
  autoLabel?: string
  children?: ReactNode
}) {
  const id = useId()
  const [display, setDisplay] = useState<'JPY' | 'USD'>(value?.currency ?? 'USD')
  const currency = value?.currency ?? display
  const shown = value ? value.amount : currency === 'USD' ? Math.round(autoUsd * 100) / 100 : autoJpy
  const toggle = (next: 'JPY' | 'USD') => {
    setDisplay(next)
    if (!value || value.currency === next) return
    const amount = next === 'JPY' ? Math.round(value.amount * usdRate) : Math.round((value.amount / usdRate) * 100) / 100
    onChange({ amount, currency: next })
  }
  return (
    <div>
      <FieldLabel htmlFor={id} extra={<AutoState manual={value !== null} onReset={() => onChange(null)} autoLabel={autoLabel} />}>
        {label}
      </FieldLabel>
      <div className="flex items-center gap-1.5">
        <NumberField
          id={id}
          className="flex-1"
          value={shown}
          onChange={(amount) => onChange({ amount, currency })}
          min={0}
          max={MAX_QUOTE_CHARGE}
          step={currency === 'USD' ? 0.01 : 1}
          ariaLabel={label}
          suffix={currency === 'USD' ? 'USD' : '円'}
        />
        <CurrencyToggle value={currency} onChange={toggle} label={`${label}の通貨`} />
      </div>
      {children}
    </div>
  )
}

/** JPY amount that is automatic until edited. */
function YenField({
  label,
  value,
  auto,
  onChange,
  children,
}: {
  label: string
  value: number | null
  auto: number
  onChange: (value: number | null) => void
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div>
      <FieldLabel htmlFor={id} extra={<AutoState manual={value !== null} onReset={() => onChange(null)} />}>
        {label}
      </FieldLabel>
      <NumberField id={id} value={value ?? auto} onChange={onChange} min={0} max={MAX_QUOTE_CHARGE} step={1000} ariaLabel={label} suffix="円" />
      {children}
    </div>
  )
}

/** `US$350 × 1本 × 1.0（通常期）= US$350 ≒ ¥52,500`. */
function rateText(rated: RatedAmount, factor?: { value: number; label: string }): string {
  const core = rated.minimum
    ? `最低料金 ${usd(rated.amount)}`
    : `${rated.base ? `${usd(rated.base)} ＋ ` : ''}${usd(rated.rate)} × ${UNIT_TEXT[rated.unit](rated.quantity)}`
  return factor ? `${core} × ${factor.value.toFixed(1)}（${factor.label}）` : core
}

function exportLinesText(lines: readonly ExportChargeLine[], mode: ShippingMode): string {
  return lines
    .map((line) => {
      const label = EXPORT_LINE_LABELS[line.key]
      if (line.key === 'airHandling') {
        return `${label} ${line.rate}円 × ${UNIT_TEXT.kg(line.quantity)}（最低 ${yen(EXPORT_CHARGE_RATES.airMin)}）`
      }
      if (line.key === 'customs' || line.key === 'document') return `${label} ${yen(line.amount)}`
      const unit = mode === 'lcl' ? UNIT_TEXT.rt(line.quantity) : UNIT_TEXT.container(line.quantity)
      return `${label} ${yen(line.rate)} × ${unit}`
    })
    .join(' ＋ ')
}

function sortJa(codes: Iterable<string>): string[] {
  return [...codes].sort((a, b) => getCountryInfo(a).nameJa.localeCompare(getCountryInfo(b).nameJa, 'ja'))
}

function DestinationSelect({
  value,
  destination,
  autoDestination,
  countries,
  onChange,
  id,
}: {
  value: string
  destination: string
  autoDestination: string
  countries: readonly ResolvedCountry[]
  onChange: (code: string) => void
  id: string
}) {
  const selected = countries.map((c) => c.code).filter((code) => code !== FREIGHT_ORIGIN)
  const major = sortJa(DEDICATED_LANE_COUNTRIES.filter((code) => !selected.includes(code)))
  const listed = new Set([...selected, ...major, FREIGHT_ORIGIN])
  const others = sortJa(getCountryCatalog().map((c) => c.code).filter((code) => !listed.has(code)))
  const option = (code: string) => (
    <option key={code} value={code}>
      {getCountryInfo(code).nameJa}
    </option>
  )
  return (
    <div className="relative">
      <CountryFlag code={destination} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
      <select id={id} className={cx(inputClass, 'pl-10')} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">自動（工程の相手国：{getCountryInfo(autoDestination).nameJa}）</option>
        {selected.length > 0 && <optgroup label="選択中の国">{selected.map(option)}</optgroup>}
        <optgroup label="主要仕向地（専用の目安運賃）">{major.map(option)}</optgroup>
        <optgroup label="その他の国（地域の目安運賃）">{others.map(option)}</optgroup>
      </select>
    </div>
  )
}

/** Left column: base price & FX, FOB charges, international freight, destination charges & duty. */
export function QuoteSettingsForm({ quote, result, countries, autoDestination, onChange }: QuoteSettingsFormProps) {
  const ids = {
    exw: useId(),
    currency: useId(),
    rate: useId(),
    usd: useId(),
    destination: useId(),
    insurance: useId(),
    duty: useId(),
    validity: useId(),
  }
  const isJpy = quote.currency === 'JPY'
  const unitJa = isJpy ? '円' : quote.currency
  const lane = result.lane
  const freightName = quote.mode === 'air' ? '航空運賃' : '海上運賃'
  const market = MARKETS.find((m) => m.value === quote.market) ?? MARKETS[0]
  const peakish = quote.market !== 'normal'
  const r = result.incoterms

  return (
    <section aria-label="基準価格・物流条件の設定パネル" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">1. 基準価格・物流条件の設定</h2>
        <p className="mt-0.5 text-xs text-slate-500">EXW 価格に積み上げる諸掛・運賃・保険・関税の条件を設定します。</p>
      </header>

      <div className="divide-y divide-slate-100">
        {/* 1. Base price, currency and FX */}
        <div className="space-y-3 p-4">
          <SectionHeader n={1} title="基準価格と通貨・為替設定" />
          <div>
            <FieldLabel htmlFor={ids.exw}>EXW 基準価格（梱包込の工場出荷価格）</FieldLabel>
            <NumberField
              id={ids.exw}
              value={quote.exw}
              onChange={(exw) => onChange({ exw })}
              min={0}
              max={MAX_QUOTE_PRICE}
              step={10000}
              ariaLabel="EXW 基準価格（円）"
              suffix="円"
            />
            <Hint>工場出荷時点の販売価格（輸出梱包込）。製品原価・利益は入力しません。</Hint>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel htmlFor={ids.currency}>見積提示通貨</FieldLabel>
              <select
                id={ids.currency}
                className={inputClass}
                value={quote.currency}
                onChange={(e) => onChange({ currency: e.target.value as QuoteCurrency })}
              >
                {QUOTE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}（{CURRENCY_INFO[c].nameJa}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor={ids.rate}>実勢為替レート{isJpy ? '' : `（1 ${quote.currency}）`}</FieldLabel>
              <NumberField
                id={ids.rate}
                value={isJpy ? 1 : quote.fxRate}
                onChange={(fxRate) => onChange({ fxRate })}
                min={0.0001}
                max={MAX_FX_RATE}
                step={0.01}
                ariaLabel="実勢為替レート（1外貨あたりの円）"
                suffix="円"
                disabled={isJpy}
              />
            </div>
          </div>
          {isJpy ? (
            <Hint>円建てで提示するため、為替換算と為替安全バッファは使いません。</Hint>
          ) : (
            <>
              <RangeField
                label="為替安全バッファ（Exchange Buffer）"
                value={quote.fxBuffer}
                min={0}
                max={MAX_FX_BUFFER}
                step={0.5}
                onChange={(fxBuffer) => onChange({ fxBuffer })}
                display={`${quote.fxBuffer.toFixed(1)}%`}
              />
              <div className="rounded-lg bg-indigo-50/70 px-3 py-2 ring-1 ring-indigo-100">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-xs font-semibold text-indigo-900">社内適用レート</span>
                  <span className="text-base font-bold text-indigo-900 tabular-nums">
                    {result.appliedRate.toFixed(2)} 円 / {quote.currency}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-indigo-900/80 tabular-nums">
                  実勢 {quote.fxRate.toFixed(2)} × (1 − {quote.fxBuffer.toFixed(1)}%)。外貨建て価格はこの厳しめのレートで割り返し、提示後の円高による為替差損を防ぎます。
                </p>
              </div>
            </>
          )}
          {quote.currency !== 'USD' && (
            <div>
              <FieldLabel htmlFor={ids.usd}>USD 換算レート（USD 建て運賃・現地諸掛の円換算用）</FieldLabel>
              <NumberField
                id={ids.usd}
                value={quote.usdRate}
                onChange={(usdRate) => onChange({ usdRate })}
                min={0.0001}
                max={MAX_FX_RATE}
                step={0.01}
                ariaLabel="USD 換算レート（1 USD あたりの円）"
                suffix="円"
              />
            </div>
          )}
        </div>

        {/* 2. Domestic logistics and export charges */}
        <div className="space-y-3 p-4">
          <SectionHeader n={2} title="国内物流・輸出諸掛" note="FOB 加算分" />
          <YenField
            label="国内トラック運賃（工場〜輸出港）"
            value={quote.domestic}
            auto={result.domestic.auto}
            onChange={(domestic) => onChange({ domestic })}
          >
            <Hint>
              {result.domestic.manual ? '手動入力。' : ''}目安：{result.truck.spec.label} × {result.truck.units}台（
              {result.truck.source === 'manual' ? '手動指定' : result.truck.source === 'selected' ? '積載3Dで選択中' : '積載3Dの自動判定'}）＝{' '}
              {yen(result.domestic.auto)}
              {result.truck.unavailable && '。標準トラックに収まらない貨物があります（特殊車両の運賃を入力してください）'}
            </Hint>
          </YenField>
          <YenField
            label="輸出通関・港湾諸掛（THC / B/L費 / バンニング費）"
            value={quote.exportCharges}
            auto={result.exportCharges.auto}
            onChange={(exportCharges) => onChange({ exportCharges })}
          >
            <Hint>
              目安：{exportLinesText(result.exportCharges.lines, quote.mode)} ＝ {yen(result.exportCharges.auto)}
            </Hint>
          </YenField>
          <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <span className="font-medium text-slate-600">FOB 諸掛 合計</span>
            <span className="font-bold text-slate-900 tabular-nums">{yen(r.fobCharges)}</span>
          </div>
        </div>

        {/* 3. International freight */}
        <div className="space-y-3 p-4">
          <SectionHeader n={3} title="変動する国際輸送費" note="CFR・CIF 加算分" />
          <Segmented
            ariaLabel="輸送モード"
            className="w-full"
            value={quote.mode}
            onChange={(mode) => onChange({ mode })}
            options={[
              { value: 'fcl', label: 'FCL（コンテナ）', icon: <Container size={15} /> },
              { value: 'lcl', label: 'LCL（混載）', icon: <Boxes size={15} /> },
              { value: 'air', label: 'Air（航空便）', icon: <Plane size={15} /> },
            ]}
          />
          <div>
            <FieldLabel htmlFor={ids.destination}>仕向地（対象国）</FieldLabel>
            <DestinationSelect
              id={ids.destination}
              value={quote.destination}
              destination={result.destination}
              autoDestination={autoDestination}
              countries={countries}
              onChange={(destination) => onChange({ destination })}
            />
            <Hint>
              {lane.estimated
                ? `専用の運賃データがないため、${FREIGHT_REGION_LABELS[lane.region]}の目安運賃を使用しています。`
                : `代表港：${lane.port}（${FREIGHT_REGION_LABELS[lane.region]}）。`}
              通常期：20ft {usd(lane.fcl20)} ／ 40ft {usd(lane.fcl40)} ／ LCL {usd(lane.lcl)}/R/T ／ Air {usd(lane.air, 2)}/kg
            </Hint>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">市況モード</span>
            <div role="radiogroup" aria-label="市況モード" className="grid grid-cols-3 gap-1.5">
              {MARKETS.map((m) => {
                const active = m.value === quote.market
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={m.title}
                    onClick={() => onChange({ market: m.value })}
                    className={cx(
                      'rounded-lg border px-2 py-1.5 text-center transition',
                      focusRing,
                      active ? m.active : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="block text-[11px] tabular-nums opacity-80">{m.factor}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <MoneyField
            label={`${freightName}（Freight Override で上書き可）`}
            value={quote.freight}
            autoUsd={result.freight.autoUsd}
            autoJpy={result.freight.autoJpy}
            usdRate={result.usdRate}
            onChange={(freight) => onChange({ freight })}
            autoLabel="テーブル運賃"
          >
            <Hint>
              {quote.freight
                ? `フォワーダーの実見積などを手動で入力中（市況係数は掛かりません）。テーブル運賃：${usd(result.freight.autoUsd)} ≒ ${yen(result.freight.autoJpy)}`
                : `テーブル運賃：${rateText(result.freight.basis, { value: result.marketFactor, label: market.label })} = ${usd(result.freight.autoUsd)} ≒ ${yen(result.freight.autoJpy)}（1 USD = ${result.usdRate.toFixed(2)} 円）`}
            </Hint>
          </MoneyField>
          <RangeField
            label="運賃変動バッファ（Freight Contingency）"
            value={quote.freightBuffer}
            min={0}
            max={MAX_FREIGHT_BUFFER}
            step={1}
            onChange={(freightBuffer) => onChange({ freightBuffer })}
            display={`+${quote.freightBuffer.toFixed(0)}%`}
          >
            <Hint>
              実勢・上書き運賃 {yen(r.freightBase)} ＋ バッファ {yen(r.freightContingency)} ＝ {yen(r.freight)}
            </Hint>
          </RangeField>
          <div>
            <FieldLabel htmlFor={ids.insurance}>{quote.mode === 'air' ? '貨物保険料率' : '海上保険料率'}（Insurance Rate）</FieldLabel>
            <NumberField
              id={ids.insurance}
              value={quote.insuranceRate}
              onChange={(insuranceRate) => onChange({ insuranceRate })}
              min={0}
              max={MAX_INSURANCE_RATE}
              step={0.01}
              ariaLabel="保険料率（%）"
              suffix="%"
            />
            <Hint>
              CIF 価格の 110%（{yen(r.insuredValue)}）に付保 → 保険料 {yen(r.insurance)}
            </Hint>
          </div>
        </div>

        {/* 4. Destination charges, duty, validity */}
        <div className="space-y-3 p-4">
          <SectionHeader n={4} title="現地輸入諸掛・関税" note="DAP / DDP 加算分" />
          <MoneyField
            label="現地港湾・輸入通関・現地配送費（DAP費用）"
            value={quote.local}
            autoUsd={result.local.autoUsd}
            autoJpy={result.local.autoJpy}
            usdRate={result.usdRate}
            onChange={(local) => onChange({ local })}
            autoLabel="プリセット"
          >
            <Hint>
              プリセット（{FREIGHT_REGION_LABELS[lane.region]}）：{rateText(result.local.basis)} = {usd(result.local.autoUsd)} ≒ {yen(result.local.autoJpy)}
            </Hint>
          </MoneyField>
          <div>
            <FieldLabel htmlFor={ids.duty}>現地実行関税率（Import Duty）</FieldLabel>
            <div className="flex items-center gap-1.5">
              <NumberField
                id={ids.duty}
                className="w-28 shrink-0"
                value={quote.dutyRate}
                onChange={(dutyRate) => onChange({ dutyRate })}
                min={0}
                max={MAX_DUTY_RATE}
                step={0.1}
                ariaLabel="輸入関税率（%）"
                suffix="%"
              />
              <div className="flex flex-wrap gap-1">
                {DUTY_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onChange({ dutyRate: p })}
                    aria-pressed={quote.dutyRate === p}
                    className={cx(
                      'rounded-md px-2 py-1 text-[11px] font-medium tabular-nums transition',
                      focusRing,
                      quote.dutyRate === p ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    )}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>
            <Hint>
              CIF 価格 {yen(r.cif)} × {percent(quote.dutyRate)} ＝ 関税 {yen(r.duty)}（輸入 VAT / GST は含みません）
            </Hint>
          </div>
          <div>
            <FieldLabel
              htmlFor={ids.validity}
              extra={
                quote.validUntil ? (
                  <button
                    type="button"
                    onClick={() => onChange({ validUntil: null })}
                    className={cx('inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-50', focusRing)}
                  >
                    <RotateCcw size={11} />
                    14日後に戻す
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400">初期値：今日から14日後</span>
                )
              }
            >
              見積有効期限（Validity Date）
            </FieldLabel>
            <div className="relative">
              <CalendarClock size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input
                id={ids.validity}
                type="date"
                className={cx(inputClass, 'pl-9 tabular-nums')}
                value={result.validUntil}
                onChange={(e) => onChange({ validUntil: (e.target.value || null) as ISODate | null })}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
              {formatJaDate(result.validUntil)} まで（{result.validityDays >= 0 ? `残り ${result.validityDays} 日` : `${-result.validityDays} 日前に期限切れ`}）
            </p>
            {result.validityDays < 0 && (
              <Hint tone="error">
                <AlertTriangle size={12} className="mr-1 inline align-[-2px]" />
                有効期限が過ぎています。日付を更新してください。
              </Hint>
            )}
            <div
              className={cx(
                'mt-2 flex gap-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed',
                peakish ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' : 'bg-slate-50 text-slate-600',
              )}
            >
              {peakish ? <AlertTriangle size={14} className="mt-px shrink-0" /> : <Info size={14} className="mt-px shrink-0" />}
              <span>
                {peakish
                  ? `【${market.label}】運賃が週単位で改定（GRI・PSS・緊急サーチャージ）される可能性があります。有効期限は 7〜14 日以内とし、運賃変動時は CIF・DDP を改定する旨（Freight Disclaimer）を必ず添えてください。`
                  : '海上・航空運賃は船社・航空会社の運賃改定（GRI・燃油サーチャージ等）で変動します。英文見積には運賃変動の免責条項（Freight Disclaimer）が自動で入ります。'}
                {peakish && result.validityDays > 14 && ` 現在の有効期限（${result.validityDays}日後）は長めです。`}
                {!peakish && result.validityDays > 30 && ` 有効期限が 30 日を超えています。運賃変動のリスクにご注意ください。`}
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="border-t border-slate-100 px-4 py-2.5 text-[10px] leading-relaxed text-slate-400">
        運賃・諸掛の初期値は日本の主要港・空港発の目安（通常期の概算）です。実際の金額はフォワーダー・通関業者の見積で確認し、各欄を上書きしてください。提示価格はすべて {unitJa} 建てで表示します。
      </p>
    </section>
  )
}
