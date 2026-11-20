import { AlertTriangle, Boxes, CalendarClock, Container, Info, Plane, RotateCcw, Sparkles } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { getCountryCatalog, getCountryInfo } from '../data/countries'
import { CURRENCY_INFO, QUOTE_CURRENCIES, type QuoteCurrency } from '../data/currencies'
import {
  DUTY_PRESETS,
  MAX_DUTY_RATE,
  MAX_FREIGHT_BUFFER,
  MAX_FX_BUFFER,
  MAX_FX_RATE,
  MAX_INSURANCE_RATE,
  MAX_PACKING_RATE,
  MAX_QUOTE_PRICE,
} from '../state/defaults'
import type { QuoteSettings } from '../types'
import type { ResolvedCountry } from '../utils/calendars'
import type { ISODate } from '../utils/dateCalc'
import { formatJaDate } from '../utils/dateFormat'
import {
  DEDICATED_LANE_COUNTRIES,
  DOMESTIC_TRUCK_RATES,
  EXPORT_CHARGE_RATES,
  FREIGHT_ORIGIN,
  FREIGHT_REGION_LABELS,
  LCL_ORIGIN_PER_RT,
  SURCHARGE_SHARE,
  type FreightLane,
  type FreightMarket,
} from '../utils/freightRates'
import { TRUCK_CAPACITY } from '../utils/incotermsCalc'
import type { CargoLink, QuoteResult, UnitChoice } from '../utils/quotation'
import { cx, focusRing, inputClass } from './classes'
import { CountryFlag } from './CountryFlag'
import { NumberField } from './NumberField'
import { QuoteCargoBlock } from './QuoteCargoBlock'
import { FieldLabel, Hint, LoadWarning, MoneyField, RangeField, SectionHeader, UnitsPicker, YenField } from './quoteFormParts'
import {
  MARKET_LABELS,
  kgText,
  percent,
  portLinesText,
  qty,
  rateText,
  recommendationLabel,
  recommendationReason,
  transportLabel,
  yen,
  yenRange,
} from './quoteStyles'
import { Segmented } from './ui'

interface QuoteSettingsFormProps {
  quote: QuoteSettings
  result: QuoteResult
  /** Cargo of the loading simulator (tab ⑤) for the "引用" input mode. */
  link: CargoLink
  /** Selected countries (left pane) — offered first as destinations. */
  countries: readonly ResolvedCountry[]
  /** Destination used when `quote.destination` is '' (the schedule's partner country). */
  autoDestination: string
  /** Port used when `quote.port` is '' (US: the coast of the partner's time zone). */
  autoPort: string
  onChange: (patch: Partial<QuoteSettings>) => void
  onShowVanning: () => void
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

/** Label of the automatic choice of a container / truck. */
function autoUnitsLabel(choice: UnitChoice): string {
  return choice.source === 'estimated' ? '概算M3から自動' : choice.source === 'default' ? '既定' : '積載3Dの計画'
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

/** Port choice of destinations with several representative ports (US West / East Coast). */
function PortChoice({ lane, value, autoPort, onChange }: { lane: FreightLane; value: string; autoPort: string; onChange: (port: string) => void }) {
  const autoLabel = lane.ports.find((p) => p.id === autoPort)?.label ?? ''
  const options = [
    { id: '', label: `自動（${autoLabel}）`, note: '相手先の時間帯から' },
    ...lane.ports.map((p) => ({ id: p.id, label: p.label, note: p.port })),
  ]
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">仕向港（Port of Discharge）</span>
      <div role="radiogroup" aria-label="仕向港" className="grid grid-cols-3 gap-1.5">
        {options.map((option) => {
          const active = option.id === value
          return (
            <button
              key={option.id || 'auto'}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.id)}
              className={cx(
                'min-w-0 rounded-lg border px-1.5 py-1.5 text-center transition',
                focusRing,
                active ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-500' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              <span className="block text-[12px] leading-tight font-semibold">{option.label}</span>
              <span className="mt-0.5 block text-[10px] leading-tight text-slate-500">{option.note}</span>
            </button>
          )
        })}
      </div>
      <Hint>米国は東海岸（New York / Savannah）向けが西海岸より高くなります。自動では相手先の時間帯が太平洋・山岳部時間なら西海岸、それ以外は東海岸を使います。</Hint>
    </div>
  )
}

/** Table rates of the destination (normal market, JPY) next to the planning band of the trade. */
function LaneRateTable({ result }: { result: QuoteResult }) {
  const lane = result.lane
  const rows: ReadonlyArray<{ key: string; label: string; table: ReactNode; band: string; active: boolean }> = [
    {
      key: '20',
      label: '20ft',
      table: yen(lane.fcl20),
      band: yenRange(lane.band.fcl20),
      active: result.mode === 'fcl' && result.container.spec.id === '20dc',
    },
    {
      key: '40',
      label: '40ft / HQ',
      table: `${yen(lane.fcl40)} / ${yen(lane.fcl40hc)}`,
      band: yenRange(lane.band.fcl40),
      active: result.mode === 'fcl' && result.container.spec.id !== '20dc',
    },
    {
      key: 'lcl',
      label: 'LCL /R/T',
      table: (
        <>
          {yen(lane.lcl + LCL_ORIGIN_PER_RT)}
          <span className="block text-[10px] font-normal text-slate-500">
            運賃 {yen(lane.lcl)} ＋ CFS・THC {yen(LCL_ORIGIN_PER_RT)}
          </span>
        </>
      ),
      band: yenRange(lane.band.lcl),
      active: result.mode === 'lcl',
    },
    { key: 'air', label: 'Air /kg', table: yen(lane.air), band: yenRange(lane.band.air), active: result.mode === 'air' },
  ]
  return (
    <table className="mt-1.5 w-full text-left text-[11px] tabular-nums" aria-label="仕向地の運賃テーブルと目安レンジ">
      <thead>
        <tr className="text-[10px] text-slate-500">
          <th scope="col" className="py-0.5 pr-2 font-medium">
            通常期
          </th>
          <th scope="col" className="py-0.5 pr-2 font-medium">
            テーブル運賃（サーチャージ込）
          </th>
          <th scope="col" className="py-0.5 font-medium">
            目安レンジ
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={cx('border-t border-slate-100 align-top', row.active && 'bg-indigo-50/70 font-semibold text-indigo-950')}>
            <th scope="row" className="py-1 pr-2 font-medium whitespace-nowrap">
              {row.label}
            </th>
            <td className="py-1 pr-2">{row.table}</td>
            <td className="py-1 text-slate-600">{row.band}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** "Entered by hand" note with a reset button (insurance premium, duty). */
function ManualNote({ children, onReset }: { children: ReactNode; onReset: () => void }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900 ring-1 ring-amber-200">
      <span className="min-w-0 flex-1">{children}</span>
      <button
        type="button"
        onClick={onReset}
        className={cx('inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium whitespace-nowrap text-indigo-700 hover:bg-indigo-50', focusRing)}
      >
        <RotateCcw size={11} />
        自動に戻す
      </button>
    </p>
  )
}

/**
 * Left column: ① estimated volume & weight, ② base price, currency and export packing,
 * ③ domestic truck, export customs and port charges, ④ international freight and insurance,
 * ⑤ destination charges, duty, validity.
 */
export function QuoteSettingsForm({ quote, result, link, countries, autoDestination, autoPort, onChange, onShowVanning }: QuoteSettingsFormProps) {
  const ids = {
    exw: useId(),
    currency: useId(),
    rate: useId(),
    usd: useId(),
    packing: useId(),
    packingRate: useId(),
    destination: useId(),
    insurance: useId(),
    duty: useId(),
    validity: useId(),
  }
  const isJpy = quote.currency === 'JPY'
  const unitJa = isJpy ? '円' : quote.currency
  const lane = result.lane
  const freightName = result.mode === 'air' ? '航空運賃' : '海上運賃'
  const market = MARKETS.find((m) => m.value === quote.market) ?? MARKETS[0]
  const peakish = quote.market !== 'normal'
  const r = result.incoterms
  const surchargePercent = Math.round(SURCHARGE_SHARE * 100)

  return (
    <section aria-label="概算M3・基準価格・物流条件の設定パネル" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">1. 概算M3・基準価格・物流条件の設定</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          梱包後の概算M3と重量から、梱包費・トラック運賃・通関料・港湾諸掛・国際運賃・サーチャージを自動で見積もります（金額はすべて手動で調整可能）。
        </p>
      </header>

      <div className="divide-y divide-slate-100">
        {/* 1. Estimated volume and weight */}
        <QuoteCargoBlock quote={quote} result={result} link={link} onChange={onChange} onShowVanning={onShowVanning} />

        {/* 2. Base price, currency, FX and export packing */}
        <div className="space-y-3 p-4">
          <SectionHeader n={2} title="基準価格と通貨・為替設定" note="EXW" />
          <div>
            <FieldLabel htmlFor={ids.exw}>
              {quote.packingCost ? 'EXW 基準価格（製品ベース・輸出梱包費別）' : 'EXW 基準価格（製品ベース・梱包込）'}
            </FieldLabel>
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
            <Hint>工場出荷時点の販売価格。製品原価・利益は入力しません。</Hint>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <label htmlFor={ids.packing} className="flex cursor-pointer items-start gap-2">
              <input
                id={ids.packing}
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-indigo-600"
                checked={quote.packingCost}
                onChange={(e) => onChange({ packingCost: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">
                  輸出木箱・パレット梱包費を <span className="inline-block">M3 単価で自動算入する</span>
                </span>
                <span className="block text-[11px] text-slate-500">EXW に「梱包後概算M3 × 梱包単価」を加算します。</span>
              </span>
            </label>
            {quote.packingCost && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-2">
                  <NumberField
                    id={ids.packingRate}
                    value={quote.packingRate}
                    onChange={(packingRate) => onChange({ packingRate })}
                    min={0}
                    max={MAX_PACKING_RATE}
                    step={500}
                    ariaLabel="梱包単価（円 / m³）"
                    suffix="円/m³"
                  />
                  <span className="text-xs text-slate-600 tabular-nums">
                    × {qty(result.volume)} m³ ＝ <span className="font-bold text-slate-900">{yen(result.packing.auto)}</span>
                  </span>
                </div>
                <YenField
                  label="輸出梱包費（梱包業者の見積で上書き可）"
                  value={quote.packingAmount}
                  auto={result.packing.auto}
                  onChange={(packingAmount) => onChange({ packingAmount })}
                  autoLabel="M3 × 単価"
                >
                  <Hint>
                    EXW 価格 ＝ 製品ベース {yen(r.base)} ＋ 輸出梱包費 {yen(r.packing)} ＝ {yen(r.exw)}
                  </Hint>
                </YenField>
              </div>
            )}
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
              <FieldLabel htmlFor={ids.usd}>USD 換算レート（USD で入力した運賃・諸掛の円換算用）</FieldLabel>
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

        {/* 3. Domestic truck, export customs and port charges */}
        <div className="space-y-3 p-4">
          <SectionHeader n={3} title="国内・港湾諸掛" note="FOB 加算分" />
          <div>
            <UnitsPicker
              label="国内トラック（工場〜輸出港）"
              category="truck"
              value={quote.truck}
              auto={result.truck}
              autoLabel={autoUnitsLabel(result.truck)}
              onChange={(truck) => onChange({ truck })}
            />
            <LoadWarning check={result.loads.truck} choice={result.truck} volume={result.volume} weight={result.weight} />
            <Hint>
              目安：{TRUCK_CAPACITY.map((t) => `${t.id} 〜${t.volume} m³・${kgText(t.weight / 1000)} t`).join(' ／ ')}（梱包後の重量で判定）。超える場合は 10t 車を複数台。
              {result.truck.unavailable && ' 標準トラックに収まらない貨物があります（特殊車両の運賃を入力してください）。'}
            </Hint>
          </div>
          <YenField label="国内トラック運賃" value={quote.domestic} auto={result.domestic.auto} onChange={(domestic) => onChange({ domestic })}>
            <Hint>
              目安：{result.truck.spec.label} {yen(DOMESTIC_TRUCK_RATES[result.truck.spec.id] ?? 0)} × {result.truck.units}台 ＝ {yen(result.domestic.auto)}
            </Hint>
          </YenField>
          <YenField label="輸出通関料" value={quote.customs} auto={result.customs.auto} onChange={(customs) => onChange({ customs })}>
            <Hint>輸出申告 1 件 {yen(EXPORT_CHARGE_RATES.customs)}（通関業者の基本料金の目安。品目数が多い・他法令の確認がある場合は加算）</Hint>
          </YenField>
          <YenField
            label="輸出港湾諸掛（THC・CFS・B/L・バンニング等）"
            value={quote.portCharges}
            auto={result.portCharges.auto}
            onChange={(portCharges) => onChange({ portCharges })}
          >
            <Hint>
              目安（{result.mode === 'lcl' ? 'LCL：R/T 連動' : result.mode === 'fcl' ? 'FCL：コンテナ本数連動' : 'Air：課金重量連動'}）：
              {portLinesText(result.portCharges.lines, result.mode)} ＝ {yen(result.portCharges.auto)}
            </Hint>
          </YenField>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-slate-600">国内・港湾諸掛 合計（FOB − EXW）</span>
              <span className="font-bold text-slate-900 tabular-nums">{yen(r.fobCharges)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              トラック {yen(r.domestic)} ＋ 通関 {yen(r.customs)} ＋ 港湾 {yen(r.portCharges)}
            </p>
          </div>
        </div>

        {/* 4. International freight and insurance */}
        <div className="space-y-3 p-4">
          <SectionHeader n={4} title="国際運賃・サーチャージ・保険" note="CFR・CIF 加算分" />
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">輸送モード</span>
            <Segmented
              ariaLabel="輸送モード"
              className="w-full"
              value={quote.mode}
              onChange={(mode) => onChange({ mode })}
              options={[
                { value: 'auto', label: '自動', icon: <Sparkles size={15} />, title: '概算M3から LCL / FCL を自動で選ぶ' },
                { value: 'fcl', label: 'FCL', icon: <Container size={15} />, title: 'コンテナ（FCL）' },
                { value: 'lcl', label: 'LCL', icon: <Boxes size={15} />, title: '混載便（LCL）' },
                { value: 'air', label: 'Air', icon: <Plane size={15} />, title: '航空便' },
              ]}
            />
            <Hint>
              {quote.mode === 'auto' ? '自動：' : '手動選択（推奨：'}
              {quote.mode === 'auto'
                ? `${recommendationReason(result)} → ${transportLabel(result)}`
                : `${recommendationLabel(result)}）→ ${transportLabel(result)}`}
            </Hint>
          </div>
          {result.fclSuggestion && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              <span className="min-w-0 flex-1">
                {result.fclSuggestion.container.spec.label} × {result.fclSuggestion.container.units} の FCL の方が割安です（運賃＋港湾・現地諸掛{' '}
                {yen(result.fclSuggestion.fclTotal)} ＜ LCL {yen(result.fclSuggestion.lclTotal)}）。
              </span>
              <button
                type="button"
                className={cx('rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100', focusRing)}
                onClick={() => onChange({ mode: 'fcl' })}
              >
                FCL に切り替え
              </button>
            </div>
          )}
          {result.mode === 'fcl' && (
            <div>
              <UnitsPicker
                label="FCL コンテナ"
                category="sea"
                value={quote.container}
                auto={result.container}
                autoLabel={autoUnitsLabel(result.recommended.container)}
                onChange={(container) => onChange({ container })}
              />
              <LoadWarning check={result.loads.container} choice={result.container} volume={result.volume} weight={result.weight} />
            </div>
          )}
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
                ? `専用の運賃データがないため、${FREIGHT_REGION_LABELS[lane.region]}の目安運賃（主要港より高め）を使用しています。`
                : `代表港：${lane.port}（${FREIGHT_REGION_LABELS[lane.region]}）。`}
              運賃はサーチャージ込、THC・CFS・B/L 等の港湾諸掛は ③ に別途加算します。
            </Hint>
            <LaneRateTable result={result} />
          </div>
          {lane.ports.length > 0 && <PortChoice lane={lane} value={quote.port} autoPort={autoPort} onChange={(port) => onChange({ port })} />}
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
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <p className="text-[11px] leading-relaxed text-slate-600 tabular-nums">
              テーブル運賃：{rateText(result.freight.table, { value: result.marketFactor, label: MARKET_LABELS[quote.market] })} ＝{' '}
              <span className="font-semibold text-slate-900">{yen(result.freight.tableJpy)}</span>（うち基本運賃 {100 - surchargePercent}%・サーチャージ{' '}
              {surchargePercent}% として内訳を表示）
            </p>
            <MoneyField
              label={`基本運賃（${result.mode === 'air' ? 'A/F' : 'O/F'}）`}
              value={quote.freight}
              auto={result.freight.base.auto}
              usdRate={result.usdRate}
              onChange={(freight) => onChange({ freight })}
              autoLabel="テーブル運賃"
            />
            <MoneyField
              label={result.mode === 'air' ? 'サーチャージ（燃油 FSC・保安 SSC 等）' : 'サーチャージ（BAF / LSS / EBS 等）'}
              value={quote.surcharge}
              auto={result.freight.surcharge.auto}
              usdRate={result.usdRate}
              onChange={(surcharge) => onChange({ surcharge })}
              autoLabel="テーブル運賃"
            >
              <Hint>
                {quote.freight || quote.surcharge
                  ? 'フォワーダーの見積を手動で入力中です（手動の金額には市況係数を掛けません）。'
                  : `フォワーダーの見積（${freightName}・サーチャージ）があれば、それぞれ上書きしてください。`}
              </Hint>
            </MoneyField>
          </div>
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
              （基本運賃 {yen(r.baseFreight)} ＋ サーチャージ {yen(r.surcharge)}）× {percent(result.freightBuffer)} ＝ バッファ {yen(r.freightContingency)} → 国際運賃・サーチャージ計{' '}
              {yen(r.freight)}
            </Hint>
          </RangeField>
          <div>
            <FieldLabel htmlFor={ids.insurance}>{result.mode === 'air' ? '貨物保険料率' : '海上保険料率'}（Insurance Rate）</FieldLabel>
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
            {result.insurance.manual ? (
              <ManualNote onReset={() => onChange({ insurance: null })}>
                保険料は積算内訳で手動入力中：{yen(r.insurance)}（料率から計算すると {yen(result.insurance.auto)}）
              </ManualNote>
            ) : (
              <Hint>
                CIF 価格の 110%（{yen(r.insuredValue)}）× {percent(quote.insuranceRate)} ＝ 保険料 {yen(r.insurance)}
              </Hint>
            )}
          </div>
        </div>

        {/* 5. Destination charges, duty, validity */}
        <div className="space-y-3 p-4">
          <SectionHeader n={5} title="現地諸掛・関税" note="DAP / DDP 加算分" />
          <MoneyField
            label="現地港湾・輸入通関・現地配送費（DAP費用）"
            value={quote.local}
            auto={result.local.auto}
            usdRate={result.usdRate}
            onChange={(local) => onChange({ local })}
            autoLabel="プリセット"
          >
            <Hint>
              プリセット（{FREIGHT_REGION_LABELS[lane.region]}）：{rateText(result.local.basis)} ＝ {yen(result.local.auto)}
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
            {result.duty.manual ? (
              <ManualNote onReset={() => onChange({ duty: null })}>
                関税は積算内訳で手動入力中：{yen(r.duty)}（税率から計算すると {yen(result.duty.auto)}）
              </ManualNote>
            ) : (
              <Hint>
                CIF 価格 {yen(r.cif)} × {percent(quote.dutyRate)} ＝ 関税 {yen(r.duty)}（輸入 VAT / GST は含みません）
              </Hint>
            )}
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
        運賃・諸掛・梱包単価の初期値は日本の主要港・空港発の目安（通常期・円建て）です。実際の金額はフォワーダー・通関業者・梱包業者の見積で確認し、各欄を上書きしてください。
        提示価格はすべて {unitJa} 建てで表示します。
      </p>
    </section>
  )
}
