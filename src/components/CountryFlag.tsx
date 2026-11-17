import { getFlagUrl } from '../data/flags'
import { cx } from './classes'

const SIZES = {
  sm: { className: 'h-3 w-4', width: 16, height: 12 },
  md: { className: 'h-[15px] w-5', width: 20, height: 15 },
  lg: { className: 'h-[18px] w-6', width: 24, height: 18 },
} as const

/**
 * Flag image (never an emoji, never the country code). Decorative: the country name is always
 * rendered next to it, so the image is hidden from assistive technology.
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
  const { className: sizeClass, width, height } = SIZES[size]
  const classes = cx('inline-block shrink-0 rounded-[3px] object-cover ring-1 ring-slate-900/10', sizeClass, className)
  const url = getFlagUrl(code)
  if (!url) return <span aria-hidden className={cx(classes, 'bg-slate-200')} />
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      width={width}
      height={height}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      draggable={false}
      className={classes}
    />
  )
}
