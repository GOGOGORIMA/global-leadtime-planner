import { AlertTriangle, ArrowRight, CircleCheck, Container, ImageDown, Info, Ship, Truck } from 'lucide-react'
import { Component, Suspense, lazy, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react'
import {
  CATEGORY_LABELS,
  getContainerSpec,
  specsOfCategory,
  type ContainerCategory,
  type ContainerId,
  type ContainerSpec,
} from '../data/containers'
import type { PlannerAction } from '../state/plannerReducer'
import type { CargoItem, CushionSettings } from '../types'
import {
  MAX_PIECES,
  analyzePacking,
  fillLevel,
  hasClearance,
  suggestForCategory,
  toClearance,
  type CategorySuggestion,
  type Clearance,
  type PackingResult,
  type UnitPlan,
} from '../utils/binPacking'
import type { ISODate } from '../utils/dateCalc'
import { CargoList } from './CargoList'
import { btn, cx, focusRing } from './classes'
import { CushioningBar } from './CushioningBar'
import type { CameraView, LoadViewerHandle, SnapshotInfo } from './LoadViewer3D'
import { Segmented } from './ui'

// three.js (~600 kB) is only downloaded when this tab is opened.
const LoadViewer3D = lazy(() => import('./LoadViewer3D'))

interface VanningPanelProps {
  container: ContainerId
  cargo: readonly CargoItem[]
  cushioning: Record<ContainerCategory, CushionSettings>
  dispatch: Dispatch<PlannerAction>
  today: ISODate
}

const VIEWS: ReadonlyArray<{ id: CameraView; label: string; title: string }> = [
  { id: 'oblique', label: '斜め俯瞰', title: 'ドア側の斜め上から全体を見る' },
  { id: 'side', label: '側面', title: '真横から積み高さと奥行きを見る' },
  { id: 'top', label: '真上', title: '真上から床面の埋まり具合を見る' },
  { id: 'door', label: '正面（ドア側）', title: 'ドア側から荷室の中を見る' },
]

const mm = (n: number) => Math.round(n).toLocaleString('en-US')
const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
const m3 = (n: number) => n.toFixed(1)
const pct = (ratio: number) => `${(ratio * 100).toFixed(1)}%`
const pct0 = (ratio: number) => `${Math.round(ratio * 100)}%`

const FILL_LABELS = { roomy: '余裕あり', good: '適正', full: 'ほぼ満載' } as const

function dims(spec: ContainerSpec): string {
  return `${mm(spec.length)} × ${mm(spec.width)} × ${mm(spec.height)} mm`
}

/** `貨物間 50 mm・壁面 30 mm・上下段 20 mm` (or `なし`). */
function clearanceJa(clearance: Clearance): string {
  const parts: string[] = []
  if (clearance.gap > 0) parts.push(`貨物間 ${mm(clearance.gap)} mm`)
  if (clearance.wall > 0) parts.push(`壁面 ${mm(clearance.wall)} mm`)
  if (clearance.stack > 0) parts.push(`上下段 ${mm(clearance.stack)} mm`)
  return parts.length ? parts.join('・') : 'なし'
}

/** Shown when the lazy 3D chunk fails to load (offline, blocked). */
class ViewerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        3D ビューアを読み込めませんでした（通信エラー、または WebGL 非対応）。積載結果はメーターと貨物リストで確認できます。
      </div>
    )
  }
}

function ViewerPlaceholder() {
  return (
    <div className="flex h-[420px] items-center justify-center rounded-xl border border-slate-200 bg-linear-to-b from-white to-slate-100 text-sm text-slate-500">
      3D ビューアを読み込み中…
    </div>
  )
}

function blockedText(plan: UnitPlan): string {
  switch (plan.blocked) {
    case 'door':
      return `${plan.spec.label} のドア開口高 ${mm(plan.spec.doorHeight)} mm を超える貨物があります`
    case 'weight':
      return `1 個で ${plan.spec.label} の最大積載 ${kg(plan.spec.maxPayload)} kg を超える貨物があります`
    case 'many':
      return '必要な台数・本数が多すぎます'
    default:
      return `${plan.spec.label} の内寸 ${dims(plan.spec)} に収まらない貨物があります`
  }
}

/** Compact suggestion badge (card header): 「海上なら 20ft Dry で積載可能（余裕あり）」. */
function SuggestionBadge({
  suggestion,
  current,
  hasCargo,
  onSelect,
}: {
  suggestion: CategorySuggestion
  current: ContainerId
  hasCargo: boolean
  onSelect: (id: ContainerId) => void
}) {
  const sea = suggestion.category === 'sea'
  const Icon = sea ? Ship : Truck
  const best = suggestion.best
  let headline: string
  let detail: string
  let tone: 'ok' | 'bad' | 'none'
  if (!hasCargo) {
    headline = `${sea ? '海上' : '陸路'}の最適規格を判定します`
    detail = '貨物を入力すると、総容積・総重量・最大寸法から自動で判定します。'
    tone = 'none'
  } else if (!best) {
    const largest = suggestion.plans[suggestion.plans.length - 1]
    headline = sea ? '標準の海上コンテナでは輸送できません' : 'トラックでは輸送できません'
    detail = `${blockedText(largest)}。${sea ? 'オープントップ・フラットラック等の特殊コンテナを検討してください。' : '大型の特殊車両を検討してください。'}`
    tone = 'bad'
  } else {
    const units = best.units ?? 1
    const level = FILL_LABELS[fillLevel(best.fill)]
    headline =
      units === 1
        ? sea
          ? `海上なら ${best.spec.label} で積載可能（${level}）`
          : `陸路なら ${best.spec.label} × 1台が最適（${level}）`
        : sea
          ? `海上なら ${best.spec.label} × ${units}本が必要`
          : `陸路なら ${best.spec.label} × ${units}台が最適`
    const others = suggestion.plans
      .filter((p) => p !== best)
      .map((p) => (p.units ? `${p.spec.label} ×${p.units}${p.spec.unitJa}` : `${p.spec.label} 不可`))
    detail = `${units === 1 ? '' : '1本・1台あたり平均 '}容積 ${pct0(best.volumeRatio)}・重量 ${pct0(best.weightRatio)}・荷室長 ${pct0(best.lengthRatio)}${others.length ? `（他: ${others.join('、')}）` : ''}`
    tone = 'ok'
  }

  return (
    <div
      className={cx(
        'flex items-center gap-2.5 rounded-lg border px-2.5 py-2',
        tone === 'ok' && 'border-emerald-200 bg-emerald-50/70',
        tone === 'bad' && 'border-rose-200 bg-rose-50/70',
        tone === 'none' && 'border-slate-200 bg-slate-50',
      )}
      title={`${CATEGORY_LABELS[suggestion.category]}の自動判定`}
    >
      <span
        className={cx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          tone === 'ok' ? 'bg-emerald-600 text-white' : tone === 'bad' ? 'bg-rose-600 text-white' : 'bg-slate-200 text-slate-500',
        )}
      >
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cx(
            'text-sm leading-snug font-bold',
            tone === 'ok' ? 'text-emerald-900' : tone === 'bad' ? 'text-rose-800' : 'text-slate-600',
          )}
        >
          {headline}
        </div>
        <div className="text-[11px] leading-snug text-slate-600 tabular-nums">{detail}</div>
      </div>
      {best &&
        (best.spec.id === current ? (
          <span className="shrink-0 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            表示中
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(best.spec.id)}
            className={cx(
              'inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-100',
              focusRing,
            )}
          >
            この規格で表示 <ArrowRight size={12} />
          </button>
        ))}
    </div>
  )
}

/** Compact progress bar for the viewer card footer. */
function CompactMeter({
  label,
  ratio,
  value,
  note,
  color,
  striped,
}: {
  label: string
  ratio: number
  value: string
  note?: string
  color: string
  striped?: boolean
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-slate-600" title={label}>
          {label}
        </span>
        <span className="text-base font-bold text-slate-900 tabular-nums">{pct(ratio)}</span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, ratio) * 100)}
      >
        <div className={cx('h-full rounded-full transition-all', color, striped && 'stripes-dark')} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="mt-1 truncate text-[11px] text-slate-600 tabular-nums" title={value}>
        {value}
      </div>
      {note && (
        <div className="truncate text-[10px] text-slate-400 tabular-nums" title={note}>
          {note}
        </div>
      )}
    </div>
  )
}

interface Alert {
  tone: 'error' | 'warning' | 'ok'
  text: string
  hint?: string
}

function buildAlerts(result: PackingResult, cargo: readonly CargoItem[], sea: CategorySuggestion, truck: CategorySuggestion): Alert[] {
  const { spec } = result
  const alerts: Alert[] = []
  if (cargo.length === 0) return alerts
  const best = spec.category === 'sea' ? sea.best : truck.best
  const bestText =
    best && best.spec.id !== spec.id ? `${best.spec.label}${best.units && best.units > 1 ? ` × ${best.units}${best.spec.unitJa}` : ''} なら全量を積載できます。` : undefined

  const count = (reason: 'space' | 'weight' | 'door' | 'size' | 'limit') =>
    cargo
      .map((item, i) => ({ item, n: result.items[i]?.unplaced[reason] ?? 0 }))
      .filter((x) => x.n > 0)

  const space = count('space')
  if (space.length) {
    const n = space.reduce((sum, x) => sum + x.n, 0)
    alerts.push({
      tone: 'error',
      text: `積みきれない貨物があります：未積載 ${n} 個（${space.map((x) => `${x.item.name} × ${x.n}`).join('、')}）`,
      hint: bestText,
    })
  }
  if (result.doorBlocked.length) {
    const rows = result.doorBlocked.map((i) => cargo[i])
    const hq = getContainerSpec('40hc')
    const fitsHq = spec.category === 'sea' && rows.every((item) => item.height <= hq.doorHeight)
    alerts.push({
      tone: 'error',
      text: `ドア開口高 ${mm(spec.doorHeight)} mm を超える貨物があります：${rows.map((item) => `${item.name}（高さ ${mm(item.height)} mm）`).join('、')}。この${spec.category === 'sea' ? 'コンテナ' : '車両'}には搬入できません。`,
      hint: fitsHq && spec.id !== hq.id ? `40ft HQ（ドア開口高 ${mm(hq.doorHeight)} mm）なら搬入できます。` : undefined,
    })
  }
  if (result.oversize.length) {
    const wall = result.clearance.wall
    const area =
      wall > 0
        ? `有効寸法（内寸 − 壁面クリアランス ${mm(wall)} mm × 2 = ${mm(result.usableLength)} × ${mm(result.usableWidth)} mm、高さ ${mm(spec.height)} mm）`
        : `内寸（${dims(spec)}）`
    alerts.push({
      tone: 'error',
      text: `荷室の${area}に収まらない貨物があります：${result.oversize
        .map((i) => {
          const c = cargo[i]
          return `${c.name}（${mm(c.length)} × ${mm(c.width)} × ${mm(c.height)} mm${c.margin > 0 ? `、個別緩衝材 +${mm(c.margin)} mm` : ''}）`
        })
        .join('、')}`,
    })
  }
  if (result.overweight) {
    const n = count('weight').reduce((sum, x) => sum + x.n, 0)
    alerts.push({
      tone: 'error',
      text: `総重量オーバー：貨物の合計 ${kg(result.totalWeight)} kg が最大積載量 ${kg(spec.maxPayload)} kg を超えています${n ? `（${n} 個は重量超過のため未積載）` : ''}。`,
      hint: bestText,
    })
  }
  if (result.limitedPieces > 0) {
    alerts.push({
      tone: 'warning',
      text: `計算は合計 ${MAX_PIECES.toLocaleString('en-US')} 個までです。超過分（${result.limitedPieces.toLocaleString('en-US')} 個）は計算していません。`,
    })
  }
  if (!alerts.some((a) => a.tone === 'error') && result.loadedPieces === result.totalPieces - result.limitedPieces) {
    const cushion = hasClearance(result.clearance) ? `（緩衝材 ${clearanceJa(result.clearance)} を確保）` : ''
    const spare = Math.max(0, spec.length - result.clearance.wall - result.usedLength)
    alerts.push({
      tone: 'ok',
      text: `すべての貨物（${result.loadedPieces.toLocaleString('en-US')} 個）を ${spec.label} に積載できます${cushion}。奥（前壁）から ${mm(result.usedLength)} mm まで使用、ドア側に ${mm(spare)} mm の余裕があります。`,
    })
  }
  return alerts
}

export function VanningPanel({ container, cargo, cushioning, dispatch, today }: VanningPanelProps) {
  const spec = getContainerSpec(container)
  // Each transport mode keeps its own cushioning (trucks: 50 mm between pieces / 30 mm to the walls).
  const seaClearance = useMemo(() => toClearance(cushioning.sea), [cushioning.sea])
  const truckClearance = useMemo(() => toClearance(cushioning.truck), [cushioning.truck])
  const clearance = spec.category === 'sea' ? seaClearance : truckClearance
  const result = useMemo(() => analyzePacking(spec, cargo, clearance), [spec, cargo, clearance])
  const sea = useMemo(() => suggestForCategory(cargo, 'sea', seaClearance), [cargo, seaClearance])
  const truck = useMemo(() => suggestForCategory(cargo, 'truck', truckClearance), [cargo, truckClearance])
  const alerts = useMemo(() => buildAlerts(result, cargo, sea, truck), [result, cargo, sea, truck])
  const hasCargo = cargo.length > 0

  // 3D viewer: the toolbar lives in this card header and drives the lazy viewer through a ref.
  const viewerRef = useRef<LoadViewerHandle>(null)
  const [view, setView] = useState<CameraView>('oblique')
  /** Container id for which the user moved the camera by hand (no preset button is active then). */
  const [movedFor, setMovedFor] = useState<string | null>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [showGuide, setShowGuide] = useState(true)
  const activeView = movedFor === spec.id ? null : view
  const changeView = (next: CameraView) => {
    setView(next)
    setMovedFor(null)
    viewerRef.current?.setView(next)
  }

  const selectContainer = (id: ContainerId) => dispatch({ type: 'setContainer', container: id })
  const switchCategory = (category: ContainerCategory) => {
    if (category === spec.category) return
    const best = (category === 'sea' ? sea : truck).best
    selectContainer(best?.spec.id ?? specsOfCategory(category)[0].id)
  }

  const snapshot: SnapshotInfo = useMemo(
    () => ({
      title: `${spec.nameJa}（${spec.label}）積載シミュレーション`,
      subtitle: `内寸 ${dims(spec)} ・ ドア開口高 ${mm(spec.doorHeight)} mm ・ 最大積載 ${kg(spec.maxPayload)} kg ・ 容積 ${spec.capacity} m³ ・ 緩衝材 ${clearanceJa(clearance)}`,
      metrics: `積載 ${result.loadedPieces}/${result.totalPieces} 個 ・ 容積 正味 ${m3(result.loadedVolume)} m³／実質占有 ${m3(result.loadedGrossVolume)} m³ / ${spec.capacity} m³ (${pct(result.grossVolumeRatio)}) ・ 重量 ${kg(result.loadedWeight)} / ${kg(spec.maxPayload)} kg (${pct(result.weightRatio)}) ・ 床面 ${pct(result.floorRatio)}`,
      items: cargo.map((item, i) => ({
        color: item.color,
        text: `${item.name}  ${mm(item.length)}×${mm(item.width)}×${mm(item.height)} mm ・ ${kg(item.weight)} kg × ${item.quantity}（積載 ${result.items[i]?.loaded ?? 0}/${item.quantity}）${item.stackable ? '' : ' ・ 上積み厳禁'}${item.margin > 0 ? ` ・ 個別緩衝材 +${mm(item.margin)} mm` : ''}`,
      })),
      warnings: alerts.filter((a) => a.tone !== 'ok').map((a) => a.text),
      footer: `Global Planner ・ ${today} ・ 奥（前壁）からドアに向かって積み付け（自動計算の目安です。実際の積み付けは現場で確認してください）`,
      fileName: `vanning_${spec.id}_${today}.png`,
    }),
    [spec, result, cargo, alerts, today, clearance],
  )
  const showsCushion = hasClearance(clearance) || cargo.some((item) => item.margin > 0)
  const cushionVolume = result.loadedGrossVolume - result.loadedVolume

  return (
    <div className="space-y-4">
      {/* 1. 3D viewer card: mode / size, suggestions, warnings, camera + PNG / canvas / meters */}
      <section aria-label="3D 積載ビュー" className="w-full rounded-xl border border-slate-200 bg-white shadow-sm @container">
        <header className="space-y-3 border-b border-slate-100 px-4 pt-3 pb-3.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Container size={18} />
            </span>
            <h2 className="text-base font-semibold text-slate-900">コンテナ・トラック積載 3Dシミュレーター（バンニング計算機）</h2>
            <span className="text-xs text-slate-500">貨物の寸法・重量・個数から積み付けを自動計算して 3D で表示します。</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="輸送手段"
              value={spec.category}
              onChange={switchCategory}
              options={[
                { value: 'sea', label: '海上コンテナ', icon: <Ship size={15} /> },
                { value: 'truck', label: '陸路トラック', icon: <Truck size={15} /> },
              ]}
            />
            <div role="radiogroup" aria-label="コンテナ・トラックの規格" className="flex flex-wrap gap-1.5">
              {specsOfCategory(spec.category).map((s) => {
                const active = s.id === spec.id
                const best = (s.category === 'sea' ? sea : truck).best?.spec.id === s.id && hasCargo
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => selectContainer(s.id)}
                    title={`${s.nameJa}：内寸 ${dims(s)}、最大積載 ${kg(s.maxPayload)} kg、容積 ${s.capacity} m³`}
                    className={cx(
                      'rounded-lg border px-2.5 py-1 text-left transition',
                      focusRing,
                      active ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <span className={cx('block text-sm font-semibold', active ? 'text-indigo-900' : 'text-slate-800')}>
                      {s.label}
                      {best && (
                        <span className="ml-1.5 rounded bg-emerald-100 px-1 py-px align-[1px] text-[10px] font-bold text-emerald-700">
                          推奨
                        </span>
                      )}
                    </span>
                    <span className="block text-[10px] text-slate-500 tabular-nums">
                      {mm(s.length)}×{mm(s.width)}×{mm(s.height)}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="flex flex-wrap gap-x-2.5 text-[11px] text-slate-500 tabular-nums">
              <span>ドア開口高 {mm(spec.doorHeight)} mm{spec.category === 'truck' ? '（荷室高まで）' : ''}</span>
              <span>最大積載 {kg(spec.maxPayload)} kg</span>
              <span>容積 {spec.capacity} m³</span>
              <span>緩衝材 {clearanceJa(clearance)}</span>
            </p>
          </div>

          <div className="grid gap-2 @3xl:grid-cols-2">
            <SuggestionBadge suggestion={sea} current={spec.id} hasCargo={hasCargo} onSelect={selectContainer} />
            <SuggestionBadge suggestion={truck} current={spec.id} hasCargo={hasCargo} onSelect={selectContainer} />
          </div>

          {alerts.length > 0 && (
            <ul className="space-y-1" aria-live="polite">
              {alerts.map((alert) => (
                <li
                  key={alert.text}
                  className={cx(
                    'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
                    alert.tone === 'error' && 'bg-rose-50 text-rose-800 ring-1 ring-rose-200',
                    alert.tone === 'warning' && 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
                    alert.tone === 'ok' && 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
                  )}
                >
                  {alert.tone === 'ok' ? (
                    <CircleCheck size={15} className="mt-px shrink-0" />
                  ) : alert.tone === 'warning' ? (
                    <Info size={15} className="mt-px shrink-0" />
                  ) : (
                    <AlertTriangle size={15} className="mt-px shrink-0" />
                  )}
                  <span>
                    <span className={alert.tone === 'error' ? 'font-semibold' : undefined}>{alert.text}</span>
                    {alert.hint && <span className="ml-1 text-slate-700">→ {alert.hint}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="カメラ視点" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  title={v.title}
                  aria-pressed={activeView === v.id}
                  onClick={() => changeView(v.id)}
                  className={cx(
                    'rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition',
                    focusRing,
                    activeView === v.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400">ドラッグで回転・右ドラッグで移動・ホイールでズーム</span>
            <button type="button" className={cx(btn.primary, 'ml-auto')} onClick={() => viewerRef.current?.save()} disabled={!viewerReady}>
              <ImageDown size={16} />
              3D画像を保存（PNG）
            </button>
          </div>
        </header>

        <div className="px-4 pt-3 pb-3 sm:px-5">
          <ViewerBoundary>
            <Suspense fallback={<ViewerPlaceholder />}>
              <LoadViewer3D
                ref={viewerRef}
                spec={spec}
                placements={result.placements}
                items={cargo}
                clearance={clearance}
                snapshot={snapshot}
                view={view}
                showCushion={showGuide}
                onUserMove={setMovedFor}
                onReady={setViewerReady}
              />
            </Suspense>
          </ViewerBoundary>
          {hasCargo && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
              {cargo.map((item, i) => {
                const status = result.items[i]
                const missing = status ? status.total - status.loaded : 0
                return (
                  <li key={item.id} className="flex min-w-0 items-center gap-1.5">
                    <span className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-slate-900/30" style={{ backgroundColor: item.color }} />
                    <span className="max-w-56 truncate">{item.name}</span>
                    <span className={cx('tabular-nums', missing > 0 ? 'font-semibold text-rose-600' : 'text-slate-500')}>
                      {status?.loaded ?? 0}/{item.quantity}
                    </span>
                  </li>
                )
              })}
              {showsCushion && showGuide && (
                <li className="flex items-center gap-1.5 text-amber-800">
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-dashed border-amber-600 bg-amber-200/60" />
                  緩衝材を含めた占有境界
                </li>
              )}
            </ul>
          )}
        </div>

        <footer className="grid grid-cols-2 gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5 @3xl:grid-cols-4">
          <CompactMeter
            label="純粋貨物容積（Net m³）"
            ratio={result.volumeRatio}
            value={`現在 ${m3(result.loadedVolume)} m³ / ${spec.capacity} m³`}
            note={result.loadedPieces < result.totalPieces ? `全貨物 ${m3(result.totalVolume)} m³` : '貨物の実寸の合計'}
            color="bg-indigo-500"
          />
          <CompactMeter
            label="緩衝材込み占有容積（Gross m³）"
            ratio={result.grossVolumeRatio}
            value={`現在 ${m3(result.loadedGrossVolume)} m³ / ${spec.capacity} m³`}
            note={cushionVolume > 0.005 ? `緩衝材・隙間 +${m3(cushionVolume)} m³` : '緩衝材なし（正味と同じ）'}
            color="bg-indigo-300"
            striped
          />
          <CompactMeter
            label="重量消化率（kg）"
            ratio={result.weightRatio}
            value={`現在 ${kg(result.loadedWeight)} kg / ${kg(spec.maxPayload)} kg`}
            note={result.overweight ? `貨物の総重量 ${kg(result.totalWeight)} kg（超過）` : `貨物の総重量 ${kg(result.totalWeight)} kg`}
            color={result.overweight ? 'bg-rose-500' : 'bg-sky-500'}
          />
          <CompactMeter
            label="床面積占有率（%）"
            ratio={result.floorRatio}
            value={`床面 ${result.grossFloorArea.toFixed(1)} m² / ${result.containerFloorArea.toFixed(1)} m²`}
            note={`奥から ${mm(result.usedLength)} mm まで使用（荷室長の ${pct0(result.usedLength / spec.length)}）`}
            color="bg-teal-500"
          />
        </footer>
      </section>

      {/* 2. Cargo card: cushioning bar on top, cargo table below */}
      <section aria-label="貨物リストと緩衝材設定" className="w-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <CushioningBar
          category={spec.category}
          spec={spec}
          settings={cushioning[spec.category]}
          dispatch={dispatch}
          showGuide={showGuide}
          onShowGuideChange={setShowGuide}
        />
        <CargoList cargo={cargo} statuses={result.items} clearance={clearance} dispatch={dispatch} />
      </section>
    </div>
  )
}
