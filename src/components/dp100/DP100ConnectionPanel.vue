<script setup lang="ts">
defineProps<{
  busy?: boolean
  connected: boolean
  unsupported: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  connect: []
  disconnect: []
}>()
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-usb</v-icon>
      DP100 Connection
      <v-spacer />
      <v-chip :color="connected ? 'success' : 'warning'" size="small" variant="flat">
        {{ connected ? 'Connected' : 'Disconnected' }}
      </v-chip>
    </v-card-title>

    <v-card-text>
      <v-alert
        v-if="unsupported"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        WebHID is not supported in this browser.
      </v-alert>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        {{ error }}
      </v-alert>

      <p class="text-body-2 mb-4">
        Connect the DP100 over USB and allow WebHID access when prompted.
      </p>

      <v-btn
        v-if="!connected"
        color="primary"
        prepend-icon="mdi-usb"
        :disabled="unsupported"
        :loading="busy"
        @click="emit('connect')"
      >
        Connect DP100
      </v-btn>

      <v-btn
        v-else
        color="warning"
        variant="outlined"
        prepend-icon="mdi-close"
        @click="emit('disconnect')"
      >
        Disconnect
      </v-btn>
    </v-card-text>
  </v-card>
</template>
