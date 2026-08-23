const STEM_RE = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/

const MONTHS_SHORT = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]

const MONTHS_FULL = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** @typedef {{ y: number, mo: number, d: number, h: number, mi: number, s: number }} LogStamp */

/**
 * @param {{ label: string, id: string, path: string }} file
 * @returns {LogStamp | null}
 */
export function extractLogStamp(file) {
  const text = `${file.label} ${file.id} ${file.path}`
  const m = text.match(STEM_RE)
  if (!m) return null
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: Number(m[6]),
  }
}

/** @param {LogStamp} stamp */
export function formatLogStamp(stamp) {
  const date = new Date(stamp.y, stamp.mo - 1, stamp.d, stamp.h, stamp.mi, stamp.s)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** @param {LogStamp} stamp */
function dateTokens(stamp) {
  const { y, mo, d, h, mi, s } = stamp
  const moP = String(mo).padStart(2, '0')
  const dP = String(d).padStart(2, '0')
  const hP = String(h).padStart(2, '0')
  const miP = String(mi).padStart(2, '0')
  const sP = String(s).padStart(2, '0')
  const monthShort = MONTHS_SHORT[mo - 1]
  const monthFull = MONTHS_FULL[mo - 1]

  return [
    `${y}-${moP}-${dP}`,
    `${y}/${moP}/${dP}`,
    `${moP}/${dP}/${y}`,
    `${mo}/${d}/${y}`,
    `${moP}-${dP}`,
    `${mo}-${d}`,
    `${y}-${moP}`,
    `${y}/${moP}`,
    `${hP}:${miP}`,
    `${hP}-${miP}`,
    `${hP}:${miP}:${sP}`,
    `${hP}-${miP}-${sP}`,
    monthShort,
    monthFull,
    `${monthShort} ${d}`,
    `${monthShort} ${d} ${y}`,
    `${monthFull} ${d}`,
    `${monthFull} ${d} ${y}`,
    formatLogStamp(stamp).toLowerCase(),
  ]
}

/** @param {LogStamp} stamp @param {string} q */
function matchDateParts(stamp, q) {
  const parts = q.match(/\d+/g)?.map(Number)
  if (!parts?.length) {
    const monthIdx = MONTHS_SHORT.findIndex((m) => q.includes(m))
    const monthFullIdx = MONTHS_FULL.findIndex((m) => q.includes(m))
    const month = monthIdx >= 0 ? monthIdx + 1 : monthFullIdx >= 0 ? monthFullIdx + 1 : 0
    if (!month) return false
    if (month !== stamp.mo) return false
    const dayMatch = q.match(/\b(\d{1,2})\b/)
    return !dayMatch || Number(dayMatch[1]) === stamp.d
  }

  const { y, mo, d, h, mi } = stamp

  if (parts.length >= 3) {
    const [a, b, c] = parts
    if (a >= 1000 && a === y && b === mo && c === d) return true
    if (c >= 1000 && a === mo && b === d && c === y) return true
    if (c >= 1000 && b === mo && a === d && c === y) return true
  }

  if (parts.length === 2) {
    const [a, b] = parts
    if (a === mo && b === d) return true
    if (a === d && b === mo) return true
    if (a >= 1000 && a === y && b === mo) return true
    if (a === h && b === mi) return true
  }

  if (parts.length === 1) {
    const [n] = parts
    if (n === y || n === mo || n === d || n === h) return true
  }

  return false
}

/**
 * @param {{ label: string, id: string, path: string }} file
 * @param {string} query
 */
export function matchesLogQuery(file, query) {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return true

  const hay = `${file.label} ${file.id} ${file.path}`.toLowerCase()
  if (hay.includes(q)) return true

  const qNorm = q.replace(/\//g, '-').replace(/:/g, '-')
  const hayNorm = hay.replace(/\//g, '-').replace(/:/g, '-')
  if (hayNorm.includes(qNorm)) return true

  const stamp = extractLogStamp(file)
  if (!stamp) return false

  const tokens = dateTokens(stamp)
  if (tokens.some((t) => t.includes(q) || q.includes(t))) return true
  if (tokens.join(' ').includes(q)) return true
  if (matchDateParts(stamp, q)) return true

  return false
}
