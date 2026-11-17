/**
 * Customer-facing English text (e-mail / WhatsApp) generated from a `ScheduleReport`.
 * Pure functions: same report + options → same text.
 */
import { yearOf, type ISODate } from './dateCalc'
import { formatEnglishDate, formatEnglishRange, type EnglishDateStyle } from './dateFormat'
import type { ReportCountry, ReportHoliday, ReportStep, ScheduleReport } from './report'
import { formatInstantClock, getTimeZoneAbbreviation } from './timezone'

/** Standard e-mail, WhatsApp / chat snippet, or a meeting proposal built from the business-hour overlap. */
export type ExportFormat = 'email' | 'whatsapp' | 'meeting'

export interface ExportOptions {
  format: ExportFormat
  recipientName: string
  senderName: string
  companyName: string
  reference: string
  dateStyle: EnglishDateStyle
  includeLocalNames: boolean
  holidayScope: 'relevant' | 'all' | 'none'
  includeMeeting: boolean
  /** Country of the recipient for meeting-time suggestions; '' = automatic. */
  recipientCountry: string
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'email',
  recipientName: '',
  senderName: '',
  companyName: '',
  reference: '',
  dateStyle: 'dmy',
  includeLocalNames: false,
  holidayScope: 'relevant',
  includeMeeting: false,
  recipientCountry: '',
}

export interface MeetingSuggestion {
  base: ReportCountry
  /** Other participants (usually the recipient's country). */
  others: ReportCountry[]
  days: Array<{ date: ISODate; intervals: Array<{ start: number; end: number }> }>
  /** Local business hours per country code, e.g. `09:00–18:00` (used when nothing overlaps). */
  businessHours?: Record<string, string>
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function stepDuration(step: ReportStep): string {
  return step.country
    ? `${plural(step.days, 'business day')} in ${step.country.nameEn}`
    : plural(step.days, 'calendar day')
}

function holidayLabel(name: string, localName: string | undefined, includeLocal: boolean): string {
  return includeLocal && localName ? `${name} (${localName})` : name
}

/** `11:00–18:00 JST / 21:00–04:00 EST`; the abbreviation follows each slot's own date (DST changes within the scan). */
function formatSlot(
  interval: { start: number; end: number },
  countries: readonly ReportCountry[],
): string {
  return countries
    .map(
      (c) =>
        `${formatInstantClock(interval.start, c.timeZone)}–${formatInstantClock(interval.end, c.timeZone)} ${getTimeZoneAbbreviation(c.timeZone, interval.start)}`,
    )
    .join(' / ')
}

function referenceSuffix(options: ExportOptions): string {
  return options.reference.trim() ? ` (Ref: ${options.reference.trim()})` : ''
}

function holidayRangeText(holiday: ReportHoliday, style: EnglishDateStyle, options: { year?: boolean } = {}): string {
  return formatEnglishRange(holiday.start, holiday.end, style, options)
}

export function renderEmail(report: ScheduleReport, options: ExportOptions, meeting?: MeetingSuggestion): string {
  const style = options.dateStyle
  const d = (date: ISODate) => formatEnglishDate(date, style)
  const lines: string[] = []
  const hasSteps = report.steps.length > 0
  const baseTime = `${report.base.nameEn} time`

  if (report.mode === 'forward') {
    lines.push(`Subject: Proposed Schedule – Estimated Delivery ${d(report.end)}${referenceSuffix(options)}`)
  } else {
    lines.push(`Subject: Order Deadline for Delivery by ${d(report.anchor)}${referenceSuffix(options)}`)
  }
  lines.push('')
  lines.push(`Dear ${options.recipientName.trim() || 'Sir or Madam'},`)
  lines.push('')

  if (report.mode === 'forward') {
    lines.push(
      'Thank you for your inquiry. Please find below our proposed schedule. Lead times have been calculated in working days, taking into account weekends and public holidays in each country involved.',
    )
  } else {
    lines.push(
      `Thank you for your inquiry. To meet your requested delivery date of ${d(report.anchor)}, please find below the required schedule. It has been calculated backwards from the delivery date, taking into account weekends and public holidays in each country involved.`,
    )
  }
  lines.push('')

  lines.push('KEY DATES')
  if (report.mode === 'forward') {
    lines.push(`- Order / start date: ${d(report.anchor)}`)
    if (report.startShifted) lines.push(`- Work commences: ${d(report.start)} (first working day)`)
    lines.push(`- Estimated delivery: ${d(report.end)}`)
  } else {
    lines.push(`- Requested delivery date: ${d(report.anchor)}`)
    lines.push(`- Order confirmation deadline: ${d(report.orderDeadline)} (${baseTime})`)
    if (report.bufferDays > 0) {
      lines.push(`- Planned completion: ${d(report.end)} (${plural(report.bufferDays, 'day')} ahead of the requested date)`)
    }
  }
  if (hasSteps) lines.push(`- Total lead time: ${plural(report.totalCalendarDays, 'calendar day')}`)
  lines.push('')

  if (report.mode === 'backward' && hasSteps) {
    lines.push(
      `To secure this delivery date, we kindly ask you to confirm your order no later than ${d(report.orderDeadline)} (${baseTime}).`,
    )
    lines.push('')
  }

  if (hasSteps) {
    lines.push('SCHEDULE BREAKDOWN')
    for (const step of report.steps) {
      lines.push(`${step.index}. ${step.name}`)
      lines.push(`   ${formatEnglishRange(step.start, step.end, style)} (${stepDuration(step)})`)
      if (step.excluded.length > 0) {
        const excluded = step.excluded
          .map((e) => {
            const name = e.names.join(' / ')
            const local = e.localNames.join(' / ')
            return `${d(e.date)} – ${holidayLabel(name, local || undefined, options.includeLocalNames)}`
          })
          .join('; ')
        lines.push(`   Excludes: ${excluded}`)
      }
    }
    lines.push('')
  }

  if (options.holidayScope !== 'none' && report.holidayGroups.length > 0) {
    lines.push('PUBLIC HOLIDAYS DURING THIS PERIOD')
    for (const group of report.holidayGroups) {
      lines.push(`${group.country.nameEn}:`)
      if (group.holidays.length === 0) lines.push('- No public holidays')
      for (const holiday of group.holidays) {
        const notes: string[] = []
        if (holiday.custom) notes.push('company holiday')
        if (holiday.bank) notes.push('bank holiday')
        if (holiday.onWeekend) notes.push('falls on a weekend')
        const label = holidayLabel(holiday.name, holiday.localName, options.includeLocalNames)
        lines.push(`- ${holidayRangeText(holiday, style)}: ${label}${notes.length ? ` (${notes.join(', ')})` : ''}`)
      }
    }
    lines.push('')
  }

  if (options.includeMeeting && meeting && meeting.days.length > 0) {
    const participants = [meeting.base, ...meeting.others]
    lines.push('AVAILABLE MEETING TIMES')
    lines.push('Should you wish to discuss the schedule, we are available at the following times:')
    for (const day of meeting.days) {
      lines.push(`- ${d(day.date)}: ${day.intervals.map((i) => formatSlot(i, participants)).join(', ')}`)
    }
    lines.push('')
  }

  lines.push(
    'Please note that this schedule is an estimate and may be subject to change due to factors such as vessel or flight availability, customs clearance and local conditions.',
  )
  lines.push('')
  lines.push('Should you have any questions, please do not hesitate to contact us.')
  lines.push('')
  lines.push('Best regards,')
  if (options.senderName.trim()) lines.push(options.senderName.trim())
  if (options.companyName.trim()) lines.push(options.companyName.trim())

  return lines.join('\n')
}

export function renderWhatsApp(report: ScheduleReport, options: ExportOptions, meeting?: MeetingSuggestion): string {
  const style = options.dateStyle
  const hasSteps = report.steps.length > 0
  const multiYear = hasSteps && yearOf(report.start) !== yearOf(report.end)
  const full = (date: ISODate) => formatEnglishDate(date, style)
  const short = (date: ISODate) => formatEnglishDate(date, style, { year: multiYear, weekday: false })
  const lines: string[] = []

  if (report.mode === 'forward') {
    lines.push(`*Proposed Schedule*${referenceSuffix(options)}`)
    lines.push(`📦 Estimated delivery: *${full(report.end)}*`)
    lines.push(`🗓 Start: ${full(report.start)}`)
  } else {
    lines.push(`*Order Deadline*${referenceSuffix(options)}`)
    lines.push(`To deliver by *${full(report.anchor)}*, please confirm your order by *${full(report.orderDeadline)}* (${report.base.nameEn} time).`)
  }
  if (hasSteps) lines.push(`⏱ Lead time: ${plural(report.totalCalendarDays, 'day')}`)

  if (hasSteps) {
    lines.push('')
    lines.push('*Schedule*')
    for (const step of report.steps) {
      const range = step.start === step.end ? short(step.start) : `${short(step.start)} – ${short(step.end)}`
      lines.push(`${step.index}. ${step.name}: ${range} (${stepDuration(step)})`)
    }
  }

  if (options.holidayScope !== 'none') {
    const groups = report.holidayGroups.filter((g) => g.holidays.length > 0)
    if (groups.length > 0) {
      lines.push('')
      lines.push('*Holidays considered*')
      for (const group of groups) {
        const items = group.holidays.map((h) => {
          const range = h.start === h.end ? short(h.start) : `${short(h.start)}–${short(h.end)}`
          const label = holidayLabel(h.name, h.localName, options.includeLocalNames)
          return `${range} ${label}${h.onWeekend ? ' (weekend)' : ''}`
        })
        lines.push(`${group.country.nameEn}: ${items.join(', ')}`)
      }
    }
  }

  if (options.includeMeeting && meeting && meeting.days.length > 0) {
    const participants = [meeting.base, ...meeting.others]
    lines.push('')
    lines.push('*Available for a call*')
    for (const day of meeting.days) {
      lines.push(`${formatEnglishDate(day.date, style, { year: false })}: ${day.intervals.map((i) => formatSlot(i, participants)).join(', ')}`)
    }
  }

  lines.push('')
  lines.push('_Estimate only – subject to change._')
  const signature = [options.senderName.trim(), options.companyName.trim()].filter(Boolean).join(', ')
  if (signature) lines.push(signature)
  return lines.join('\n')
}

/** Meeting request e-mail proposing the next times when both sides are within business hours. */
export function renderMeetingProposal(
  options: ExportOptions,
  meeting: MeetingSuggestion,
  report?: ScheduleReport | null,
): string {
  const style = options.dateStyle
  const d = (date: ISODate) => formatEnglishDate(date, style)
  const participants = [meeting.base, ...meeting.others]
  const lines: string[] = []
  lines.push(`Subject: Meeting Request – Proposed Times${referenceSuffix(options)}`)
  lines.push('')
  lines.push(`Dear ${options.recipientName.trim() || 'Sir or Madam'},`)
  lines.push('')

  if (meeting.days.length > 0) {
    lines.push(
      'I hope this message finds you well. We would like to arrange an online meeting to discuss the schedule. Taking our respective business hours into account, the following times would work on both sides:',
    )
    lines.push('')
    meeting.days.forEach((day, i) => {
      lines.push(`${i + 1}. ${d(day.date)}: ${day.intervals.map((interval) => formatSlot(interval, participants)).join(', ')}`)
    })
    lines.push('')
    lines.push(
      'Any 30–60 minute slot within these windows would suit us. Please let us know which time works best for you, or feel free to suggest an alternative.',
    )
  } else {
    const hours = participants
      .map((c) => `${c.nameEn}: ${meeting.businessHours?.[c.code] ?? '09:00–18:00'} ${c.timeZoneAbbr}`)
      .join(', ')
    lines.push(
      `I hope this message finds you well. We would like to arrange an online meeting to discuss the schedule. As our business hours do not overlap (${hours}), we would be happy to join a call outside our regular office hours. Please let us know a time that is convenient for you.`,
    )
  }

  if (report && report.steps.length > 0) {
    lines.push('')
    lines.push(
      report.mode === 'backward'
        ? `For reference, to meet your requested delivery date of ${d(report.anchor)}, the order would need to be confirmed by ${d(report.orderDeadline)} (${report.base.nameEn} time).`
        : `For reference, our current plan targets delivery on ${d(report.end)}.`,
    )
  }

  lines.push('')
  lines.push('We look forward to speaking with you.')
  lines.push('')
  lines.push('Best regards,')
  if (options.senderName.trim()) lines.push(options.senderName.trim())
  if (options.companyName.trim()) lines.push(options.companyName.trim())
  return lines.join('\n')
}

export function renderExport(report: ScheduleReport, options: ExportOptions, meeting?: MeetingSuggestion): string {
  if (options.format === 'meeting' && meeting) return renderMeetingProposal(options, meeting, report)
  return options.format === 'whatsapp' ? renderWhatsApp(report, options, meeting) : renderEmail(report, options, meeting)
}
