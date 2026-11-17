import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calculator,
  CalendarCheck,
  CalendarClock,
  LayoutTemplate,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react'
import { useId, useState, type Dispatch, type ReactNode } from 'react'
import { MAX_STEPS, STEP_NAME_SUGGESTIONS, STEP_TEMPLATES, pickDefaultPartner } from '../state/defaults'
import type { PlannerAction } from '../state/plannerReducer'
import { CALENDAR_DAYS, type PlannerState, type Step } from '../types'
import type { ResolvedCountry } from '../utils/calendars'
import {
  MAX_STEP_DAYS,
  addDays,
  diffDays,
  isISODate,
  type ScheduleResult,
  type ScheduledStep,
} from '../utils/dateCalc'
import { formatJaDate } from '../utils/dateFormat'
import type { ReportStep, ScheduleReport } from '../utils/report'
import { btn, cx, inputClass, labelClass } from './classes'
import { Badge, Card, Flag, Segmented } from './ui'
import { stepColor } from './styles'

interface SchedulePanelProps {
  state: PlannerState
  dispatch: Dispatch<PlannerAction>
  countries: readonly ResolvedCountry[]
  schedule: ScheduleResult
  report: ScheduleReport | null
  today: string
}

function DaysInput({ value, onChange, label }: { value: number; onChange: (days: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value))
  // Re-sync the text field when the committed value changes from outside (stepper, URL, template).
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setDraft(String(value))
  }
  const commit = (raw: string) => {
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n)) onChange(n)
  }
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/25">
      <button
        type="button"
        className="px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
        aria-label={`${label}を1日減らす`}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_STEP_DAYS}
        aria-label={label}
        className="no-spinner w-full min-w-0 border-x border-slate-200 py-2 text-center text-sm font-semibold text-slate-900 tabular-nums focus:outline-none"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => setDraft(String(value))}
      />
      <button
        type="button"
        className="px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
        aria-label={`${label}を1日増やす`}
        disabled={value >= MAX_STEP_DAYS}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}

function StepResultLine({ scheduled, reportStep }: { scheduled?: ScheduledStep; reportStep?: ReportStep }) {
  if (!scheduled) return null
  const holidays = reportStep?.excluded ?? []
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
      <span className="font-semibold text-slate-800 tabular-nums">
        {formatJaDate(scheduled.start, { year: false })} → {formatJaDate(scheduled.end, { year: false })}
      </span>
      <span className="tabular-nums">{scheduled.calendarDays}暦日</span>
      {scheduled.skippedDays.length > 0 && (
        <span className="tabular-nums text-slate-500">休業日スキップ {scheduled.skippedDays.length}日</span>
      )}
      {holidays.map((h) => (
        <Badge key={h.date} tone={h.kind === 'holiday' ? 'rose' : 'orange'}>
          {formatJaDate(h.date, { year: false, weekday: false })} {h.localNames[0] ?? h.names[0]}
        </Badge>
      ))}
    </div>
  )
}

function StepRow({
  step,
  index,
  total,
  countries,
  dispatch,
  scheduled,
  reportStep,
  suggestionsId,
}: {
  step: Step
  index: number
  total: number
  countries: readonly ResolvedCountry[]
  dispatch: Dispatch<PlannerAction>
  scheduled?: ScheduledStep
  reportStep?: ReportStep
  suggestionsId: string
}) {
  const color = stepColor(index)
  const update = (patch: Partial<Omit<Step, 'id'>>) => dispatch({ type: 'updateStep', id: step.id, patch })
  return (
    <li className={cx('rounded-xl border bg-white p-3 shadow-sm', color.border)}>
      <div className="flex items-center gap-2">
        <span className={cx('h-2.5 w-2.5 rounded-full', color.dot)} />
        <span className={cx('text-xs font-bold tracking-wide', color.text)}>STEP {index + 1}</span>
        <div className="ml-auto flex items-center">
          <button
            type="button"
            className={btn.icon}
            disabled={index === 0}
            aria-label="上へ移動"
            onClick={() => dispatch({ type: 'moveStep', id: step.id, direction: -1 })}
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            className={btn.icon}
            disabled={index === total - 1}
            aria-label="下へ移動"
            onClick={() => dispatch({ type: 'moveStep', id: step.id, direction: 1 })}
          >
            <ArrowDown size={15} />
          </button>
          <button
            type="button"
            className={cx(btn.icon, 'hover:bg-rose-50! hover:text-rose-600!')}
            aria-label="工程を削除"
            onClick={() => dispatch({ type: 'removeStep', id: step.id })}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-12 gap-2">
        <div className="col-span-12 md:col-span-6">
          <label className="sr-only" htmlFor={`step-name-${step.id}`}>
            工程名
          </label>
          <input
            id={`step-name-${step.id}`}
            type="text"
            list={suggestionsId}
            className={inputClass}
            value={step.name}
            placeholder="工程名（英語推奨：メールにそのまま使用）"
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div className="col-span-5 md:col-span-2">
          <DaysInput value={step.days} label={`STEP ${index + 1} の所要日数`} onChange={(days) => update({ days })} />
        </div>
        <div className="col-span-7 md:col-span-4">
          <select
            aria-label={`STEP ${index + 1} の適用カレンダー`}
            className={inputClass}
            value={step.calendar}
            onChange={(e) => update({ calendar: e.target.value })}
          >
            <option value={CALENDAR_DAYS}>📅 暦日（土日祝も稼働）</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.info.flag} {c.code} 営業日（{c.info.nameJa}）
              </option>
            ))}
          </select>
        </div>
      </div>
      <StepResultLine scheduled={scheduled} reportStep={reportStep} />
    </li>
  )
}

function SummaryTile({
  label,
  value,
  sub,
  tone = 'slate',
  icon,
}: {
  label: string
  value: string
  sub?: ReactNode
  tone?: 'indigo' | 'emerald' | 'rose' | 'slate'
  icon?: ReactNode
}) {
  const tones = {
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
  }
  return (
    <div className={cx('rounded-xl border p-3.5', tones[tone])}>
      <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs opacity-80">{sub}</div>}
    </div>
  )
}

function relativeDays(from: string, to: string): string {
  const d = diffDays(from, to)
  if (d === 0) return '今日'
  return d > 0 ? `あと${d}日` : `${-d}日前`
}

export function SchedulePanel({ state, dispatch, countries, schedule, report, today }: SchedulePanelProps) {
  const suggestionsId = useId()
  const base = countries[0]
  const ok = schedule.ok && schedule.steps.length > 0 ? schedule : null

  const switchMode = (mode: PlannerState['mode']) => {
    if (mode === state.mode) return
    // Keep the same plan visible from the other direction.
    const anchor = ok ? (mode === 'backward' ? ok.end : ok.start) : undefined
    dispatch({ type: 'setMode', mode, anchor })
  }

  const applyTemplate = (id: string) => {
    const template = STEP_TEMPLATES.find((t) => t.id === id)
    if (!template) return
    if (state.steps.length > 0 && !window.confirm(`現在の工程を「${template.label}」で置き換えますか？`)) return
    dispatch({ type: 'setSteps', steps: template.build(state.base, pickDefaultPartner(state.base, state.partners)) })
  }

  const quickAnchors =
    state.mode === 'backward'
      ? [30, 60, 90].map((d) => ({ label: `+${d}日`, date: addDays(today, d) }))
      : [
          { label: '今日', date: today },
          { label: '+7日', date: addDays(today, 7) },
        ]

  const deadlinePassed = ok && report && state.mode === 'backward' && report.orderDeadline < today

  return (
    <Card
      icon={<Calculator size={18} />}
      title="納期計算（順算・逆算）"
      subtitle="工程ごとに所要日数と適用カレンダーを設定。各国の週末・祝日・カスタム休日を自動でスキップします。"
      actions={
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <LayoutTemplate size={16} className="text-slate-400" />
          <select
            aria-label="工程テンプレート"
            className={cx(inputClass, 'w-auto py-1.5')}
            value=""
            onChange={(e) => applyTemplate(e.target.value)}
          >
            <option value="">テンプレートを適用…</option>
            {STEP_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}：{t.description}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <datalist id={suggestionsId}>
        {STEP_NAME_SUGGESTIONS.map((s) => (
          <option key={s.en} value={s.en} label={s.ja} />
        ))}
      </datalist>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-full sm:w-auto">
              <span className={labelClass}>計算モード</span>
              <Segmented
                ariaLabel="計算モード"
                className="w-full sm:w-auto"
                value={state.mode}
                onChange={switchMode}
                options={[
                  { value: 'backward', label: '逆算：希望納期 → 発注期限', icon: <CalendarClock size={15} /> },
                  { value: 'forward', label: '順算：開始日 → 納期', icon: <CalendarCheck size={15} /> },
                ]}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="anchor-date">
                {state.mode === 'backward' ? '希望納品日（現地着）' : '開始日（受注・着手日）'}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="anchor-date"
                  type="date"
                  className={cx(inputClass, 'w-44')}
                  value={state.anchor}
                  onChange={(e) => isISODate(e.target.value) && dispatch({ type: 'setAnchor', anchor: e.target.value })}
                />
                {quickAnchors.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    className={cx(btn.ghost, 'border border-slate-200 py-1 text-xs')}
                    onClick={() => dispatch({ type: 'setAnchor', anchor: q.date })}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ol className="space-y-3">
            {state.steps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                index={index}
                total={state.steps.length}
                countries={countries}
                dispatch={dispatch}
                scheduled={ok?.steps[index]}
                reportStep={report?.steps[index]}
                suggestionsId={suggestionsId}
              />
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={btn.secondary}
              disabled={state.steps.length >= MAX_STEPS}
              onClick={() => dispatch({ type: 'addStep' })}
            >
              <Plus size={16} />
              工程を追加
            </button>
            <p className="text-xs text-slate-500">
              工程は前工程の翌日から開始（各カレンダーの次の稼働日）。工程名は英文メールにそのまま使われます。
            </p>
          </div>
        </div>

        <aside className="space-y-3">
          {!schedule.ok && (
            <div className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <AlertTriangle size={18} className="shrink-0" />
              <div>
                <div className="font-semibold">計算できません</div>
                <div className="text-xs">稼働日が見つからないカレンダーがあります。週末設定やカスタム休日を確認してください。</div>
              </div>
            </div>
          )}
          {schedule.ok && schedule.steps.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
              工程を追加すると結果が表示されます。
            </div>
          )}
          {ok && report && state.mode === 'backward' && (
            <>
              <SummaryTile
                tone={deadlinePassed ? 'rose' : 'indigo'}
                icon={<CalendarClock size={14} />}
                label={`発注デッドライン（${base.code}営業日・${base.info.nameJa}時間）`}
                value={formatJaDate(report.orderDeadline)}
                sub={
                  deadlinePassed ? (
                    <span className="font-semibold">⚠ 期限を {-diffDays(today, report.orderDeadline)} 日過ぎています</span>
                  ) : (
                    <>今日から{relativeDays(today, report.orderDeadline)}</>
                  )
                }
              />
              <SummaryTile
                tone="emerald"
                icon={<CalendarCheck size={14} />}
                label="希望納品日"
                value={formatJaDate(state.anchor)}
                sub={
                  report.bufferDays > 0
                    ? `最終工程の完了は ${formatJaDate(ok.end, { year: false })}（${report.bufferDays}日前倒し）`
                    : '最終工程が希望日ちょうどに完了'
                }
              />
            </>
          )}
          {ok && report && state.mode === 'forward' && (
            <>
              <SummaryTile
                tone="emerald"
                icon={<CalendarCheck size={14} />}
                label="最終納期（現地着の見込み）"
                value={formatJaDate(ok.end)}
                sub={`今日から${relativeDays(today, ok.end)}`}
              />
              <SummaryTile
                tone="indigo"
                icon={<CalendarClock size={14} />}
                label="開始日"
                value={formatJaDate(state.anchor)}
                sub={report.startShifted ? `稼働開始は ${formatJaDate(ok.start, { year: false })}（非稼働日のため）` : '開始日から稼働'}
              />
            </>
          )}
          {ok && (
            <div className="grid grid-cols-2 gap-3">
              <SummaryTile label="総リードタイム" value={`${ok.totalCalendarDays}暦日`} sub={`${ok.steps.length}工程`} />
              <SummaryTile
                label="休業日スキップ"
                value={`${ok.steps.reduce((n, s) => n + s.skippedDays.length, 0)}日`}
                sub={`うち祝日等 ${report?.steps.reduce((n, s) => n + s.excluded.length, 0) ?? 0}日`}
              />
            </div>
          )}
          {ok && (
            <ul className="space-y-1.5 rounded-xl border border-slate-200 p-3 text-xs">
              {ok.steps.map((s, i) => {
                const country = countries.find((c) => c.code === s.calendar)
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', stepColor(i).dot)} />
                    <span className="min-w-0 flex-1 truncate text-slate-700" title={s.name}>
                      {s.name}
                    </span>
                    <span className="shrink-0 text-slate-400">
                      {country ? <Flag flag={country.info.flag} /> : '📅'} {s.days}日
                    </span>
                    <span className="shrink-0 font-medium text-slate-800 tabular-nums">
                      {formatJaDate(s.start, { year: false, weekday: false })}–{formatJaDate(s.end, { year: false, weekday: false })}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </Card>
  )
}
