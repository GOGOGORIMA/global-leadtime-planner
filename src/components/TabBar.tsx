import { Calculator, CalendarRange, Clock, Container, Mail, ReceiptText, type LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PlannerTab } from '../types'
import { cx } from './classes'
import { tabButtonId, tabPanelId } from './tabIds'

/** `shortLabel` is used while the right pane is narrower than 70rem (window ≈ 1520px). */
const TAB_DEFINITIONS: ReadonlyArray<{ id: PlannerTab; label: string; shortLabel: string; title: string; icon: LucideIcon }> = [
  { id: 'meeting', label: '会議可能時間帯', shortLabel: '会議時間帯', title: '現在時刻と会議可能時間帯', icon: Clock },
  { id: 'schedule', label: '納期計算', shortLabel: '納期計算', title: '納期計算（順算・逆算）', icon: Calculator },
  {
    id: 'calendar',
    label: '稼働カレンダー＆ガント',
    shortLabel: 'カレンダー',
    title: '各国の稼働カレンダー＆工程ガントチャート',
    icon: CalendarRange,
  },
  { id: 'export', label: '英文メール / WhatsApp', shortLabel: '英文出力', title: '英文メール / WhatsApp 出力', icon: Mail },
  {
    id: 'vanning',
    label: '積載3Dシミュレーター',
    shortLabel: '積載3D',
    title: 'コンテナ・トラック積載 3Dシミュレーター（バンニング計算機）',
    icon: Container,
  },
  {
    id: 'quote',
    label: 'Incoterms輸出見積',
    shortLabel: '輸出見積',
    title: 'Incoterms 輸出見積・コスト積算ボード',
    icon: ReceiptText,
  },
]

/** Pill-style tab navigation for the right pane (WAI-ARIA tabs pattern, arrow keys move focus). */
export function TabBar({ value, onChange }: { value: PlannerTab; onChange: (tab: PlannerTab) => void }) {
  const listRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const index = TAB_DEFINITIONS.findIndex((t) => t.id === value)
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const target =
      e.key === 'Home' ? 0 : e.key === 'End' ? TAB_DEFINITIONS.length - 1 : delta ? (index + delta + TAB_DEFINITIONS.length) % TAB_DEFINITIONS.length : -1
    if (target < 0) return
    e.preventDefault()
    const next = TAB_DEFINITIONS[target].id
    onChange(next)
    listRef.current?.querySelector<HTMLElement>(`#${tabButtonId(next)}`)?.focus()
  }

  return (
    // Container query: a narrower right pane gets short labels (< 70rem, window ≈ 1520px) and smaller tabs (< 56rem), so all six fit at 1000px.
    <div className="@container">
      <div
        ref={listRef}
        role="tablist"
        aria-label="表示する画面"
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
      >
        {TAB_DEFINITIONS.map(({ id, label, shortLabel, title, icon: Icon }) => {
          const active = id === value
          return (
            <button
              key={id}
              id={tabButtonId(id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={tabPanelId(id)}
              tabIndex={active ? 0 : -1}
              title={title}
              onClick={() => onChange(id)}
              className={cx(
                'flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[13px] font-semibold tracking-tight whitespace-nowrap transition @4xl:gap-1.5 @4xl:px-2.5 @4xl:text-sm @4xl:tracking-normal @[70rem]:gap-2 @[70rem]:px-3',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
                active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <Icon size={16} className={cx('size-3.5 shrink-0 @4xl:size-4', active ? 'text-white' : 'text-slate-400')} />
              <span className="@[70rem]:hidden">{shortLabel}</span>
              <span className="hidden @[70rem]:inline">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
