/**
 * Customer-facing English text (e-mail / WhatsApp) generated from a `ScheduleReport`.
 * Pure functions: same report + options → same text.
 */
import { hasClearance, type CategorySuggestion, type Clearance, type PackingSummary } from './binPacking'
import { yearOf, type ISODate } from './dateCalc'
import { formatEnglishDate, formatEnglishRange, type EnglishDateStyle } from './dateFormat'
import type { QuoteResult } from './quotation'
import type { ReportCountry, ReportHoliday, ReportStep, ScheduleReport } from './report'
import { formatInstantClock, getTimeZoneAbbreviation } from './timezone'

/**
 * Standard e-mail, WhatsApp / chat snippet, a meeting proposal built from the business-hour
 * overlap, or the Incoterms price quotation of tab ⑥.
 */
export type ExportFormat = 'email' | 'whatsapp' | 'meeting' | 'quote'

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
  /** Append the "Packing & Container Summary" from the loading simulator (tab ⑤). */
  includePacking: boolean
  /** Append the "Incoterms Price Quotation" from the quotation board (tab ⑥). */
  includeQuote: boolean
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
  includePacking: false,
  includeQuote: false,
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

const formatKg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
const formatMm = (n: number) => Math.round(n).toLocaleString('en-US')
const formatPercent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`
const pieces = (n: number) => `${n.toLocaleString('en-US')} pc${n === 1 ? '' : 's'}`
const sizeText = (x: { length: number; width: number; height: number }) =>
  `${formatMm(x.length)} × ${formatMm(x.width)} × ${formatMm(x.height)} mm`

/** `1 × 20ft Dry container`, or why no standard size of this category works. */
function equipmentText(suggestion: CategorySuggestion): string {
  const best = suggestion.best
  if (best?.units) return `${best.units} × ${best.spec.nameEn}`
  const largest = suggestion.plans[suggestion.plans.length - 1]
  const why =
    largest?.blocked === 'door'
      ? 'a package exceeds the door height'
      : largest?.blocked === 'weight'
        ? 'a package exceeds the maximum payload'
        : 'a package exceeds the inside dimensions'
  return suggestion.category === 'sea'
    ? `not possible in standard containers (${why}; special equipment such as open-top or flat-rack required)`
    : `not possible by standard truck (${why})`
}

/** `50 mm between packages, 30 mm to the walls, 20 mm between tiers` (or `none`). */
function clearanceText(clearance: Clearance): string {
  const parts: string[] = []
  if (clearance.gap > 0) parts.push(`${formatMm(clearance.gap)} mm between packages`)
  if (clearance.wall > 0) parts.push(`${formatMm(clearance.wall)} mm to the walls`)
  if (clearance.stack > 0) parts.push(`${formatMm(clearance.stack)} mm between tiers`)
  return parts.length ? parts.join(', ') : 'none'
}

const sameClearance = (a: Clearance, b: Clearance) => a.gap === b.gap && a.wall === b.wall && a.stack === b.stack

/** "PACKING & CONTAINER SUMMARY" block of the e-mail (loading simulator, tab ⑤). */
export function renderPackingSection(packing: PackingSummary): string[] {
  const lines: string[] = ['PACKING & CONTAINER SUMMARY']
  if (packing.pieces === 0) {
    lines.push('- No packages entered yet.')
    return lines
  }
  const plan = packing.selected
  const used = plan.clearance
  lines.push(`- Packages: ${pieces(packing.pieces)} (${packing.types} type${packing.types === 1 ? '' : 's'})`)
  lines.push(`- Net cargo volume: ${packing.totalVolume.toFixed(1)} m³`)
  lines.push(`- Gross occupied volume (incl. cushioning): ${packing.grossVolume.toFixed(1)} m³`)
  lines.push(`- Total gross weight: ${formatKg(packing.totalWeight)} kg`)
  if (packing.largest) lines.push(`- Largest package: ${sizeText(packing.largest)} (${packing.largest.name})`)
  if (packing.nonStackablePieces > 0) lines.push(`- Non-stackable: ${pieces(packing.nonStackablePieces)} (no top load)`)
  lines.push(`- Cushioning / clearance: ${clearanceText(used)}`)
  // A recommendation planned with other cushioning than the loading plan says so.
  const recommendation = (suggestion: CategorySuggestion) => {
    const own = packing.clearance[suggestion.category]
    const note = !sameClearance(own, used) && hasClearance(own) && suggestion.best ? `, allowing ${clearanceText(own)}` : ''
    return `${equipmentText(suggestion)}${note}`
  }
  lines.push(`- Recommended equipment (sea): ${recommendation(packing.sea)}`)
  lines.push(`- Recommended equipment (road): ${recommendation(packing.truck)}`)
  const name = plan.spec.nameEn
  lines.push(
    plan.loadedPieces === plan.totalPieces
      ? `- Loading plan (${name}): all ${pieces(plan.totalPieces)} fit – ${formatPercent(plan.grossVolumeRatio)} of volume (gross occupied), ${formatPercent(plan.weightRatio)} of max. payload`
      : `- Loading plan (${name}): ${plan.loadedPieces} of ${pieces(plan.totalPieces)} fit – the remaining ${pieces(plan.totalPieces - plan.loadedPieces)} require${plan.totalPieces - plan.loadedPieces === 1 ? 's' : ''} additional space`,
  )
  lines.push('Package list:')
  packing.items.forEach((item, i) => {
    const notes = [
      ...(item.stackable ? [] : ['non-stackable']),
      ...(item.margin > 0 ? [`+${formatMm(item.margin)} mm cushioning`] : []),
    ]
    lines.push(
      `${i + 1}. ${item.name}: ${sizeText(item)}, ${formatKg(item.weight)} kg × ${item.quantity}${notes.length ? ` (${notes.join(', ')})` : ''}`,
    )
  })
  lines.push('Note: the loading plan is an estimate based on the package dimensions and weights above.')
  return lines
}

/** Quotation of tab ⑥ plus the destination's English name (for the named places). */
export interface QuotationText {
  quote: QuoteResult
  destinationName: string
}

/** `USD 34,364.26` / `JPY 5,000,000`. */
export function formatMoney(amount: number, currency: string, decimals: number): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

const formatM3 = (m3: number) => m3.toFixed(m3 < 10 ? 2 : 1)

/** Incoterms quoted in the English text (DAP is shown on the board only). */
const QUOTED_TERMS = ['EXW', 'FOB', 'CIF', 'DDP'] as const

/** `CIF Laem Chabang, Thailand` etc. (Incoterms® 2020 named places). */
function namedPlace(term: (typeof QUOTED_TERMS)[number], q: QuotationText): string {
  const isAir = q.quote.freight.basis.unit === 'kg'
  const name = q.destinationName
  switch (term) {
    case 'EXW':
      return 'EXW Japan'
    case 'FOB':
      return isAir ? 'FOB Japanese airport' : 'FOB Japanese port'
    case 'CIF':
      if (isAir) return `CIF main airport, ${name}`
      return `CIF ${q.quote.lane.port ?? 'main port'}, ${name}`
    case 'DDP':
      return `DDP your premises, ${name}`
  }
}

const TERM_NAMES_EN = {
  EXW: 'Ex Works',
  FOB: 'Free On Board',
  CIF: 'Cost, Insurance and Freight',
  DDP: 'Delivered Duty Paid',
} as const

/** `Sea freight (FCL), 1 × 20ft Dry container` / `Sea freight (LCL), 15.5 R/T (W/M)` / `Air freight, chargeable weight 3,160 kg`. */
function transportText(q: QuoteResult): string {
  switch (q.freight.basis.unit) {
    case 'container':
      return `Sea freight (FCL), ${q.container.units} × ${q.container.spec.nameEn}`
    case 'rt':
      return `Sea freight (LCL), ${q.revenueTons.toFixed(2)} R/T (W/M)`
    case 'kg':
      return `Air freight, chargeable weight ${formatKg(Math.ceil(q.chargeableKg))} kg`
  }
}

/** `31 packages, 15.5 m³ (net volume), 3,160 kg (gross weight)`; the package count only for linked cargo. */
function cargoText(q: QuoteResult): string {
  const count =
    q.volumeLinked && q.weightLinked && q.pieces > 0
      ? `${q.pieces.toLocaleString('en-US')} package${q.pieces === 1 ? '' : 's'}, `
      : ''
  return `${count}${formatM3(q.volume)} m³ (net volume), ${formatKg(q.weight)} kg (gross weight)`
}

function exchangeRateText(q: QuoteResult): string | null {
  return q.currency === 'JPY' ? null : `${q.currency} 1 = JPY ${q.appliedRate.toFixed(2)}`
}

/** Freight disclaimer; firmer wording when the market is at peak / surge levels. */
function freightDisclaimer(q: QuoteResult): string {
  const market =
    q.marketFactor >= 2.5
      ? 'Freight markets are currently highly volatile. '
      : q.marketFactor > 1
        ? 'Freight rates are currently at peak-season levels and may change at short notice. '
        : ''
  return `${market}Ocean / air freight rates and surcharges (such as GRI, PSS, bunker / fuel and currency adjustment factors) are set by the carriers and may change without notice. The freight included in the CIF and DDP prices is based on current market levels and space availability; should the actual freight at the time of booking differ, the CIF and DDP prices will be revised accordingly. Import VAT / GST, inspection, storage and demurrage charges are not included.`
}

function priceLines(q: QuotationText, withTermNames: boolean): string[] {
  const { quote } = q
  return QUOTED_TERMS.map((term) => {
    const price = formatMoney(quote.prices[term].quote, quote.currency, quote.decimals)
    return `- ${namedPlace(term, q)}${withTermNames ? ` (${TERM_NAMES_EN[term]})` : ''}: ${price}`
  })
}

/** "INCOTERMS PRICE QUOTATION" block appended to the standard e-mail. */
export function renderQuotationSection(q: QuotationText, style: EnglishDateStyle): string[] {
  const { quote } = q
  const basis = [transportText(quote), `${formatM3(quote.volume)} m³ (net) / ${formatKg(quote.weight)} kg (gross)`]
  const rate = exchangeRateText(quote)
  if (rate) basis.push(rate)
  return [
    `INCOTERMS PRICE QUOTATION (${quote.currency}, Incoterms® 2020)`,
    ...priceLines(q, false),
    `- Basis: ${basis.join('; ')}`,
    `- DDP includes import duty estimated at ${formatPercentValue(quote.dutyRate)} of the CIF value`,
    `- Valid until: ${formatEnglishDate(quote.validUntil, style)}`,
    `Freight disclaimer: ${freightDisclaimer(quote)}`,
  ]
}

/** `5%`, `2.5%`, `0.25%`. */
const formatPercentValue = (percent: number) => `${Number(percent.toFixed(2))}%`

/** Stand-alone "Price Quotation" e-mail (export format `quote`). */
export function renderQuotationEmail(options: ExportOptions, q: QuotationText, report?: ScheduleReport | null): string {
  const style = options.dateStyle
  const d = (date: ISODate) => formatEnglishDate(date, style)
  const { quote } = q
  const lines: string[] = []
  lines.push(`Subject: Price Quotation – EXW / FOB / CIF / DDP${referenceSuffix(options)}`)
  lines.push('')
  lines.push(`Dear ${options.recipientName.trim() || 'Sir or Madam'},`)
  lines.push('')
  lines.push('Thank you for your inquiry. We are pleased to submit our quotation as follows (Incoterms® 2020):')
  lines.push('')
  lines.push(`PRICE QUOTATION (${quote.currency})`)
  lines.push(...priceLines(q, true))
  lines.push('')
  lines.push('SHIPMENT BASIS')
  lines.push(`- Transport: ${transportText(quote)}, Japan → ${q.destinationName}`)
  if (quote.freight.basis.unit === 'kg') lines.push('- For air freight, FOB / CIF correspond to FCA / CIP (Incoterms® 2020).')
  lines.push(`- Cargo: ${cargoText(quote)}`)
  const rate = exchangeRateText(quote)
  if (rate) lines.push(`- Exchange rate basis: ${rate}`)
  lines.push('- Marine insurance: 110% of the CIF value (CIF and DDP)')
  lines.push(`- DDP includes import duty estimated at ${formatPercentValue(quote.dutyRate)} of the CIF value`)
  lines.push('')
  lines.push('VALIDITY')
  lines.push(`This quotation is valid until ${d(quote.validUntil)}.`)
  lines.push('')
  lines.push('FREIGHT DISCLAIMER')
  lines.push(freightDisclaimer(quote))
  if (report && report.steps.length > 0) {
    lines.push('')
    lines.push(
      report.mode === 'backward'
        ? `For reference, to meet your requested delivery date of ${d(report.anchor)}, the order would need to be confirmed by ${d(report.orderDeadline)} (${report.base.nameEn} time).`
        : `For reference, our current plan targets delivery on ${d(report.end)}.`,
    )
  }
  lines.push('')
  lines.push('Should you have any questions, please do not hesitate to contact us.')
  lines.push('')
  lines.push('Best regards,')
  if (options.senderName.trim()) lines.push(options.senderName.trim())
  if (options.companyName.trim()) lines.push(options.companyName.trim())
  return lines.join('\n')
}

/** Short quotation block for WhatsApp / chat. */
function renderQuotationChat(q: QuotationText, style: EnglishDateStyle): string[] {
  const { quote } = q
  const icon = quote.freight.basis.unit === 'kg' ? '✈️' : '🚢'
  const mode =
    quote.freight.basis.unit === 'container'
      ? `FCL ${quote.container.units} × ${quote.container.spec.label}`
      : quote.freight.basis.unit === 'rt'
        ? `LCL ${quote.revenueTons.toFixed(2)} R/T`
        : `Air ${formatKg(Math.ceil(quote.chargeableKg))} kg chargeable`
  return [
    `*Price quotation* (${quote.currency}, Incoterms® 2020)`,
    ...QUOTED_TERMS.map((term) => `${namedPlace(term, q)}: *${formatMoney(quote.prices[term].quote, quote.currency, quote.decimals)}*`),
    `${icon} ${mode} · ${formatM3(quote.volume)} m³ · ${formatKg(quote.weight)} kg`,
    `⏳ Valid until ${formatEnglishDate(quote.validUntil, style, { weekday: false })} – freight subject to change`,
  ]
}

export function renderEmail(
  report: ScheduleReport,
  options: ExportOptions,
  meeting?: MeetingSuggestion,
  packing?: PackingSummary | null,
  quotation?: QuotationText | null,
): string {
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

  if (options.includePacking && packing) {
    lines.push(...renderPackingSection(packing))
    lines.push('')
  }

  if (options.includeQuote && quotation) {
    lines.push(...renderQuotationSection(quotation, style))
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

export function renderWhatsApp(
  report: ScheduleReport,
  options: ExportOptions,
  meeting?: MeetingSuggestion,
  packing?: PackingSummary | null,
  quotation?: QuotationText | null,
): string {
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

  if (options.includePacking && packing && packing.pieces > 0) {
    lines.push('')
    lines.push('*Packing summary*')
    const gross = packing.grossVolume - packing.totalVolume > 0.05 ? ` net / ${packing.grossVolume.toFixed(1)} m³ gross` : ''
    lines.push(`📦 ${pieces(packing.pieces)} · ${packing.totalVolume.toFixed(1)} m³${gross} · ${formatKg(packing.totalWeight)} kg`)
    lines.push(`🚢 Sea: ${equipmentText(packing.sea)}`)
    lines.push(`🚚 Road: ${equipmentText(packing.truck)}`)
  }

  if (options.includeQuote && quotation) {
    lines.push('')
    lines.push(...renderQuotationChat(quotation, style))
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

export function renderExport(
  report: ScheduleReport,
  options: ExportOptions,
  meeting?: MeetingSuggestion,
  packing?: PackingSummary | null,
  quotation?: QuotationText | null,
): string {
  if (options.format === 'meeting' && meeting) return renderMeetingProposal(options, meeting, report)
  if (options.format === 'quote' && quotation) return renderQuotationEmail(options, quotation, report)
  return options.format === 'whatsapp'
    ? renderWhatsApp(report, options, meeting, packing, quotation)
    : renderEmail(report, options, meeting, packing, quotation)
}
