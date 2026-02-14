<script setup lang="ts">
import { useAnkerCharger } from '../composables/useAnkerCharger'

const { connected, loading, error, cryptoState, deviceInfo, connect, disconnect } = useAnkerCharger()
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-bluetooth</v-icon>
      Anker Charger
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
          Connect to an Anker charger via Bluetooth LE. Make sure Bluetooth is enabled and the
          charger is powered on.
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
            <tr v-if="deviceInfo?.mac">
              <td class="font-weight-medium">MAC Address</td>
              <td><code>{{ deviceInfo.mac }}</code></td>
            </tr>
            <tr v-if="deviceInfo?.serial">
              <td class="font-weight-medium">Serial</td>
              <td><code>{{ deviceInfo.serial }}</code></td>
            </tr>
            <tr v-if="deviceInfo?.firmware">
              <td class="font-weight-medium">BLE Firmware</td>
              <td>{{ deviceInfo.firmware }}</td>
            </tr>
            <tr>
              <td class="font-weight-medium">Encryption</td>
              <td>
                <v-chip
                  size="small"
                  :color="
                    cryptoState === 'Session'
                      ? 'success'
                      : cryptoState === 'Initial'
                        ? 'warning'
                        : 'default'
                  "
                >
                  {{ cryptoState }}
                </v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>
        <div v-if="deviceInfo?.firmware" class="text-caption text-disabled mt-2">
          This is the BLE module firmware from handshake metadata. Main charger firmware may differ.
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>
