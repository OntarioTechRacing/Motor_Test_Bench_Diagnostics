import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import PlotChart from './PlotChart'
import {
  buildSeries,
  defaultVisible,
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

export default function App() {
  /** @type {[ManifestFile[], Function]} */
  const [files, setFiles] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [allSignals, setAllSignals] = useState([])
  const [visible, setVisible] = useState([])
  const [filter, setFilter] = useState('')
  const [plotMode, setPlotMode] = useState('lines')
  const [status, setStatus] = useState('Loading…')
  const [plotData, setPlotData] = useState(null)
  const [localLabel, setLocalLabel] = useState('')

  const rowsRef = useRef([])
  const fieldsRef = useRef([])
  const visibleRef = useRef([])
  const loadToken = useRef(0)
  const initialized = useRef(false)

  const selected = useMemo(
    () => files.find((f) => f.id === selectedId) || null,
    [files, selectedId],
  )

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  const statusLabel = selected?.label || localLabel || 'CSV'

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
      const n = selectedSignals.length
      let msg = `${statusLabel} · ${n} signal(s) · ${data.rowsOut.toLocaleString()} pts`
      if (data.downsampled) {
        msg += ` (downsampled from ${data.rowsIn.toLocaleString()})`
      }
      setStatus(msg)
    },
    [statusLabel],
  )

  const applyParsed = useCallback(
    (rows, fields, label) => {
      fieldsRef.current = fields
      rowsRef.current = rows
      const signals = signalColumns(fields)
      setAllSignals(signals)

      const prev = visibleRef.current
      let next
      if (!initialized.current || prev.length === 0) {
        next = defaultVisible(signals)
        initialized.current = true
      } else {
        next = prev.filter((s) => signals.includes(s))
        if (next.length === 0) next = defaultVisible(signals)
      }
      setVisible(next)
      setLocalLabel(label.startsWith('local:') ? label.slice(6) : '')
      replot(next)
    },
    [replot],
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
        applyParsed(parsed.rows, parsed.fields, entry.label)
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
    ;(async () => {
      try {
        const list = await refreshFileList()
        if (cancelled) return
        if (!list.length) {
          setStatus('No CSVs in manifest — convert logs or open a local CSV')
          return
        }
        const preferred = preferDefaultFile(list)
        if (preferred) await loadRemoteFile(preferred)
      } catch (err) {
        if (!cancelled) setStatus(String(err.message || err))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFileChange = (e) => {
    const id = e.target.value
    const entry = files.find((f) => f.id === id)
    if (entry) loadRemoteFile(entry)
  }

  const onFileSelectFocus = () => {
    refreshFileList().catch(() => {})
  }

  const onLocalFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const token = ++loadToken.current
    setStatus(`Parsing ${file.name}…`)
    setSelectedId('')
    try {
      const text = await file.text()
      if (token !== loadToken.current) return
      const parsed = await parseText(text, `local:${file.name}`)
      if (token !== loadToken.current) return
      applyParsed(parsed.rows, parsed.fields, `local:${file.name}`)
    } catch (err) {
      setStatus(String(err.message || err))
    }
    e.target.value = ''
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
    setVisible(next)
    replot(next)
  }

  const resetDefaults = () => {
    const next = defaultVisible(allSignals)
    setVisible(next)
    replot(next)
  }

  const filteredSignals = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return allSignals
    return allSignals.filter(
      (s) => s.toLowerCase().includes(q) || shortName(s).toLowerCase().includes(q),
    )
  }, [allSignals, filter])

  const title = status

  return (
    <div id="app">
      <aside id="sidebar">
        <header className="sidebar-header">
          <h1>Signals</h1>
          <p className="status">{status}</p>
        </header>

        <label className="field">
          <span>CSV file</span>
          <select
            value={selectedId}
            onChange={onFileChange}
            onFocus={onFileSelectFocus}
            disabled={!files.length}
          >
            {!selectedId && localLabel ? (
              <option value="">{localLabel} (local)</option>
            ) : null}
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Open local CSV</span>
          <input type="file" accept=".csv,text/csv" onChange={onLocalFile} />
        </label>

        <label className="field">
          <span>Plot style</span>
          <select value={plotMode} onChange={(e) => setPlotMode(e.target.value)}>
            <option value="lines">Lines (connected)</option>
            <option value="markers">Points only</option>
            <option value="lines+markers">Lines + points</option>
          </select>
        </label>

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

        <label className="field">
          <span>Filter</span>
          <input
            type="search"
            placeholder="Filter signals…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoComplete="off"
          />
        </label>

        <div className="signal-list" role="group" aria-label="Signals">
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

      <main id="main">
        {plotData ? (
          <PlotChart
            data={plotData}
            visible={visible}
            plotMode={plotMode}
            title={title}
          />
        ) : (
          <div className="chart-empty">Load a CSV to plot</div>
        )}
      </main>
    </div>
  )
}
