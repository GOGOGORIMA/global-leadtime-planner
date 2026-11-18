import { ArrowRight, CalendarClock, Check, Copy, ExternalLink, Mail, MessageCircle, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { getContainerSpec, type ContainerCategory, type ContainerId } from '../data/containers'
import type { CargoItem, CushionSettings } from '../types'
import { buildPackingSummary, toClearance } from '../utils/binPacking'
import type { ResolvedCountry } from '../utils/calendars'
import { toParticipant } from '../utils/calendars'
import { copyToClipboard } from '../utils/clipboard'
import { ALL_DAYS_CALENDAR, addDays, maxISODate, type ISODate, type WorkCalendar } from '../utils/dateCalc'
import { formatJaDate } from '../utils/dateFormat'
import {
  renderEmail,
  renderMeetingProposal,
  renderWhatsApp,
  type ExportFormat,
  type ExportOptions,
  type MeetingSuggestion,
} from '../utils/exportText'
import { toReportCountry, type ScheduleReport } from '../utils/report'
import { findUpcomingMeetingDays, formatClock } from '../utils/timezone'
import { btn, cx, focusRing, inputClass, labelClass } from './classes'
import { CountryFlag } from './CountryFlag'
import { Card } from './ui'

interface ExportPanelProps {
  report: ScheduleReport | null
  countries: readonly ResolvedCountry[]
  calendars: ReadonlyMap<string, WorkCalendar>
  recipientCountry: string
  today: ISODate
  /** Date picked in the meeting tab (`null` = today). Meeting proposals start there when it is after today. */
  meetingDate: ISODate | null
  /** Loading simulator data (tab ⑤) for the optional Packing & Container Summary. */
  cargo: readonly CargoItem[]
  container: ContainerId
  cushioning: Record<ContainerCategory, CushionSettings>
  options: ExportOptions
  onOptionsChange: (patch: Partial<ExportOptions>) => void
  /** Opens the meeting tab (会議可能時間帯). */
  onShowMeeting: () => void
  /** Opens the loading simulator tab (積載3D). */
  onShowVanning: () => void
}

const FORMATS: ReadonlyArray<{ value: ExportFormat; label: string; description: string; icon: LucideIcon }> = [
  { value: 'email', label: 'Standard Email', description: '納期回答メール（工程の日程・除外した祝日・関係国の祝日）', icon: Mail },
  { value: 'whatsapp', label: 'WhatsApp / Chat', description: 'チャット向けの短い要約（太字・箇条書き）', icon: MessageCircle },
  { value: 'meeting', label: 'Meeting Proposal', description: '営業時間の重なりから会議の候補日時を打診', icon: CalendarClock },
]

const MEETING_CANDIDATES = 3

function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-indigo-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

function FormatPicker({ value, onChange }: { value: ExportFormat; onChange: (format: ExportFormat) => void }) {
  return (
    <div role="radiogroup" aria-label="出力形式" className="grid grid-cols-3 gap-2">
      {FORMATS.map(({ value: format, label, description, icon: Icon }) => {
        const active = format === value
        return (
          <button
            key={format}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(format)}
            className={cx(
              'flex min-w-0 items-start gap-2.5 rounded-xl border p-3 text-left transition',
              focusRing,
              active
                ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            <span
              className={cx(
                'hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg @2xl:flex',
                active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500',
              )}
            >
              <Icon size={16} />
            </span>
            <span className="min-w-0">
              <span className={cx('block text-sm font-semibold', active ? 'text-indigo-900' : 'text-slate-800')}>{label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ExportPanel({
  report,
  countries,
  calendars,
  recipientCountry,
  today,
  meetingDate,
  cargo,
  container,
  cushioning,
  options,
  onOptionsChange,
  onShowMeeting,
  onShowVanning,
}: ExportPanelProps) {
  const [copied, setCopied] = useState(false)
  const base = countries[0]
  const recipient = countries.find((c) => c.code === recipientCountry)
  const partner = recipient && !recipient.isBase ? recipient : undefined
  const format: ExportFormat = FORMATS.some((f) => f.value === options.format) ? options.format : 'email'
  const isMeeting = format === 'meeting'

  // Proposals start tomorrow (base time) so the recipient has time to reply; the meeting proposal
  // starts at the date picked in the meeting tab instead when that is later.
  const tomorrow = addDays(today, 1)
  const meetingFrom = isMeeting && meetingDate ? maxISODate(tomorrow, meetingDate) : tomorrow
  const wantsMeeting = isMeeting || options.includeMeeting

  const meeting = useMemo<MeetingSuggestion | undefined>(() => {
    if (!wantsMeeting || !partner) return undefined
    const pair = [base, partner]
    const participants = pair.map((c) => toParticipant(c, calendars.get(c.code) ?? ALL_DAYS_CALENDAR))
    return {
      base: toReportCountry(base, meetingFrom),
      others: [toReportCountry(partner, meetingFrom)],
      days: findUpcomingMeetingDays(meetingFrom, base.timeZone, participants, { count: MEETING_CANDIDATES }),
      businessHours: Object.fromEntries(pair.map((c) => [c.code, `${formatClock(c.workStart)}–${formatClock(c.workEnd)}`])),
    }
  }, [wantsMeeting, partner, base, calendars, meetingFrom])

  // Packing & Container Summary (tab ⑤) — only computed when it is switched on.
  const packing = useMemo(
    () =>
      options.includePacking && !isMeeting
        ? buildPackingSummary(cargo, getContainerSpec(container), {
            sea: toClearance(cushioning.sea),
            truck: toClearance(cushioning.truck),
          })
        : null,
    [options.includePacking, isMeeting, cargo, container, cushioning],
  )

  const text = useMemo(() => {
    const exportOptions = { ...options, format }
    if (format === 'meeting') return meeting ? renderMeetingProposal(exportOptions, meeting, report) : ''
    if (!report) return ''
    return format === 'whatsapp'
      ? renderWhatsApp(report, exportOptions, meeting, packing)
      : renderEmail(report, exportOptions, meeting, packing)
  }, [report, options, format, meeting, packing])

  const copy = async () => {
    if (!text) return
    const ok = await copyToClipboard(text)
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 2000)
  }

  const openExternal = () => {
    if (!text) return
    if (format === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
      return
    }
    const [first, ...rest] = text.split('\n')
    const subject = first.replace(/^Subject:\s*/, '')
    const body = rest.join('\n').replace(/^\n+/, '')
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  const emptyMessage = isMeeting
    ? '相手国（基準国以外）を選択すると、会議の候補日時を打診する英文が生成されます。'
    : '工程を設定すると英文が生成されます。'

  return (
    <Card
      icon={<Mail size={18} />}
      title="英文メール / WhatsApp 出力"
      subtitle="計算結果（各工程の日程・スキップした祝日）や会議の候補日時を、海外の取引先にそのまま送れる英文に整形します。"
    >
      {/* Container query: layout follows the width of the tab panel, not the window. */}
      <div className="@container">
        <FormatPicker value={format} onChange={(next) => onOptionsChange({ format: next })} />
        <div className="mt-5 grid gap-6 @3xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
          <div className="space-y-3">
            <div>
              <label className={labelClass} htmlFor="exp-recipient">
                宛名（Dear …）
              </label>
              <input
                id="exp-recipient"
                className={inputClass}
                placeholder="例: Mr. Smith（空欄なら Sir or Madam）"
                value={options.recipientName}
                onChange={(e) => onOptionsChange({ recipientName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass} htmlFor="exp-sender">
                  署名：氏名
                </label>
                <input
                  id="exp-sender"
                  className={inputClass}
                  placeholder="Taro Yamada"
                  value={options.senderName}
                  onChange={(e) => onOptionsChange({ senderName: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="exp-company">
                  署名：会社名
                </label>
                <input
                  id="exp-company"
                  className={inputClass}
                  placeholder="ABC Trading Co., Ltd."
                  value={options.companyName}
                  onChange={(e) => onOptionsChange({ companyName: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass} htmlFor="exp-ref">
                  参照番号（PO・見積No.）
                </label>
                <input
                  id="exp-ref"
                  className={inputClass}
                  placeholder="PO-12345"
                  value={options.reference}
                  onChange={(e) => onOptionsChange({ reference: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="exp-date-style">
                  日付形式
                </label>
                <select
                  id="exp-date-style"
                  className={inputClass}
                  value={options.dateStyle}
                  onChange={(e) => onOptionsChange({ dateStyle: e.target.value as ExportOptions['dateStyle'] })}
                >
                  <option value="dmy">Tue, 17 Nov 2026</option>
                  <option value="mdy">Tue, Nov 17, 2026</option>
                  <option value="iso">2026-11-17 (Tue)</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="exp-recipient-country">
                相手国（{isMeeting ? '会議候補' : '祝日・会議候補'}に使用）
              </label>
              <div className="relative">
                {partner && (
                  <CountryFlag code={partner.code} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                )}
                <select
                  id="exp-recipient-country"
                  className={cx(inputClass, partner && 'pl-10')}
                  value={countries.some((c) => !c.isBase && c.code === options.recipientCountry) ? options.recipientCountry : ''}
                  onChange={(e) => onOptionsChange({ recipientCountry: e.target.value })}
                >
                  <option value="">自動（最終工程の国）{recipient ? `：${recipient.info.nameJa}` : ''}</option>
                  {countries
                    .filter((c) => !c.isBase)
                    .map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.info.nameJa}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {isMeeting ? (
              <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                <p>
                  <span className="font-semibold text-slate-800">{formatJaDate(meetingFrom)}</span>
                  以降で、
                  <span className="inline-flex items-center gap-1 align-[-2px]">
                    <CountryFlag code={base.code} size="sm" />
                    {base.info.nameJa}
                  </span>
                  {partner && (
                    <>
                      と
                      <span className="inline-flex items-center gap-1 align-[-2px]">
                        <CountryFlag code={partner.code} size="sm" />
                        {partner.info.nameJa}
                      </span>
                    </>
                  )}
                  の営業時間が30分以上重なる直近{MEETING_CANDIDATES}日を候補にします（双方の週末・祝日・カスタム休日を除外）。
                </p>
                <p className="text-slate-500">
                  起点日は「会議可能時間帯」タブで選んだ日付です（明日より前の場合は明日から）。
                </p>
                <button type="button" className={cx(btn.ghost, '-ml-2.5 text-indigo-700')} onClick={onShowMeeting}>
                  会議可能時間帯で確認する <ArrowRight size={14} />
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className={labelClass} htmlFor="exp-scope">
                    祝日の記載範囲
                  </label>
                  <select
                    id="exp-scope"
                    className={inputClass}
                    value={options.holidayScope}
                    onChange={(e) => onOptionsChange({ holidayScope: e.target.value as ExportOptions['holidayScope'] })}
                  >
                    <option value="relevant">関係国のみ（基準国・工程で使う国・相手国）</option>
                    <option value="all">選択中のすべての国</option>
                    <option value="none">記載しない</option>
                  </select>
                </div>
                <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                  <Checkbox checked={options.includeLocalNames} onChange={(v) => onOptionsChange({ includeLocalNames: v })}>
                    祝日名に現地語を併記（例: Labor Thanksgiving Day (勤労感謝の日)）
                  </Checkbox>
                  <Checkbox checked={options.includeMeeting} onChange={(v) => onOptionsChange({ includeMeeting: v })}>
                    会議候補の時間帯を記載（相手国と営業時間が重なる直近3営業日）
                  </Checkbox>
                  {options.includeMeeting && !partner && (
                    <p className="text-xs text-amber-700">相手国（基準国以外）を選択すると会議候補を記載できます。</p>
                  )}
                  <Checkbox checked={options.includePacking} onChange={(v) => onOptionsChange({ includePacking: v })}>
                    Packing &amp; Container Summary を追記（正味／緩衝材込みの容積・総重量・推奨コンテナ／トラック。「積載3D」タブの貨物リストと緩衝材設定から作成）
                  </Checkbox>
                  {options.includePacking && (
                    <button type="button" className={cx(btn.ghost, '-ml-2 text-indigo-700')} onClick={onShowVanning}>
                      積載シミュレーターで貨物を確認する <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </>
            )}
            <p className="text-[11px] leading-relaxed text-slate-400">
              入力した宛名・署名はこのブラウザ内（LocalStorage）にのみ保存され、共有URLには含まれません。
            </p>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button type="button" className={cx(btn.primary, 'min-w-40')} disabled={!text} onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'コピーしました' : 'ワンクリックでコピー'}
              </button>
              <button type="button" className={btn.secondary} disabled={!text} onClick={openExternal}>
                <ExternalLink size={15} />
                {format === 'whatsapp' ? 'WhatsAppで開く' : 'メールアプリで開く'}
              </button>
              <span className="ml-auto text-[11px] text-slate-400 tabular-nums">{text.length.toLocaleString()} 文字</span>
            </div>
            {text ? (
              <pre
                aria-label="英文プレビュー"
                className="max-h-[620px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-800"
              >
                {text}
              </pre>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                {emptyMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
