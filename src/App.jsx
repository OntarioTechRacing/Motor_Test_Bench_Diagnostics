import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import PlotChart from './PlotChart'
import LogFilePicker from './LogFilePicker'
import OnboardingTour, { useOnboardingTour } from './OnboardingTour'
import { loadPreferences, savePreferences } from './preferences'
import { buildShareUrl, readUrlState, writeUrlState } from './urlState'
import {
  buildSeries,
  defaultVisible,
  downloadText,
  enableStateSignals,
  exportVisibleCsv,
  faultSignals,
  logExportStem,
  shortName,
  signalColumns,
} from './csvUtils'
import './App.css'

/**
 * @typedef {{ id: string, label: string, path: string }} ManifestFile
 */

function preferDefaultFile(files) {
  return (
    files.find((f) => f.id.includes('2026-08-20_21-28-54')) ||
    files.find((f) => !f.id.includes('all_sessions')) ||
    files[0] ||
    null
  )
}

function pickInitialLog(files, logId) {
  if (logId) {
    const match = files.find((f) => f.id === logId)
    if (match) return match
  }
  return preferDefaultFile(files)
}

/** Binary search: largest index with x[i] <= t */
function indexAtOrBefore(xs, t) {
  if (!xs.length) return 0
  let lo = 0
  let hi = xs.length - 1
  if (t <= xs[0]) return 0
  if (t >= xs[hi]) return hi
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (xs[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export default function App() {
  /** @type {[ManifestFile[], Function]} */
  const [files, setFiles] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [allSignals, setAllSignals] = useState([])
  const [visible, setVisible] = useState([])
  const [filter, setFilter] = useState('')
  const [plotMode, setPlotMode] = useState(() => {
    const url = readUrlState()
    const prefs = loadPreferences()
    return url.plotMode || prefs?.plotMode || 'lines'
  })
  const [status, setStatus] = useState('Loading…')
  const [plotData, setPlotData] = useState(null)
  const [pickerTourDemo, setPickerTourDemo] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replayEndIndex, setReplayEndIndex] = useState(/** @type {number | null} */ (null))
  const [replaySpeed, setReplaySpeed] = useState(1)
  const { tourActive, runId, startTour, closeTour } = useOnboardingTour()

  const rowsRef = useRef([])
  const fieldsRef = useRef([])
  const visibleRef = useRef([])
  const loadToken = useRef(0)
  const initialized = useRef(false)
  const seedSignalsRef = useRef(/** @type {string[] | null} */ (null))
  const chartRef = useRef(/** @type {import('./PlotChart').default | null} */ (null))
  const bootDoneRef = useRef(false)
  const replayRafRef = useRef(0)
  const replayClockRef = useRef({ lastWall: 0, sessionT: 0 })

  const selected = useMemo(
    () => files.find((f) => f.id === selectedId) || null,
    [files, selectedId],
  )

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  const statusLabel = selected?.label || 'CSV'

  const persistState = useCallback(() => {
    if (!bootDoneRef.current) return
    const state = {
      logId: selectedId || undefined,
      visibleSignals: visible,
      plotMode,
    }
    savePreferences(state)
    writeUrlState(state)
  }, [selectedId, visible, plotMode])

  useEffect(() => {
    const timer = window.setTimeout(persistState, 300)
    return () => window.clearTimeout(timer)
  }, [persistState])

  const replot = useCallback(
    (selectedSignals) => {
      const fields = fieldsRef.current
      const rows = rowsRef.current
      if (!rows.length) {
        setPlotData(null)
        return
      }
      const data = buildSeries(rows, fields, selectedSignals)
      setPlotData(data)
      setReplayPlaying(false)
      setReplayEndIndex(null)
      const n = selectedSignals.length
      let msg = `${statusLabel} · ${n} signal(s) · ${data.rowsOut.toLocaleString()} pts`
      if (data.downsampled) {
        msg += ` (downsampled from ${data.rowsIn.toLocaleString()})`
      }
      setStatus(msg)
    },
    [statusLabel],
  )

  const applyVisible = useCallback(
    (next) => {
      setVisible(next)
      replot(next)
    },
    [replot],
  )

  const applyParsed = useCallback(
    (rows, fields) => {
      fieldsRef.current = fields
      rowsRef.current = rows
      const signals = signalColumns(fields)
      setAllSignals(signals)

      const prev = visibleRef.current
      const seeded = seedSignalsRef.current
      let next
      if (seeded?.length) {
        next = seeded.filter((s) => signals.includes(s))
        seedSignalsRef.current = null
        if (!next.length) next = defaultVisible(signals)
        initialized.current = true
      } else if (!initialized.current || prev.length === 0) {
        next = defaultVisible(signals)
        initialized.current = true
      } else {
        next = prev.filter((s) => signals.includes(s))
        if (next.length === 0) next = defaultVisible(signals)
      }
      applyVisible(next)
    },
    [applyVisible],
  )

  const parseText = useCallback(
    (text, label) =>
      new Promise((resolve, reject) => {
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => {
            if (result.errors?.length && !result.data?.length) {
              reject(new Error(result.errors[0].message || 'Parse failed'))
              return
            }
            const fields = result.meta.fields || []
            resolve({ rows: result.data, fields, label })
          },
          error: (err) => reject(err),
        })
      }),
    [],
  )

  const loadRemoteFile = useCallback(
    async (entry) => {
      if (!entry?.path) return
      const token = ++loadToken.current
      setStatus(`Loading ${entry.label}…`)
      setSelectedId(entry.id)
      try {
        const res = await fetch(entry.path)
        if (!res.ok) throw new Error(`Failed to load ${entry.label} (${res.status})`)
        const text = await res.text()
        if (token !== loadToken.current) return
        const parsed = await parseText(text, entry.label)
        if (token !== loadToken.current) return
        applyParsed(parsed.rows, parsed.fields)
      } catch (err) {
        if (token !== loadToken.current) return
        setStatus(String(err.message || err))
      }
    },
    [applyParsed, parseText],
  )

  const refreshFileList = useCallback(async () => {
    const res = await fetch('/manifest.json')
    if (!res.ok) throw new Error(`Failed to load manifest (${res.status})`)
    const data = await res.json()
    const list = Array.isArray(data.files) ? data.files : []
    setFiles(list)
    return list
  }, [])

  useEffect(() => {
    let cancelled = false
    const url = readUrlState()
    const prefs = loadPreferences()
    const initialSignals = url.visibleSignals ?? prefs?.visibleSignals ?? null
    if (initialSignals?.length) seedSignalsRef.current = initialSignals

    ;(async () => {
      try {
        const list = await refreshFileList()
        if (cancelled) return
        if (!list.length) {
          setStatus('No CSVs in manifest — run the sync workflow to convert session logs')
          bootDoneRef.current = true
          return
        }
        const preferred = pickInitialLog(list, url.logId || prefs?.logId)
        if (preferred) await loadRemoteFile(preferred)
        bootDoneRef.current = true
      } catch (err) {
        if (!cancelled) setStatus(String(err.message || err))
        bootDoneRef.current = true
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFileSelect = (entry) => {
    loadRemoteFile(entry)
  }

  const toggleSignal = (name, on) => {
    setVisible((prev) => {
      const next = on ? [...new Set([...prev, name])] : prev.filter((s) => s !== name)
      replot(next)
      return next
    })
  }

  const setAllVisible = (on) => {
    const next = on ? [...allSignals] : []
    applyVisible(next)
  }

  const resetDefaults = () => {
    applyVisible(defaultVisible(allSignals))
  }

  const applyFaultPreset = () => {
    const next = faultSignals(allSignals)
    if (next.length) applyVisible(next)
  }

  const applyEnablePreset = () => {
    const next = enableStateSignals(allSignals)
    if (next.length) applyVisible(next)
  }

  const copyShareLink = async () => {
    const url = buildShareUrl({
      logId: selectedId || undefined,
      visibleSignals: visible,
      plotMode,
    })
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      setStatus('Could not copy link')
    }
  }

  const exportPng = async () => {
    if (!chartRef.current || !selectedId) return
    const stem = logExportStem(selectedId)
    try {
      await chartRef.current.exportPng(`${stem}_chart.png`)
    } catch (err) {
      setStatus(String(err?.message || err))
    }
  }

  const exportCsv = () => {
    if (!rowsRef.current.length || !visible.length) return
    const stem = logExportStem(selectedId)
    const csv = exportVisibleCsv(rowsRef.current, fieldsRef.current, visible)
    downloadText(`${stem}_signals.csv`, csv, 'text/csv;charset=utf-8')
  }

  const filteredSignals = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return allSignals
    return allSignals.filter(
      (s) => s.toLowerCase().includes(q) || shortName(s).toLowerCase().includes(q),
    )
  }, [allSignals, filter])

  const onTourStep = useCallback((step) => {
    setPickerTourDemo(step.id === 'dates')
  }, [])

  useEffect(() => {
    if (!tourActive) setPickerTourDemo(false)
  }, [tourActive])

  useEffect(() => {
    if (!replayPlaying || !plotData?.x?.length) return undefined

    const xs = plotData.x
    const tStart = xs[0]
    const tEnd = xs[xs.length - 1]
    const clock = replayClockRef.current

    if (replayEndIndex == null || replayEndIndex <= 0) {
      clock.sessionT = tStart
      setReplayEndIndex(1)
    } else if (replayEndIndex >= xs.length) {
      clock.sessionT = tStart
      setReplayEndIndex(1)
    } else {
      clock.sessionT = xs[Math.max(0, replayEndIndex - 1)]
    }
    clock.lastWall = performance.now()
    let lastEmit = 0

    const tick = (now) => {
      const dt = (now - clock.lastWall) / 1000
      clock.lastWall = now
      clock.sessionT += dt * replaySpeed

      if (clock.sessionT >= tEnd) {
        setReplayEndIndex(xs.length)
        setReplayPlaying(false)
        return
      }

      if (now - lastEmit >= 50) {
        lastEmit = now
        const idx = indexAtOrBefore(xs, clock.sessionT) + 1
        setReplayEndIndex(Math.min(idx, xs.length))
      }
      replayRafRef.current = requestAnimationFrame(tick)
    }

    replayRafRef.current = requestAnimationFrame(tick)
    return () => {
      if (replayRafRef.current) cancelAnimationFrame(replayRafRef.current)
    }
    // intentionally omit replayEndIndex from deps — clock owns session time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayPlaying, replaySpeed, plotData])

  const startReplay = () => {
    if (!plotData?.x?.length) return
    if (replayEndIndex == null || replayEndIndex >= plotData.x.length) {
      setReplayEndIndex(1)
    }
    setReplayPlaying(true)
  }

  const pauseReplay = () => {
    setReplayPlaying(false)
  }

  const resetReplay = () => {
    setReplayPlaying(false)
    setReplayEndIndex(null)
  }

  const onReplayScrub = (e) => {
    if (!plotData?.x?.length) return
    const idx = Number(e.target.value)
    setReplayPlaying(false)
    setReplayEndIndex(idx <= 0 ? 1 : idx)
  }

  const title = status
  const canExport = Boolean(plotData && rowsRef.current.length)
  const replayPointCount = plotData?.x?.length || 0
  const replayCurrent =
    replayEndIndex == null ? replayPointCount : Math.min(replayEndIndex, replayPointCount)
  const replayTimeLabel =
    plotData?.x?.length && replayEndIndex != null && replayEndIndex > 0
      ? `${Number(plotData.x[Math.min(replayEndIndex, plotData.x.length) - 1]).toFixed(2)} s`
      : plotData?.x?.length
        ? 'full'
        : '—'

  return (
    <div id="app">
      <OnboardingTour
        active={tourActive}
        runId={runId}
        onClose={closeTour}
        onStepChange={onTourStep}
      />
      <aside id="sidebar">
        <header className="sidebar-header">
          <div className="sidebar-title-row">
            <h1>Signals</h1>
            <div className="sidebar-header-actions">
              <button
                type="button"
                className="header-action-btn"
                data-tour="share-link"
                onClick={copyShareLink}
                title="Copy shareable link"
                disabled={!selectedId}
              >
                {linkCopied ? 'Copied!' : 'Link'}
              </button>
              <button
                type="button"
                className="header-action-btn"
                data-tour="tour-btn"
                onClick={startTour}
                title="Replay tour"
              >
                Tour
              </button>
            </div>
          </div>
          <p className="status">{status}</p>
        </header>

        <div className="field" data-tour="log-file">
          <span>Log file</span>
          <LogFilePicker
            files={files}
            selectedId={selectedId}
            disabled={!files.length}
            onSelect={onFileSelect}
            onRefresh={() => refreshFileList().catch(() => {})}
            tourDemo={pickerTourDemo}
          />
        </div>

        <label className="field" data-tour="plot-style">
          <span>Plot style</span>
          <select value={plotMode} onChange={(e) => setPlotMode(e.target.value)}>
            <option value="lines">Lines (connected)</option>
            <option value="markers">Points only</option>
            <option value="lines+markers">Lines + points</option>
          </select>
        </label>

        <div className="toolbar toolbar--export" data-tour="export">
          <button type="button" onClick={exportPng} disabled={!canExport}>
            PNG
          </button>
          <button type="button" onClick={exportCsv} disabled={!canExport}>
            CSV
          </button>
        </div>

        <div className="replay-panel" data-tour="replay">
          <span className="field-label">Replay</span>
          <div className="toolbar toolbar--replay">
            {replayPlaying ? (
              <button type="button" onClick={pauseReplay} disabled={!plotData}>
                Pause
              </button>
            ) : (
              <button type="button" onClick={startReplay} disabled={!plotData}>
                Play
              </button>
            )}
            <button type="button" onClick={resetReplay} disabled={!plotData}>
              Reset
            </button>
            <select
              value={String(replaySpeed)}
              onChange={(e) => setReplaySpeed(Number(e.target.value))}
              aria-label="Replay speed"
              disabled={!plotData}
            >
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
              <option value="8">8×</option>
              <option value="16">16×</option>
            </select>
          </div>
          <input
            type="range"
            className="replay-scrub"
            min={0}
            max={Math.max(replayPointCount, 1)}
            value={replayCurrent}
            onChange={onReplayScrub}
            disabled={!plotData}
            aria-label="Replay position"
          />
          <p className="replay-meta">
            {replayEndIndex == null
              ? 'Showing full log'
              : `${replayCurrent.toLocaleString()} / ${replayPointCount.toLocaleString()} · ${replayTimeLabel}`}
          </p>
        </div>

        <div data-tour="signal-toolbar">
          <div className="toolbar">
            <button type="button" onClick={resetDefaults}>
              Defaults
            </button>
            <button type="button" onClick={() => setAllVisible(true)}>
              Show all
            </button>
            <button type="button" onClick={() => setAllVisible(false)}>
              Hide all
            </button>
          </div>

          <div className="toolbar toolbar--presets">
            <button type="button" onClick={applyFaultPreset} disabled={!allSignals.length}>
              Faults
            </button>
            <button type="button" onClick={applyEnablePreset} disabled={!allSignals.length}>
              Enable
            </button>
          </div>
        </div>

        <label className="field" data-tour="signal-filter">
          <span>Filter</span>
          <input
            type="search"
            placeholder="Filter signals…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoComplete="off"
          />
        </label>

        <div className="signal-list" role="group" aria-label="Signals" data-tour="signal-list">
          {filteredSignals.map((name) => (
            <label key={name} className="signal-item">
              <input
                type="checkbox"
                checked={visible.includes(name)}
                onChange={(e) => toggleSignal(name, e.target.checked)}
              />
              <span title={name}>{shortName(name)}</span>
            </label>
          ))}
        </div>
      </aside>

      <main id="main" data-tour="chart">
        {plotData ? (
          <PlotChart
            ref={chartRef}
            data={plotData}
            visible={visible}
            plotMode={plotMode}
            title={title}
            replayEndIndex={replayEndIndex}
            replayPlaying={replayPlaying}
          />
        ) : (
          <div className="chart-empty">Load a CSV to plot</div>
        )}
      </main>
    </div>
  )
}
