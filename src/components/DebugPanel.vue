<script setup lang="ts">
import { useBusPirate } from '../composables/useBusPirate'

const { debugLog, debugEnabled, clearDebugLog } = useBusPirate()
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-bug</v-icon>
      Raw Serial Debug
      <v-spacer />
      <v-switch
        v-model="debugEnabled"
        label="Trace"
        density="compact"
        hide-details
        class="mr-2"
      />
      <v-btn
        icon="mdi-delete"
        size="small"
        variant="text"
        @click="clearDebugLog"
      />
    </v-card-title>

    <v-card-text>
      <v-alert type="info" variant="tonal" density="compact" class="mb-3">
        Shows raw COBS-framed bytes on the wire. TX = sent to BP, RX = received from BP.
        If you see TX but no RX, you may have selected the wrong serial port (terminal instead of BPIO2).
      </v-alert>

      <div
        v-if="debugLog.length === 0"
        class="text-body-2 text-disabled text-center py-4"
      >
        No data yet. Connect and send a command to see raw bytes.
      </div>

      <v-virtual-scroll
        v-else
        :items="debugLog"
        :height="300"
        item-height="56"
      >
        <template #default="{ item }">
          <div class="d-flex align-start py-1" style="border-bottom: 1px solid rgba(255,255,255,0.05)">
            <v-chip
              :color="item.direction === 'tx' ? 'warning' : 'info'"
              size="x-small"
              variant="flat"
              class="mr-2 mt-1"
              style="min-width: 28px"
            >
              {{ item.direction.toUpperCase() }}
            </v-chip>
            <div style="min-width: 0; flex: 1">
              <div
                class="text-body-2 font-weight-medium"
                style="font-family: monospace; word-break: break-all; line-height: 1.4"
              >
                {{ item.hex }}
              </div>
              <div class="text-caption text-disabled">
                {{ item.length }} bytes @ {{ item.timestamp.toLocaleTimeString(undefined, { hour12: false }) }}.{{ String(item.timestamp.getMilliseconds()).padStart(3, '0') }}
              </div>
            </div>
          </div>
        </template>
      </v-virtual-scroll>
    </v-card-text>
  </v-card>
</template>
