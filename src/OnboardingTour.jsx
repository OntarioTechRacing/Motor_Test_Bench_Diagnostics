import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

const STORAGE_KEY = 'motor-test-bench-tour-v2'

const STEPS = [
  {
    id: 'welcome',
    title: 'Motor Test Bench Diagnostics',
    body: 'Plot inverter and vehicle signals from session logs. This short tour covers picking a log, replaying a run, reading the graph, and sharing your view.',
    target: null,
  },
  {
    id: 'logs',
    title: 'Choose a log file',
    body: 'Open Log file to browse sessions. Use Folders to group by source (for example OTR-Telemetry), or type in Search to filter by name, folder, or timestamp.',
    target: '[data-tour="log-file"]',
  },
  {
    id: 'dates',
    title: 'Browse by date',
    body: 'Switch to the Dates tab for a calendar. Days with logs are highlighted — click one, then pick a session from the list. Use ‹ › to change months.',
    target: '[data-tour="log-dates"]',
  },
  {
    id: 'plot',
    title: 'Plot style',
    body: 'Choose Lines, Points only, or Lines + points depending on how dense the data looks.',
    target: '[data-tour="plot-style"]',
  },
  {
    id: 'export',
    title: 'Export',
    body: 'PNG downloads a snapshot of the chart. CSV downloads only the signals you currently have checked, at full resolution for the whole session.',
    target: '[data-tour="export"]',
  },
  {
    id: 'replay',
    title: 'Replay the run',
    body: 'Play animates the log in session time so traces draw as the run progresses. Use the speed menu (0.25×–16×), drag the scrubber to jump, Pause to freeze, or Reset to show the full log again.',
    target: '[data-tour="replay"]',
  },
  {
    id: 'toolbar',
    title: 'Signal shortcuts',
    body: 'Defaults loads common inverter signals. Show all / Hide all toggles every channel. Faults and Enable jump to fault bits and inverter enable/state signals.',
    target: '[data-tour="signal-toolbar"]',
  },
  {
    id: 'signals',
    title: 'Signal list',
    body: 'Check the channels you want on the graph. Use Filter to search by name when a log has dozens of signals.',
    target: '[data-tour="signal-filter"]',
  },
  {
    id: 'chart',
    title: 'The graph',
    body: 'Visible signals plot as colored traces. The legend is under the chart. The status text in the sidebar shows which log is loaded and how many points are plotted.',
    target: '[data-tour="chart"]',
  },
  {
    id: 'chart-hover',
    title: 'Read values',
    body: 'Move the cursor across the plot to see a crosshair and the value of each visible signal at that time_s.',
    target: '[data-tour="chart"]',
  },
  {
    id: 'chart-zoom',
    title: 'Zoom and pan',
    body: 'Drag a box to zoom into a time range. After zooming, drag to pan. Double-click the plot (or the home icon in the top-right toolbar) to reset.',
    target: '[data-tour="chart"]',
  },
  {
    id: 'chart-toolbar',
    title: 'Chart toolbar',
    body: 'Hover the top-right corner of the graph for Plotly tools: zoom, pan, reset axes, and download image.',
    target: '[data-tour="chart"]',
  },
  {
    id: 'share-link',
    title: 'Share with Link',
    body: 'Click Link in the header to copy a URL that opens this same log with your current signals and plot style — handy for sending a teammate the exact view.',
    target: '[data-tour="share-link"]',
  },
  {
    id: 'done',
    title: 'You are all set',
    body: 'Click Tour in the header anytime to run this walkthrough again. Skip is always available if you already know your way around.',
    target: '[data-tour="tour-btn"]',
  },
]

function readCompleted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCompleted() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

/**
 * @param {{ active: boolean, onClose: () => void, runId?: number, onStepChange?: (step: (typeof STEPS)[number]) => void }} props
 */
export default function OnboardingTour({ active, onClose, runId = 0, onStepChange }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState(null)

  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1
  const isFirst = stepIndex === 0

  useEffect(() => {
    if (active) setStepIndex(0)
  }, [active, runId])

  useEffect(() => {
    if (!active) return
    onStepChange?.(STEPS[stepIndex])
  }, [active, stepIndex, onStepChange])

  const measureTarget = useCallback(() => {
    if (!active || !step?.target) {
      setTargetRect(null)
      return
    }
    const el = document.querySelector(step.target)
    if (!el) {
      setTargetRect(null)
      return
    }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const rect = el.getBoundingClientRect()
    const pad = 6
    setTargetRect({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    })
  }, [active, step])

  useLayoutEffect(() => {
    measureTarget()
    if (!active) return undefined
    const needsRetry =
      step?.id === 'dates' ||
      step?.id === 'replay' ||
      step?.id === 'share-link' ||
      step?.id === 'done'
    if (!needsRetry) return undefined
    const t1 = window.setTimeout(measureTarget, 80)
    const t2 = window.setTimeout(measureTarget, 220)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [measureTarget, stepIndex, active, step?.id])

  useEffect(() => {
    if (!active) return undefined
    const onResize = () => measureTarget()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [active, measureTarget])

  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        writeCompleted()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onClose])

  if (!active) return null

  const finish = () => {
    writeCompleted()
    onClose()
  }

  const skip = () => {
    writeCompleted()
    onClose()
  }

  const next = () => {
    if (isLast) finish()
    else setStepIndex((i) => i + 1)
  }

  const back = () => {
    if (!isFirst) setStepIndex((i) => i - 1)
  }

  const cardStyle = (() => {
    const margin = 12
    const cardW = Math.min(320, window.innerWidth - margin * 2)
    if (!targetRect) {
      return {
        top: '50%',
        left: '50%',
        width: cardW,
        transform: 'translate(-50%, -50%)',
      }
    }
    const belowTop = targetRect.top + targetRect.height + margin
    const cardH =
      step?.id === 'dates' ||
      step?.id === 'replay' ||
      String(step?.id || '').startsWith('chart')
        ? 230
        : 180
    const fitsBelow = belowTop + cardH < window.innerHeight
    const top = fitsBelow ? belowTop : Math.max(margin, targetRect.top - cardH - margin)
    const left =
      step?.id === 'dates'
        ? clamp(
            targetRect.left + targetRect.width + margin,
            margin,
            window.innerWidth - cardW - margin,
          )
        : String(step?.id || '').startsWith('chart')
          ? clamp(targetRect.left + 24, margin, window.innerWidth - cardW - margin)
          : clamp(targetRect.left, margin, window.innerWidth - cardW - margin)
    return { top, left, width: cardW }
  })()

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Product tour">
      <div className="tour-backdrop" onClick={skip} aria-hidden />
      {targetRect ? (
        <div
          className="tour-spotlight"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }}
        />
      ) : null}

      <div className="tour-card" style={cardStyle}>
        <div className="tour-card-header">
          <span className="tour-step-count">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <button type="button" className="tour-skip" onClick={skip}>
            Skip tour
          </button>
        </div>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-btn tour-btn--ghost" onClick={back} disabled={isFirst}>
            Back
          </button>
          <button type="button" className="tour-btn tour-btn--primary" onClick={next}>
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useOnboardingTour() {
  const [active, setActive] = useState(false)
  const [runId, setRunId] = useState(0)

  useEffect(() => {
    if (readCompleted()) return undefined
    const timer = window.setTimeout(() => {
      setRunId((id) => id + 1)
      setActive(true)
    }, 700)
    return () => window.clearTimeout(timer)
  }, [])

  const startTour = useCallback(() => {
    setRunId((id) => id + 1)
    setActive(true)
  }, [])

  const closeTour = useCallback(() => {
    setActive(false)
  }, [])

  return { tourActive: active, runId, startTour, closeTour }
}
