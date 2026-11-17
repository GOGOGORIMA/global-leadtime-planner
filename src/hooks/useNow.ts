import { useEffect, useState } from 'react'

/** Current epoch ms, refreshed on `intervalMs` boundaries (e.g. every full minute for 60 000). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, intervalMs - (Date.now() % intervalMs) + 20)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [intervalMs])
  return now
}
