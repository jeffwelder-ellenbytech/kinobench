<script setup lang="ts">
import { useBusPirate } from '../composables/useBusPirate'

const { connected, status, error, loading, connect, disconnect, getStatus } = useBusPirate()

async function handleConnect() {
  await connect()
  if (connected.value) {
    await getStatus()
  }
}
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-usb</v-icon>
      Connection
      <v-spacer />
      <v-chip
        :color="connected ? 'success' : 'error'"
        size="small"
        variant="flat"
      >
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
          Connect to a Bus Pirate 5 via the BPIO2 binary interface.
          Make sure your Bus Pirate is plugged in and the second serial port is available.
        </p>
        <v-btn
          color="primary"
          :loading="loading"
          prepend-icon="mdi-connection"
          @click="handleConnect"
        >
          Connect
        </v-btn>
      </div>

      <div v-else>
        <v-btn
          color="error"
          variant="outlined"
          :loading="loading"
          prepend-icon="mdi-close"
          class="mb-4"
          @click="disconnect"
        >
          Disconnect
        </v-btn>

        <div v-if="status">
          <v-table density="compact">
            <tbody>
              <tr>
                <td class="font-weight-medium">Firmware</td>
                <td>v{{ status.firmwareVersion }}</td>
              </tr>
              <tr v-if="status.firmwareGitHash">
                <td class="font-weight-medium">Git Hash</td>
                <td><code>{{ status.firmwareGitHash }}</code></td>
              </tr>
              <tr v-if="status.firmwareDate">
                <td class="font-weight-medium">Build Date</td>
                <td>{{ status.firmwareDate }}</td>
              </tr>
              <tr>
                <td class="font-weight-medium">Hardware</td>
                <td>v{{ status.hardwareVersion }}</td>
              </tr>
              <tr>
                <td class="font-weight-medium">Current Mode</td>
                <td>{{ status.modeCurrent ?? 'HiZ' }}</td>
              </tr>
              <tr>
                <td class="font-weight-medium">Available Modes</td>
                <td>
                  <v-chip
                    v-for="mode in status.modesAvailable"
                    :key="mode"
                    size="x-small"
                    class="mr-1 mb-1"
                  >
                    {{ mode }}
                  </v-chip>
                </td>
              </tr>
              <tr v-if="status.pinLabels.length">
                <td class="font-weight-medium">Pin Labels</td>
                <td>{{ status.pinLabels.join(', ') }}</td>
              </tr>
              <tr>
                <td class="font-weight-medium">PSU</td>
                <td>
                  {{ status.psuEnabled ? `${status.psuMv}mV / ${status.psuMa}mA` : 'Off' }}
                </td>
              </tr>
              <tr>
                <td class="font-weight-medium">Pull-ups</td>
                <td>{{ status.pullupEnabled ? 'Enabled' : 'Disabled' }}</td>
              </tr>
            </tbody>
          </v-table>

          <v-btn
            variant="text"
            size="small"
            prepend-icon="mdi-refresh"
            class="mt-2"
            :loading="loading"
            @click="getStatus"
          >
            Refresh Status
          </v-btn>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>
