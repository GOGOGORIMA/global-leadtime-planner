import { Check, Copy, ExternalLink, Mail, MessageCircle } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { ResolvedCountry } from '../utils/calendars'
import { toParticipant } from '../utils/calendars'
import { copyToClipboard } from '../utils/clipboard'
import { ALL_DAYS_CALENDAR, addDays, type ISODate, type WorkCalendar } from '../utils/dateCalc'
import { renderExport, type ExportOptions, type MeetingSuggestion } from '../utils/exportText'
import { toReportCountry, type ScheduleReport } from '../utils/report'
import { findUpcomingMeetingDays } from '../utils/timezone'
import { btn, cx, inputClass, labelClass } from './classes'
import { Card, Segmented } from './ui'

interface ExportPanelProps {
  report: ScheduleReport | null
  countries: readonly ResolvedCountry[]
  calendars: ReadonlyMap<string, WorkCalendar>
  recipientCountry: string
  today: ISODate
  options: ExportOptions
  onOptionsChange: (patch: Partial<ExportOptions>) => void
}

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

export function ExportPanel({
  report,
  countries,
  calendars,
  recipientCountry,
  today,
  options,
  onOptionsChange,
}: ExportPanelProps) {
  const [copied, setCopied] = useState(false)
  const base = countries[0]
  const recipient = countries.find((c) => c.code === recipientCountry)

  const meeting = useMemo<MeetingSuggestion | undefined>(() => {
    if (!options.includeMeeting || !recipient || recipient.isBase) return undefined
    const participants = [base, recipient].map((c) => toParticipant(c, calendars.get(c.code) ?? ALL_DAYS_CALENDAR))
    // Proposals start tomorrow (base time) so the recipient has time to reply.
    const days = findUpcomingMeetingDays(addDays(today, 1), base.timeZone, participants, { count: 3 })
    return {
      base: toReportCountry(base, today),
      others: [toReportCountry(recipient, today)],
      days,
    }
  }, [options.includeMeeting, recipient, base, calendars, today])

  const text = useMemo(() => (report ? renderExport(report, options, meeting) : ''), [report, options, meeting])

  const copy = async () => {
    if (!text) return
    const ok = await copyToClipboard(text)
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 2000)
  }

  const openExternal = () => {
    if (!text) return
    if (options.format === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
      return
    }
    const [first, ...rest] = text.split('\n')
    const subject = first.replace(/^Subject:\s*/, '')
    const body = rest.join('\n').replace(/^\n+/, '')
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  return (
    <Card
      icon={<Mail size={18} />}
      title="英文メール / WhatsApp 出力"
      subtitle="計算結果（各工程の日程・スキップした祝日）を、海外顧客にそのまま送れる英文に整形します。"
      actions={
        <Segmented
          ariaLabel="出力形式"
          value={options.format}
          onChange={(format) => onOptionsChange({ format })}
          options={[
            { value: 'email', label: 'メール', icon: <Mail size={15} /> },
            { value: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle size={15} /> },
          ]}
        />
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
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
          <div>
            <label className={labelClass} htmlFor="exp-recipient-country">
              相手国（祝日・会議候補に使用）
            </label>
            <select
              id="exp-recipient-country"
              className={inputClass}
              value={countries.some((c) => !c.isBase && c.code === options.recipientCountry) ? options.recipientCountry : ''}
              onChange={(e) => onOptionsChange({ recipientCountry: e.target.value })}
            >
              <option value="">自動（最終工程の国）{recipient ? `：${recipient.info.nameJa}` : ''}</option>
              {countries
                .filter((c) => !c.isBase)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.info.flag} {c.info.nameJa}（{c.code}）
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <Checkbox checked={options.includeLocalNames} onChange={(v) => onOptionsChange({ includeLocalNames: v })}>
              祝日名に現地語を併記（例: Labor Thanksgiving Day (勤労感謝の日)）
            </Checkbox>
            <Checkbox checked={options.includeMeeting} onChange={(v) => onOptionsChange({ includeMeeting: v })}>
              会議候補の時間帯を記載（相手国と営業時間が重なる直近3営業日）
            </Checkbox>
            {options.includeMeeting && (!recipient || recipient.isBase) && (
              <p className="text-xs text-amber-700">相手国（基準国以外）を選択すると会議候補を記載できます。</p>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">入力した宛名・署名はこのブラウザ内（LocalStorage）にのみ保存され、共有URLには含まれません。</p>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" className={cx(btn.primary, 'min-w-40')} disabled={!text} onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'コピーしました' : 'ワンクリックでコピー'}
            </button>
            <button type="button" className={btn.secondary} disabled={!text} onClick={openExternal}>
              <ExternalLink size={15} />
              {options.format === 'whatsapp' ? 'WhatsAppで開く' : 'メールアプリで開く'}
            </button>
            <span className="ml-auto text-[11px] text-slate-400 tabular-nums">{text.length.toLocaleString()} 文字</span>
          </div>
          {text ? (
            <pre
              aria-label="英文プレビュー"
              className="max-h-[560px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-800"
            >
              {text}
            </pre>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              工程を設定すると英文が生成されます。
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
