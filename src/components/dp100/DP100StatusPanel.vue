<script setup lang="ts">
import type { BasicInfo, BasicSet } from '../../services/dp100/frame-data'

const props = defineProps<{
  info: BasicInfo | null
  setpoint: BasicSet | null
}>()

const mvToV = (mv: number) => (mv / 1000).toFixed(3)
const maToA = (ma: number) => (ma / 1000).toFixed(3)
const mcToC = (mc: number) => (mc / 10).toFixed(1)

function outputStateLabel(): string {
  if (!props.setpoint) return '--'
  return props.setpoint.state === 1 ? 'Output enabled' : 'Output disabled'
}
</script>

<template>
  <v-card>
    <v-card-title>Device Status</v-card-title>
    <v-card-text>
      <v-row>
        <v-col cols="6" md="3">
          <div class="text-caption">Vin</div>
          <div class="text-h6">{{ info ? `${mvToV(info.vin)} V` : '--' }}</div>
        </v-col>
        <v-col cols="6" md="3">
          <div class="text-caption">Vout</div>
          <div class="text-h6">{{ info ? `${mvToV(info.vout)} V` : '--' }}</div>
        </v-col>
        <v-col cols="6" md="3">
          <div class="text-caption">Iout</div>
          <div class="text-h6">{{ info ? `${maToA(info.iout)} A` : '--' }}</div>
        </v-col>
        <v-col cols="6" md="3">
          <div class="text-caption">Output</div>
          <div class="text-h6">{{ outputStateLabel() }}</div>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="6" md="3">
          <v-chip size="small" label>
            Temp1: {{ info ? `${mcToC(info.temp1)} C` : '--' }}
          </v-chip>
        </v-col>
        <v-col cols="6" md="3">
          <v-chip size="small" label>
            Temp2: {{ info ? `${mcToC(info.temp2)} C` : '--' }}
          </v-chip>
        </v-col>
        <v-col cols="6" md="3">
          <v-chip size="small" label>
            5V Rail: {{ info ? `${mvToV(info.dc_5V)} V` : '--' }}
          </v-chip>
        </v-col>
        <v-col cols="6" md="3">
          <v-chip :color="info?.work_st ? 'success' : 'warning'" size="small" label>
            {{ info?.work_st ? 'Running' : 'Idle' }}
          </v-chip>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>
