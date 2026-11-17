import { useEffect, useMemo, useReducer } from 'react'
import { DEFAULT_BASE_COUNTRY, getDefaultTimeZone } from '../data/countries'
import { createDefaultState } from '../state/defaults'
import { plannerReducer } from '../state/plannerReducer'
import type { PlannerState } from '../types'
import { loadLastQuery, saveLastQuery } from '../utils/storage'
import { todayInTimeZone } from '../utils/timezone'
import { parseState, readTabParam, serializeState } from '../utils/urlState'

export function createFreshState(): PlannerState {
  return createDefaultState(todayInTimeZone(getDefaultTimeZone(DEFAULT_BASE_COUNTRY)))
}

/** URL query → last session (LocalStorage) → defaults. A URL with only `?tab=` opens that tab on top. */
function getInitialState(): PlannerState {
  const fallback = createFreshState()
  const fromUrl = parseState(window.location.search, fallback)
  if (fromUrl.recognized) return fromUrl.state
  const tab = readTabParam(window.location.search)
  const last = loadLastQuery()
  const restored = last ? parseState(last, fallback) : undefined
  const state = restored?.recognized ? restored.state : fallback
  return tab ? { ...state, tab } : state
}

/**
 * Planner state with two-way persistence: every change is mirrored into the URL query string
 * (shareable link, `history.replaceState`, debounced) and into LocalStorage (restored on the next
 * visit when the URL carries no state).
 */
export function usePlanner() {
  const [state, dispatch] = useReducer(plannerReducer, undefined, getInitialState)
  const query = useMemo(() => serializeState(state), [state])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { pathname, search, hash } = window.location
      if (search !== `?${query}`) {
        try {
          window.history.replaceState(window.history.state, '', `${pathname}?${query}${hash}`)
        } catch {
          // Some browsers throttle replaceState; the next change will retry.
        }
      }
      saveLastQuery(query)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  return { state, dispatch, query }
}
