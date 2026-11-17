/** Shared Tailwind class strings (kept out of component files for React Fast Refresh). */

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1'

export const btn = {
  primary: cx(
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 whitespace-nowrap text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50',
    focusRing,
  ),
  secondary: cx(
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 whitespace-nowrap text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
    focusRing,
  ),
  ghost: cx(
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 whitespace-nowrap text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40',
    focusRing,
  ),
  icon: cx(
    'inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30',
    focusRing,
  ),
}

export const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:bg-slate-50'

export const labelClass = 'mb-1 block text-xs font-medium text-slate-600'
