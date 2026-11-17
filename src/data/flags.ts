/**
 * Country flag image URLs.
 *
 * Images instead of emoji: Windows does not render regional-indicator emoji as flags (it shows
 * letters such as "JP"), and the UI must never show bare country codes.
 *
 * - Primary: PNGs from flagcdn.com (`https://flagcdn.com/w40/jp.png`), requested without a referrer.
 * - Fallback: the bundled SVGs from `flag-icons` (MIT), used when flagcdn.com cannot be reached
 *   (offline, blocked by a proxy) or has no image for a code. Each SVG is emitted as its own asset
 *   (`?no-inline`), so browsers only download the flags actually shown.
 */
const files = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  query: '?no-inline',
  import: 'default',
})

const urlByCode = new Map<string, string>()
for (const [path, url] of Object.entries(files)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -'.svg'.length).toUpperCase()
  urlByCode.set(code, url)
}

/** URL of the 4:3 flag for an ISO 3166-1 alpha-2 code, or `undefined` when there is none. */
export function getFlagUrl(code: string): string | undefined {
  return urlByCode.get(code.toUpperCase())
}

const FLAG_CDN_CODE = /^[a-z]{2}$/

/** flagcdn.com PNG of the given width (height follows the flag's own aspect ratio), or `undefined` for a malformed code. */
export function getFlagCdnUrl(code: string, width: 40 | 80 = 40): string | undefined {
  const lower = code.toLowerCase()
  return FLAG_CDN_CODE.test(lower) ? `https://flagcdn.com/w${width}/${lower}.png` : undefined
}
