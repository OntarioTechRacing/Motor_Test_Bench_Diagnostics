import Papa from 'papaparse'

export const TIME_COLS = new Set(['time', 'time_s'])
export const MAX_POINTS = 12_000

export const DEFAULT_SIGNALS = [
  'INV_Commanded_Torque',
  'INV_Torque_Feedback',
  'INV_Motor_Speed',
  'INV_DC_Bus_Voltage',
  'INV_DC_Bus_Current',
  'INV_Motor_Temperature',
  'INV_Module_A',
  'INV_Module_B',
  'INV_Module_C',
  'INV_Inverter_Enable_State',
]

export const FAULT_SIGNAL_PATTERNS = [
  /INV_Run_Fault/i,
  /INV_Post_Fault/i,
  /INV_Diag_Run_Faults/i,
  /INV_Diag_Post_Faults/i,
]

export const ENABLE_STATE_PATTERNS = [
  /^INV_Inverter_Enable/i,
  /^INV_Inverter_State$/i,
  /^INV_VSM_State$/i,
  /^INV_Inverter_Discharge_State$/i,
  /^INV_Inverter_Run_Mode$/i,
]

export function shortName(name) {
  return name.startsWith('INV_') ? name.slice(4) : name
}

export function signalColumns(fields) {
  return (fields || []).filter((c) => c && !TIME_COLS.has(c))
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function matchPatterns(name, patterns) {
  return patterns.some((re) => re.test(name))
}

export function faultSignals(allSignals) {
  return allSignals.filter((s) => matchPatterns(s, FAULT_SIGNAL_PATTERNS))
}

export function enableStateSignals(allSignals) {
  return allSignals.filter((s) => matchPatterns(s, ENABLE_STATE_PATTERNS))
}

/** Stride-downsample row objects; returns { x, series, rowsIn, rowsOut, downsampled }. */
export function buildSeries(rows, fields, selected) {
  const signals = selected.filter((s) => fields.includes(s))
  const rowsIn = rows.length
  const stride = rowsIn > MAX_POINTS ? Math.ceil(rowsIn / MAX_POINTS) : 1
  const sampled = stride === 1 ? rows : rows.filter((_, i) => i % stride === 0)
  const rowsOut = sampled.length

  const hasTimeS = fields.includes('time_s')
  const x = sampled.map((r, i) => {
    if (hasTimeS) return toNum(r.time_s) ?? i * stride
    return i * stride
  })

  const series = {}
  for (const name of signals) {
    series[name] = sampled.map((r) => toNum(r[name]))
  }

  return {
    x,
    series,
    rowsIn,
    rowsOut,
    downsampled: stride > 1,
  }
}

export function defaultVisible(allSignals) {
  const picked = DEFAULT_SIGNALS.filter((s) => allSignals.includes(s))
  if (picked.length) return picked
  return allSignals.slice(0, Math.min(8, allSignals.length))
}

export function palette(n) {
  const colors = []
  for (let i = 0; i < n; i++) {
    const h = (i * 137.508) % 360
    colors.push(`hsl(${h.toFixed(1)}, 72%, 62%)`)
  }
  return colors
}

export function exportVisibleCsv(rows, fields, visibleSignals) {
  const cols = ['time', 'time_s', ...visibleSignals.filter((s) => fields.includes(s))]
  const present = cols.filter((c) => fields.includes(c))
  const subset = rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const c of present) out[c] = row[c] ?? ''
    return out
  })
  return Papa.unparse(subset, { columns: present })
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function logExportStem(logId) {
  if (!logId) return 'session'
  const part = logId.split('/').pop() || logId
  return part.replace(/[^\w.-]+/g, '_')
}
