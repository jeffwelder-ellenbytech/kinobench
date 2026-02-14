<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Config, Data, Layout } from 'plotly.js'

interface TelemetrySeries {
  tsMs: number[]
  voltageV: number[]
  currentA: number[]
  powerW: number[]
  accumulatedMah: number[]
}

const props = defineProps<{
  series: TelemetrySeries
  inactive: boolean
}>()

const plotEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
const hiddenTraceNames = ref<Set<string>>(new Set())
let legendClickHandler: ((event: unknown) => boolean) | null = null
let legendDoubleClickHandler: (() => boolean) | null = null
type PlotlyLib = typeof import('plotly.js-dist-min').default
let plotly: PlotlyLib | null = null

async function ensurePlotly(): Promise<PlotlyLib> {
  if (!plotly) {
    const module = await import('plotly.js-dist-min')
    plotly = module.default
  }
  return plotly
}

function traceVisible(name: string): true | 'legendonly' {
  return hiddenTraceNames.value.has(name) ? 'legendonly' : true
}

function buildTraces(series: TelemetrySeries, inactive: boolean): Data[] {
  const xValues = series.tsMs.map((ts) => new Date(ts))
  const opacity = inactive ? 0.35 : 1
  const width = inactive ? 1.5 : 2

  return [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Voltage (V)',
      x: xValues,
      y: series.voltageV,
      yaxis: 'y',
      line: { color: '#1E88E5', width },
      opacity,
      visible: traceVisible('Voltage (V)'),
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Current (A)',
      x: xValues,
      y: series.currentA,
      yaxis: 'y2',
      line: { color: '#43A047', width },
      opacity,
      visible: traceVisible('Current (A)'),
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Power (W)',
      x: xValues,
      y: series.powerW,
      yaxis: 'y3',
      line: { color: '#FB8C00', width },
      opacity,
      visible: traceVisible('Power (W)'),
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Accum. Charge (mAh)',
      x: xValues,
      y: series.accumulatedMah,
      yaxis: 'y4',
      line: { color: '#8E24AA', width },
      opacity,
      visible: traceVisible('Accum. Charge (mAh)'),
    },
  ]
}

function buildLayout(): Partial<Layout> {
  return {
    margin: { l: 56, r: 56, t: 14, b: 34 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    showlegend: true,
    uirevision: 'telemetry',
    legend: { orientation: 'h', y: -0.24 },
    hovermode: 'x unified',
    xaxis: {
      type: 'date',
      title: { text: 'Time' },
      showgrid: true,
      zeroline: false,
      rangeslider: { visible: false },
    },
    yaxis: {
      title: { text: 'Voltage (V)' },
      side: 'left',
      showgrid: true,
      zeroline: false,
    },
    yaxis2: {
      title: { text: 'Current (A)' },
      side: 'right',
      overlaying: 'y',
      showgrid: false,
      zeroline: false,
    },
    yaxis3: {
      title: { text: 'Power (W)' },
      side: 'left',
      overlaying: 'y',
      position: 0.06,
      showgrid: false,
      zeroline: false,
    },
    yaxis4: {
      title: { text: 'Accum. Charge (mAh)' },
      side: 'right',
      overlaying: 'y',
      position: 0.94,
      showgrid: false,
      zeroline: false,
    },
  }
}

const config: Partial<Config> = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
}

async function renderPlot(): Promise<void> {
  if (!plotEl.value) return
  const lib = await ensurePlotly()
  await lib.react(plotEl.value, buildTraces(props.series, props.inactive), buildLayout(), config)
}

onMounted(async () => {
  if (!plotEl.value) return
  const lib = await ensurePlotly()
  await lib.newPlot(plotEl.value, buildTraces(props.series, props.inactive), buildLayout(), config)
  const plot = plotEl.value as HTMLElement & {
    on?: (eventName: string, cb: (event: unknown) => boolean) => void
    removeListener?: (eventName: string, cb: (event: unknown) => boolean) => void
  }
  legendClickHandler = (event: unknown) => {
    const legendEvent = event as {
      curveNumber?: number
      data?: Array<{ name?: string }>
      fullData?: Array<{ name?: string }>
    }
    const curveNumber = legendEvent.curveNumber ?? -1
    const nameFromData = curveNumber >= 0 ? legendEvent.data?.[curveNumber]?.name : undefined
    const nameFromFullData = curveNumber >= 0 ? legendEvent.fullData?.[curveNumber]?.name : undefined
    const traceName = nameFromData ?? nameFromFullData
    if (!traceName) return false

    if (hiddenTraceNames.value.has(traceName)) {
      hiddenTraceNames.value.delete(traceName)
    } else {
      hiddenTraceNames.value.add(traceName)
    }
    renderPlot().catch(() => {})
    return false
  }
  legendDoubleClickHandler = () => false
  plot.on?.('plotly_legendclick', legendClickHandler)
  plot.on?.('plotly_legenddoubleclick', legendDoubleClickHandler)

  resizeObserver = new ResizeObserver(() => {
    if (plotEl.value && plotly) plotly.Plots.resize(plotEl.value).catch(() => {})
  })
  resizeObserver.observe(plotEl.value)
})

watch(
  () => [props.series, props.inactive] as const,
  () => {
    renderPlot().catch(() => {})
  },
  { deep: true },
)

onBeforeUnmount(() => {
  const plot = plotEl.value as HTMLElement & {
    removeListener?: (eventName: string, cb: (event: unknown) => boolean) => void
  }
  if (legendClickHandler) plot.removeListener?.('plotly_legendclick', legendClickHandler)
  if (legendDoubleClickHandler) plot.removeListener?.('plotly_legenddoubleclick', legendDoubleClickHandler)
  if (resizeObserver && plotEl.value) {
    resizeObserver.unobserve(plotEl.value)
    resizeObserver.disconnect()
  }
  if (plotEl.value && plotly) plotly.purge(plotEl.value)
})
</script>

<template>
  <div ref="plotEl" class="telemetry-plot" />
</template>

<style scoped>
.telemetry-plot {
  width: 100%;
  min-height: 360px;
}
</style>
