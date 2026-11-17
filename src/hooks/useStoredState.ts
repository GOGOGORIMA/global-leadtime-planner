import { useCallback, useState } from 'react'
import { readJSON, writeJSON } from '../utils/storage'

/** `useState` persisted to LocalStorage (merged over `defaults`, so new fields get defaults). */
export function useStoredState<T extends object>(key: string, defaults: T) {
  const [value, setValue] = useState<T>(() => ({ ...defaults, ...readJSON<Partial<T>>(key, {}) }))
  const update = useCallback(
    (patch: Partial<T>) => {
      setValue((prev) => {
        const next = { ...prev, ...patch }
        writeJSON(key, next)
        return next
      })
    },
    [key],
  )
  return [value, update] as const
}
