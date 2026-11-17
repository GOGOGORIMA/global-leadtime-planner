import type { DayStatus } from '../utils/dateCalc'

/** Day-status colours shared by the timeline, legend and meeting bars. */
export const DAY_STATUS_STYLES: Record<DayStatus, { cell: string; label: string; swatch: string }> = {
  working: { cell: 'bg-emerald-400 hover:bg-emerald-500', swatch: 'bg-emerald-400', label: '稼働日' },
  weekend: { cell: 'bg-slate-200 hover:bg-slate-300', swatch: 'bg-slate-200', label: '週末' },
  holiday: { cell: 'bg-rose-500 hover:bg-rose-600', swatch: 'bg-rose-500', label: '祝日' },
  'custom-off': { cell: 'bg-amber-400 hover:bg-amber-500', swatch: 'bg-amber-400', label: 'カスタム休日' },
  'custom-work': { cell: 'bg-emerald-700 hover:bg-emerald-800', swatch: 'bg-emerald-700', label: '臨時稼働日' },
}

export interface StepColor {
  solid: string
  soft: string
  text: string
  dot: string
  border: string
}

/**
 * Step palette — deliberately avoids emerald (working), rose (holiday), amber (custom day off)
 * and slate (weekend) so bars never look like calendar states.
 */
const STEP_COLORS: readonly StepColor[] = [
  { solid: 'bg-indigo-500', soft: 'bg-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-500', border: 'border-indigo-200' },
  { solid: 'bg-sky-500', soft: 'bg-sky-200', text: 'text-sky-700', dot: 'bg-sky-500', border: 'border-sky-200' },
  { solid: 'bg-fuchsia-500', soft: 'bg-fuchsia-200', text: 'text-fuchsia-700', dot: 'bg-fuchsia-500', border: 'border-fuchsia-200' },
  { solid: 'bg-teal-500', soft: 'bg-teal-200', text: 'text-teal-700', dot: 'bg-teal-500', border: 'border-teal-200' },
  { solid: 'bg-violet-500', soft: 'bg-violet-200', text: 'text-violet-700', dot: 'bg-violet-500', border: 'border-violet-200' },
  { solid: 'bg-cyan-600', soft: 'bg-cyan-200', text: 'text-cyan-700', dot: 'bg-cyan-600', border: 'border-cyan-200' },
  { solid: 'bg-pink-500', soft: 'bg-pink-200', text: 'text-pink-700', dot: 'bg-pink-500', border: 'border-pink-200' },
  { solid: 'bg-blue-600', soft: 'bg-blue-200', text: 'text-blue-700', dot: 'bg-blue-600', border: 'border-blue-200' },
  { solid: 'bg-lime-600', soft: 'bg-lime-200', text: 'text-lime-800', dot: 'bg-lime-600', border: 'border-lime-200' },
  { solid: 'bg-purple-600', soft: 'bg-purple-200', text: 'text-purple-700', dot: 'bg-purple-600', border: 'border-purple-200' },
]

export function stepColor(index: number): StepColor {
  return STEP_COLORS[index % STEP_COLORS.length]
}
