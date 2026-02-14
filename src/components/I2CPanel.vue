<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBusPirate } from '../composables/useBusPirate'

const { connected, lastResponse, error, loading, log, configureI2C, i2cRead, i2cWrite } =
  useBusPirate()

// I2C Config
const i2cSpeed = ref(100)
const clockStretch = ref(false)

// Transaction
const txAddress = ref('50')
const txMode = ref<'read' | 'write'>('read')
const txWriteData = ref('')
const txReadCount = ref(2)

const addressValid = computed(() => {
  const val = parseInt(txAddress.value, 16)
  return !isNaN(val) && val >= 0x00 && val <= 0x7f
})

const writeDataValid = computed(() => {
  if (txMode.value !== 'write') return true
  const trimmed = txWriteData.value.trim()
  if (!trimmed) return false
  return trimmed.split(/[\s,]+/).every((b) => {
    const val = parseInt(b, 16)
    return !isNaN(val) && val >= 0x00 && val <= 0xff
  })
})

const formValid = computed(() => {
  return addressValid.value && (txMode.value === 'read' || writeDataValid.value)
})

function parseHexBytes(str: string): number[] {
  return str
    .trim()
    .split(/[\s,]+/)
    .map((b) => parseInt(b, 16))
}

function formatHexDump(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

async function handleConfigure() {
  await configureI2C(i2cSpeed.value * 1000, clockStretch.value)
}

async function handleSend() {
  const addr = parseInt(txAddress.value, 16)
  if (txMode.value === 'read') {
    await i2cRead(addr, txReadCount.value)
  } else {
    const data = parseHexBytes(txWriteData.value)
    await i2cWrite(addr, data)
  }
}
</script>

<template>
  <v-card :disabled="!connected">
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-bus-clock</v-icon>
      I2C
    </v-card-title>

    <v-card-text>
      <v-alert v-if="!connected" type="info" variant="tonal" density="compact" class="mb-4">
        Connect to a Bus Pirate first.
      </v-alert>

      <!-- I2C Configuration -->
      <div class="text-subtitle-2 mb-2">Configure I2C Mode</div>
      <v-row dense>
        <v-col cols="6" sm="4">
          <v-select
            v-model="i2cSpeed"
            :items="[10, 50, 100, 400, 1000]"
            label="Speed (kHz)"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="6" sm="4" class="d-flex align-center">
          <v-switch
            v-model="clockStretch"
            label="Clock Stretch"
            density="compact"
            hide-details
          />
        </v-col>
        <v-col cols="12" sm="4" class="d-flex align-center">
          <v-btn
            color="primary"
            variant="tonal"
            :loading="loading"
            :disabled="!connected"
            @click="handleConfigure"
          >
            Configure
          </v-btn>
        </v-col>
      </v-row>

      <v-divider class="my-4" />

      <!-- I2C Transaction -->
      <div class="text-subtitle-2 mb-2">I2C Transaction</div>
      <v-row dense>
        <v-col cols="6" sm="3">
          <v-text-field
            v-model="txAddress"
            label="Address (hex, 7-bit)"
            prefix="0x"
            density="compact"
            variant="outlined"
            :error="!!txAddress && !addressValid"
            hint="e.g. 50 for EEPROM"
            persistent-hint
          />
        </v-col>
        <v-col cols="6" sm="3">
          <v-btn-toggle v-model="txMode" mandatory density="compact" color="primary">
            <v-btn value="read">Read</v-btn>
            <v-btn value="write">Write</v-btn>
          </v-btn-toggle>
        </v-col>
        <v-col v-if="txMode === 'read'" cols="6" sm="3">
          <v-text-field
            v-model.number="txReadCount"
            label="Bytes to read"
            type="number"
            :min="1"
            :max="512"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col v-if="txMode === 'write'" cols="12" sm="6">
          <v-text-field
            v-model="txWriteData"
            label="Data (hex bytes)"
            density="compact"
            variant="outlined"
            :error="!!txWriteData && !writeDataValid"
            hint="e.g. A0 01 FF"
            persistent-hint
          />
        </v-col>
      </v-row>

      <v-btn
        color="primary"
        :loading="loading"
        :disabled="!connected || !formValid"
        prepend-icon="mdi-send"
        class="mt-2"
        @click="handleSend"
      >
        Send
      </v-btn>

      <!-- Result -->
      <div v-if="lastResponse" class="mt-4">
        <v-alert
          v-if="lastResponse.error"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-2"
        >
          {{ lastResponse.error }}
        </v-alert>
        <div v-if="lastResponse.dataRead.length > 0">
          <div class="text-subtitle-2 mb-1">Response Data</div>
          <v-sheet rounded color="surface-variant" class="pa-3 font-weight-medium" style="font-family: monospace">
            {{ formatHexDump(lastResponse.dataRead) }}
          </v-sheet>
          <div class="text-caption mt-1">{{ lastResponse.dataRead.length }} byte(s)</div>
        </div>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-4">
        {{ error }}
      </v-alert>

      <!-- Transaction Log -->
      <div v-if="log.length" class="mt-4">
        <v-divider class="mb-2" />
        <div class="text-subtitle-2 mb-2">Transaction Log</div>
        <v-virtual-scroll :items="log" :height="250" item-height="40">
          <template #default="{ item }">
            <div class="d-flex align-center text-body-2 py-1">
              <v-chip
                :color="item.error ? 'error' : item.type === 'config' ? 'info' : 'success'"
                size="x-small"
                class="mr-2"
                variant="flat"
              >
                {{ item.type }}
              </v-chip>
              <span class="text-truncate">{{ item.detail }}</span>
              <v-spacer />
              <code v-if="item.result" class="text-success ml-2">{{ item.result }}</code>
              <code v-if="item.error" class="text-error ml-2">{{ item.error }}</code>
              <span class="text-caption text-disabled ml-2">
                {{ item.timestamp.toLocaleTimeString() }}
              </span>
            </div>
          </template>
        </v-virtual-scroll>
      </div>
    </v-card-text>
  </v-card>
</template>
