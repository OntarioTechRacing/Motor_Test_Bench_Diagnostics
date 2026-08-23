import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/**
 * @typedef {{ id: string, label: string, path: string }} ManifestFile
 * @typedef {{ dateKey: string, timeKey: string, year: number, month: number, day: number }} ParsedLogDate
 * @typedef {ManifestFile & { name: string, folder: string, parsed: ParsedLogDate | null }} EnrichedFile
 */

const DATE_TIME_RE = /(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function splitLabel(label) {
  const idx = label.lastIndexOf(' / ')
  if (idx === -1) return { folder: '', name: label }
  return {
    folder: label.slice(0, idx),
    name: label.slice(idx + 3),
  }
}

function parseFileDate(file) {
  const hay = `${file.id} ${file.label} ${file.path}`
  const match = hay.match(DATE_TIME_RE)
  if (!match) return null
  const dateKey = match[1]
  const timeKey = match[2].replace(/-/g, ':')
  const [year, month, day] = dateKey.split('-').map(Number)
  return { dateKey, timeKey, year, month, day }
}

/** @param {ManifestFile[]} files */
function enrichFiles(files) {
  return files.map((file) => {
    const { folder, name } = splitLabel(file.label)
    return { ...file, folder, name, parsed: parseFileDate(file) }
  })
}

/** @param {EnrichedFile[]} files */
function groupFiles(files) {
  /** @type {Map<string, EnrichedFile[]>} */
  const groups = new Map()
  for (const file of files) {
    if (!groups.has(file.folder)) groups.set(file.folder, [])
    groups.get(file.folder).push(file)
  }
  const folders = [...groups.keys()].sort((a, b) => a.localeCompare(b))
  return folders.map((folder) => ({
    folder,
    files: groups.get(folder).sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

/** @param {EnrichedFile[]} files */
function groupByDate(files) {
  /** @type {Map<string, EnrichedFile[]>} */
  const byDate = new Map()
  for (const file of files) {
    if (!file.parsed) continue
    const key = file.parsed.dateKey
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key).push(file)
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => {
      const ta = a.parsed?.timeKey || ''
      const tb = b.parsed?.timeKey || ''
      return ta.localeCompare(tb)
    })
  }
  return byDate
}

function matchesQuery(file, q) {
  const hay = `${file.label} ${file.id} ${file.path} ${file.parsed?.dateKey || ''} ${file.parsed?.timeKey || ''}`.toLowerCase()
  return hay.includes(q)
}

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function latestParsedDate(files) {
  let latest = null
  for (const file of files) {
    if (!file.parsed) continue
    if (!latest || file.parsed.dateKey > latest.dateKey) latest = file.parsed
    else if (
      file.parsed.dateKey === latest.dateKey &&
      file.parsed.timeKey > latest.timeKey
    ) {
      latest = file.parsed
    }
  }
  return latest
}

function buildCalendarDays(year, month, datesWithLogs) {
  const firstDow = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells = []

  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({
      day,
      dateKey,
      count: datesWithLogs.get(dateKey)?.length || 0,
    })
  }
  return cells
}

function FileOption({ file, selectedId, onPick, subtitle }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={file.id === selectedId}
      className={`log-picker-item${file.id === selectedId ? ' log-picker-item--active' : ''}`}
      onClick={() => onPick(file)}
    >
      <span className="log-picker-item-label">{subtitle || file.label}</span>
      {subtitle ? <span className="log-picker-item-sub">{file.folder || file.name}</span> : null}
    </button>
  )
}

/**
 * @param {{
 *   files: ManifestFile[],
 *   selectedId: string,
 *   disabled?: boolean,
 *   onSelect: (file: ManifestFile) => void,
 *   onRefresh?: () => void,
 *   tourDemo?: boolean,
 * }} props
 */
export default function LogFilePicker({
  files,
  selectedId,
  disabled = false,
  onSelect,
  onRefresh,
  tourDemo = false,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [viewMode, setViewMode] = useState('folders')
  const [selectedDateKey, setSelectedDateKey] = useState('')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [panelStyle, setPanelStyle] = useState(null)
  const rootRef = useRef(null)
  const panelRef = useRef(null)

  const enriched = useMemo(() => enrichFiles(files), [files])

  const selected = useMemo(
    () => enriched.find((f) => f.id === selectedId) || null,
    [enriched, selectedId],
  )

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? enriched.filter((f) => matchesQuery(f, q)) : enriched),
    [enriched, q],
  )

  const grouped = useMemo(() => groupFiles(filtered), [filtered])
  const byDate = useMemo(() => groupByDate(enriched), [enriched])
  const filteredByDate = useMemo(() => groupByDate(filtered), [filtered])

  const datesWithLogs = q ? filteredByDate : byDate

  useEffect(() => {
    const onDocClick = (e) => {
      if (tourDemo) return
      if (!rootRef.current?.contains(e.target)) {
        setOpen(false)
        setQuery('')
        setSelectedDateKey('')
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [tourDemo])

  const wasTourDemoRef = useRef(false)

  useEffect(() => {
    if (tourDemo) {
      wasTourDemoRef.current = true
      setOpen(true)
      setViewMode('calendar')
      setQuery('')
      const anchor = latestParsedDate(enriched)
      if (anchor) {
        setCalendarMonth({ year: anchor.year, month: anchor.month })
        setSelectedDateKey(anchor.dateKey)
      }
      return
    }
    // Only force-close when leaving tour demo — do not close on file-list refresh
    if (wasTourDemoRef.current) {
      wasTourDemoRef.current = false
      setOpen(false)
      setQuery('')
      setSelectedDateKey('')
    }
  }, [tourDemo, enriched])

  useEffect(() => {
    if (tourDemo) return
    if (!open || viewMode !== 'calendar') return
    const anchor = selected?.parsed || latestParsedDate(enriched)
    if (!anchor) return
    setCalendarMonth({ year: anchor.year, month: anchor.month })
    if (selected?.parsed) setSelectedDateKey(selected.parsed.dateKey)
  }, [open, viewMode, selected, enriched])

  const displayValue = selected?.label || ''

  const pick = (file) => {
    onSelect(file)
    setOpen(false)
    setQuery('')
    setSelectedDateKey('')
  }

  const openPicker = (e) => {
    e?.stopPropagation?.()
    if (disabled) return
    setOpen((v) => {
      const next = !v
      if (next) onRefresh?.()
      return next
    })
  }

  const shiftMonth = (delta) => {
    setCalendarMonth((prev) => {
      const d = new Date(prev.year, prev.month - 1 + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    })
  }

  const showSearchResults = Boolean(q)
  const calendarExpanded = open && viewMode === 'calendar' && !showSearchResults

  const logsForSelectedDate = selectedDateKey
    ? datesWithLogs.get(selectedDateKey) || []
    : []

  const updatePanelLayout = useCallback(() => {
    if (!open || !rootRef.current) {
      setPanelStyle(null)
      return
    }
    const trigger = rootRef.current.querySelector('.log-picker-trigger')
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const expanded = calendarExpanded
    const width = expanded ? Math.max(420, rect.width + 100) : rect.width
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const maxHeight = expanded
      ? window.innerHeight - rect.bottom - 20
      : Math.min(420, window.innerHeight * 0.52)
    setPanelStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left,
      width,
      maxHeight: Math.max(300, maxHeight),
      zIndex: tourDemo ? 210 : 60,
    })
  }, [open, calendarExpanded, tourDemo])

  useLayoutEffect(() => {
    updatePanelLayout()
  }, [updatePanelLayout, filtered.length, selectedDateKey, logsForSelectedDate.length])

  useEffect(() => {
    if (!open) return undefined
    const onLayout = () => updatePanelLayout()
    window.addEventListener('resize', onLayout)
    window.addEventListener('scroll', onLayout, true)
    return () => {
      window.removeEventListener('resize', onLayout)
      window.removeEventListener('scroll', onLayout, true)
    }
  }, [open, updatePanelLayout])

  const calendarDays = buildCalendarDays(
    calendarMonth.year,
    calendarMonth.month,
    datesWithLogs,
  )

  return (
    <div
      className={`log-picker${open ? ' log-picker--open' : ''}${disabled ? ' log-picker--disabled' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="log-picker-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={openPicker}
      >
        <span className="log-picker-value" title={displayValue || 'Choose a log file'}>
          {displayValue || 'Choose a log file…'}
        </span>
        <span className="log-picker-chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          data-tour="log-dates"
          className={`log-picker-panel${calendarExpanded ? ' log-picker-panel--calendar' : ''}${tourDemo ? ' log-picker-panel--tour' : ''}`}
          style={panelStyle || undefined}
          role="listbox"
          aria-label="Log files"
        >
          <div className="log-picker-toolbar">
            <div className="log-picker-tabs" role="tablist" aria-label="Browse mode">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'folders'}
                className={`log-picker-tab${viewMode === 'folders' ? ' log-picker-tab--active' : ''}`}
                onClick={() => setViewMode('folders')}
              >
                Folders
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'calendar'}
                className={`log-picker-tab${viewMode === 'calendar' ? ' log-picker-tab--active' : ''}`}
                onClick={() => setViewMode('calendar')}
              >
                Dates
              </button>
            </div>
            <span className="log-picker-count">
              {filtered.length === files.length
                ? `${files.length}`
                : `${filtered.length} / ${files.length}`}
            </span>
          </div>

          <div className="log-picker-search-wrap">
            <input
              type="search"
              className="log-picker-search"
              placeholder={viewMode === 'calendar' ? 'Search by date, time, folder…' : 'Search logs…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              autoComplete="off"
              aria-label="Search log files"
            />
          </div>

          <div
            className={`log-picker-list${calendarExpanded ? ' log-picker-list--calendar' : ''}`}
          >
            {!filtered.length ? (
              <div className="log-picker-empty">No logs match “{query.trim()}”</div>
            ) : showSearchResults ? (
              filtered.map((file) => (
                <FileOption key={file.id} file={file} selectedId={selectedId} onPick={pick} />
              ))
            ) : viewMode === 'folders' ? (
              grouped.map(({ folder, files: groupFiles }) => (
                <div key={folder || '__root__'} className="log-picker-group">
                  {folder ? <div className="log-picker-group-label">{folder}</div> : null}
                  {groupFiles.map((file) => (
                    <FileOption
                      key={file.id}
                      file={file}
                      selectedId={selectedId}
                      onPick={pick}
                      subtitle={folder ? file.name : undefined}
                    />
                  ))}
                </div>
              ))
            ) : (
              <>
                <div className="log-picker-calendar">
                  <div className="log-picker-cal-header">
                    <button
                      type="button"
                      className="log-picker-cal-nav"
                      aria-label="Previous month"
                      onClick={() => shiftMonth(-1)}
                    >
                      ‹
                    </button>
                    <span className="log-picker-cal-title">
                      {MONTH_NAMES[calendarMonth.month - 1]} {calendarMonth.year}
                    </span>
                    <button
                      type="button"
                      className="log-picker-cal-nav"
                      aria-label="Next month"
                      onClick={() => shiftMonth(1)}
                    >
                      ›
                    </button>
                  </div>

                  <div className="log-picker-cal-weekdays" aria-hidden>
                    {WEEKDAY_LABELS.map((label, i) => (
                      <span key={`${label}-${i}`} className="log-picker-cal-weekday">
                        {label}
                      </span>
                    ))}
                  </div>

                  <div className="log-picker-cal-grid">
                    {calendarDays.map((cell, idx) =>
                      cell ? (
                        <button
                          key={cell.dateKey}
                          type="button"
                          disabled={cell.count === 0}
                          className={[
                            'log-picker-cal-day',
                            cell.count > 0 ? 'log-picker-cal-day--has-logs' : '',
                            selectedDateKey === cell.dateKey ? 'log-picker-cal-day--selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => setSelectedDateKey(cell.dateKey)}
                          title={
                            cell.count
                              ? `${cell.count} log${cell.count === 1 ? '' : 's'}`
                              : 'No logs'
                          }
                        >
                          <span className="log-picker-cal-day-num">{cell.day}</span>
                          {cell.count > 0 ? (
                            <span className="log-picker-cal-day-dot" aria-hidden />
                          ) : null}
                        </button>
                      ) : (
                        <span key={`pad-${idx}`} className="log-picker-cal-pad" aria-hidden />
                      ),
                    )}
                  </div>
                </div>

                {selectedDateKey ? (
                  <div className="log-picker-date-logs">
                    <div className="log-picker-date-heading">
                      {formatDateLabel(selectedDateKey)}
                      <span className="log-picker-date-count">
                        {logsForSelectedDate.length} log
                        {logsForSelectedDate.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="log-picker-date-logs-scroll">
                      {logsForSelectedDate.length ? (
                        logsForSelectedDate.map((file) => (
                          <FileOption
                            key={file.id}
                            file={file}
                            selectedId={selectedId}
                            onPick={pick}
                            subtitle={`${file.folder ? `${file.folder} · ` : ''}${file.parsed?.timeKey || file.name}`}
                          />
                        ))
                      ) : (
                        <div className="log-picker-empty">No logs on this date</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="log-picker-hint">
                    Select a highlighted date to see available logs
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
