import { Calculator, CalendarRange, Clock, Mail, type LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PlannerTab } from '../types'
import { cx } from './classes'
import { tabButtonId, tabPanelId } from './tabIds'

const TAB_DEFINITIONS: ReadonlyArray<{ id: PlannerTab; label: string; title: string; icon: LucideIcon }> = [
  { id: 'meeting', label: '会議可能時間帯', title: '現在時刻と会議可能時間帯', icon: Clock },
  { id: 'schedule', label: '納期計算', title: '納期計算（順算・逆算）', icon: Calculator },
  { id: 'calendar', label: '稼働カレンダー＆ガント', title: '各国の稼働カレンダー＆工程ガントチャート', icon: CalendarRange },
  { id: 'export', label: '英文メール / WhatsApp', title: '英文メール / WhatsApp 出力', icon: Mail },
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
    // Container query: a narrower right pane (window ≈ 1000–1170px) gets slightly smaller tabs, so all four still fit.
    <div className="@container">
      <div
        ref={listRef}
        role="tablist"
        aria-label="表示する画面"
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
      >
        {TAB_DEFINITIONS.map(({ id, label, title, icon: Icon }) => {
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
                'flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[13px] font-semibold tracking-tight whitespace-nowrap transition @3xl:gap-2 @3xl:px-3 @3xl:text-sm @3xl:tracking-normal',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
                active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <Icon size={16} className={cx('size-3.5 shrink-0 @3xl:size-4', active ? 'text-white' : 'text-slate-400')} />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
