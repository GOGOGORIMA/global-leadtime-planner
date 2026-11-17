import { Bookmark, Check, Globe, Link2, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createId } from '../state/defaults'
import { copyToClipboard } from '../utils/clipboard'
import { loadPresets, savePresets, type SavedPreset } from '../utils/storage'
import { btn, cx, inputClass } from './classes'

interface AppHeaderProps {
  query: string
  onLoadQuery: (query: string) => void
  onReset: () => void
}

function PresetMenu({ query, onLoad }: { query: string; onLoad: (query: string) => void }) {
  const [open, setOpen] = useState(false)
  const [presets, setPresets] = useState<SavedPreset[]>(() => loadPresets())
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const persist = (next: SavedPreset[]) => {
    setPresets(next)
    savePresets(next)
  }

  const save = () => {
    const presetName = name.trim() || `プリセット ${presets.length + 1}`
    const savedAt = new Date().toISOString()
    const existing = presets.find((p) => p.name === presetName)
    persist(
      existing
        ? presets.map((p) => (p.id === existing.id ? { ...p, query, savedAt } : p))
        : [{ id: createId(), name: presetName, query, savedAt }, ...presets],
    )
    setName('')
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={btn.secondary}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title="プリセットの保存・読み込み（LocalStorage）"
      >
        <Bookmark size={16} />
        <span className="hidden sm:inline">プリセット</span>
        {presets.length > 0 && (
          <span className="rounded-full bg-indigo-100 px-1.5 text-[11px] font-semibold text-indigo-700">{presets.length}</span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="プリセット"
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
        >
          <div className="text-sm font-semibold text-slate-900">現在の設定を保存</div>
          <p className="mt-0.5 text-[11px] text-slate-500">国・営業時間・工程・カスタム休日をこのブラウザに保存します。同名は上書き。</p>
          <div className="mt-2 flex gap-2">
            <input
              className={inputClass}
              placeholder="例: タイ向け 海上標準"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label="プリセット名"
            />
            <button type="button" className={cx(btn.primary, 'shrink-0')} onClick={save}>
              {saved ? <Check size={16} /> : <Save size={16} />}
              保存
            </button>
          </div>
          <div className="mt-4 mb-1 text-xs font-semibold text-slate-500">保存済み（{presets.length}）</div>
          {presets.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">まだ保存されたプリセットはありません。</p>
          ) : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {presets.map((preset) => (
                <li key={preset.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-indigo-50"
                    onClick={() => {
                      onLoad(preset.query)
                      setOpen(false)
                    }}
                  >
                    <div className="truncate text-sm font-medium text-slate-800">{preset.name}</div>
                    <div className="text-[11px] text-slate-400">{new Date(preset.savedAt).toLocaleString('ja-JP')}</div>
                  </button>
                  <button
                    type="button"
                    className={cx(btn.icon, 'mr-1 hover:bg-rose-50! hover:text-rose-600!')}
                    aria-label={`${preset.name}を削除`}
                    onClick={() => persist(presets.filter((p) => p.id !== preset.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function AppHeader({ query, onLoadQuery, onReset }: AppHeaderProps) {
  const [copied, setCopied] = useState(false)

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?${query}`
    const ok = await copyToClipboard(url)
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-indigo-600 to-sky-500 text-white shadow-md">
            <Globe size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">Global Lead-Time Planner</h1>
              <span className="hidden rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 ring-1 ring-indigo-200 sm:inline">
                B2B
              </span>
            </div>
            <p className="hidden truncate text-xs text-slate-500 md:block">
              時差・現地祝日を考慮した納期の順算／逆算と、海外拠点との会議調整
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className={btn.secondary} onClick={share} title="現在の状態を再現できるURLをコピー">
            {copied ? <Check size={16} className="text-emerald-600" /> : <Link2 size={16} />}
            <span className="hidden sm:inline">{copied ? 'コピーしました' : '共有URLをコピー'}</span>
          </button>
          <PresetMenu query={query} onLoad={onLoadQuery} />
          <button type="button" className={btn.ghost} onClick={onReset} title="初期状態に戻す">
            <RotateCcw size={16} />
            <span className="hidden lg:inline">リセット</span>
          </button>
        </div>
      </div>
    </header>
  )
}
