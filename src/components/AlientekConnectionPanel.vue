<script setup lang="ts">
import { computed } from 'vue'
import { useAlientekModeOne } from '../composables/useAlientekModeOne'

const { connected, loading, error, deviceInfo, status, connect, disconnect } = useAlientekModeOne()

const lastNotifyHex = computed(() => {
  const raw = status.value.rawHex ?? ''
  if (!raw) return ''
  const bytes = raw.match(/.{1,2}/g)
  return bytes ? bytes.join(' ').toUpperCase() : ''
})

const lastNotifyBytes = computed(() => {
  const raw = status.value.rawHex ?? ''
  const bytes = raw.match(/.{1,2}/g)
  if (!bytes || bytes.length === 0) return []
  return bytes.map((b) => b.toUpperCase())
})

function hexRange(start: number, end: number): string {
  const bytes = lastNotifyBytes.value
  if (!bytes.length || start < 0 || end < start) return '--'
  const slice = bytes.slice(start, end + 1)
  if (!slice.length) return '--'
  return slice.join(' ')
}
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-bluetooth</v-icon>
      Alientek EL15
      <v-spacer />
      <v-chip :color="connected ? 'success' : 'error'" size="small" variant="flat">
        {{ connected ? 'Connected' : 'Disconnected' }}
      </v-chip>
    </v-card-title>

    <v-card-text>
      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        closable
        class="mb-4"
        @click:close="error = null"
      >
        {{ error }}
      </v-alert>

      <div v-if="!connected">
        <p class="text-body-2 mb-4">
          Connect to the Alientek EL15 over Bluetooth LE. Put the device in BLE mode and keep it
          nearby.
        </p>
        <v-btn color="primary" :loading="loading" prepend-icon="mdi-bluetooth" @click="connect">
          Connect
        </v-btn>
      </div>

      <div v-else>
        <v-btn
          color="error"
          variant="outlined"
          prepend-icon="mdi-close"
          class="mb-4"
          @click="disconnect"
        >
          Disconnect
        </v-btn>

        <v-table density="compact">
          <tbody>
            <tr v-if="deviceInfo?.name">
              <td class="font-weight-medium">Name</td>
              <td><code>{{ deviceInfo.name }}</code></td>
            </tr>
            <tr v-if="deviceInfo?.id">
              <td class="font-weight-medium">Device ID</td>
              <td><code>{{ deviceInfo.id }}</code></td>
            </tr>
            <tr v-if="deviceInfo?.writeCharacteristic">
              <td class="font-weight-medium">Write Char</td>
              <td><code>{{ deviceInfo.writeCharacteristic }}</code></td>
            </tr>
            <tr v-if="deviceInfo?.notifyCharacteristic">
              <td class="font-weight-medium">Notify Char</td>
              <td><code>{{ deviceInfo.notifyCharacteristic }}</code></td>
            </tr>
            <tr v-if="lastNotifyHex">
              <td class="font-weight-medium">Last Notify</td>
              <td>
                <code class="notify-hex">{{ lastNotifyHex }}</code>
                <div class="notify-breakdown mt-2">
                  <div class="notify-title">Byte Breakdown (28-byte status frame)</div>
                  <div class="notify-row"><span class="range">0-6</span><span class="bytes">{{ hexRange(0, 6) }}</span><span class="desc">Header (DF 07 03 08 unk1 mode/fan run)</span></div>
                  <div class="notify-row"><span class="range">7-10</span><span class="bytes">{{ hexRange(7, 10) }}</span><span class="desc">Voltage (float, little-endian)</span></div>
                  <div class="notify-row"><span class="range">11-14</span><span class="bytes">{{ hexRange(11, 14) }}</span><span class="desc">Current (float, little-endian)</span></div>
                  <div class="notify-row"><span class="range">15-18</span><span class="bytes">{{ hexRange(15, 18) }}</span><span class="desc">Runtime (long, little-endian)</span></div>
                  <div class="notify-row"><span class="range">19-22</span><span class="bytes">{{ hexRange(19, 22) }}</span><span class="desc">Temperature (float, little-endian)</span></div>
                  <div class="notify-row"><span class="range">23-26</span><span class="bytes">{{ hexRange(23, 26) }}</span><span class="desc">Setpoint (float, little-endian)</span></div>
                  <div class="notify-row"><span class="range">27</span><span class="bytes">{{ hexRange(27, 27) }}</span><span class="desc">CRC</span></div>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.notify-hex {
  display: inline-block;
  line-height: 1.45;
  word-break: break-word;
}

.notify-breakdown {
  font-size: 0.8rem;
  line-height: 1.35;
}

.notify-title {
  font-weight: 700;
  margin-bottom: 4px;
}

.notify-row {
  display: grid;
  grid-template-columns: 48px minmax(130px, 220px) 1fr;
  gap: 8px;
  margin-bottom: 2px;
}

.range,
.bytes {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}

.range {
  font-weight: 700;
}

.bytes {
  word-break: break-word;
}
</style>
