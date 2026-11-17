/**
 * Local corrections applied on top of `date-holidays` for countries whose upstream rules differ
 * from the official public-holiday list.
 *
 * - Corrections are applied to each date-holidays instance of the country (also regional ones),
 *   see `getInstance()` in `utils/holidays.ts`. Other countries are never affected.
 * - Rules use the date-holidays grammar ("9 Dhu al-Hijjah", "12-02 P2D", …). `set` adds a rule or
 *   overwrites an existing one with the same key; `remove` deletes upstream rules.
 * - Holidays produced by a corrected rule are flagged `corrected: true` so the UI can say so.
 * - Every country entry must cite its legal source. Re-check when date-holidays is upgraded.
 */
import type { HolidaysTypes } from 'date-holidays'

export interface HolidayRuleDefinition {
  /** Rule in date-holidays grammar. */
  rule: string
  /** Names by language: `en` (used in e-mails) plus the local language for tooltips. */
  name: Readonly<Record<string, string>>
  type: HolidaysTypes.HolidayType
  /**
   * Drop the generated day when it falls on the same date as this other rule's holiday.
   * Needed for "30 Ramadan": date-holidays maps day 30 of a 29-day Ramadan onto 1 Shawwal.
   */
  onlyIfDistinctFrom?: string
}

export interface HolidayCorrection {
  /** Short Japanese summary for the UI. */
  note: string
  /** Legal source and where it was checked. */
  source: string
  sourceUrl: string
  /** Upstream rules to delete. */
  remove?: readonly string[]
  /** Rules to add, or to overwrite when the key already exists upstream. */
  set?: readonly HolidayRuleDefinition[]
}

export const HOLIDAY_CORRECTIONS: Readonly<Record<string, HolidayCorrection>> = {
  /**
   * United Arab Emirates — Cabinet Resolution No. 27 of 2024 (public and private sector):
   * New Year 1 Jan; Eid al-Fitr 1–3 Shawwal (+ 30 Ramadan when Ramadan has 30 days);
   * Arafat Day 9 Dhul Hijjah; Eid al-Adha 10–12 Dhul Hijjah; Hijri New Year 1 Muharram;
   * Prophet's Birthday 12 Rabi' al-Awwal; National Day 2–3 December.
   * Isra & Mi'raj has not been a public holiday since the 2019 unified list, and the first day of
   * Ramadan never was. Holidays the Cabinet moves to the start/end of a week (e.g. National Day
   * 2025 on 1–2 Dec) are announced each year and are not modelled here.
   */
  AE: {
    note: 'UAE 閣議決定 2024 年第 27 号の公式祝日一覧に合わせて補正',
    source: 'UAE Cabinet Resolution No. 27 of 2024 — u.ae "Public holidays" (checked 2026-11)',
    sourceUrl: 'https://u.ae/en/information-and-services/public-holidays-and-religious-affairs/public-holidays',
    remove: ['12-02'],
    set: [
      // Not days off under the official list: kept as information only.
      { rule: '27 Rajab', name: { en: 'Laylat al-Miʿraj', ar: 'الإسراء والمعراج' }, type: 'observance' },
      { rule: '1 Ramadan', name: { en: 'First day of Ramadan', ar: 'اليوم الأول من رمضان' }, type: 'observance' },
      // Eid al-Fitr starts on 30 Ramadan when the month has 30 days.
      {
        rule: '30 Ramadan',
        name: { en: 'Eid al-Fitr holiday (30 Ramadan)', ar: 'عطلة عيد الفطر (30 رمضان)' },
        type: 'public',
        onlyIfDistinctFrom: '1 Shawwal P3D',
      },
      { rule: '9 Dhu al-Hijjah', name: { en: 'Arafat Day', ar: 'يوم عرفة' }, type: 'public' },
      // National Day is two days (2–3 December); upstream has only 2 December.
      { rule: '12-02 P2D', name: { en: 'National Day', ar: 'اليوم الوطني' }, type: 'public' },
    ],
  },
}

export function getHolidayCorrection(code: string): HolidayCorrection | undefined {
  return HOLIDAY_CORRECTIONS[code]
}
