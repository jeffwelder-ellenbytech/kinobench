<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAlientekModeOne } from '../composables/useAlientekModeOne'

const { connected, status, refreshStatus, setLoad, setCurrent, startPolling, stopPolling, lastPolledAt, disconnect } = useAlientekModeOne()

const autoRefresh = ref(true)
const pollInterval = ref(1000)
const loadChanging = ref(false)
const currentChanging = ref(false)
const setCurrentInput = ref(2)

watch(autoRefresh, (enabled) => {
  if (enabled && connected.value) startPolling(pollInterval.value)
  else stopPolling()
})

watch(connected, (isConnected) => {
  if (isConnected && autoRefresh.value) startPolling(pollInterval.value)
  if (!isConnected) autoRefresh.value = true
})

const power = computed(() => status.value.power)
const tempF = computed(() => status.value.tempF)
const runtimeLabel = computed(() => status.value.runTimeLabel)
const modeLabel = computed(() => {
  const mode = status.value.mode
  if (mode === 0x00) return 'IDLE'
  if (mode === 0x01) return 'CC'
  if (mode === 0x09) return 'CV'
  if (mode === 0x02) return 'CAP'
  if (mode === 0x0a) return 'DCR'
  if (mode === 0x11) return 'CR'
  if (mode === 0x19) return 'CP'
  return `M${mode}`
})
const profileLabel = computed(() => {
  const mode = status.value.mode
  if (mode === 0x02 || mode === 0x0a) return 'Battery'
  if (mode === 0x00) return 'Standby'
  return 'Basic'
})
const isBasicMode = computed(() => profileLabel.value === 'Basic')
const lastPolledLabel = computed(() => (lastPolledAt.value ? lastPolledAt.value.toLocaleTimeString() : 'Never'))
const loadIsOn = computed(() => status.value.run !== 0)
const currentInputValid = computed(() => Number.isFinite(setCurrentInput.value) && setCurrentInput.value >= 0)

function splitDisplayValue(value: number, decimals: number = 5): { main: string; tail: string } {
  const fixed = value.toFixed(decimals)
  return {
    main: fixed.slice(0, -1),
    tail: fixed.slice(-1),
  }
}

const voltageDisplay = computed(() => splitDisplayValue(status.value.voltage, 5))
const currentDisplay = computed(() => splitDisplayValue(status.value.current, 5))
const powerDisplay = computed(() => splitDisplayValue(power.value, 5))

function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals)
}

async function toggleLoad() {
  loadChanging.value = true
  try {
    await setLoad(!loadIsOn.value)
  } finally {
    loadChanging.value = false
  }
}

watch(
  () => status.value.setpoint,
  (setpoint) => {
    if (!currentChanging.value) setCurrentInput.value = Number(setpoint.toFixed(3))
  },
)

async function applySetCurrent() {
  if (!currentInputValid.value) return
  currentChanging.value = true
  try {
    await setCurrent(setCurrentInput.value)
  } finally {
    currentChanging.value = false
  }
}
</script>

<template>
  <v-card class="mode-one-wrap pa-4">
    <div class="d-flex align-center mb-3">
      <div class="text-subtitle-1 font-weight-bold">EL15 Measurement Interface</div>
      <v-spacer />
      <div class="text-caption text-disabled mr-3">Last polled: {{ lastPolledLabel }}</div>
      <v-switch
        v-model="autoRefresh"
        hide-details
        density="compact"
        color="success"
        label="Auto"
      />
      <v-btn
        v-if="connected"
        icon="mdi-bluetooth-off"
        size="small"
        variant="text"
        color="error"
        class="ml-2 mr-1"
        @click="disconnect"
      />
      <v-btn icon="mdi-refresh" size="small" variant="text" :disabled="!connected" @click="refreshStatus" />
    </div>

    <v-alert
      v-if="!connected"
      type="info"
      density="compact"
      variant="tonal"
      class="mb-3"
    >
      Connect from the Alientek panel to start live telemetry.
    </v-alert>

    <div class="display-layout">
      <div class="measurement-display" :class="{ 'opacity-50': !connected }">
        <div class="topbar">
          <div class="status-left">{{ status.run ? 'ON' : 'OFF' }}</div>
          <div class="status-fan">{{ status.fan ? '✻' : '-' }}</div>
          <div class="status-profile">{{ profileLabel }}</div>
          <div class="status-lock">🔓</div>
          <div class="status-mode">{{ modeLabel }}</div>
        </div>

        <div class="readout-grid">
          <div class="tile tile-v">
            <div class="value">
              {{ voltageDisplay.main }}<span class="digit-tail">{{ voltageDisplay.tail }}</span><span class="unit">V</span>
            </div>
          </div>
          <div class="tile tile-a">
            <div class="value">
              {{ currentDisplay.main }}<span class="digit-tail">{{ currentDisplay.tail }}</span><span class="unit">A</span>
            </div>
          </div>
          <div class="tile tile-w">
            <div class="value">
              {{ powerDisplay.main }}<span class="digit-tail">{{ powerDisplay.tail }}</span><span class="unit">W</span>
            </div>
          </div>

          <div class="tile tile-rt">
            <div class="label">Run Time</div>
            <div class="small-value">{{ runtimeLabel }}</div>
          </div>
          <div class="tile tile-temp">
            <div class="label">Temp('F)</div>
            <div class="small-value">{{ fmt(tempF, 2) }}</div>
          </div>
          <div class="tile tile-set">
            <div class="label">Set Current</div>
            <div class="small-value">{{ fmt(status.setpoint, 3) }} A</div>
          </div>
        </div>
      </div>

      <div class="side-controls">
        <v-card variant="outlined" class="pa-3 mb-3">
          <div class="text-subtitle-2 mb-2">Set Current (Basic)</div>
          <v-text-field
            v-model.number="setCurrentInput"
            type="number"
            min="0"
            step="0.001"
            density="compact"
            hide-details
            suffix="A"
            class="mb-2"
            :disabled="!connected || !isBasicMode || currentChanging"
          />
          <v-btn
            block
            color="primary"
            :loading="currentChanging"
            :disabled="!connected || !isBasicMode || !currentInputValid"
            @click="applySetCurrent"
          >
            Apply Current
          </v-btn>
          <div v-if="!isBasicMode" class="text-caption text-disabled mt-2">
            Current setpoint write is enabled in Basic modes.
          </div>
        </v-card>

        <v-btn
          block
          size="large"
          :disabled="!connected"
          :loading="loadChanging"
          :color="loadIsOn ? 'error' : 'success'"
          prepend-icon="mdi-power"
          @click="toggleLoad"
        >
          {{ loadIsOn ? 'Load Off' : 'Load On' }}
        </v-btn>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.mode-one-wrap {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.display-layout {
  display: inline-grid;
  grid-template-columns: minmax(0, 760px) 250px;
  gap: 14px;
  align-items: start;
  justify-content: start;
  width: auto;
  max-width: 100%;
}

.measurement-display {
  width: 100%;
  max-width: 760px;
  border: 3px solid #2874b8;
  border-radius: 10px;
  overflow: hidden;
  background: #0e1724;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35);
}

.side-controls {
  display: flex;
  flex-direction: column;
}

.topbar {
  display: grid;
  grid-template-columns: 72px 54px 1fr 54px 78px;
  align-items: center;
  background: #232a35;
  color: #eef5ff;
  min-height: 48px;
  font-weight: 700;
  font-size: 1.05rem;
}

.status-left {
  color: #ff2c2c;
  text-align: center;
  font-size: 2rem;
  line-height: 1;
}

.status-fan,
.status-profile,
.status-lock,
.status-mode {
  text-align: center;
}

.status-profile {
  font-size: 2rem;
}

.status-mode {
  font-size: 2rem;
}

.readout-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 0.72fr;
  grid-template-rows: repeat(3, 94px);
}

.tile {
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  border-right: 1px solid rgba(255, 255, 255, 0.15);
  padding: 8px 14px;
}

.tile-v {
  grid-column: 1;
  grid-row: 1;
  background: #0fb64f;
}

.tile-a {
  grid-column: 1;
  grid-row: 2;
  background: #cb1c2c;
}

.tile-w {
  grid-column: 1;
  grid-row: 3;
  background: #a525b5;
}

.tile-rt {
  grid-column: 2;
  grid-row: 1;
  background: #1f67ca;
}

.tile-temp {
  grid-column: 2;
  grid-row: 2;
  background: #274f84;
}

.tile-set {
  grid-column: 2;
  grid-row: 3;
  background: #d15f00;
}

.value {
  font-size: 3.2rem;
  line-height: 1;
  color: #f4fffc;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.unit {
  font-size: 0.52em;
  margin-left: 8px;
}

.digit-tail {
  font-size: 0.52em;
  line-height: 1;
  vertical-align: baseline;
  margin-left: 1px;
}

.label {
  font-size: 1.3rem;
  color: #d8ebff;
  margin-bottom: 6px;
}

.small-value {
  font-size: 2.2rem;
  line-height: 1;
  font-weight: 800;
  color: #ffffff;
}

@media (max-width: 1200px) {
  .display-layout {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .measurement-display {
    max-width: 100%;
  }

  .side-controls {
    max-width: 360px;
  }
}

@media (max-width: 900px) {
  .topbar {
    grid-template-columns: 54px 40px 1fr 42px 58px;
    min-height: 40px;
  }

  .status-left,
  .status-profile,
  .status-mode {
    font-size: 1.4rem;
  }

  .readout-grid {
    grid-template-rows: repeat(3, 78px);
  }

  .value {
    font-size: 2.4rem;
  }

  .label {
    font-size: 1rem;
  }

  .small-value {
    font-size: 1.6rem;
  }
}
</style>
