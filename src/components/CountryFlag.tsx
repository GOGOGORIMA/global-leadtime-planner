import { useState } from 'react'
import { getFlagCdnUrl, getFlagUrl } from '../data/flags'
import { cx } from './classes'

const SIZES = {
  sm: { className: 'h-3 w-4', width: 16, height: 12 },
  md: { className: 'h-3.5 w-5', width: 20, height: 14 },
  lg: { className: 'h-[18px] w-6', width: 24, height: 18 },
} as const

interface FlagSource {
  src: string
  srcSet?: string
}

/** flagcdn.com first (w40, w80 on high-DPI screens), then the bundled flag-icons SVG. */
function flagSources(code: string): FlagSource[] {
  const sources: FlagSource[] = []
  const cdn = getFlagCdnUrl(code, 40)
  const cdn2x = getFlagCdnUrl(code, 80)
  if (cdn) sources.push({ src: cdn, srcSet: cdn2x ? `${cdn} 1x, ${cdn2x} 2x` : undefined })
  const local = getFlagUrl(code)
  if (local) sources.push({ src: local })
  return sources
}

/**
 * Flag image (never an emoji, never the country code). Decorative: the country name is always
 * rendered next to it, so the image is hidden from assistive technology. When an image fails to
 * load it falls back to the next source, and finally to a neutral placeholder.
 */
export function CountryFlag({
  code,
  size = 'md',
  lazy = false,
  className,
}: {
  code: string
  size?: keyof typeof SIZES
  lazy?: boolean
  className?: string
}) {
  // Failed attempts are tracked per code, so switching to another country starts from flagcdn again.
  const [failed, setFailed] = useState<{ code: string; count: number } | null>(null)
  const attempt = failed?.code === code ? failed.count : 0
  const { className: sizeClass, width, height } = SIZES[size]
  // bg-slate-100 shows while the image is loading; the opaque flag covers it afterwards.
  const classes = cx('inline-block shrink-0 rounded-xs bg-slate-100 object-cover ring-1 ring-slate-900/10', sizeClass, className)
  const source = flagSources(code)[attempt]
  if (!source) return <span aria-hidden className={cx(classes, 'bg-slate-200')} />
  return (
    <img
      // A new element per source: a leftover srcset would otherwise keep pointing at the failed image.
      key={source.src}
      src={source.src}
      srcSet={source.srcSet}
      alt=""
      aria-hidden
      width={width}
      height={height}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed({ code, count: attempt + 1 })}
      className={classes}
    />
  )
}
