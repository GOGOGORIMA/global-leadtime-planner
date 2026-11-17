import { describe, expect, it } from 'vitest'
import {
  findCommonIntervals,
  findUpcomingMeetingDays,
  formatClock,
  formatInstantClock,
  formatUtcOffset,
  getBusinessSlots,
  getDayWindow,
  getTimeZoneAbbreviation,
  getTimeZoneOffset,
  getZonedDateTime,
  parseClock,
  todayInTimeZone,
  totalMinutes,
  zonedTimeToInstant,
  type Participant,
} from './timezone'

const H = 3_600_000
const allDays = () => true
const weekdays = (date: string) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())

const person = (timeZone: string, isWorkingDate: (d: string) => boolean = allDays): Participant => ({
  timeZone,
  workStart: 9 * 60,
  workEnd: 18 * 60,
  isWorkingDate,
})

describe('zone conversions', () => {
  it('reads wall-clock time and offsets', () => {
    const instant = Date.UTC(2026, 10, 17, 15, 30) // 2026-11-17 15:30Z
    expect(getZonedDateTime(instant, 'Asia/Tokyo')).toMatchObject({ date: '2026-11-18', hour: 0, minute: 30 })
    expect(getTimeZoneOffset(instant, 'Asia/Tokyo')).toBe(540)
    expect(getTimeZoneOffset(instant, 'Asia/Kolkata')).toBe(330)
    expect(getTimeZoneOffset(instant, 'America/New_York')).toBe(-300)
    expect(getTimeZoneOffset(Date.UTC(2026, 6, 1), 'America/New_York')).toBe(-240)
    expect(todayInTimeZone('Asia/Tokyo', instant)).toBe('2026-11-18')
    expect(todayInTimeZone('America/Los_Angeles', instant)).toBe('2026-11-17')
  })

  it('converts local wall time to instants, including DST change days', () => {
    expect(zonedTimeToInstant('2026-11-18', 9 * 60, 'Asia/Tokyo')).toBe(Date.UTC(2026, 10, 18, 0))
    // US spring forward (8 Mar 2026) and fall back (1 Nov 2026)
    expect(zonedTimeToInstant('2026-03-08', 9 * 60, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 13))
    expect(zonedTimeToInstant('2026-03-08', 60, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 6))
    expect(zonedTimeToInstant('2026-11-01', 9 * 60, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 14))
    const window = getDayWindow('2026-03-08', 'America/New_York')
    expect((window.end - window.start) / H).toBe(23)
  })

  it('formats offsets, clocks and abbreviations', () => {
    expect(formatUtcOffset(540)).toBe('UTC+9')
    expect(formatUtcOffset(330)).toBe('UTC+5:30')
    expect(formatUtcOffset(-300)).toBe('UTC-5')
    expect(formatClock(540)).toBe('09:00')
    expect(formatClock(1440)).toBe('24:00')
    expect(parseClock('8:30')).toBe(510)
    expect(parseClock('24:00')).toBe(1440)
    expect(parseClock('24:30')).toBeNull()
    expect(parseClock('9:75')).toBeNull()
    expect(formatInstantClock(Date.UTC(2026, 10, 17, 0, 5), 'Asia/Bangkok')).toBe('07:05')
    const winter = Date.UTC(2026, 0, 15)
    expect(getTimeZoneAbbreviation('Asia/Tokyo', winter)).toBe('JST')
    expect(getTimeZoneAbbreviation('America/New_York', winter)).toBe('EST')
    expect(getTimeZoneAbbreviation('America/New_York', Date.UTC(2026, 6, 15))).toBe('EDT')
    expect(getTimeZoneAbbreviation('Europe/Berlin', winter)).toBe('CET')
    expect(getTimeZoneAbbreviation('Asia/Shanghai', winter)).toBe('CST')
    expect(getTimeZoneAbbreviation('Asia/Taipei', winter)).toBe('CST')
    expect(getTimeZoneAbbreviation('Asia/Kolkata', winter)).toBe('IST')
    expect(getTimeZoneAbbreviation('Asia/Singapore', winter)).toBe('SGT')
    expect(getTimeZoneAbbreviation('Asia/Ho_Chi_Minh', winter)).toBe('ICT')
  })
})

describe('business-hour overlap', () => {
  const window = getDayWindow('2026-11-18', 'Asia/Tokyo') // Wednesday, JST day

  it('computes the JP–TH overlap (11:00–18:00 JST)', () => {
    const common = findCommonIntervals(window, [person('Asia/Tokyo'), person('Asia/Bangkok')])
    expect(common).toEqual([{ start: Date.UTC(2026, 10, 18, 2), end: Date.UTC(2026, 10, 18, 9) }])
    expect(totalMinutes(common)).toBe(7 * 60)
  })

  it('computes the JP–DE overlap in winter (17:00–18:00 JST)', () => {
    const common = findCommonIntervals(window, [person('Asia/Tokyo'), person('Europe/Berlin')])
    expect(common).toEqual([{ start: Date.UTC(2026, 10, 18, 8), end: Date.UTC(2026, 10, 18, 9) }])
  })

  it('handles the 30-minute offset of India (09:00–18:00 IST = 12:30–21:30 JST)', () => {
    const slots = getBusinessSlots(window, person('Asia/Kolkata'))
    expect(slots).toEqual([
      { start: Date.UTC(2026, 10, 18, 3, 30), end: Date.UTC(2026, 10, 18, 12, 30), localDate: '2026-11-18', working: true },
    ])
    const common = findCommonIntervals(window, [person('Asia/Tokyo'), person('Asia/Kolkata')])
    expect(common).toEqual([{ start: Date.UTC(2026, 10, 18, 3, 30), end: Date.UTC(2026, 10, 18, 9) }])
    expect(totalMinutes(common)).toBe(5.5 * 60)
    expect(formatInstantClock(window.start, 'Asia/Kolkata')).toBe('20:30')
  })

  it('computes the JP–TW overlap (Taiwan is one hour behind: 10:00–18:00 JST)', () => {
    const common = findCommonIntervals(window, [person('Asia/Tokyo'), person('Asia/Taipei')])
    expect(totalMinutes(common)).toBe(8 * 60)
  })

  it('finds no overlap between Tokyo and New York office hours', () => {
    expect(findCommonIntervals(window, [person('Asia/Tokyo'), person('America/New_York')])).toEqual([])
  })

  it('splits a partner day across two of their local dates and flags non-working ones', () => {
    // Base: New York, Wed 18 Nov. Tokyo's Thu 19 Nov business hours start 19:00 EST.
    const nyWindow = getDayWindow('2026-11-18', 'America/New_York')
    const slots = getBusinessSlots(nyWindow, person('Asia/Tokyo', (d) => d !== '2026-11-19'))
    expect(slots).toEqual([
      { start: nyWindow.start, end: Date.UTC(2026, 10, 18, 9), localDate: '2026-11-18', working: true },
      { start: Date.UTC(2026, 10, 19, 0), end: nyWindow.end, localDate: '2026-11-19', working: false },
    ])
  })

  it('finds the next shared meeting days, skipping weekends', () => {
    const days = findUpcomingMeetingDays('2026-11-20', 'Asia/Tokyo', [
      person('Asia/Tokyo', weekdays),
      person('Asia/Bangkok', weekdays),
    ])
    expect(days.map((d) => d.date)).toEqual(['2026-11-20', '2026-11-23', '2026-11-24'])
  })
})
