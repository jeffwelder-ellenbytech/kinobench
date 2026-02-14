<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAnkerBattery } from '../composables/useAnkerBattery'

const { connected, powerStatus, refreshStatus, startPolling, stopPolling, lastPolledAt } = useAnkerBattery()

const autoRefresh = ref(false)
const pollInterval = ref(2000)

watch(autoRefresh, (enabled) => {
  if (enabled && connected.value) {
    startPolling(pollInterval.value)
  } else {
    stopPolling()
  }
})

watch(connected, (isConnected) => {
  if (!isConnected) {
    autoRefresh.value = false
  }
})

function modeColor(mode: string): string {
  if (mode === 'Output') return 'success'
  if (mode === 'Input') return 'info'
  return 'default'
}

const ports = [
  { key: 'usbC1' as const, label: 'USB-C 1', icon: 'mdi-usb-c-port' },
  { key: 'usbC2' as const, label: 'USB-C 2', icon: 'mdi-usb-c-port' },
  { key: 'usbA' as const, label: 'USB-A', icon: 'mdi-usb-port' },
]

const lastPolledLabel = computed(() => {
  if (!lastPolledAt.value) return 'Never'
  return lastPolledAt.value.toLocaleTimeString()
})
</script>

<template>
  <v-card :disabled="!connected">
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-lightning-bolt</v-icon>
      Power Monitor
      <v-spacer />
      <v-switch
        v-model="autoRefresh"
        label="Auto"
        density="compact"
        hide-details
        class="mr-2 flex-grow-0"
        :disabled="!connected"
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

      <!-- Battery & Summary -->
      <v-row class="mb-2">
        <v-col cols="4" class="text-center">
          <div class="text-h3 font-weight-bold">{{ powerStatus.batteryPercent }}%</div>
          <div class="text-caption text-disabled">Battery</div>
        </v-col>
        <v-col cols="4" class="text-center">
          <div class="text-h5">{{ powerStatus.totalOutputW }} W</div>
          <div class="text-caption text-disabled">Output</div>
        </v-col>
        <v-col cols="4" class="text-center">
          <div class="text-h5">{{ powerStatus.totalInputW }} W</div>
          <div class="text-caption text-disabled">Input</div>
        </v-col>
      </v-row>

      <div v-if="powerStatus.temperature" class="text-caption text-disabled mb-3">
        Temperature: {{ powerStatus.temperature }} °C
      </div>

      <!-- Per-port cards -->
      <v-row>
        <v-col v-for="port in ports" :key="port.key" cols="12" sm="4">
          <v-card
            variant="outlined"
            :class="{ 'opacity-40': powerStatus[port.key].mode === 'Off' }"
          >
            <v-card-title class="text-subtitle-2 d-flex align-center pa-3 pb-1">
              <v-icon size="small" class="mr-1">{{ port.icon }}</v-icon>
              {{ port.label }}
              <v-spacer />
              <v-chip size="x-small" :color="modeColor(powerStatus[port.key].mode)">
                {{ powerStatus[port.key].mode }}
              </v-chip>
            </v-card-title>
            <v-card-text class="pa-3 pt-1">
              <div class="d-flex justify-space-between text-body-2">
                <span>{{ powerStatus[port.key].voltage }} V</span>
                <span>{{ powerStatus[port.key].current }} A</span>
                <span class="font-weight-medium">{{ powerStatus[port.key].power }} W</span>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>
