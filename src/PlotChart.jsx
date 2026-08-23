import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import { palette, shortName } from './csvUtils'

/**
 * @typedef {{ exportPng: (filename: string) => Promise<void> }} PlotChartHandle
 */

function sliceSeries(data, endIndex) {
  if (!data?.x?.length) return data
  if (endIndex == null || endIndex >= data.x.length) return data
  const n = Math.max(0, Math.min(endIndex, data.x.length))
  const series = {}
  for (const [key, values] of Object.entries(data.series || {})) {
    series[key] = values.slice(0, n)
  }
  return {
    ...data,
    x: data.x.slice(0, n),
    series,
  }
}

const PlotChart = forwardRef(function PlotChart(
  { data, visible, plotMode, title, replayEndIndex = null, replayPlaying = false },
  ref,
) {
  const elRef = useRef(null)
  const readyRef = useRef(false)

  useImperativeHandle(ref, () => ({
    async exportPng(filename) {
      const el = elRef.current
      if (!el || !readyRef.current) return
      await Plotly.downloadImage(el, {
        format: 'png',
        width: 1600,
        height: 900,
        filename: filename.replace(/\.png$/i, ''),
      })
    },
  }))

  useEffect(() => {
    const el = elRef.current
    if (!el || !data?.x?.length) return

    const fullLen = data.x.length
    const end =
      replayEndIndex == null
        ? fullLen
        : Math.max(0, Math.min(replayEndIndex, fullLen))
    const sliced = sliceSeries(data, end)
    const names = visible.filter((n) => sliced?.series?.[n])
    const colors = palette(names.length)
    const mode = plotMode || 'lines'

    const tMin = data.x[0]
    const tMax = data.x[fullLen - 1]
    const playheadT = end > 0 ? sliced.x[sliced.x.length - 1] : tMin
    const inReplay = replayEndIndex != null

    let yMin = Infinity
    let yMax = -Infinity
    if (inReplay) {
      for (const name of names) {
        const full = data.series[name] || []
        for (let i = 0; i < full.length; i++) {
          const v = full[i]
          if (v == null || Number.isNaN(v)) continue
          if (v < yMin) yMin = v
          if (v > yMax) yMax = v
        }
      }
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
        yMin = 0
        yMax = 1
      } else if (yMin === yMax) {
        yMin -= 1
        yMax += 1
      } else {
        const pad = (yMax - yMin) * 0.05
        yMin -= pad
        yMax += pad
      }
    }

    const traces = names.map((name, i) => {
      const color = colors[i]
      const trace = {
        type: 'scattergl',
        mode,
        name: shortName(name),
        x: sliced.x,
        y: sliced.series[name],
        hovertemplate: `%{fullData.name}: %{y}<extra></extra>`,
      }
      if (mode.includes('lines')) {
        trace.line = { width: 1.4, color }
      }
      if (mode.includes('markers')) {
        trace.marker = { size: mode === 'markers' ? 4 : 3, color }
      }
      return trace
    })

    const shapes =
      inReplay && end > 0
        ? [
            {
              type: 'line',
              xref: 'x',
              yref: 'paper',
              x0: playheadT,
              x1: playheadT,
              y0: 0,
              y1: 1,
              line: {
                color: replayPlaying ? '#58a6ff' : '#8b949e',
                width: 1.5,
                dash: 'dot',
              },
            },
          ]
        : []

    const layout = {
      autosize: true,
      margin: { l: 56, r: 24, t: 48, b: 72 },
      paper_bgcolor: '#0d1117',
      plot_bgcolor: '#0d1117',
      font: { color: '#e6edf3', size: 12 },
      title: {
        text: title || '',
        font: { size: 13, color: '#8b949e' },
        x: 0,
        xanchor: 'left',
        y: 0.98,
        yanchor: 'top',
      },
      xaxis: {
        title: 'time_s',
        gridcolor: '#21262d',
        zerolinecolor: '#30363d',
        color: '#8b949e',
        ...(inReplay ? { range: [tMin, tMax], autorange: false } : {}),
      },
      yaxis: {
        title: 'value',
        gridcolor: '#21262d',
        zerolinecolor: '#30363d',
        color: '#8b949e',
        ...(inReplay ? { range: [yMin, yMax], autorange: false } : {}),
      },
      legend: {
        orientation: 'h',
        y: -0.18,
        yanchor: 'top',
        x: 0,
        font: { size: 11 },
        bgcolor: 'rgba(13,17,23,0.7)',
      },
      hovermode: 'x unified',
      hoverlabel: {
        bgcolor: '#161b22',
        bordercolor: '#30363d',
        font: { size: 12 },
      },
      dragmode: 'zoom',
      shapes,
    }

    const config = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      toImageButtonOptions: {
        format: 'png',
        filename: 'chart',
        width: 1600,
        height: 900,
      },
    }

    const run = async () => {
      if (!readyRef.current) {
        await Plotly.newPlot(el, traces, layout, config)
        readyRef.current = true
      } else {
        await Plotly.react(el, traces, layout, config)
      }
    }
    run()
  }, [data, visible, plotMode, title, replayEndIndex, replayPlaying])

  useEffect(() => {
    const el = elRef.current
    if (!el) return undefined
    const onResize = () => {
      if (readyRef.current) Plotly.Plots.resize(el)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return <div ref={elRef} className="chart" />
})

export default PlotChart
