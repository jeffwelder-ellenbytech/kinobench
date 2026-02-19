<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { type TelemetryPortKey, useAnkerCharger } from '../composables/useAnkerCharger'

const AnkerTelemetryGraph = defineAsyncComponent(() => import('./AnkerTelemetryGraph.vue'))

const {
  connected,
  cryptoState,
  powerStatus,
  refreshStatus,
  setPortOutput,
  disconnect,
  startPolling,
  stopPolling,
  lastPolledAt,
  telemetrySeries,
  sessionChargeMetrics,
  selectedTelemetryPort,
  portActivity,
  setSelectedTelemetryPort,
  resetTelemetryHistory,
} = useAnkerCharger()

const autoRefresh = ref(true)
const pollInterval = ref(2000)

watch(autoRefresh, (enabled) => {
  if (enabled && connected.value) {
    startPolling(pollInterval.value)
  } else {
    stopPolling()
  }
})

watch(
  connected,
  (isConnected) => {
    if (isConnected && autoRefresh.value) startPolling(pollInterval.value)
    if (!isConnected) autoRefresh.value = true
  },
  { immediate: true },
)

function modeColor(mode: string): string {
  if (mode === 'Output') return 'success'
  return 'default'
}

const ports = [
  { key: 'usbC1' as const, label: 'USB-C 1', icon: 'mdi-usb-c-port' },
  { key: 'usbC2' as const, label: 'USB-C 2', icon: 'mdi-usb-c-port' },
  { key: 'usbA' as const, label: 'USB-C 3', icon: 'mdi-usb-c-port' },
]

const selectedGraphPort = computed<TelemetryPortKey>({
  get: () => selectedTelemetryPort.value,
  set: (value) => {
    setSelectedTelemetryPort(value)
  },
})

const telemetryPortItems = computed(() =>
  ports.map((port) => ({
    title: port.label,
    value: port.key,
    props: { disabled: !portActivity.value[port.key].isActive },
  })),
)

const selectedPortInactive = computed(() => !portActivity.value[selectedTelemetryPort.value].isActive)
const hasTelemetryData = computed(() => telemetrySeries.value.tsMs.length > 0)
const graphReady = computed(() => connected.value && cryptoState.value === 'Session')
const sessionMahLabel = computed(() => `${sessionChargeMetrics.value.accumulatedMah.toFixed(2)} mAh`)
const sessionChargingTimeLabel = computed(() => {
  const totalSeconds = Math.floor(sessionChargeMetrics.value.chargingMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0')
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0')
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
})

const lastPolledLabel = computed(() => {
  if (!lastPolledAt.value) return 'Never'
  return lastPolledAt.value.toLocaleTimeString()
})

const activePortCount = computed(
  () => ports.filter((port) => portActivity.value[port.key].mode === 'Output').length,
)

const togglingPort = ref<TelemetryPortKey | null>(null)

async function togglePort(port: TelemetryPortKey) {
  const isOutput = powerStatus.value[port].mode === 'Output'
  togglingPort.value = port
  try {
    await setPortOutput(port, !isOutput)
  } catch {
    // Error is already propagated into the store's `error` ref.
  } finally {
    togglingPort.value = null
  }
}
</script>

<template>
  <v-card :disabled="!connected">
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-lightning-bolt</v-icon>
      Charger Monitor
      <v-spacer />
      <v-switch
        v-model="autoRefresh"
        label="Auto"
        density="compact"
        hide-details
        color="success"
        class="mr-2 flex-grow-0"
        :disabled="!connected"
      />
      <v-btn
        v-if="connected"
        icon="mdi-bluetooth-off"
        size="small"
        variant="text"
        color="error"
        class="mr-1"
        @click="disconnect"
      />
      <v-btn
        icon="mdi-refresh"
        size="small"
        variant="text"
        :disabled="!connected"
        @click="refreshStatus"
      />
    </v-card-title>

    <v-card-text>
      <div class="text-caption text-disabled mb-2">Last polled: {{ lastPolledLabel }}</div>

      <v-row class="mb-2">
        <v-col cols="6" class="text-center">
          <div class="text-h5">{{ powerStatus.totalOutputW }} W</div>
          <div class="text-caption text-disabled">Output</div>
        </v-col>
        <v-col cols="6" class="text-center">
          <div class="text-h5">{{ activePortCount }}/3</div>
          <div class="text-caption text-disabled">Active Ports</div>
        </v-col>
      </v-row>

      <div v-if="powerStatus.temperature" class="text-caption text-disabled mb-3">
        Temperature: {{ powerStatus.temperature }} °C
      </div>

      <v-row>
        <v-col v-for="port in ports" :key="port.key" cols="12" sm="4">
          <v-card variant="outlined" :class="{ 'opacity-40': powerStatus[port.key].mode === 'Off' }">
            <v-card-title class="text-subtitle-2 d-flex align-center pa-3 pb-1">
              <v-icon size="small" class="mr-1">{{ port.icon }}</v-icon>
              {{ port.label }}
              <v-spacer />
              <v-chip size="x-small" :color="modeColor(powerStatus[port.key].mode)">
                {{ powerStatus[port.key].mode }}
              </v-chip>
            </v-card-title>
            <v-card-text class="pa-3 pt-1">
              <div v-if="powerStatus[port.key].mode === 'Off'" class="text-caption text-disabled mb-1">
                Inactive
              </div>
              <div class="d-flex justify-space-between text-body-2">
                <span>{{ powerStatus[port.key].voltage }} V</span>
                <span>{{ powerStatus[port.key].current }} A</span>
                <span class="font-weight-medium">{{ powerStatus[port.key].power }} W</span>
              </div>
              <v-btn
                block
                size="small"
                class="mt-3"
                :color="powerStatus[port.key].mode === 'Output' ? 'error' : 'success'"
                :loading="togglingPort === port.key"
                :disabled="!connected || cryptoState !== 'Session' || togglingPort !== null"
                @click="togglePort(port.key)"
              >
                {{ powerStatus[port.key].mode === 'Output' ? 'Turn Off' : 'Turn On' }}
              </v-btn>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-divider class="my-4" />

      <div class="d-flex align-center flex-wrap ga-2 mb-3" :class="{ 'opacity-40': selectedPortInactive }">
        <div class="text-subtitle-2">Scientific Telemetry</div>
        <v-spacer />
        <v-select
          v-model="selectedGraphPort"
          :items="telemetryPortItems"
          item-title="title"
          item-value="value"
          item-props="props"
          label="Port"
          density="compact"
          hide-details
          variant="outlined"
          class="telemetry-port-select"
          :disabled="!connected"
        />
        <v-btn size="small" variant="tonal" :disabled="!connected" @click="resetTelemetryHistory">
          Reset History
        </v-btn>
      </div>

      <div
        class="d-flex align-center flex-wrap ga-4 mb-3 text-caption text-disabled"
        :class="{ 'opacity-40': selectedPortInactive }"
      >
        <div>Session charge: <strong class="text-medium-emphasis">{{ sessionMahLabel }}</strong></div>
        <div>Charging time: <strong class="text-medium-emphasis">{{ sessionChargingTimeLabel }}</strong></div>
      </div>

      <div class="position-relative">
        <AnkerTelemetryGraph v-if="graphReady" :series="telemetrySeries" :inactive="selectedPortInactive" />
        <div v-else class="telemetry-placeholder d-flex align-center justify-center text-caption">
          Graph loads after BLE session key is established.
        </div>
        <div
          v-if="graphReady && (!hasTelemetryData || selectedPortInactive)"
          class="telemetry-overlay d-flex align-center justify-center text-caption"
        >
          {{ !hasTelemetryData ? 'No telemetry yet. Poll or wait for live updates.' : 'Selected port is inactive.' }}
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.telemetry-port-select {
  max-width: 180px;
}

.telemetry-overlay {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.75);
  pointer-events: none;
}

.telemetry-placeholder {
  min-height: 360px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
