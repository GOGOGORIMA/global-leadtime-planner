import { describe, expect, it } from 'vitest'
import { CALENDAR_DAYS, type OverrideMap, type Step } from '../types'
import { buildCalendarMap, makeCalendarResolver, resolveCountry } from './calendars'
import { computeSchedule, type ScheduleMode } from './dateCalc'
import { DEFAULT_EXPORT_OPTIONS, renderEmail, renderWhatsApp, type ExportOptions } from './exportText'
import { buildScheduleReport, type HolidayScope } from './report'

const STEPS: Step[] = [
  { id: 'a', name: 'Procurement & Production', days: 5, calendar: 'JP' },
  { id: 'b', name: 'Ocean Freight & Customs Clearance', days: 14, calendar: CALENDAR_DAYS },
  { id: 'c', name: 'Local Delivery', days: 3, calendar: 'TH' },
]

function makeReport(mode: ScheduleMode, anchor: string, overrides: OverrideMap = {}, holidayScope: HolidayScope = 'relevant') {
  const countries = [resolveCountry('JP', undefined, true), resolveCountry('TH', undefined), resolveCountry('US', undefined)]
  const calendars = buildCalendarMap(countries, overrides)
  const schedule = computeSchedule({ mode, anchor, steps: STEPS, resolveCalendar: makeCalendarResolver(calendars, 'JP') })
  if (!schedule.ok) throw new Error(schedule.error)
  return buildScheduleReport({ schedule, countries, calendars, overrides, holidayScope })
}

const options = (patch: Partial<ExportOptions> = {}): ExportOptions => ({ ...DEFAULT_EXPORT_OPTIONS, ...patch })

describe('schedule report', () => {
  it('collects skipped holidays per step with real holiday data', () => {
    const report = makeReport('forward', '2026-11-17')
    expect(report.steps.map((s) => [s.start, s.end])).toEqual([
      ['2026-11-17', '2026-11-24'],
      ['2026-11-25', '2026-12-08'],
      ['2026-12-09', '2026-12-14'],
    ])
    expect(report.steps[0].excluded).toEqual([
      { date: '2026-11-23', kind: 'holiday', names: ['Labor Thanksgiving Day'], localNames: ['勤労感謝の日'] },
    ])
    expect(report.steps[0].weekendDays).toBe(2)
    expect(report.steps[2].excluded.map((e) => e.date)).toEqual(['2026-12-10'])
    // "relevant" scope = base country + countries used by steps (US is selected but unused).
    expect(report.holidayGroups.map((g) => g.country.code)).toEqual(['JP', 'TH'])
    const th = report.holidayGroups[1].holidays
    expect(th.find((h) => h.start === '2026-12-05')?.onWeekend).toBe(true)
  })

  it('derives the base-country order deadline for backward schedules', () => {
    const report = makeReport('backward', '2026-12-13') // Sunday
    expect(report.end).toBe('2026-12-11')
    expect(report.bufferDays).toBe(2)
    expect(report.orderDeadline).toBe(report.start)
  })

  it('lists custom days off with their labels', () => {
    const report = makeReport('forward', '2026-11-17', { JP: { '2026-11-18': { kind: 'off', label: 'Stocktaking' } } })
    expect(report.steps[0].excluded.map((e) => e.names[0])).toEqual(['Stocktaking', 'Labor Thanksgiving Day'])
    expect(report.steps[0].end).toBe('2026-11-25')
    expect(report.holidayGroups[0].holidays[0]).toMatchObject({ name: 'Stocktaking', custom: true })
  })
})

describe('English export text', () => {
  it('renders a professional forward e-mail', () => {
    const text = renderEmail(
      makeReport('forward', '2026-11-17'),
      options({ recipientName: 'Ms. Suda', senderName: 'Taro Yamada', companyName: 'ABC Trading Co., Ltd.', reference: 'PO-1234' }),
    )
    expect(text).toContain('Subject: Proposed Schedule – Estimated Delivery Mon, 14 Dec 2026 (Ref: PO-1234)')
    expect(text).toContain('Dear Ms. Suda,')
    expect(text).toContain('- Estimated delivery: Mon, 14 Dec 2026')
    expect(text).toContain('- Total lead time: 28 calendar days')
    expect(text).toContain('1. Procurement & Production\n   Tue, 17 Nov 2026 – Tue, 24 Nov 2026 (5 business days in Japan)')
    expect(text).toContain('   Excludes: Mon, 23 Nov 2026 – Labor Thanksgiving Day')
    expect(text).toContain('2. Ocean Freight & Customs Clearance\n   Wed, 25 Nov 2026 – Tue, 8 Dec 2026 (14 calendar days)')
    expect(text).toContain('Thailand:\n')
    expect(text).toContain('- Thu, 10 Dec 2026: Constitution Day')
    expect(text).toMatch(/- Sat, 5 Dec 2026: .+ \(falls on a weekend\)/)
    expect(text.endsWith('Best regards,\nTaro Yamada\nABC Trading Co., Ltd.')).toBe(true)
    expect(text).not.toContain('勤労感謝の日')
  })

  it('includes local holiday names on request and supports US date style', () => {
    const text = renderEmail(makeReport('forward', '2026-11-17'), options({ includeLocalNames: true, dateStyle: 'mdy' }))
    expect(text).toContain('Excludes: Mon, Nov 23, 2026 – Labor Thanksgiving Day (勤労感謝の日)')
    expect(text).toContain('Dear Sir or Madam,')
  })

  it('renders a backward e-mail with the order deadline', () => {
    const text = renderEmail(makeReport('backward', '2026-12-14'), options())
    expect(text).toContain('Subject: Order Deadline for Delivery by Mon, 14 Dec 2026')
    expect(text).toContain('- Order confirmation deadline: Tue, 17 Nov 2026 (Japan time)')
    expect(text).toContain('confirm your order no later than Tue, 17 Nov 2026 (Japan time).')
  })

  it('renders a compact WhatsApp message', () => {
    const text = renderWhatsApp(
      makeReport('forward', '2026-11-17', {}, 'all'),
      options({ format: 'whatsapp', holidayScope: 'all' }),
    )
    expect(text).toContain('*Proposed Schedule*')
    expect(text).toContain('📦 Estimated delivery: *Mon, 14 Dec 2026*')
    expect(text).toContain('1. Procurement & Production: 17 Nov – 24 Nov (5 business days in Japan)')
    expect(text).toContain('Japan: 23 Nov Labor Thanksgiving Day')
    expect(text).toContain('United States: 26 Nov Thanksgiving Day')
    // No flag emoji: Windows would render them as letters such as "JP".
    expect(text).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u)
  })

  it('omits the holiday section when requested', () => {
    const text = renderEmail(makeReport('forward', '2026-11-17', {}, 'none'), options({ holidayScope: 'none' }))
    expect(text).not.toContain('PUBLIC HOLIDAYS')
  })
})

describe('UAE schedule with corrected holidays', () => {
  it('skips the two-day National Day but not Commemoration Day or Fridays', () => {
    const countries = [resolveCountry('JP', undefined, true), resolveCountry('AE', undefined)]
    const calendars = buildCalendarMap(countries, {})
    const steps: Step[] = [{ id: 'd', name: 'Local Delivery', days: 3, calendar: 'AE' }]
    const schedule = computeSchedule({
      mode: 'forward',
      anchor: '2026-12-01',
      steps,
      resolveCalendar: makeCalendarResolver(calendars, 'JP'),
    })
    if (!schedule.ok) throw new Error(schedule.error)
    // Tue 1 Dec (working) → Wed/Thu National Day skipped → Fri 4 Dec (working) → weekend → Mon 7 Dec
    expect([schedule.start, schedule.end]).toEqual(['2026-12-01', '2026-12-07'])
    const report = buildScheduleReport({ schedule, countries, calendars, overrides: {}, holidayScope: 'relevant' })
    const text = renderEmail(report, options())
    expect(text).toContain('Excludes: Wed, 2 Dec 2026 – National Day; Thu, 3 Dec 2026 – National Day')
    expect(text).toContain('United Arab Emirates:\n- Wed, 2 Dec 2026 – Thu, 3 Dec 2026: National Day')
  })
})
