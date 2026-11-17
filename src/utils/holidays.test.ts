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
import { buildCountryCalendar, resolveCountry } from './calendars'
import { getDayStatus } from './dateCalc'
import { getHolidayRegions, getHolidaysInRange, getHolidaysOn, getLocalHolidayLanguage, isBlockingHoliday } from './holidays'

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
    expect([...PRESET_PARTNER_COUNTRIES]).toEqual(['KR', 'TH', 'MY', 'VN', 'ID', 'KE', 'ZA', 'NG', 'US', 'DE', 'AE'])
    for (const code of [DEFAULT_BASE_COUNTRY, ...PRESET_PARTNER_COUNTRIES]) {
      const info = getCountryInfo(code)
      expect(info.hasHolidayData).toBe(true)
      expect(info.nameEn).not.toBe(code)
      expect(info.flag).toHaveLength(4) // two regional-indicator code points (surrogate pairs)
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
