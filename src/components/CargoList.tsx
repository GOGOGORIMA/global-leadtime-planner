import { CopyPlus, PackagePlus, RotateCw, Trash2 } from 'lucide-react'
import type { Dispatch, ReactNode } from 'react'
import { PALLET_PRESETS } from '../data/containers'
import {
  MAX_CARGO_DIMENSION,
  MAX_CARGO_ITEMS,
  MAX_CARGO_QUANTITY,
  MAX_CARGO_WEIGHT,
  MAX_CUSHION,
  SAMPLE_CARGO,
} from '../state/defaults'
import type { PlannerAction } from '../state/plannerReducer'
import type { CargoItem } from '../types'
import { occupiedSize, type Clearance, type ItemLoadStatus, type UnplacedReason } from '../utils/binPacking'
import { btn, cx, focusRing, inputClass } from './classes'
import { NumberField } from './NumberField'

const REASON_LABELS: Record<UnplacedReason, string> = {
  space: 'スペース不足',
  weight: '重量超過',
  door: 'ドア開口高を超過',
  size: '荷室（有効寸法）に入らない寸法',
  limit: '計算上限（1,000 個）を超過',
}

/** Short labels for the pallet buttons in the table (full name + size in the tooltip). */
const PALLET_SHORT: Record<string, string> = { t11: 'T11', euro: 'ユーロ', t12: 'T12', us: '北米' }

const formatNumber = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/*
 * Layout: one line per cargo when the list is at least 960px wide (container query) — a grid with
 * a header row. Narrower, each row wraps: name + actions first, then the fields with small labels.
 * The grid template is spelled out in full in both places so Tailwind can see it.
 */
const ROW_LAYOUT =
  'flex flex-wrap items-end gap-x-2 gap-y-2 @min-[960px]:grid @min-[960px]:grid-cols-[2rem_minmax(6rem,1fr)_13rem_5.5rem_5rem_4rem_4rem_4rem_4.75rem_3.5rem] @min-[960px]:items-center @min-[960px]:gap-x-1.5'
const HEADER_LAYOUT =
  'hidden @min-[960px]:grid @min-[960px]:grid-cols-[2rem_minmax(6rem,1fr)_13rem_5.5rem_5rem_4rem_4rem_4rem_4.75rem_3.5rem] @min-[960px]:gap-x-1.5'
/** Small caption shown above a field only in the wrapped (narrow) layout. */
const MINI_LABEL = 'mb-0.5 block text-[10px] font-medium text-slate-500 @min-[960px]:hidden'

function Cell({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx('min-w-0 order-2 @min-[960px]:order-none', className)}>
      {label && <span className={MINI_LABEL}>{label}</span>}
      {children}
    </div>
  )
}

function Switch({
  checked,
  onChange,
  onText,
  offText,
  label,
  title,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  onText: string
  offText: string
  label: string
  title: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      onClick={() => onChange(!checked)}
      className={cx('inline-flex h-[34px] items-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap', focusRing)}
    >
      <span className={cx('relative h-[18px] w-8 shrink-0 rounded-full transition', checked ? 'bg-emerald-500' : 'bg-slate-300')}>
        <span
          className={cx(
            'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all',
            checked ? 'left-[16px]' : 'left-[2px]',
          )}
        />
      </span>
      <span className={checked ? 'text-slate-600' : 'font-semibold text-rose-600'}>{checked ? onText : offText}</span>
    </button>
  )
}

function CargoRow({
  item,
  index,
  status,
  clearance,
  dispatch,
  canDuplicate,
}: {
  item: CargoItem
  index: number
  status?: ItemLoadStatus
  clearance: Clearance
  dispatch: Dispatch<PlannerAction>
  canDuplicate: boolean
}) {
  const update = (patch: Partial<Omit<CargoItem, 'id'>>) => dispatch({ type: 'updateCargo', id: item.id, patch })
  const unitVolume = (item.length * item.width * item.height) / 1e9
  const occupied = occupiedSize(item, clearance)
  const unitGross = (occupied.length * occupied.width * occupied.height) / 1e9
  const cushioned = unitGross - unitVolume > 1e-9
  const unplaced = status
    ? (Object.entries(status.unplaced) as Array<[UnplacedReason, number]>).filter(([, n]) => n > 0)
    : []
  const missing = unplaced.reduce((sum, [, n]) => sum + n, 0)
  const name = `貨物 ${index + 1}`

  return (
    <li className="rounded-lg border border-l-4 border-slate-200 bg-white px-2.5 py-2" style={{ borderLeftColor: item.color }}>
      <div className={ROW_LAYOUT}>
        <div className="order-1 @min-[960px]:order-none">
          <label className="relative block h-8 w-8 cursor-pointer overflow-hidden rounded-md ring-1 ring-slate-900/15" title="識別カラーを変更">
            <span className="absolute inset-0" style={{ backgroundColor: item.color }} />
            <input
              type="color"
              value={item.color}
              aria-label={`${name} の識別カラー`}
              onChange={(e) => update({ color: e.target.value })}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
        <div className="order-1 min-w-[10rem] flex-1 @min-[960px]:order-none @min-[960px]:min-w-0">
          <input
            className={cx(inputClass, 'px-2.5 py-1.5 font-medium')}
            value={item.name}
            maxLength={60}
            placeholder="例: Case #1 本体木箱"
            aria-label={`${name} の貨物名`}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <Cell label="長さ L × 幅 W × 高さ H（mm）">
          <div className="flex items-center gap-1">
            <NumberField compact ariaLabel={`${name} の長さ（mm）`} value={item.length} min={1} max={MAX_CARGO_DIMENSION} onChange={(length) => update({ length })} className="w-[58px]" />
            <span className="text-xs text-slate-400">×</span>
            <NumberField compact ariaLabel={`${name} の幅（mm）`} value={item.width} min={1} max={MAX_CARGO_DIMENSION} onChange={(width) => update({ width })} className="w-[58px]" />
            <span className="text-xs text-slate-400">×</span>
            <NumberField compact ariaLabel={`${name} の高さ（mm）`} value={item.height} min={1} max={MAX_CARGO_DIMENSION} onChange={(height) => update({ height })} className="w-[58px]" />
          </div>
        </Cell>
        <Cell label="定型パレット">
          <div role="group" aria-label={`${name} の定型パレット寸法`} className="grid w-[88px] grid-cols-2 gap-0.5">
            {PALLET_PRESETS.map((preset) => {
              const active = item.length === preset.length && item.width === preset.width
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={`${preset.title} を入力（高さはそのまま）`}
                  aria-pressed={active}
                  onClick={() => update({ length: preset.length, width: preset.width })}
                  className={cx(
                    'rounded px-1 py-px text-[10px] leading-4 font-semibold whitespace-nowrap ring-1 transition ring-inset',
                    focusRing,
                    active ? 'bg-indigo-50 text-indigo-700 ring-indigo-300' : 'text-slate-600 ring-slate-200 hover:bg-slate-50',
                  )}
                >
                  {PALLET_SHORT[preset.id] ?? preset.label}
                </button>
              )
            })}
          </div>
        </Cell>
        <Cell label="重量（kg / 個）" className="w-20 @min-[960px]:w-auto">
          <NumberField compact ariaLabel={`${name} の 1 個あたり重量（kg）`} value={item.weight} min={0} max={MAX_CARGO_WEIGHT} step={0.1} suffix="kg" onChange={(weight) => update({ weight })} />
        </Cell>
        <Cell label="個数" className="w-16 @min-[960px]:w-auto">
          <NumberField compact ariaLabel={`${name} の個数`} value={item.quantity} min={1} max={MAX_CARGO_QUANTITY} onChange={(quantity) => update({ quantity })} />
        </Cell>
        <Cell label="段積み">
          <Switch
            checked={item.stackable}
            onChange={(stackable) => update({ stackable })}
            onText="可"
            offText="厳禁"
            label={`${name} の段積み（OFF = 上積み厳禁）`}
            title="OFF にすると、この貨物の上には何も積みません（精密機械・天面載せ不可の木箱など）"
          />
        </Cell>
        <Cell label="90°回転">
          <Switch
            checked={item.rotatable}
            onChange={(rotatable) => update({ rotatable })}
            onText="可"
            offText="固定"
            label={`${name} の 90°回転`}
            title="ON: 床の上で 90° 回して（長さと幅を入れ替えて）隙間なく詰めます。横倒しはしません。"
          />
        </Cell>
        <Cell label="個別緩衝材" className="w-20 @min-[960px]:w-auto">
          <span title="この貨物だけ周囲（前後左右）に追加する緩衝材の厚み。貨物間・壁面の設定に上乗せされます。">
            <NumberField compact ariaLabel={`${name} の個別緩衝材（mm）`} value={item.margin} min={0} max={MAX_CUSHION} suffix="mm" onChange={(margin) => update({ margin })} />
          </span>
        </Cell>
        <div className="order-1 flex items-center @min-[960px]:order-none @min-[960px]:justify-end">
          <button
            type="button"
            className={btn.icon}
            disabled={!canDuplicate}
            aria-label={`${name} を複製`}
            title="この貨物を複製"
            onClick={() => dispatch({ type: 'duplicateCargo', id: item.id })}
          >
            <CopyPlus size={15} />
          </button>
          <button
            type="button"
            className={cx(btn.icon, 'hover:bg-rose-50! hover:text-rose-600!')}
            aria-label={`${name} を削除`}
            title="この貨物を削除"
            onClick={() => dispatch({ type: 'removeCargo', id: item.id })}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
        <span>
          {formatNumber(unitVolume, 2)} m³ × {item.quantity} = <b className="font-semibold text-slate-700">{formatNumber(unitVolume * item.quantity, 2)} m³</b>
          {cushioned && <span className="text-amber-700">（緩衝材込み {formatNumber(unitGross * item.quantity, 2)} m³）</span>}
        </span>
        <span>
          計 <b className="font-semibold text-slate-700">{formatNumber(item.weight * item.quantity, item.weight % 1 ? 1 : 0)} kg</b>
        </span>
        {status && (
          <span
            className={cx('ml-auto font-semibold', missing > 0 ? 'text-rose-600' : 'text-emerald-700')}
            title={unplaced.map(([reason, n]) => `${REASON_LABELS[reason]}: ${n} 個`).join(' / ')}
          >
            {missing > 0
              ? `未積載 ${missing} 個（${unplaced.map(([r]) => REASON_LABELS[r]).join('・')}）`
              : `積載 ${status.loaded}/${status.total}`}
          </span>
        )}
      </div>
    </li>
  )
}

/** Cargo table (木箱・パレット・カートン) of the loading tab: one row per cargo type. */
export function CargoList({
  cargo,
  statuses,
  clearance,
  dispatch,
}: {
  cargo: readonly CargoItem[]
  statuses: readonly ItemLoadStatus[]
  /** Cushioning of the selected transport mode (for the volume incl. cushioning). */
  clearance: Clearance
  dispatch: Dispatch<PlannerAction>
}) {
  const full = cargo.length >= MAX_CARGO_ITEMS
  const pieces = cargo.reduce((sum, item) => sum + item.quantity, 0)
  return (
    <div className="@container">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-900">
          貨物リスト
          <span className="ml-2 text-xs font-normal text-slate-500">木箱・パレット・カートン（寸法は外寸 mm）</span>
        </h3>
        <span className="text-[11px] text-slate-500 tabular-nums">
          {cargo.length} 種類・計 {pieces.toLocaleString('en-US')} 個
        </span>
      </div>

      {cargo.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          貨物がありません。下の「＋ 貨物を追加」から木箱・パレット・カートンを入力してください。
        </div>
      ) : (
        <>
          <div className={cx(HEADER_LAYOUT, 'mb-1 border-b border-slate-200 px-[14px] pb-1 text-[11px] font-semibold text-slate-500')} aria-hidden>
            <span>色</span>
            <span>貨物名</span>
            <span>長さ L × 幅 W × 高さ H（mm）</span>
            <span>定型パレット</span>
            <span>単体重量</span>
            <span>個数</span>
            <span>段積み</span>
            <span>90°回転</span>
            <span>個別緩衝材</span>
            <span />
          </div>
          <ul className="space-y-1.5">
            {cargo.map((item, index) => (
              <CargoRow
                key={item.id}
                item={item}
                index={index}
                status={statuses[index]}
                clearance={clearance}
                dispatch={dispatch}
                canDuplicate={!full}
              />
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btn.primary} disabled={full} onClick={() => dispatch({ type: 'addCargo' })}>
          <PackagePlus size={16} />＋ 貨物を追加
        </button>
        <button
          type="button"
          className={btn.ghost}
          title="サンプル（本体木箱・パレット・カートン）に置き換える"
          onClick={() => dispatch({ type: 'setCargo', cargo: [...SAMPLE_CARGO] })}
        >
          <RotateCw size={14} />
          サンプル
        </button>
        <button
          type="button"
          className={cx(btn.ghost, 'hover:text-rose-600')}
          disabled={cargo.length === 0}
          onClick={() => dispatch({ type: 'setCargo', cargo: [] })}
        >
          <Trash2 size={14} />
          すべて削除
        </button>
        <p className="ml-auto text-[11px] leading-relaxed text-slate-400">
          貨物名は英文メールの Packing &amp; Container Summary にもそのまま入るため英語推奨です。
          {full && ' 貨物は最大 30 種類までです。'}
        </p>
      </div>
    </div>
  )
}
