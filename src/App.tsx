import { useCallback, useMemo, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { CountryPanel } from './components/CountryPanel'
import { CountrySettingsModal } from './components/CountrySettingsModal'
import { ExportPanel } from './components/ExportPanel'
import { MeetingPlanner } from './components/MeetingPlanner'
import { SchedulePanel } from './components/SchedulePanel'
import { Timeline } from './components/Timeline'
import { useNow } from './hooks/useNow'
import { createFreshState, usePlanner } from './hooks/usePlanner'
import { useStoredState } from './hooks/useStoredState'
import { CALENDAR_DAYS, type CountrySettings, type PlannerState } from './types'
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

  const { base: baseCode, partners, settings, overrides, mode, anchor, steps } = state
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

  const loadQuery = useCallback(
    (q: string) => dispatch({ type: 'replace', state: parseState(q, createFreshState()).state }),
    [dispatch],
  )
  const reset = useCallback(() => {
    if (window.confirm('国・工程・カスタム休日を初期状態に戻しますか？（保存済みプリセットは残ります）')) {
      dispatch({ type: 'replace', state: createFreshState() })
      setMeetingDate(null)
    }
  }, [dispatch])

  const settingsCountry = settingsFor ? (countries.find((c) => c.code === settingsFor) ?? null) : null
  const updateSettings = useCallback(
    (patch: Partial<CountrySettings>) => {
      if (settingsFor) dispatch({ type: 'updateSettings', code: settingsFor, patch })
    },
    [dispatch, settingsFor],
  )

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader query={query} onLoadQuery={loadQuery} onReset={reset} />

      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-6 px-4 py-6 sm:px-6">
        {/* Top: country list (340px) | current time & meeting window (rest) — side by side from 1024px */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[340px_1fr]">
          <div className="min-w-0">
            <CountryPanel countries={countries} dispatch={dispatch} onOpenSettings={setSettingsFor} now={now} />
          </div>
          <div className="min-w-0">
            <MeetingPlanner
              countries={countries}
              calendars={calendars}
              date={meetingDate ?? today}
              today={today}
              onDateChange={setMeetingDate}
            />
          </div>
        </div>

        <SchedulePanel
          state={state}
          dispatch={dispatch}
          countries={countries}
          schedule={schedule}
          report={report}
          today={today}
        />

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

        <ExportPanel
          report={report}
          countries={countries}
          calendars={calendars}
          recipientCountry={recipientCountry}
          today={today}
          options={exportOptions}
          onOptionsChange={setExportOptions}
        />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-x-6 gap-y-1 px-4 py-4 text-[11px] leading-relaxed text-slate-500 sm:px-6">
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
            （データ CC BY-SA 4.0）／ タイムゾーン: ブラウザ標準 Intl（IANA）。祝日・休業日は変更される場合があります。重要な日程は現地にご確認ください。
          </p>
          <p>計算はすべてブラウザ内で完結し、入力内容が外部に送信されることはありません。</p>
        </div>
      </footer>

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
