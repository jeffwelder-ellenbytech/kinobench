<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Config, Data, Layout } from 'plotly.js'

interface ChartRow {
  time: number
  voltage: number
  current: number
  power: number
}

const props = defineProps<{
  data: ChartRow[]
  showPower: boolean
}>()

const plotEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

let plotly: typeof import('plotly.js-dist-min').default | null = null

async function ensurePlotly() {
  if (!plotly) {
    const module = await import('plotly.js-dist-min')
    plotly = module.default
  }
  return plotly
}

function buildTraces(data: ChartRow[], showPower: boolean): Data[] {
  const x = data.map((row) => new Date(row.time))
  return [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Voltage (V)',
      x,
      y: data.map((row) => row.voltage),
      yaxis: 'y',
      line: { color: '#1E88E5', width: 2 },
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Current (A)',
      x,
      y: data.map((row) => row.current),
      yaxis: 'y2',
      line: { color: '#43A047', width: 2 },
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Power (W)',
      x,
      y: data.map((row) => row.power),
      yaxis: 'y3',
      line: { color: '#FB8C00', width: 2 },
      visible: showPower ? true : 'legendonly',
    },
  ]
}

function buildLayout(showPower: boolean): Partial<Layout> {
  return {
    margin: { l: 56, r: 56, t: 14, b: 34 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    showlegend: true,
    hovermode: 'x unified',
    xaxis: {
      type: 'date',
      title: { text: 'Time' },
      showgrid: true,
      zeroline: false,
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
      side: 'right',
      overlaying: 'y',
      position: 0.94,
      showgrid: false,
      zeroline: false,
      visible: showPower,
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
  await lib.react(plotEl.value, buildTraces(props.data, props.showPower), buildLayout(props.showPower), config)
}

onMounted(async () => {
  if (!plotEl.value) return
  const lib = await ensurePlotly()
  await lib.newPlot(plotEl.value, buildTraces(props.data, props.showPower), buildLayout(props.showPower), config)
  resizeObserver = new ResizeObserver(() => {
    if (plotEl.value && plotly) plotly.Plots.resize(plotEl.value).catch(() => {})
  })
  resizeObserver.observe(plotEl.value)
})

watch(
  () => [props.data, props.showPower] as const,
  () => {
    renderPlot().catch(() => {})
  },
  { deep: true },
)

onBeforeUnmount(() => {
  if (resizeObserver && plotEl.value) {
    resizeObserver.unobserve(plotEl.value)
    resizeObserver.disconnect()
  }
  if (plotEl.value && plotly) plotly.purge(plotEl.value)
})
</script>

<template>
  <v-card>
    <v-card-title>Monitor Chart</v-card-title>
    <v-card-text>
      <div ref="plotEl" class="dp100-plot" />
    </v-card-text>
  </v-card>
</template>

<style scoped>
.dp100-plot {
  width: 100%;
  min-height: 360px;
}
</style>
