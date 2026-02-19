<script setup lang="ts">
import { useAlientekModeOne } from '../composables/useAlientekModeOne'

const { connected, loading, error, deviceInfo, connect, disconnect } = useAlientekModeOne()
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
          </tbody>
        </v-table>
      </div>
    </v-card-text>
  </v-card>
</template>
