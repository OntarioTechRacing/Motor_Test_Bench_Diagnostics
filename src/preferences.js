const STORAGE_KEY = 'motor-test-bench-prefs-v1'

/** @typedef {{ logId?: string, visibleSignals?: string[], plotMode?: string }} ViewerPrefs */

/** @returns {ViewerPrefs | null} */
export function loadPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    return {
      logId: typeof data.logId === 'string' ? data.logId : undefined,
      visibleSignals: Array.isArray(data.visibleSignals)
        ? data.visibleSignals.filter((s) => typeof s === 'string')
        : undefined,
      plotMode: typeof data.plotMode === 'string' ? data.plotMode : undefined,
    }
  } catch {
    return null
  }
}

/** @param {ViewerPrefs} prefs */
export function savePreferences(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore quota / private mode */
  }
}
