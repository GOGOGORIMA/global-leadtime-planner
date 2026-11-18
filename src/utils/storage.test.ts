import { describe, expect, it } from 'vitest'
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS, migrateLegacyStorage } from './storage'

/** Minimal in-memory `Storage` for the migration test (Vitest runs in Node). */
function memoryStorage(initial: Record<string, string>): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

describe('LocalStorage migration to the Global Planner keys', () => {
  it('keeps presets and export options but drops the cached last session (old 9-country list)', () => {
    const storage = memoryStorage({
      [LEGACY_STORAGE_KEYS.presets]: '[{"id":"a","name":"Bangkok","query":"base=JP&c=TH","savedAt":"2026-11-01"}]',
      [LEGACY_STORAGE_KEYS.exportOptions]: '{"senderName":"Taro Yamada"}',
      [LEGACY_STORAGE_KEYS.lastQuery]: '"v=1&base=JP&c=KR,TW,CN,US,TH,MY,IN,VN,SG"',
    })
    migrateLegacyStorage(storage)
    expect(storage.getItem(STORAGE_KEYS.presets)).toContain('Bangkok')
    expect(storage.getItem(STORAGE_KEYS.exportOptions)).toBe('{"senderName":"Taro Yamada"}')
    expect(storage.getItem(STORAGE_KEYS.lastQuery)).toBeNull()
    expect(Object.values(LEGACY_STORAGE_KEYS).map((key) => storage.getItem(key))).toEqual([null, null, null])
  })

  it('never overwrites data already stored under the new keys and tolerates missing storage', () => {
    const storage = memoryStorage({
      [LEGACY_STORAGE_KEYS.presets]: '[]',
      [STORAGE_KEYS.presets]: '[{"id":"b","name":"New","query":"base=JP","savedAt":"2026-11-18"}]',
    })
    migrateLegacyStorage(storage)
    expect(storage.getItem(STORAGE_KEYS.presets)).toContain('"New"')
    expect(storage.getItem(LEGACY_STORAGE_KEYS.presets)).toBeNull()
    expect(() => migrateLegacyStorage(undefined)).not.toThrow()
  })
})
