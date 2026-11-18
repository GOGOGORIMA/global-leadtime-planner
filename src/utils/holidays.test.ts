import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_COUNTRY,
  PRESET_PARTNER_COUNTRIES,
  getCountryCatalog,
  getCountryInfo,
  getDefaultTimeZone,
  getDefaultWeekend,
  getTimeZoneOptions,
} from '../data/countries'
import { getFlagUrl } from '../data/flags'
import { buildCountryCalendar, resolveCountry, toParticipant } from './calendars'
import { getDayStatus } from './dateCalc'
import { getHolidayRegions, getHolidaysInRange, getHolidaysOn, getLocalHolidayLanguage, isBlockingHoliday } from './holidays'
import { findCommonIntervals, getDayWindow, getTimeZoneAbbreviation, totalMinutes } from './timezone'

describe('holidays (date-holidays wrapper)', () => {
  it('returns English and local names for Japanese public holidays', () => {
    const [entry] = getHolidaysOn('JP', undefined, '2026-11-23')
    expect(entry).toMatchObject({ name: 'Labor Thanksgiving Day', localName: '勤労感謝の日', blocking: true })
    expect(getLocalHolidayLanguage('JP')).toBe('jp')
    expect(isBlockingHoliday('JP', undefined, '2026-11-24')).toBe(false)
  })

  it('treats substitute holidays as blocking', () => {
    const [entry] = getHolidaysOn('JP', undefined, '2026-05-06')
    expect(entry.substitute).toBe(true)
    expect(entry.blocking).toBe(true)
  })

  it('expands multi-day holidays (Korean Seollal, Vietnamese Tết) into each day', () => {
    for (const date of ['2026-02-16', '2026-02-17', '2026-02-18']) {
      expect(isBlockingHoliday('KR', undefined, date)).toBe(true)
    }
    expect(isBlockingHoliday('KR', undefined, '2026-02-19')).toBe(false)
    const tet = getHolidaysInRange('VN', undefined, '2026-02-14', '2026-02-22', { blockingOnly: true }).map((h) => h.date)
    expect(new Set(tet)).toEqual(new Set(['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20']))
  })

  it('does not block days for half-day holidays (German Christmas Eve from 14:00)', () => {
    const entries = getHolidaysOn('DE', undefined, '2026-12-24')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.partial && !e.blocking)).toBe(true)
    expect(isBlockingHoliday('DE', undefined, '2026-12-25')).toBe(true)
  })

  it('adds regional holidays when a state is selected', () => {
    // Epiphany (6 Jan) is a public holiday in Bavaria but not nationwide.
    expect(isBlockingHoliday('DE', undefined, '2026-01-06')).toBe(false)
    expect(isBlockingHoliday('DE', 'BY', '2026-01-06')).toBe(true)
    expect(getHolidayRegions('MY').some((r) => r.code === '10' && r.name === 'Selangor')).toBe(true)
  })

  it('matches holiday names in the local language by rule, not by index', () => {
    const songkran = getHolidaysOn('TH', undefined, '2026-04-13')
    expect(songkran[0].name).toBe('Songkran Festival')
    expect(songkran[0].localName).toBe('วันสงกรานต์')
  })

  it('handles countries without holiday data gracefully', () => {
    expect(getHolidaysOn('KH', undefined, '2026-04-14')).toEqual([])
    expect(getCountryInfo('KH').hasHolidayData).toBe(false)
  })
})

describe('country catalog', () => {
  it('contains the preset countries with names and flags', () => {
    const catalog = getCountryCatalog()
    expect(catalog.length).toBeGreaterThan(200)
    expect(DEFAULT_BASE_COUNTRY).toBe('JP')
    expect([...PRESET_PARTNER_COUNTRIES]).toEqual(['KR', 'CN', 'US', 'GB', 'DE', 'IN'])
    expect(PRESET_PARTNER_COUNTRIES.map((code) => getCountryInfo(code).nameJa)).toEqual([
      '韓国',
      '中国',
      'アメリカ',
      'イギリス',
      'ドイツ',
      'インド',
    ])
    expect(PRESET_PARTNER_COUNTRIES.map((code) => getDefaultTimeZone(code))).toEqual([
      'Asia/Seoul',
      'Asia/Shanghai',
      'America/New_York',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Kolkata',
    ])
    // The former presets stay in the catalog (addable from the search box).
    for (const code of ['TW', 'TH', 'MY', 'VN', 'SG']) expect(catalog.some((c) => c.code === code)).toBe(true)
    for (const code of [DEFAULT_BASE_COUNTRY, ...PRESET_PARTNER_COUNTRIES]) {
      const info = getCountryInfo(code)
      expect(info.hasHolidayData).toBe(true)
      expect(info.nameEn).not.toBe(code)
    }
    expect(getCountryInfo('KR').nameJa).toBe('韓国')
    expect(getCountryInfo('US').nameEn).toBe('United States')
    expect(getCountryInfo('AE').nameEn).toBe('United Arab Emirates')
  })

  it('models the UAE: Sat–Sun weekend (since 2022), Gulf time and multi-day Eid', () => {
    const ae = resolveCountry('AE', undefined)
    expect(ae.timeZone).toBe('Asia/Dubai')
    expect(ae.weekend).toEqual([0, 6])
    const calendar = buildCountryCalendar(ae, undefined)
    expect(getDayStatus('2026-11-20', calendar)).toBe('working') // Friday is a working day
    expect(getDayStatus('2026-11-21', calendar)).toBe('weekend')
    // Eid al-Fitr 2026: three days from 20 March (date-holidays' calculated dates)
    for (const date of ['2026-03-20', '2026-03-21', '2026-03-22']) expect(isBlockingHoliday('AE', undefined, date)).toBe(true)
    expect(isBlockingHoliday('AE', undefined, '2026-03-23')).toBe(false)
    expect(getHolidaysOn('AE', undefined, '2026-12-02')[0]).toMatchObject({ name: 'National Day', blocking: true })
    expect(getLocalHolidayLanguage('AE')).toBe('ar')
  })

  it('provides default time zones and weekends', () => {
    expect(getDefaultTimeZone('JP')).toBe('Asia/Tokyo')
    expect(getDefaultTimeZone('US')).toBe('America/New_York')
    expect(getDefaultTimeZone('US', 'CA')).toBe('America/Los_Angeles')
    expect(getTimeZoneOptions('ID')).toContain('Asia/Makassar')
    expect(getDefaultWeekend('JP')).toEqual([0, 6])
    expect(getDefaultWeekend('SA')).toEqual([5, 6])
    expect(getDefaultWeekend('MY')).toEqual([0, 6])
    expect(getDefaultWeekend('MY', '03')).toEqual([5, 6]) // Kelantan
  })

  it('builds working calendars from settings + holidays + overrides', () => {
    const jp = resolveCountry('JP', undefined, true)
    const calendar = buildCountryCalendar(jp, { '2026-11-24': { kind: 'off', label: 'Factory shutdown' } })
    expect(getDayStatus('2026-11-23', calendar)).toBe('holiday')
    expect(getDayStatus('2026-11-24', calendar)).toBe('custom-off')
    expect(getDayStatus('2026-11-25', calendar)).toBe('working')
    const saturdayShift = resolveCountry('JP', { weekend: [0] })
    expect(getDayStatus('2026-11-21', buildCountryCalendar(saturdayShift, undefined))).toBe('working')
  })
})

describe('holiday corrections — UAE (Cabinet Resolution No. 27 of 2024)', () => {
  const blocking = (date: string) => isBlockingHoliday('AE', undefined, date)
  const names = (date: string) => getHolidaysOn('AE', undefined, date).map((h) => h.name)

  it('keeps Isra & Miʿraj and the first day of Ramadan as information only', () => {
    expect(blocking('2026-01-16')).toBe(false)
    expect(getHolidaysOn('AE', undefined, '2026-01-16')[0]).toMatchObject({
      name: 'Laylat al-Miʿraj',
      type: 'observance',
      corrected: true,
    })
    expect(blocking('2026-02-18')).toBe(false)
    expect(names('2026-02-18')).toEqual(['First day of Ramadan'])
  })

  it('adds 30 Ramadan to Eid al-Fitr only when Ramadan has 30 days', () => {
    // 2026: 30-day Ramadan → 19–22 March, as announced for the federal government.
    expect(['2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23'].map(blocking)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ])
    expect(getHolidaysOn('AE', undefined, '2026-03-19')[0]).toMatchObject({
      name: 'Eid al-Fitr holiday (30 Ramadan)',
      localName: 'عطلة عيد الفطر (30 رمضان)',
      corrected: true,
    })
    // 2027: 29-day Ramadan → no extra day and no duplicate entry on 1 Shawwal.
    expect(blocking('2027-03-08')).toBe(false)
    expect(names('2027-03-09')).toEqual(['End of Ramadan (Eid al-Fitr)'])
  })

  it('adds Arafat Day and the second day of National Day; Commemoration Day is a working day', () => {
    expect(getHolidaysOn('AE', undefined, '2026-05-26')[0]).toMatchObject({
      name: 'Arafat Day',
      localName: 'يوم عرفة',
      blocking: true,
      corrected: true,
    })
    expect(['2026-05-27', '2026-05-28', '2026-05-29'].map(blocking)).toEqual([true, true, true])
    expect(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'].map(blocking)).toEqual([false, true, true, false])
    expect(names('2026-12-03')).toEqual(['National Day'])
  })

  it('does not touch other countries', () => {
    expect(getHolidaysOn('BH', undefined, '2026-05-26')[0]).toMatchObject({ name: 'Arafat Day', corrected: false })
    expect(getHolidaysInRange('SA', undefined, '2026-01-01', '2026-12-31').every((h) => !h.corrected)).toBe(true)
    expect(getHolidaysOn('JP', undefined, '2026-11-23')[0].corrected).toBe(false)
  })
})

describe('flags and names shown in the UI', () => {
  it('has a local SVG flag for every selectable country (no emoji, no CDN)', () => {
    const missing = getCountryCatalog().filter((c) => !getFlagUrl(c.code))
    expect(missing.map((c) => c.code)).toEqual([])
    expect(getFlagUrl('TW')).toMatch(/tw\.svg/)
  })

  it('has unique Japanese names, so dropdowns can show names without country codes', () => {
    const names = getCountryCatalog().map((c) => c.nameJa)
    expect(new Set(names).size).toBe(names.length)
    expect(getCountryCatalog().filter((c) => c.nameJa === c.code)).toEqual([])
  })
})

describe('Taiwan and India', () => {
  it('resolves Taiwan to Asia/Taipei (UTC+8) with Taiwanese holidays', () => {
    const tw = resolveCountry('TW', undefined)
    expect(tw.timeZone).toBe('Asia/Taipei')
    expect(tw.weekend).toEqual([0, 6])
    // Lunar New Year 2026: eve (16 Feb) to 20 Feb, plus the compensatory day date-holidays adds (21 Feb).
    for (const date of ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20']) {
      expect(isBlockingHoliday('TW', undefined, date)).toBe(true)
    }
    expect(getHolidaysOn('TW', undefined, '2026-10-10')[0]).toMatchObject({ name: 'National Day / Double Tenth Day', blocking: true })
    expect(getHolidaysOn('TW', undefined, '2026-04-06')[0]).toMatchObject({ substitute: true, blocking: true }) // Tomb Sweeping Day (Sun) → Mon
    expect(getLocalHolidayLanguage('TW')).toBe('zh')
  })

  it('resolves India to Asia/Kolkata (UTC+5:30) with national holidays', () => {
    const india = resolveCountry('IN', undefined)
    expect(india.timeZone).toBe('Asia/Kolkata')
    expect(india.weekend).toEqual([0, 6])
    expect(getHolidaysOn('IN', undefined, '2026-01-26')[0]).toMatchObject({ name: 'Republic Day', blocking: true })
    expect(isBlockingHoliday('IN', undefined, '2026-08-15')).toBe(true) // Independence Day
    expect(isBlockingHoliday('IN', undefined, '2026-10-02')).toBe(true) // Gandhi Jayanti
    expect(isBlockingHoliday('IN', undefined, '2026-10-05')).toBe(false)
  })
})

describe('United Kingdom and Germany', () => {
  it('shows the United Kingdom as イギリス and uses the Bank Holidays of England by default', () => {
    expect(getCountryInfo('GB')).toMatchObject({ nameJa: 'イギリス', nameEn: 'United Kingdom' })
    const gb = resolveCountry('GB', undefined)
    expect(gb).toMatchObject({ timeZone: 'Europe/London', region: 'ENG', regionName: 'England', weekend: [0, 6] })
    const calendar = buildCountryCalendar(gb, undefined)
    expect(getDayStatus('2026-04-06', calendar)).toBe('holiday') // Easter Monday
    expect(getDayStatus('2026-08-31', calendar)).toBe('holiday') // Summer bank holiday (England & Wales)
    expect(getDayStatus('2026-12-28', calendar)).toBe('holiday') // Boxing Day (substitute day)
    expect(getDayStatus('2026-08-03', calendar)).toBe('working')
    // Another nation can still be chosen: Scotland's summer bank holiday is the first Monday of August.
    const scotland = buildCountryCalendar(resolveCountry('GB', { region: 'SCT' }), undefined)
    expect(getDayStatus('2026-08-03', scotland)).toBe('holiday')
    expect(getDayStatus('2026-08-31', scotland)).toBe('working')
  })

  it('blocks German national holidays but not the half-day Christmas Eve', () => {
    const de = resolveCountry('DE', undefined)
    expect(de).toMatchObject({ timeZone: 'Europe/Berlin', region: undefined })
    const calendar = buildCountryCalendar(de, undefined)
    for (const date of ['2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-12-25']) {
      expect(getDayStatus(date, calendar), date).toBe('holiday')
    }
    expect(getDayStatus('2026-12-24', calendar)).toBe('working')
  })

  it('labels the preset time zones with their DST abbreviations and overlaps with Japan', () => {
    const jan = Date.UTC(2026, 0, 14, 12)
    const jul = Date.UTC(2026, 6, 15, 12)
    const labels = (tz: string) => [getTimeZoneAbbreviation(tz, jan), getTimeZoneAbbreviation(tz, jul)]
    expect(labels('Europe/London')).toEqual(['GMT', 'BST'])
    expect(labels('Europe/Berlin')).toEqual(['CET', 'CEST'])
    expect(labels('America/New_York')).toEqual(['EST', 'EDT'])
    expect(labels('Asia/Kolkata')).toEqual(['IST', 'IST'])
    const jp = resolveCountry('JP', undefined, true)
    const overlap = (code: string, date: string) => {
      const partner = resolveCountry(code, undefined)
      const participants = [jp, partner].map((c) => toParticipant(c, buildCountryCalendar(c, undefined)))
      return totalMinutes(findCommonIntervals(getDayWindow(date, jp.timeZone), participants))
    }
    // 09:00–18:00 each: London overlaps only under BST, Berlin 1 h (CET) / 2 h (CEST), India 5.5 h.
    expect([overlap('GB', '2026-01-14'), overlap('GB', '2026-07-15')]).toEqual([0, 60])
    expect([overlap('DE', '2026-01-14'), overlap('DE', '2026-07-15')]).toEqual([60, 120])
    expect(overlap('IN', '2026-01-14')).toBe(330)
  })
})
