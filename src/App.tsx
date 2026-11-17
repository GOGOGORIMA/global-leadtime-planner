import { useCallback, useMemo, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { CountryPanel } from './components/CountryPanel'
import { CountrySettingsModal } from './components/CountrySettingsModal'
import { ExportPanel } from './components/ExportPanel'
import { MeetingPlanner } from './components/MeetingPlanner'
import { SchedulePanel } from './components/SchedulePanel'
import { tabButtonId, tabPanelId } from './components/tabIds'
import { TabBar } from './components/TabBar'
import { Timeline } from './components/Timeline'
import { useNow } from './hooks/useNow'
import { createFreshState, usePlanner } from './hooks/usePlanner'
import { useStoredState } from './hooks/useStoredState'
import { CALENDAR_DAYS, type CountrySettings, type PlannerState, type PlannerTab } from './types'
import { buildCalendarMap, makeCalendarResolver, resolveSelectedCountries } from './utils/calendars'
import { computeSchedule, type ISODate } from './utils/dateCalc'
import { DEFAULT_EXPORT_OPTIONS } from './utils/exportText'
import { buildScheduleReport } from './utils/report'
import { STORAGE_KEYS } from './utils/storage'
import { todayInTimeZone } from './utils/timezone'
import { parseState } from './utils/urlState'

/** Recipient country for e-mail extras: explicit choice → last partner-calendar step → first partner. */
function resolveRecipient(preferred: string, state: PlannerState): string {
  if (preferred && preferred !== state.base && state.partners.includes(preferred)) return preferred
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const calendar = state.steps[i].calendar
    if (calendar !== CALENDAR_DAYS && calendar !== state.base) return calendar
  }
  return state.partners[0] ?? state.base
}

export default function App() {
  const { state, dispatch, query } = usePlanner()
  const now = useNow(60_000)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [meetingDate, setMeetingDate] = useState<ISODate | null>(null)
  const [exportOptions, setExportOptions] = useStoredState(STORAGE_KEYS.exportOptions, DEFAULT_EXPORT_OPTIONS)

  const { base: baseCode, partners, settings, overrides, mode, anchor, steps, tab } = state
  const countries = useMemo(
    () => resolveSelectedCountries({ base: baseCode, partners, settings }),
    [baseCode, partners, settings],
  )
  const calendars = useMemo(() => buildCalendarMap(countries, overrides), [countries, overrides])
  const schedule = useMemo(
    () => computeSchedule({ mode, anchor, steps, resolveCalendar: makeCalendarResolver(calendars, baseCode) }),
    [mode, anchor, steps, calendars, baseCode],
  )

  const base = countries[0]
  const today = todayInTimeZone(base.timeZone, now)
  const recipientCountry = resolveRecipient(exportOptions.recipientCountry, state)

  const report = useMemo(
    () =>
      schedule.ok
        ? buildScheduleReport({
            schedule,
            countries,
            calendars,
            overrides,
            holidayScope: exportOptions.holidayScope,
            recipientCountry,
          })
        : null,
    [schedule, countries, calendars, overrides, exportOptions.holidayScope, recipientCountry],
  )

  const setTab = useCallback((next: PlannerTab) => dispatch({ type: 'setTab', tab: next }), [dispatch])
  // Loading a preset or resetting replaces the plan but keeps the tab the user is looking at.
  const loadQuery = useCallback(
    (q: string) => dispatch({ type: 'replace', state: { ...parseState(q, createFreshState()).state, tab } }),
    [dispatch, tab],
  )
  const reset = useCallback(() => {
    if (window.confirm('国・工程・カスタム休日を初期状態に戻しますか？（保存済みプリセットは残ります）')) {
      dispatch({ type: 'replace', state: { ...createFreshState(), tab } })
      setMeetingDate(null)
    }
  }, [dispatch, tab])

  const settingsCountry = settingsFor ? (countries.find((c) => c.code === settingsFor) ?? null) : null
  const updateSettings = useCallback(
    (patch: Partial<CountrySettings>) => {
      if (settingsFor) dispatch({ type: 'updateSettings', code: settingsFor, patch })
    },
    [dispatch, settingsFor],
  )

  return (
    // Desktop tool: the two panes always stay side by side; narrower windows scroll horizontally.
    <div className="flex min-h-screen min-w-[1000px] flex-col">
      <AppHeader query={query} onLoadQuery={loadQuery} onReset={reset} />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-row items-start gap-6 px-6 py-5">
        {/* Left pane: countries & business hours, always visible */}
        <aside
          aria-label="対象国と営業時間"
          className="sticky top-5 max-h-[calc(100vh-2.5rem)] w-[330px] min-w-[330px] shrink-0 overflow-y-auto rounded-xl"
        >
          <CountryPanel countries={countries} dispatch={dispatch} onOpenSettings={setSettingsFor} now={now} />
        </aside>

        {/* Right pane: tab bar + the selected tab only */}
        <div className="min-w-0 flex-1">
          <TabBar value={tab} onChange={setTab} />
          <div role="tabpanel" id={tabPanelId(tab)} aria-labelledby={tabButtonId(tab)} className="mt-4">
            {tab === 'meeting' && (
              <MeetingPlanner
                countries={countries}
                calendars={calendars}
                date={meetingDate ?? today}
                today={today}
                onDateChange={setMeetingDate}
              />
            )}
            {tab === 'schedule' && (
              <SchedulePanel
                state={state}
                dispatch={dispatch}
                countries={countries}
                schedule={schedule}
                report={report}
                today={today}
                onShowGantt={() => setTab('calendar')}
              />
            )}
            {tab === 'calendar' && (
              <Timeline
                countries={countries}
                calendars={calendars}
                overrides={overrides}
                schedule={schedule}
                mode={mode}
                anchor={anchor}
                today={today}
                orderDeadline={report?.orderDeadline}
                dispatch={dispatch}
              />
            )}
            {tab === 'export' && (
              <ExportPanel
                report={report}
                countries={countries}
                calendars={calendars}
                recipientCountry={recipientCountry}
                today={today}
                meetingDate={meetingDate}
                options={exportOptions}
                onOptionsChange={setExportOptions}
                onShowMeeting={() => setTab('meeting')}
              />
            )}
          </div>

          {/* Inside the right column so the sticky left pane is never pushed up at the end of the page. */}
          <footer className="mt-8 space-y-1 border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-500">
            <p>
              祝日データ:{' '}
              <a
                className="underline decoration-slate-300 hover:text-slate-700"
                href="https://github.com/commenthol/date-holidays"
                target="_blank"
                rel="noreferrer"
              >
                date-holidays
              </a>
              （データ CC BY-SA 4.0）／ タイムゾーン: ブラウザ標準 Intl（IANA）／ 国旗: flagcdn.com（取得できない場合は同梱の
              flag-icons）。祝日・休業日は変更される場合があります。重要な日程は現地にご確認ください。
            </p>
            <p>計算はすべてブラウザ内で完結し、入力内容が外部に送信されることはありません。</p>
          </footer>
        </div>
      </main>

      <CountrySettingsModal
        country={settingsCountry}
        settings={settingsFor ? settings[settingsFor] : undefined}
        now={now}
        onChange={updateSettings}
        onReset={() => settingsFor && dispatch({ type: 'resetSettings', code: settingsFor })}
        onClose={() => setSettingsFor(null)}
      />
    </div>
  )
}
