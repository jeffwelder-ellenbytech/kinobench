<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAlientekModeOne } from '../composables/useAlientekModeOne'

const { connected, status, refreshStatus, setLoad, setCurrent, setBasicSetpoint, setMode, startPolling, stopPolling, lastPolledAt, disconnect } = useAlientekModeOne()

type MainMode = 'Basic' | 'Battery' | 'Power' | 'Advanced'
type BasicSubMode = 'cc' | 'cv' | 'cr' | 'cp'

const autoRefresh = ref(true)
const pollInterval = ref(1000)
const loadChanging = ref(false)
const currentChanging = ref(false)
const modeChanging = ref(false)
const editingSetpoint = ref(false)
const modeSwitchToast = ref(false)
const setCurrentInput = ref(2)
const cvVoltageInput = ref(5.0)
const crResistanceInput = ref(10.0)
const cpPowerInput = ref(10.0)
const activeMainMode = ref<MainMode>('Basic')
const basicSubMode = ref<BasicSubMode>('cc')
const syncFromStatus = ref(false)

const mainModes: MainMode[] = ['Basic', 'Battery', 'Power', 'Advanced']

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
  if (activeMainMode.value !== 'Basic') return activeMainMode.value.toUpperCase()
  if (basicSubMode.value === 'cc') return 'CC'
  if (basicSubMode.value === 'cv') return 'CV'
  if (basicSubMode.value === 'cr') return 'CR'
  if (basicSubMode.value === 'cp') return 'CP'
  return `M${status.value.mode}`
})
const profileLabel = computed(() => activeMainMode.value)
const isBasicMode = computed(() => activeMainMode.value === 'Basic')
const lastPolledLabel = computed(() => (lastPolledAt.value ? lastPolledAt.value.toLocaleTimeString() : 'Never'))
const loadIsOn = computed(() => status.value.run !== 0)
const currentInputValid = computed(() => Number.isFinite(setCurrentInput.value) && setCurrentInput.value >= 0)
const basicApplyDisabled = computed(() => {
  if (!connected.value || !isBasicMode.value || currentChanging.value) return true
  if (basicSubMode.value === 'cc') return !currentInputValid.value
  if (basicSubMode.value === 'cv') return !(Number.isFinite(cvVoltageInput.value) && cvVoltageInput.value >= 0)
  if (basicSubMode.value === 'cr') return !(Number.isFinite(crResistanceInput.value) && crResistanceInput.value >= 0)
  return !(Number.isFinite(cpPowerInput.value) && cpPowerInput.value >= 0)
})

const modeValueBySubMode: Record<BasicSubMode, number> = {
  cc: 0x01,
  cv: 0x09,
  cr: 0x11,
  cp: 0x19,
}
const basicApplyLabel = computed(() => {
  if (basicSubMode.value === 'cc') return 'Apply Current'
  if (basicSubMode.value === 'cv') return 'Apply Voltage'
  if (basicSubMode.value === 'cr') return 'Apply Resistance'
  return 'Apply Power'
})
const basicApplyHint = computed(() => {
  if (!isBasicMode.value) return 'Sub-mode controls are enabled in Basic mode.'
  return ''
})

function syncModeFromStatus(mode: number) {
  syncFromStatus.value = true
  if (mode === 0x01 || mode === 0x00) {
    activeMainMode.value = 'Basic'
    basicSubMode.value = 'cc'
  } else if (mode === 0x08 || mode === 0x09) {
    activeMainMode.value = 'Basic'
    basicSubMode.value = 'cv'
  } else if (mode === 0x10 || mode === 0x11) {
    activeMainMode.value = 'Basic'
    basicSubMode.value = 'cr'
  } else if (mode === 0x18 || mode === 0x19) {
    activeMainMode.value = 'Basic'
    basicSubMode.value = 'cp'
  } else if (mode === 0x02 || mode === 0x0a) {
    activeMainMode.value = 'Battery'
  }
  queueMicrotask(() => {
    syncFromStatus.value = false
  })
}

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

function padFormatted(value: number, intDigits: number, decimals: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  const fixed = safe.toFixed(decimals)
  const [intPart, fracPart] = fixed.split('.')
  const paddedInt = (intPart ?? '0').padStart(intDigits, '0')
  return fracPart !== undefined ? `${paddedInt}.${fracPart}` : paddedInt
}

const setpointLabel = computed(() => {
  if (activeMainMode.value !== 'Basic') return 'Set Value'
  if (basicSubMode.value === 'cc') return 'Set Current'
  if (basicSubMode.value === 'cv') return 'Set Voltage'
  if (basicSubMode.value === 'cr') return 'Set Res'
  return 'Set Power'
})

const setpointDisplayValue = computed(() => {
  const value = status.value.setpoint
  if (activeMainMode.value !== 'Basic') return value.toFixed(3)
  if (basicSubMode.value === 'cc') return padFormatted(value, 2, 3)
  if (basicSubMode.value === 'cv') return padFormatted(value, 2, 3)
  if (basicSubMode.value === 'cr') return padFormatted(value, 3, 1)
  return padFormatted(value, 3, 2)
})

const setpointDisplayUnit = computed(() => {
  if (activeMainMode.value !== 'Basic') return ''
  if (basicSubMode.value === 'cc') return 'A'
  if (basicSubMode.value === 'cv') return 'V'
  if (basicSubMode.value === 'cr') return 'Ohms'
  return 'W'
})

const modeSwitchToastText = 'Turn output OFF before changing Basic sub modes.'

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

function onSetpointFocus() {
  editingSetpoint.value = true
}

function onSetpointBlur() {
  editingSetpoint.value = false
}

function syncSetpointIntoActiveInput(setpoint: number) {
  if (basicSubMode.value === 'cc') {
    setCurrentInput.value = Number(setpoint.toFixed(3))
  } else if (basicSubMode.value === 'cv') {
    cvVoltageInput.value = Number(setpoint.toFixed(3))
  } else if (basicSubMode.value === 'cr') {
    crResistanceInput.value = Number(setpoint.toFixed(1))
  } else if (basicSubMode.value === 'cp') {
    cpPowerInput.value = Number(setpoint.toFixed(2))
  }
}

watch(
  () => [status.value.setpoint, basicSubMode.value] as const,
  ([setpoint]) => {
    if (!currentChanging.value && !editingSetpoint.value) syncSetpointIntoActiveInput(setpoint)
  },
  { immediate: true },
)
watch(
  () => status.value.mode,
  (mode) => syncModeFromStatus(mode),
  { immediate: true },
)

watch(basicSubMode, async (next) => {
  if (!connected.value || !isBasicMode.value || syncFromStatus.value || modeChanging.value) return
  const targetMode = modeValueBySubMode[next]
  if (status.value.mode === targetMode) return
  modeChanging.value = true
  try {
    await setMode(targetMode)
  } finally {
    modeChanging.value = false
  }
})

function onBasicSubModeRequested(next: BasicSubMode | null) {
  if (!next || next === basicSubMode.value) return
  if (loadIsOn.value) {
    modeSwitchToast.value = true
    return
  }
  basicSubMode.value = next
}

async function applyBasicParameter() {
  if (basicApplyDisabled.value) return
  editingSetpoint.value = false
  currentChanging.value = true
  try {
    if (basicSubMode.value === 'cc') await setCurrent(setCurrentInput.value)
    else if (basicSubMode.value === 'cv') await setBasicSetpoint(cvVoltageInput.value)
    else if (basicSubMode.value === 'cr') await setBasicSetpoint(crResistanceInput.value)
    else if (basicSubMode.value === 'cp') await setBasicSetpoint(cpPowerInput.value)
  } finally {
    currentChanging.value = false
  }
}
</script>

<template>
  <v-card class="mode-one-wrap pa-4">
    <div class="d-flex align-center mb-3">
      <div class="d-flex flex-column">
        <div class="text-subtitle-1 font-weight-bold">EL15 Measurement Interface</div>
        <div class="text-caption text-disabled">Last live poll: {{ lastPolledLabel }}</div>
      </div>
      <v-spacer />
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
      <div>
        <div class="measurement-display" :class="{ 'opacity-50': !connected }">
        <div class="topbar">
          <div class="status-left">{{ status.run ? 'ON' : 'OFF' }}</div>
          <div class="status-fan">
            <v-icon v-if="status.fan" icon="mdi-fan" size="22" />
            <span v-else>-</span>
            <v-icon icon="mdi-bluetooth" size="24" class="ml-1" />
          </div>
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
            <div class="label">{{ setpointLabel }}</div>
            <div class="small-value">{{ setpointDisplayValue }} {{ setpointDisplayUnit }}</div>
          </div>
        </div>
      </div>
      </div>

      <div class="side-controls">
        <v-card variant="outlined" class="pa-3 mb-3">
          <div class="text-subtitle-2 mb-2">Main Modes</div>
          <div class="main-mode-list mb-3">
            <v-chip
              v-for="mode in mainModes"
              :key="mode"
              size="small"
              :color="activeMainMode === mode ? 'primary' : 'default'"
              variant="flat"
            >
              {{ mode }}
            </v-chip>
          </div>

          <div class="text-subtitle-2 mb-2">Basic Sub Modes</div>
          <v-btn-toggle
            :model-value="basicSubMode"
            @update:model-value="onBasicSubModeRequested"
            mandatory
            rounded="pill"
            density="compact"
            class="mb-3 radial-group"
            :disabled="!connected || !isBasicMode || modeChanging"
          >
            <v-btn value="cc">CC</v-btn>
            <v-btn value="cv">CV</v-btn>
            <v-btn value="cr">CR</v-btn>
            <v-btn value="cp">CP</v-btn>
          </v-btn-toggle>

          <div class="text-subtitle-2 mb-2">
            <template v-if="basicSubMode === 'cc'">Set Current (A)</template>
            <template v-else-if="basicSubMode === 'cv'">Set Voltage (V)</template>
            <template v-else-if="basicSubMode === 'cr'">Set Resistance (Ohms)</template>
            <template v-else>Set Power (W)</template>
          </div>
          <v-text-field
            v-if="basicSubMode === 'cc'"
            v-model.number="setCurrentInput"
            type="number"
            min="0"
            step="0.001"
            density="compact"
            hide-details
            suffix="A"
            class="mb-2"
            :disabled="!connected || !isBasicMode || currentChanging"
            @focus="onSetpointFocus"
            @blur="onSetpointBlur"
            @keydown.enter.prevent="applyBasicParameter"
          />
          <v-text-field
            v-else-if="basicSubMode === 'cv'"
            v-model.number="cvVoltageInput"
            type="number"
            min="0"
            step="0.001"
            density="compact"
            hide-details
            suffix="V"
            class="mb-2"
            :disabled="!connected || !isBasicMode || currentChanging"
            @focus="onSetpointFocus"
            @blur="onSetpointBlur"
            @keydown.enter.prevent="applyBasicParameter"
          />
          <v-text-field
            v-else-if="basicSubMode === 'cr'"
            v-model.number="crResistanceInput"
            type="number"
            min="0"
            step="0.1"
            density="compact"
            hide-details
            suffix="Ohms"
            class="mb-2"
            :disabled="!connected || !isBasicMode || currentChanging"
            @focus="onSetpointFocus"
            @blur="onSetpointBlur"
            @keydown.enter.prevent="applyBasicParameter"
          />
          <v-text-field
            v-else
            v-model.number="cpPowerInput"
            type="number"
            min="0"
            step="0.01"
            density="compact"
            hide-details
            suffix="W"
            class="mb-2"
            :disabled="!connected || !isBasicMode || currentChanging"
            @focus="onSetpointFocus"
            @blur="onSetpointBlur"
            @keydown.enter.prevent="applyBasicParameter"
          />
          <div class="text-caption text-disabled mb-2">
            <template v-if="basicSubMode === 'cv'">Target format: 05.000V</template>
            <template v-else-if="basicSubMode === 'cr'">Target format: 0010.0Ohms</template>
            <template v-else-if="basicSubMode === 'cp'">Target format: 010.00W</template>
          </div>
          <v-btn
            block
            color="primary"
            :loading="currentChanging"
            :disabled="basicApplyDisabled"
            @click="applyBasicParameter"
          >
            {{ basicApplyLabel }}
          </v-btn>
          <div v-if="basicApplyHint" class="text-caption text-disabled mt-2">
            {{ basicApplyHint }}
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
    <v-snackbar v-model="modeSwitchToast" timeout="1800" color="warning">
      {{ modeSwitchToastText }}
    </v-snackbar>
  </v-card>
</template>

<style scoped>
.mode-one-wrap {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.display-layout {
  display: inline-grid;
  grid-template-columns: minmax(0, 760px) 300px;
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
  min-width: 300px;
}

.main-mode-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.radial-group :deep(.v-btn) {
  min-width: 54px;
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
