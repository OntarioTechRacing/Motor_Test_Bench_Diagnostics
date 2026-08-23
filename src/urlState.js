const VALID_MODES = new Set(['lines', 'markers', 'lines+markers'])

/** @typedef {{ logId?: string, visibleSignals?: string[], plotMode?: string }} UrlState */

/** @returns {UrlState} */
export function readUrlState() {
  const params = new URLSearchParams(window.location.search)
  const logId = params.get('log')?.trim() || undefined
  const signalsRaw = params.get('signals')?.trim()
  const mode = params.get('mode')?.trim()

  /** @type {UrlState} */
  const state = {}
  if (logId) state.logId = logId
  if (signalsRaw) {
    state.visibleSignals = signalsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (mode && VALID_MODES.has(mode)) state.plotMode = mode
  return state
}

/** @param {{ logId?: string, visibleSignals?: string[], plotMode?: string }} state */
export function writeUrlState(state) {
  const params = new URLSearchParams()
  if (state.logId) params.set('log', state.logId)
  if (state.visibleSignals?.length) params.set('signals', state.visibleSignals.join(','))
  if (state.plotMode && VALID_MODES.has(state.plotMode)) params.set('mode', state.plotMode)

  const qs = params.toString()
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.replaceState(null, '', url)
}

/** @param {{ logId?: string, visibleSignals?: string[], plotMode?: string }} state */
export function buildShareUrl(state) {
  const params = new URLSearchParams()
  if (state.logId) params.set('log', state.logId)
  if (state.visibleSignals?.length) params.set('signals', state.visibleSignals.join(','))
  if (state.plotMode && VALID_MODES.has(state.plotMode)) params.set('mode', state.plotMode)
  const qs = params.toString()
  return qs ? `${window.location.origin}${window.location.pathname}?${qs}` : window.location.href
}

export function hasUrlState() {
  const params = new URLSearchParams(window.location.search)
  return params.has('log') || params.has('signals') || params.has('mode')
}
