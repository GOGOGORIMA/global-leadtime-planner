import { Layers, RotateCcw } from 'lucide-react'
import { useId, type Dispatch } from 'react'
import type { ContainerCategory, ContainerSpec } from '../data/containers'
import {
  DEFAULT_CUSHIONING,
  GAP_PRESETS,
  MAX_CUSHION,
  MAX_STACK_CUSHION,
  WALL_PRESETS,
} from '../state/defaults'
import type { PlannerAction } from '../state/plannerReducer'
import type { CushionSettings } from '../types'
import { btn, cx, focusRing } from './classes'
import { NumberField } from './NumberField'

const mm = (n: number) => Math.round(n).toLocaleString('en-US')

function QuickButtons({ values, value, onSelect, label }: { values: readonly number[]; value: number; onSelect: (v: number) => void; label: string }) {
  return (
    <div role="group" aria-label={`${label}のクイック選択`} className="flex gap-0.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          aria-label={`${v} mm`}
          title={`${v} mm`}
          onClick={() => onSelect(v)}
          className={cx(
            'min-w-[1.375rem] rounded-md px-1.5 py-1 text-[11px] leading-4 font-semibold tabular-nums ring-1 transition ring-inset',
            focusRing,
            value === v ? 'bg-amber-500 text-white ring-amber-500' : 'bg-white text-slate-600 ring-slate-200 hover:bg-amber-50',
          )}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

/**
 * 緩衝材・クリアランス設定バー (top of the cargo card): gap between pieces, wall clearance, cushioning
 * between tiers and the 3D guide switch on one row. Containers and trucks keep their own settings
 * (trucks start with 50 mm between pieces and 30 mm to the walls).
 */
export function CushioningBar({
  category,
  spec,
  settings,
  dispatch,
  showGuide,
  onShowGuideChange,
}: {
  category: ContainerCategory
  spec: ContainerSpec
  settings: CushionSettings
  dispatch: Dispatch<PlannerAction>
  showGuide: boolean
  onShowGuideChange: (show: boolean) => void
}) {
  const defaults = DEFAULT_CUSHIONING[category]
  const isDefault =
    settings.gap === defaults.gap &&
    settings.wall === defaults.wall &&
    settings.stack === defaults.stack &&
    settings.stackGap === defaults.stackGap
  const set = (patch: Partial<CushionSettings>) => dispatch({ type: 'setCushioning', category, patch })
  const gapId = useId()
  const wallId = useId()
  const stackId = useId()
  const sea = category === 'sea'

  return (
    <section aria-label="緩衝材・クリアランス設定" className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex items-center gap-1.5" title={`${sea ? '海上コンテナ' : '陸路トラック'}用の設定（海上／陸路で別々に保存）`}>
          <Layers size={15} className="text-amber-600" />
          <span className="text-sm font-semibold whitespace-nowrap text-slate-800">緩衝材・クリアランス</span>
        </div>

        <div className="flex items-center gap-1.5" title="貨物間の緩衝材厚み：貨物と貨物の間に入れる発泡スチロール・ベニヤ板・エアーバッグ等の厚み">
          <label htmlFor={gapId} className="text-xs font-medium whitespace-nowrap text-slate-700">
            貨物間
          </label>
          <NumberField
            id={gapId}
            compact
            ariaLabel="貨物間の緩衝材厚み（mm）"
            value={settings.gap}
            min={0}
            max={MAX_CUSHION}
            suffix="mm"
            onChange={(gap) => set({ gap })}
            className="w-[64px]"
          />
          <QuickButtons values={GAP_PRESETS} value={settings.gap} onSelect={(gap) => set({ gap })} label="貨物間の緩衝材厚み" />
        </div>

        <div
          className="flex items-center gap-1.5"
          title={`壁面クリアランス：${sea ? 'コンテナ内壁・前壁・ドア' : 'トラックのアオリ（側壁）・前壁・後扉'}と貨物の間の隙間（ラッシング作業・振動による接触防止）`}
        >
          <label htmlFor={wallId} className="text-xs font-medium whitespace-nowrap text-slate-700">
            壁面
          </label>
          <NumberField
            id={wallId}
            compact
            ariaLabel="壁面クリアランス（mm）"
            value={settings.wall}
            min={0}
            max={MAX_CUSHION}
            suffix="mm"
            onChange={(wall) => set({ wall })}
            className="w-[64px]"
          />
          <QuickButtons values={WALL_PRESETS} value={settings.wall} onSelect={(wall) => set({ wall })} label="壁面クリアランス" />
        </div>

        <div className="flex items-center gap-1.5" title="ON: 段積みの上下間に敷板・パレット等の厚み（0〜50 mm）を確保。OFF: 緩衝材は水平方向（長さ・幅）のみ">
          <label htmlFor={stackId} className="flex cursor-pointer items-center gap-1.5 text-xs font-medium whitespace-nowrap text-slate-700">
            <input
              id={stackId}
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-amber-500"
              checked={settings.stack}
              onChange={(e) => set({ stack: e.target.checked })}
            />
            上下段にも適用
          </label>
          <NumberField
            compact
            ariaLabel="上下段の間の緩衝材厚み（mm）"
            value={settings.stackGap}
            min={0}
            max={MAX_STACK_CUSHION}
            suffix="mm"
            disabled={!settings.stack}
            onChange={(stackGap) => set({ stackGap })}
            className="w-[60px]"
          />
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={showGuide}
          aria-label="3D上の緩衝材ガイド表示"
          onClick={() => onShowGuideChange(!showGuide)}
          title="3D 上に、緩衝材を含めた占有境界（黄色の半透明ボックスと破線）と壁面クリアランスの内側を表示"
          className={cx('inline-flex items-center gap-1.5 rounded-md py-0.5 text-xs font-medium whitespace-nowrap text-slate-700', focusRing)}
        >
          <span className={cx('relative h-[18px] w-8 shrink-0 rounded-full transition', showGuide ? 'bg-amber-500' : 'bg-slate-300')}>
            <span
              className={cx(
                'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all',
                showGuide ? 'left-[16px]' : 'left-[2px]',
              )}
            />
          </span>
          3Dガイド
        </button>

        <button
          type="button"
          className={cx(btn.icon, 'ml-auto')}
          disabled={isDefault}
          onClick={() => dispatch({ type: 'resetCushioning', category })}
          aria-label="緩衝材の設定を初期値に戻す"
          title={`初期値（${sea ? '海上コンテナ: 0 mm' : '陸路トラック: 貨物間 50 mm・壁面 30 mm'}）に戻す`}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500 tabular-nums">
        <span className="mr-1 rounded bg-white px-1.5 py-px text-[10px] font-bold text-amber-800 ring-1 ring-amber-200">
          {sea ? '海上コンテナ用' : '陸路トラック用'}
        </span>
        貨物間の緩衝材厚み・壁面クリアランス（mm）。初期値は
        {sea ? ' 0 mm' : ' 貨物間 50 mm・壁面 30 mm'}（海上／陸路で別々に保存）
        {' ・ '}
        有効積載エリア（内寸 − 壁面 × 2）
        <b className="font-semibold text-slate-700">
          {' '}
          {mm(spec.length - 2 * settings.wall)} × {mm(spec.width - 2 * settings.wall)} mm
        </b>
        {' ・ '}
        個別の緩衝材は貨物リストの各行で設定
      </p>
    </section>
  )
}
