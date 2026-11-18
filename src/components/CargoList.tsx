import { CopyPlus, PackagePlus, RotateCw, Trash2 } from 'lucide-react'
import type { Dispatch } from 'react'
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

const formatNumber = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function Toggle({
  checked,
  onChange,
  label,
  offLabel,
  title,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  offLabel?: string
  title: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={cx('inline-flex items-center gap-1.5 rounded-md py-0.5 text-xs font-medium', focusRing)}
    >
      <span className={cx('relative h-[18px] w-8 shrink-0 rounded-full transition', checked ? 'bg-emerald-500' : 'bg-slate-300')}>
        <span
          className={cx(
            'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all',
            checked ? 'left-[16px]' : 'left-[2px]',
          )}
        />
      </span>
      <span className={checked ? 'text-slate-700' : 'text-rose-600'}>{checked || !offLabel ? label : offLabel}</span>
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
    <li className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" style={{ borderLeft: `4px solid ${item.color}` }}>
      <div className="flex items-center gap-2">
        <label className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-slate-900/15" title="識別カラーを変更">
          <span className="absolute inset-0" style={{ backgroundColor: item.color }} />
          <input
            type="color"
            value={item.color}
            aria-label={`${name} の識別カラー`}
            onChange={(e) => update({ color: e.target.value })}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          className={cx(inputClass, 'min-w-0 flex-1 px-2.5 py-1.5 font-medium')}
          value={item.name}
          maxLength={60}
          placeholder="例: Case #1 本体木箱"
          aria-label={`${name} の貨物名`}
          onChange={(e) => update({ name: e.target.value })}
        />
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

      {/* Sizes on one line, weight and quantity on the next (5-digit values stay readable). */}
      <div className="mt-2 grid grid-cols-6 gap-1.5">
        <div className="col-span-2">
          <NumberField label="長さ L（mm）" ariaLabel={`${name} の長さ（mm）`} value={item.length} min={1} max={MAX_CARGO_DIMENSION} onChange={(length) => update({ length })} />
        </div>
        <div className="col-span-2">
          <NumberField label="幅 W（mm）" ariaLabel={`${name} の幅（mm）`} value={item.width} min={1} max={MAX_CARGO_DIMENSION} onChange={(width) => update({ width })} />
        </div>
        <div className="col-span-2">
          <NumberField label="高さ H（mm）" ariaLabel={`${name} の高さ（mm）`} value={item.height} min={1} max={MAX_CARGO_DIMENSION} onChange={(height) => update({ height })} />
        </div>
        <div className="col-span-2">
          <NumberField label="重量（kg / 個）" ariaLabel={`${name} の 1 個あたり重量（kg）`} value={item.weight} min={0} max={MAX_CARGO_WEIGHT} step={0.1} onChange={(weight) => update({ weight })} />
        </div>
        <div className="col-span-2">
          <NumberField label="個数" ariaLabel={`${name} の個数`} value={item.quantity} min={1} max={MAX_CARGO_QUANTITY} onChange={(quantity) => update({ quantity })} />
        </div>
        <div className="col-span-2" title="この貨物だけ周囲（前後左右）に追加する緩衝材の厚み。貨物間・壁面の設定に上乗せされます。">
          <NumberField
            label="個別緩衝材（+mm）"
            ariaLabel={`${name} の個別緩衝材（mm）`}
            value={item.margin}
            min={0}
            max={MAX_CUSHION}
            onChange={(margin) => update({ margin })}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {PALLET_PRESETS.map((preset) => {
          const active = item.length === preset.length && item.width === preset.width
          return (
            <button
              key={preset.id}
              type="button"
              title={`${preset.title} を入力（高さはそのまま）`}
              onClick={() => update({ length: preset.length, width: preset.width })}
              className={cx(
                'rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 transition ring-inset',
                focusRing,
                active ? 'bg-indigo-50 text-indigo-700 ring-indigo-300' : 'text-slate-600 ring-slate-200 hover:bg-slate-50',
              )}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Toggle
          checked={item.stackable}
          onChange={(stackable) => update({ stackable })}
          label="段積み可"
          offLabel="上積み厳禁"
          title="OFF にすると、この貨物の上には何も積みません（精密機械・天面載せ不可の木箱など）"
        />
        <Toggle
          checked={item.rotatable}
          onChange={(rotatable) => update({ rotatable })}
          label="90°回転可"
          offLabel="向き固定"
          title="ON: 床の上で 90° 回して（長さと幅を入れ替えて）隙間なく詰めます。横倒しはしません。"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600 tabular-nums">
        <span>
          {formatNumber(unitVolume, 2)} m³ × {item.quantity} = <b className="text-slate-800">{formatNumber(unitVolume * item.quantity, 2)} m³</b>
          {cushioned && <span className="text-amber-700">（緩衝材込み {formatNumber(unitGross * item.quantity, 2)} m³）</span>}
          {' ・ '}
          <b className="text-slate-800">{formatNumber(item.weight * item.quantity, item.weight % 1 ? 1 : 0)} kg</b>
        </span>
        {status && (
          <span
            className={cx('font-semibold', missing > 0 ? 'text-rose-600' : 'text-emerald-700')}
            title={unplaced.map(([reason, n]) => `${REASON_LABELS[reason]}: ${n} 個`).join(' / ')}
          >
            {missing > 0 ? `未積載 ${missing} 個（${unplaced.map(([r]) => REASON_LABELS[r]).join('・')}）` : `積載 ${status.loaded}/${status.total}`}
          </span>
        )}
      </div>
    </li>
  )
}

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
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn.primary} disabled={full} onClick={() => dispatch({ type: 'addCargo' })}>
          <PackagePlus size={16} />
          貨物を追加
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
        <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
          {cargo.length} 種類・計 {pieces.toLocaleString('en-US')} 個
        </span>
      </div>
      {cargo.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          貨物がありません。「貨物を追加」から木箱・パレット・カートンを入力してください。
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
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
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        寸法は外寸（mm）。貨物名は英文メールの Packing &amp; Container Summary にもそのまま入るため英語推奨です。
        {full && ' 貨物は最大 30 種類までです。'}
      </p>
    </div>
  )
}
