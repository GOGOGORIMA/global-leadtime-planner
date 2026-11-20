import { AlertTriangle, ArrowRight, Container, PencilLine, Plus, Ruler, Trash2, type LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'
import {
  MAX_CARGO_QUANTITY,
  MAX_CARGO_WEIGHT,
  MAX_PACKING_WEIGHT_KG,
  MAX_PACKING_WEIGHT_PERCENT,
  MAX_QUOTE_ROWS,
  MAX_QUOTE_VOLUME,
  MAX_QUOTE_WEIGHT,
} from '../state/defaults'
import type { QuoteCargoMode, QuoteSettings } from '../types'
import {
  CRATE_KG_PER_ADDED_M3,
  PACKING_WEIGHT_PERCENT,
  rowVolume,
  type PackingAllowance,
  type PackingWeightSetting,
  type SizeRow,
  type SizeUnit,
} from '../utils/incotermsCalc'
import type { CargoLink, QuoteResult } from '../utils/quotation'
import { btn, cx, focusRing } from './classes'
import { NumberField } from './NumberField'
import { AutoState, FieldLabel, Hint, MiniToggle, RangeField, SectionHeader } from './quoteFormParts'
import { kgText, percent, qty, recommendationLabel, recommendationReason } from './quoteStyles'

interface QuoteCargoBlockProps {
  quote: QuoteSettings
  result: QuoteResult
  /** Cargo of the loading simulator (tab ⑤). */
  link: CargoLink
  onChange: (patch: Partial<QuoteSettings>) => void
  onShowVanning: () => void
}

const MODES: ReadonlyArray<{ value: QuoteCargoMode; label: string; note: string; icon: LucideIcon }> = [
  { value: 'simple', label: '簡易サイズから計算', note: 'L × W × H × 個数', icon: Ruler },
  { value: 'direct', label: '直接入力', note: '概算M3・重量をそのまま', icon: PencilLine },
  { value: 'vanning', label: '積載3Dから引用', note: 'タブ⑤の結果を使う', icon: Container },
]

const ALLOWANCES: ReadonlyArray<{ value: PackingAllowance; label: string; note: string; weight: string }> = [
  { value: 'none', label: 'そのまま', note: '梱包済寸法 1.0x', weight: '重量 +0%' },
  { value: 'carton', label: '段ボール・パレット梱包', note: '容積 +15% / 1.15x', weight: '重量 +8%' },
  { value: 'crate', label: '輸出密閉木箱・スキッド梱包', note: '容積 +25% / 1.25x', weight: '重量 +15%〜' },
]

const UNITS = [
  { value: 'cm' as const, label: 'cm' },
  { value: 'mm' as const, label: 'mm' },
]

const WEIGHT_UNITS = [
  { value: 'pct' as const, label: '%' },
  { value: 'kg' as const, label: 'kg' },
]

const round1 = (n: number) => Math.round(n * 10) / 10
const kg = (n: number) => kgText(Math.round(n))

/** How the packing weight was found (hint under the field). */
function packingWeightHint(quote: QuoteSettings, result: QuoteResult): string {
  const c = result.cargo
  const label = ALLOWANCES.find((a) => a.value === quote.allowance)?.label ?? ''
  switch (c.packingRule) {
    case 'none':
      return `梱包済みの寸法として重量は加算しません（自動：段ボール・パレット +${PACKING_WEIGHT_PERCENT.carton}% ／ 木箱・スキッド +${PACKING_WEIGHT_PERCENT.crate}%）。`
    case 'percent':
      return `${label}：基準重量 ${kg(c.baseWeight)} kg × ${c.packingPercent}% ＝ ${kg(c.packingKg)} kg（${
        quote.allowance === 'crate' ? '木材・補強桟木・緩衝材' : 'パレット・バンド・ストレッチフィルム'
      }の重さ）`
    case 'volume': {
      const added = result.volume - c.netVolume
      return `${label}：増えた容積 ${qty(added)} m³ × ${CRATE_KG_PER_ADDED_M3} kg/m³ ＝ ${kg(c.packingKg)} kg（+${PACKING_WEIGHT_PERCENT.crate}% の ${kg(
        (c.baseWeight * PACKING_WEIGHT_PERCENT.crate) / 100,
      )} kg より重いため、こちらを採用）`
    }
    case 'manualPercent':
      return `手動：基準重量 ${kg(c.baseWeight)} kg × ${percent(c.packingPercent)} ＝ ${kg(c.packingKg)} kg`
    case 'manualKg':
      return `手動：${kg(c.packingKg)} kg（基準重量の ${percent(round1(c.packingPercent))}）`
  }
}

/** Packing materials: automatic by the allowance, or by hand as a % of the product weight / kg. */
function PackingWeightField({ quote, result, onChange }: { quote: QuoteSettings; result: QuoteResult; onChange: (patch: Partial<QuoteSettings>) => void }) {
  const id = useId()
  const manual = quote.packingWeight
  const [display, setDisplay] = useState<PackingWeightSetting['unit']>(manual?.unit ?? 'pct')
  const unit = manual?.unit ?? display
  const c = result.cargo
  const value = manual ? manual.value : unit === 'pct' ? round1(c.packingPercent) : round1(c.packingKg)
  const toggle = (next: PackingWeightSetting['unit']) => {
    setDisplay(next)
    if (!manual || manual.unit === next) return
    const converted = next === 'kg' ? round1((c.baseWeight * manual.value) / 100) : c.baseWeight > 0 ? round1((manual.value / c.baseWeight) * 100) : 0
    onChange({ packingWeight: { unit: next, value: converted } })
  }
  return (
    <div>
      <FieldLabel
        htmlFor={id}
        extra={<AutoState manual={manual !== null} onReset={() => onChange({ packingWeight: null })} autoLabel="係数から自動" />}
      >
        梱包材の重量（Packing Weight）
      </FieldLabel>
      <div className="flex items-center gap-1.5">
        <NumberField
          id={id}
          className="flex-1"
          value={value}
          onChange={(v) => onChange({ packingWeight: { unit, value: v } })}
          min={0}
          max={unit === 'pct' ? MAX_PACKING_WEIGHT_PERCENT : MAX_PACKING_WEIGHT_KG}
          step={unit === 'pct' ? 0.5 : 1}
          ariaLabel={unit === 'pct' ? '梱包材の重量（基準重量に対する %）' : '梱包材の重量（kg）'}
          suffix={unit === 'pct' ? '%' : 'kg'}
        />
        <MiniToggle value={unit} options={WEIGHT_UNITS} onChange={toggle} label="梱包材の重量の単位" />
      </div>
      <Hint>{packingWeightHint(quote, result)}</Hint>
    </div>
  )
}

function SizeRowEditor({
  row,
  index,
  unit,
  removable,
  onChange,
  onRemove,
}: {
  row: SizeRow
  index: number
  unit: SizeUnit
  removable: boolean
  onChange: (patch: Partial<SizeRow>) => void
  onRemove: () => void
}) {
  const maxSize = unit === 'cm' ? 2000 : 20000
  const size = (key: 'length' | 'width' | 'height', label: string) => (
    <NumberField
      compact
      value={row[key]}
      onChange={(value) => onChange({ [key]: value })}
      min={unit === 'cm' ? 0.1 : 1}
      max={maxSize}
      ariaLabel={`${index + 1}行目 ${label}（${unit}）`}
      suffix={unit}
    />
  )
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
        {size('length', '縦 L')}
        <span className="text-xs text-slate-400">×</span>
        {size('width', '横 W')}
        <span className="text-xs text-slate-400">×</span>
        {size('height', '高さ H')}
      </div>
      <div className="mt-1.5 grid grid-cols-[5.5rem_7rem_minmax(0,1fr)_auto] items-center gap-1.5">
        <NumberField
          compact
          value={row.quantity}
          onChange={(quantity) => onChange({ quantity })}
          min={1}
          max={MAX_CARGO_QUANTITY}
          ariaLabel={`${index + 1}行目 個数`}
          suffix="個"
        />
        <NumberField
          compact
          value={row.weight}
          onChange={(weight) => onChange({ weight })}
          min={0}
          max={MAX_CARGO_WEIGHT}
          step={0.1}
          ariaLabel={`${index + 1}行目 単体重量（kg）`}
          suffix="kg"
        />
        <span className="truncate text-right text-[11px] text-slate-500 tabular-nums" title="この行の容積・重量">
          {qty(rowVolume(row, unit))} m³・{kgText(row.weight * row.quantity)} kg
        </span>
        <button
          type="button"
          className={cx(btn.icon, 'p-1')}
          onClick={onRemove}
          disabled={!removable}
          title={removable ? 'この行を削除' : '1 行は必要です'}
          aria-label={`${index + 1}行目を削除`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] font-medium text-indigo-900/70">{label}</div>
      <div className={cx('truncate font-bold text-indigo-950 tabular-nums', strong ? 'text-lg leading-tight' : 'text-sm')}>{value}</div>
    </div>
  )
}

/** Section 1 of the quotation form: the estimated volume (概算M3) and weight every charge is based on. */
export function QuoteCargoBlock({ quote, result, link, onChange, onShowVanning }: QuoteCargoBlockProps) {
  const mode = quote.cargoMode
  const rows = quote.items
  const updateRow = (index: number, patch: Partial<SizeRow>) =>
    onChange({ items: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) })
  const addRow = () => {
    const last = rows[rows.length - 1]
    onChange({ items: [...rows, { ...last, quantity: 1 }] })
  }

  return (
    <div className="space-y-3 p-4">
      <SectionHeader n={1} title="概算M3（容積）・重量の算定" note="すべての費用の計算ベース" />

      <div role="radiogroup" aria-label="概算M3の入力方法" className="grid grid-cols-3 gap-1.5">
        {MODES.map(({ value, label, note, icon: Icon }) => {
          const active = value === mode
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ cargoMode: value })}
              className={cx(
                'flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-1.5 py-2 text-center transition',
                focusRing,
                active ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-500' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              <Icon size={16} className={active ? 'text-indigo-600' : 'text-slate-400'} />
              <span className="text-[12px] leading-tight font-semibold">{label}</span>
              <span className="text-[10px] leading-tight text-slate-500">{note}</span>
            </button>
          )
        })}
      </div>

      {mode === 'simple' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600">縦 L × 横 W × 高さ H ／ 個数 ／ 単体重量</span>
            <MiniToggle value={quote.sizeUnit} options={UNITS} onChange={(sizeUnit) => onChange({ sizeUnit })} label="寸法の単位" />
          </div>
          <ul className="space-y-1.5">
            {rows.map((row, index) => (
              <SizeRowEditor
                key={index}
                row={row}
                index={index}
                unit={quote.sizeUnit}
                removable={rows.length > 1}
                onChange={(patch) => updateRow(index, patch)}
                onRemove={() => onChange({ items: rows.filter((_, i) => i !== index) })}
              />
            ))}
          </ul>
          <button type="button" className={cx(btn.ghost, 'py-1 text-xs text-indigo-700')} onClick={addRow} disabled={rows.length >= MAX_QUOTE_ROWS}>
            <Plus size={14} />
            行を追加（最大 {MAX_QUOTE_ROWS} 行）
          </button>
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">梱包膨らみ係数（Packing Allowance）</span>
            <div role="radiogroup" aria-label="梱包膨らみ係数" className="grid grid-cols-3 gap-1.5">
              {ALLOWANCES.map(({ value, label, note }) => {
                const active = value === quote.allowance
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onChange({ allowance: value })}
                    className={cx(
                      'min-w-0 rounded-lg border px-1.5 py-1.5 text-center transition',
                      focusRing,
                      active ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-500' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <span className="block text-[11px] leading-tight font-semibold">{label}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500 tabular-nums">{note}</span>
                    <span className="block text-[10px] text-slate-500 tabular-nums">{ALLOWANCES.find((a) => a.value === value)?.weight}</span>
                  </button>
                )
              })}
            </div>
            <Hint>製品の裸寸・正味重量しか分からないときは、梱包方法を選ぶと梱包後の M3 と重量（梱包材の重さ）を見込めます。</Hint>
          </div>
          <PackingWeightField quote={quote} result={result} onChange={onChange} />
        </div>
      )}

      {mode === 'direct' && (
        <div className="space-y-3">
          <RangeField
            label="概算総容積（m³）"
            value={quote.volume}
            min={0}
            max={80}
            step={0.1}
            unit=" m³"
            display={`${qty(quote.volume)} m³`}
            onChange={(volume) => onChange({ volume })}
          >
            <NumberField
              className="mt-1"
              value={quote.volume}
              onChange={(volume) => onChange({ volume })}
              min={0}
              max={MAX_QUOTE_VOLUME}
              step={0.1}
              ariaLabel="概算総容積（m³）の数値"
              suffix="m³"
            />
          </RangeField>
          <RangeField
            label="概算総重量（kg）"
            value={quote.weight}
            min={0}
            max={30000}
            step={50}
            unit=" kg"
            display={`${kgText(quote.weight)} kg`}
            onChange={(weight) => onChange({ weight })}
          >
            <NumberField
              className="mt-1"
              value={quote.weight}
              onChange={(weight) => onChange({ weight })}
              min={0}
              max={MAX_QUOTE_WEIGHT}
              step={1}
              ariaLabel="概算総重量（kg）の数値"
              suffix="kg"
            />
          </RangeField>
        </div>
      )}

      {mode === 'vanning' && (
        <div className="space-y-2">
          {link.pieces > 0 ? (
            <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">
              <p>
                「積載3D」タブの貨物 <span className="font-semibold text-slate-900">{link.pieces.toLocaleString('en-US')} 個</span>（{link.types} 種類）の
                実寸を合計しています（梱包済みの寸法として扱い、膨らみ係数は掛けません）。
              </p>
              <p className="mt-1 tabular-nums">
                選択中の規格：{link.selected.label}
                {link.sea && ` ／ 海上：${link.sea.spec.label} × ${link.sea.units}本`}
                {link.truck && ` ／ 国内：${link.truck.spec.label} × ${link.truck.units}台`}
              </p>
            </div>
          ) : (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              「積載3D」タブに貨物が登録されていません。貨物を追加するか、ほかの入力方法を選んでください。
            </p>
          )}
          <button type="button" className={cx(btn.ghost, '-ml-2.5 py-1 text-xs text-indigo-700')} onClick={onShowVanning}>
            積載3Dで貨物を確認・編集する <ArrowRight size={13} />
          </button>
        </div>
      )}

      <div className="rounded-lg bg-indigo-50/70 p-3 ring-1 ring-indigo-100">
        {mode === 'simple' ? (
          <div className="mb-1.5 space-y-0.5 text-[11px] text-indigo-900/80 tabular-nums">
            <p>
              寸法の合計 {qty(result.cargo.netVolume)} m³ × {result.cargo.factor.toFixed(2)}（{ALLOWANCES.find((a) => a.value === quote.allowance)?.label}）＝
              梱包後概算M3
            </p>
            <p>
              基準重量 {kg(result.cargo.baseWeight)} kg ＋ 梱包材 {kg(result.cargo.packingKg)} kg（+{percent(round1(result.cargo.packingPercent))}）＝
              梱包後概算重量
            </p>
          </div>
        ) : (
          <p className="mb-1.5 text-[11px] text-indigo-900/80">
            {mode === 'direct' ? '入力した容積・重量を梱包後の数値として扱います。' : '積載3Dの貨物の寸法・重量を梱包後の数値として扱います。'}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="梱包後概算M3" value={`${qty(result.volume)} m³`} strong />
          <Stat label="梱包後概算重量" value={`${kgText(Math.round(result.weight))} kg`} strong />
          <Stat label="課金 R/T（W/M）" value={`${qty(result.revenueTons)} RT`} strong />
        </div>
        <p className="mt-1 text-[10px] text-indigo-900/70 tabular-nums">
          R/T ＝ max（容積 {qty(result.volume)} m³, 重量 {qty(result.weight / 1000)} t）。トラック・コンテナの重量判定も梱包後の重量で行います。
        </p>
        <p className="mt-2 text-xs text-indigo-950">
          推奨：<span className="font-bold">{recommendationLabel(result)}</span>
          <span className="text-indigo-900/70">（{recommendationReason(result)}）</span>
        </p>
        {result.fclSuggestion && (
          <p className="mt-1 text-[11px] font-medium text-amber-800">
            ただし分岐点を超えたため、{result.fclSuggestion.container.spec.label} の FCL の方が割安です（右の「算定ベース」から切り替え可）。
          </p>
        )}
      </div>
    </div>
  )
}
