/**
 * Country flags as local SVG files from `flag-icons` (MIT).
 *
 * Images instead of emoji: Windows does not render regional-indicator emoji as flags (it shows
 * letters such as "JP"), and the UI must never show bare country codes. The files are served from
 * this site (no third-party CDN, nothing leaks about which countries are selected). Each SVG is
 * emitted as its own asset (`?no-inline`), so browsers only download the flags actually shown.
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
