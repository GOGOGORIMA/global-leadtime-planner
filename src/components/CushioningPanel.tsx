import { Layers, RotateCcw } from 'lucide-react'
import { useId, type Dispatch } from 'react'
import type { ContainerCategory, ContainerSpec } from '../data/containers'
import {
  DEFAULT_CUSHIONING,
  GAP_PRESETS,
  MAX_CUSHION,
  MAX_STACK_CUSHION,
  STACK_PRESETS,
  WALL_PRESETS,
} from '../state/defaults'
import type { PlannerAction } from '../state/plannerReducer'
import type { CushionSettings } from '../types'
import { btn, cx, focusRing } from './classes'
import { NumberField } from './NumberField'

const mm = (n: number) => Math.round(n).toLocaleString('en-US')

function PresetButtons({
  values,
  value,
  onSelect,
  disabled,
  label,
}: {
  values: readonly number[]
  value: number
  onSelect: (value: number) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div role="group" aria-label={`${label}のクイック選択`} className="flex flex-wrap gap-1">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          aria-pressed={value === v}
          onClick={() => onSelect(v)}
          className={cx(
            'rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums ring-1 transition ring-inset disabled:cursor-not-allowed disabled:opacity-40',
            focusRing,
            value === v ? 'bg-amber-500 text-white ring-amber-500' : 'bg-white text-slate-600 ring-slate-200 hover:bg-amber-50',
          )}
        >
          {v}mm
        </button>
      ))}
    </div>
  )
}

function CushionField({
  title,
  description,
  value,
  max,
  presets,
  onChange,
}: {
  title: string
  description: string
  value: number
  max: number
  presets: readonly number[]
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    // Column layout with the inputs pinned to the bottom, so both fields line up side by side.
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-800">
        {title}
      </label>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{description}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1.5">
        <NumberField id={id} ariaLabel={title} value={value} min={0} max={max} suffix="mm" onChange={onChange} className="w-28" />
        <PresetButtons values={presets} value={value} onSelect={onChange} label={title} />
      </div>
    </div>
  )
}

/**
 * 緩衝材・隙間設定（Cushioning / Clearance）for the selected transport mode. Containers and trucks
 * keep their own settings (trucks start with 50 mm between pieces and 30 mm to the walls).
 */
export function CushioningPanel({
  category,
  spec,
  settings,
  dispatch,
}: {
  category: ContainerCategory
  spec: ContainerSpec
  settings: CushionSettings
  dispatch: Dispatch<PlannerAction>
}) {
  const defaults = DEFAULT_CUSHIONING[category]
  const isDefault =
    settings.gap === defaults.gap &&
    settings.wall === defaults.wall &&
    settings.stack === defaults.stack &&
    settings.stackGap === defaults.stackGap
  const set = (patch: Partial<CushionSettings>) => dispatch({ type: 'setCushioning', category, patch })
  const stackId = useId()
  const sea = category === 'sea'

  return (
    <section
      aria-label="緩衝材・隙間設定"
      className="rounded-xl border border-amber-200 bg-amber-50/50 p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Layers size={16} className="text-amber-600" />
        <h3 className="text-sm font-semibold text-slate-900">緩衝材・隙間設定（Cushioning / Clearance）</h3>
        <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
          {sea ? '海上コンテナ用' : '陸路トラック用'}
        </span>
        <span className="text-[11px] text-slate-500">
          初期値：{sea ? '0 mm（必要に応じて設定）' : '貨物間 50 mm・壁面 30 mm'}。海上／陸路で別々に保存されます。
        </span>
        <button
          type="button"
          className={cx(btn.ghost, 'ml-auto px-2 py-1 text-xs')}
          disabled={isDefault}
          onClick={() => dispatch({ type: 'resetCushioning', category })}
        >
          <RotateCcw size={13} />
          初期値に戻す
        </button>
      </div>

      <div className="mt-3 grid gap-3 @3xl:grid-cols-2">
        <CushionField
          title="貨物間の緩衝材厚み（Inter-cargo Gap）"
          description="貨物と貨物の間に入れる発泡スチロール・ベニヤ板・エアーバッグ等の厚み"
          value={settings.gap}
          max={MAX_CUSHION}
          presets={GAP_PRESETS}
          onChange={(gap) => set({ gap })}
        />
        <CushionField
          title="壁面・周囲クリアランス（Wall Margin）"
          description={`${sea ? 'コンテナ内壁・前壁・ドア' : 'トラックのアオリ（側壁）・前壁・後扉'}と貨物の間の隙間（ラッシング作業・振動による接触防止）`}
          value={settings.wall}
          max={MAX_CUSHION}
          presets={WALL_PRESETS}
          onChange={(wall) => set({ wall })}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-amber-200/70 pt-3">
        <label htmlFor={stackId} className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800">
          <input
            id={stackId}
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 accent-amber-500"
            checked={settings.stack}
            onChange={(e) => set({ stack: e.target.checked })}
          />
          上下段の間にも緩衝材を適用する
        </label>
        <NumberField
          ariaLabel="上下段の間の緩衝材厚み（mm）"
          value={settings.stackGap}
          min={0}
          max={MAX_STACK_CUSHION}
          suffix="mm"
          disabled={!settings.stack}
          onChange={(stackGap) => set({ stackGap })}
          className="w-24"
        />
        <PresetButtons
          values={STACK_PRESETS}
          value={settings.stackGap}
          onSelect={(stackGap) => set({ stackGap })}
          disabled={!settings.stack}
          label="上下段の間の緩衝材"
        />
        <span className="text-[11px] text-slate-500">
          {settings.stack
            ? `段積みの上下間に敷板・パレット等として ${settings.stackGap} mm（0〜50 mm）を確保します。`
            : 'OFF：緩衝材は水平方向（長さ・幅）のみ。段積みは直接重ねます。'}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-600 tabular-nums">
        有効積載エリア（内寸 − 壁面クリアランス × 2）：
        <b className="text-slate-800">
          {mm(spec.length - 2 * settings.wall)} × {mm(spec.width - 2 * settings.wall)} mm
        </b>
        {' ・ '}
        貨物 1 個の実効占有サイズ ＝ 実寸 ＋ 貨物間 {settings.gap} mm（各面 {settings.gap / 2} mm）
        {settings.stack ? ` ＋ 上下段 ${settings.stackGap} mm` : ''}
        {' ＋ 個別緩衝材 × 2'}
      </p>
    </section>
  )
}
