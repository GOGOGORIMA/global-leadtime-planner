import { describe, expect, it } from 'vitest'
import { CALENDAR_DAYS, type OverrideMap, type Step } from '../types'
import { buildCalendarMap, makeCalendarResolver, resolveCountry } from './calendars'
import { computeSchedule, type ScheduleMode } from './dateCalc'
import { getContainerSpec } from '../data/containers'
import { DEFAULT_QUOTE, SAMPLE_CARGO, createDefaultState, instantiateCargo } from '../state/defaults'
import { buildPackingSummary } from './binPacking'
import {
  DEFAULT_EXPORT_OPTIONS,
  renderEmail,
  renderExport,
  renderMeetingProposal,
  renderQuotationEmail,
  renderWhatsApp,
  type ExportOptions,
  type QuotationText,
} from './exportText'
import { buildQuotation } from './quotation'
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

describe('Meeting Proposal', () => {
  const jp = { code: 'JP', nameEn: 'Japan', timeZone: 'Asia/Tokyo', timeZoneAbbr: 'JST' }
  const th = { code: 'TH', nameEn: 'Thailand', timeZone: 'Asia/Bangkok', timeZoneAbbr: 'ICT' }
  const us = { code: 'US', nameEn: 'United States', timeZone: 'America/New_York', timeZoneAbbr: 'EST' }

  it('lists the proposed windows in both time zones', () => {
    const text = renderMeetingProposal(
      options({ format: 'meeting', recipientName: 'Ms. Suda', reference: 'PO-1234', senderName: 'Taro Yamada' }),
      {
        base: jp,
        others: [th],
        days: [{ date: '2026-11-18', intervals: [{ start: Date.UTC(2026, 10, 18, 2), end: Date.UTC(2026, 10, 18, 9) }] }],
      },
      makeReport('backward', '2026-12-14'),
    )
    expect(text).toContain('Subject: Meeting Request – Proposed Times (Ref: PO-1234)')
    expect(text).toContain('Dear Ms. Suda,')
    expect(text).toContain('1. Wed, 18 Nov 2026: 11:00–18:00 JST / 09:00–16:00 ICT')
    expect(text).toContain('the order would need to be confirmed by Tue, 17 Nov 2026 (Japan time).')
    expect(text.endsWith('Best regards,\nTaro Yamada')).toBe(true)
  })

  it('offers a call outside office hours when business hours never overlap', () => {
    const text = renderMeetingProposal(options({ format: 'meeting' }), {
      base: jp,
      others: [us],
      days: [],
      businessHours: { JP: '09:00–18:00', US: '09:00–18:00' },
    })
    expect(text).toContain('As our business hours do not overlap (Japan: 09:00–18:00 JST, United States: 09:00–18:00 EST)')
    expect(text).not.toContain('1. ')
  })
})

describe('Packing & Container Summary', () => {
  const packing = buildPackingSummary(instantiateCargo(SAMPLE_CARGO), getContainerSpec('20dc'))

  it('adds the packing section to the e-mail only when requested', () => {
    const report = makeReport('backward', '2026-12-14')
    expect(renderEmail(report, options(), undefined, packing)).not.toContain('PACKING & CONTAINER SUMMARY')
    const text = renderEmail(report, options({ includePacking: true }), undefined, packing)
    const section = text.slice(text.indexOf('PACKING & CONTAINER SUMMARY'), text.indexOf('Please note that'))
    expect(section.trim().split('\n')).toEqual([
      'PACKING & CONTAINER SUMMARY',
      '- Packages: 31 pcs (3 types)',
      '- Net cargo volume: 15.5 m³',
      '- Gross occupied volume (incl. cushioning): 15.5 m³',
      '- Total gross weight: 3,160 kg',
      '- Largest package: 2,200 × 1,500 × 1,800 mm (Case #1 Main Unit (Crate))',
      '- Non-stackable: 1 pc (no top load)',
      '- Cushioning / clearance: none',
      '- Recommended equipment (sea): 1 × 20ft Dry container',
      '- Recommended equipment (road): 1 × 4-ton truck (wide body)',
      '- Loading plan (20ft Dry container): all 31 pcs fit – 46.7% of volume (gross occupied), 13.2% of max. payload',
      'Package list:',
      '1. Case #1 Main Unit (Crate): 2,200 × 1,500 × 1,800 mm, 1,000 kg × 1 (non-stackable)',
      '2. Case #2 Accessories (Pallet): 1,100 × 1,100 × 1,000 mm, 300 kg × 6',
      '3. Case #3 Spare Parts (Carton): 600 × 400 × 400 mm, 15 kg × 24',
      'Note: the loading plan is an estimate based on the package dimensions and weights above.',
    ])
  })

  it('adds a short packing summary to WhatsApp', () => {
    const text = renderWhatsApp(makeReport('backward', '2026-12-14'), options({ format: 'whatsapp', includePacking: true }), undefined, packing)
    expect(text).toContain('*Packing summary*\n📦 31 pcs · 15.5 m³ · 3,160 kg\n🚢 Sea: 1 × 20ft Dry container\n🚚 Road: 1 × 4-ton truck (wide body)')
  })

  it('shows net and gross volumes and the cushioning used', () => {
    const cargo = instantiateCargo(SAMPLE_CARGO).map((c, i) => (i === 0 ? { ...c, margin: 100 } : c))
    const cushioned = buildPackingSummary(cargo, getContainerSpec('4t'), {
      sea: { gap: 0, wall: 0, stack: 0 },
      truck: { gap: 50, wall: 30, stack: 20 },
    })
    const report = makeReport('backward', '2026-12-14')
    const text = renderEmail(report, options({ includePacking: true }), undefined, cushioned)
    expect(text).toContain('- Net cargo volume: 15.5 m³')
    // crate (2,200 + 250) × (1,500 + 250) × (1,800 + 20) + 6 pallets 1,150² × 1,020 + 24 cartons 650 × 450 × 420
    const gross = 2.45 * 1.75 * 1.82 + 6 * 1.15 * 1.15 * 1.02 + 24 * 0.65 * 0.45 * 0.42
    expect(text).toContain(`- Gross occupied volume (incl. cushioning): ${gross.toFixed(1)} m³`)
    expect(text).toContain('- Cushioning / clearance: 50 mm between packages, 30 mm to the walls, 20 mm between tiers')
    // The container recommendation was planned without cushioning: no note. The truck one matches the plan.
    expect(text).toContain('- Recommended equipment (sea): 1 × 20ft Dry container\n')
    expect(text).toContain('1. Case #1 Main Unit (Crate): 2,200 × 1,500 × 1,800 mm, 1,000 kg × 1 (non-stackable, +100 mm cushioning)')
    const chat = renderWhatsApp(report, options({ format: 'whatsapp', includePacking: true }), undefined, cushioned)
    expect(chat).toContain(`📦 31 pcs · 15.5 m³ net / ${gross.toFixed(1)} m³ gross · 3,160 kg`)
    // Selected container without cushioning: the truck recommendation mentions its own cushioning.
    const sea = buildPackingSummary(cargo, getContainerSpec('20dc'), {
      sea: { gap: 0, wall: 0, stack: 0 },
      truck: { gap: 50, wall: 30, stack: 0 },
    })
    expect(renderEmail(report, options({ includePacking: true }), undefined, sea)).toContain(
      '- Recommended equipment (road): 1 × 4-ton truck (wide body), allowing 50 mm between packages, 30 mm to the walls',
    )
  })

  it('explains when standard equipment cannot carry a package', () => {
    const tall = buildPackingSummary(
      [{ id: 'x', name: 'Tall unit', length: 1200, width: 1000, height: 2600, weight: 900, quantity: 1, stackable: false, rotatable: true, color: '#6366f1', margin: 0 }],
      getContainerSpec('40hc'),
    )
    const text = renderEmail(makeReport('backward', '2026-12-14'), options({ includePacking: true }), undefined, tall)
    expect(text).toContain(
      '- Recommended equipment (sea): not possible in standard containers (a package exceeds the door height; special equipment such as open-top or flat-rack required)',
    )
    expect(text).toContain('- Recommended equipment (road): not possible by standard truck (a package exceeds the inside dimensions)')
    expect(text).toContain('- Loading plan (40ft High Cube container): 0 of 1 pc fit – the remaining 1 pc requires additional space')
  })
})

describe('Incoterms Price Quotation', () => {
  const cargo = instantiateCargo(SAMPLE_CARGO)
  const cushioning = createDefaultState('2026-11-18').cushioning
  // The loading simulator's sample shipment without export packing (FCL 20ft to Thailand).
  const quotation = (patch: Partial<typeof DEFAULT_QUOTE> = {}, destination = 'TH', destinationName = 'Thailand', port = ''): QuotationText => ({
    quote: buildQuotation(
      { ...DEFAULT_QUOTE, cargoMode: 'vanning', packingCost: false, ...patch },
      cargo,
      '20dc',
      cushioning,
      destination,
      '2026-11-18',
      port,
    ),
    destinationName,
  })

  it('renders a stand-alone quotation e-mail with prices, cargo, validity and the freight disclaimer', () => {
    const report = makeReport('backward', '2026-12-14')
    const text = renderQuotationEmail(options({ format: 'quote', reference: 'Q-2026-118', senderName: 'Taro Yamada' }), quotation(), report)
    const lines = text.split('\n')
    expect(lines[0]).toBe('Subject: Price Quotation – EXW / FOB / CIF / DDP (Ref: Q-2026-118)')
    expect(text).toContain(
      [
        'PRICE QUOTATION (USD)',
        '- EXW Japan (Ex Works): USD 34,364.26',
        '- FOB Japanese port (Free On Board): USD 35,465.98',
        '- CIF Laem Chabang, Thailand (Cost, Insurance and Freight): USD 36,983.77',
        '- DDP your premises, Thailand (Delivered Duty Paid): USD 39,348.43',
      ].join('\n'),
    )
    expect(text).not.toContain('DAP')
    expect(text).toContain('- Transport: Sea freight (FCL), 1 × 20ft Dry container, Japan → Thailand')
    expect(text).toContain('- Estimated Volume: 15.5 CBM / Gross Weight: 3,160 kg (31 packages)')
    expect(text).not.toContain('Export packing')
    expect(text).toContain('- Exchange rate basis: USD 1 = JPY 145.50')
    expect(text).toContain('- DDP includes import duty estimated at 5% of the CIF value')
    expect(text).toContain('VALIDITY\nThis quotation is valid until Wed, 2 Dec 2026.')
    expect(text).toContain('FREIGHT DISCLAIMER\nOcean / air freight rates and surcharges')
    expect(text).toContain('the CIF and DDP prices will be revised accordingly')
    expect(text).toContain('For reference, to meet your requested delivery date of')
    expect(lines.at(-1)).toBe('Taro Yamada')
    // The internal FX / freight buffers are never mentioned.
    expect(text).not.toMatch(/buffer|contingency|150\.00/i)
    expect(renderExport(report, options({ format: 'quote' }), undefined, null, quotation())).toBe(
      renderQuotationEmail(options({ format: 'quote' }), quotation(), report),
    )
  })

  it('describes LCL, air and JPY quotations and warns in volatile markets', () => {
    const lcl = renderQuotationEmail(options(), quotation({ cargoMode: 'direct', volume: 2.5, weight: 3160, mode: 'lcl', market: 'peak' }))
    expect(lcl).toContain('- Transport: Sea freight (LCL), 3.16 R/T (W/M), Japan → Thailand')
    expect(lcl).toContain('- Estimated Volume: 2.5 CBM / Gross Weight: 3,160 kg\n') // direct entry: no package count
    expect(lcl).toContain('FREIGHT DISCLAIMER\nFreight rates are currently at peak-season levels')
    const air = renderQuotationEmail(options(), quotation({ mode: 'air', market: 'surge' }, 'DE', 'Germany'))
    expect(air).toContain('- FOB Japanese airport (Free On Board)')
    expect(air).toContain('- CIF main airport, Germany (Cost, Insurance and Freight)')
    expect(air).toContain('- Transport: Air freight, chargeable weight 3,160 kg, Japan → Germany')
    expect(air).toContain('- For air freight, FOB / CIF correspond to FCA / CIP (Incoterms® 2020).')
    expect(air).toContain('Freight markets are currently highly volatile.')
    const yen = renderQuotationEmail(options(), quotation({ currency: 'JPY', fxRate: 1 }, 'KH', 'Cambodia'))
    expect(yen).toContain('- EXW Japan (Ex Works): JPY 5,000,000')
    expect(yen).toContain('- CIF main port, Cambodia')
    expect(yen).not.toContain('Exchange rate basis')
    // Size calculator with export packing: LCL by R/T and the packing note.
    const packed = renderQuotationEmail(options(), quotation({ cargoMode: 'simple', packingCost: true }, 'KR', 'South Korea'))
    expect(packed).toContain('- Transport: Sea freight (LCL), 7.26 R/T (W/M), Japan → South Korea')
    expect(packed).toContain('- Estimated Volume: 7.3 CBM / Gross Weight: 1,800 kg (6 packages)')
    expect(packed).toContain('- Export packing (crates / pallets) is included in the EXW price')
    expect(packed).toContain('- EXW Japan (Ex Works): USD 35,112.71')
    // Pallets add 15 % volume and 8 % weight: the gross weight is the packed weight.
    const pallets = renderQuotationEmail(options(), quotation({ cargoMode: 'simple', allowance: 'carton' }, 'KR', 'South Korea'))
    expect(pallets).toContain('- Estimated Volume: 8.3 CBM / Gross Weight: 1,944 kg (6 packages)')
    // The US port follows the chosen coast.
    const east = renderQuotationEmail(options(), quotation({ cargoMode: 'direct', volume: 20, weight: 4000 }, 'US', 'United States', 'east'))
    expect(east).toContain('- CIF New York / Savannah, United States (Cost, Insurance and Freight)')
  })

  it('inserts the quotation into the standard e-mail and WhatsApp only when requested', () => {
    const report = makeReport('backward', '2026-12-14')
    expect(renderEmail(report, options(), undefined, null, quotation())).not.toContain('INCOTERMS PRICE QUOTATION')
    const email = renderEmail(report, options({ includeQuote: true }), undefined, null, quotation())
    const section = email.slice(email.indexOf('INCOTERMS PRICE QUOTATION'), email.indexOf('Please note that'))
    expect(section.trim().split('\n').slice(0, 8)).toEqual([
      'INCOTERMS PRICE QUOTATION (USD, Incoterms® 2020)',
      '- EXW Japan: USD 34,364.26',
      '- FOB Japanese port: USD 35,465.98',
      '- CIF Laem Chabang, Thailand: USD 36,983.77',
      '- DDP your premises, Thailand: USD 39,348.43',
      '- Estimated Volume: 15.5 CBM / Gross Weight: 3,160 kg (31 packages)',
      '- Basis: Sea freight (FCL), 1 × 20ft Dry container; USD 1 = JPY 145.50',
      '- DDP includes import duty estimated at 5% of the CIF value',
    ])
    expect(section).toContain('- Valid until: Wed, 2 Dec 2026')
    expect(section).toContain('Freight disclaimer: ')
    const chat = renderWhatsApp(report, options({ format: 'whatsapp', includeQuote: true }), undefined, null, quotation())
    expect(chat).toContain(
      [
        '*Price quotation* (USD, Incoterms® 2020)',
        'EXW Japan: *USD 34,364.26*',
        'FOB Japanese port: *USD 35,465.98*',
        'CIF Laem Chabang, Thailand: *USD 36,983.77*',
        'DDP your premises, Thailand: *USD 39,348.43*',
        '📐 Estimated Volume: 15.5 CBM / Gross Weight: 3,160 kg',
        '🚢 FCL 1 × 20ft Dry',
        '⏳ Valid until 2 Dec 2026 – freight subject to change',
      ].join('\n'),
    )
  })
})
