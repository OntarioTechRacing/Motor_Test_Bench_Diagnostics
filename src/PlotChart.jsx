import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import { palette, shortName } from './csvUtils'

export default function PlotChart({ data, visible, plotMode, title }) {
  const elRef = useRef(null)
  const readyRef = useRef(false)

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const names = visible.filter((n) => data?.series?.[n])
    const colors = palette(names.length)
    const mode = plotMode || 'lines'

    const traces = names.map((name, i) => {
      const color = colors[i]
      const trace = {
        type: 'scattergl',
        mode,
        name: shortName(name),
        meta: name,
        x: data.x,
        y: data.series[name],
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

    const layout = {
      autosize: true,
      margin: { l: 56, r: 24, t: 40, b: 48 },
      paper_bgcolor: '#0d1117',
      plot_bgcolor: '#0d1117',
      font: { color: '#e6edf3', size: 12 },
      title: {
        text: title || '',
        font: { size: 13, color: '#8b949e' },
        x: 0,
        xanchor: 'left',
      },
      xaxis: {
        title: 'time_s',
        gridcolor: '#21262d',
        zerolinecolor: '#30363d',
        color: '#8b949e',
      },
      yaxis: {
        title: 'value',
        gridcolor: '#21262d',
        zerolinecolor: '#30363d',
        color: '#8b949e',
      },
      legend: {
        orientation: 'h',
        y: 1.02,
        yanchor: 'bottom',
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
    }

    const config = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
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
  }, [data, visible, plotMode, title])

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
}
