/**
 * LocalStorage persistence (presets, last session, export options).
 * Every access is wrapped in try/catch: storage can be unavailable (private mode, blocked
 * cookies, quota) and the app must keep working without it.
 */

const PREFIX = 'glp:v1:'
export const STORAGE_KEYS = {
  presets: `${PREFIX}presets`,
  lastQuery: `${PREFIX}last-query`,
  exportOptions: `${PREFIX}export-options`,
} as const

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export interface SavedPreset {
  id: string
  name: string
  /** Serialized planner state (same format as the share URL query string). */
  query: string
  savedAt: string
}

function isSavedPreset(value: unknown): value is SavedPreset {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.query === 'string'
}

export function loadPresets(): SavedPreset[] {
  const raw = readJSON<unknown>(STORAGE_KEYS.presets, [])
  return Array.isArray(raw) ? raw.filter(isSavedPreset) : []
}

export function savePresets(presets: readonly SavedPreset[]): boolean {
  return writeJSON(STORAGE_KEYS.presets, presets)
}

export function loadLastQuery(): string | null {
  const value = readJSON<unknown>(STORAGE_KEYS.lastQuery, null)
  return typeof value === 'string' ? value : null
}

export function saveLastQuery(query: string): void {
  writeJSON(STORAGE_KEYS.lastQuery, query)
}
