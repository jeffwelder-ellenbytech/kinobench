<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BasicSet } from '../../services/dp100/frame-data'

const props = defineProps<{
  basicSet: BasicSet | null
  busy?: boolean
}>()

const emit = defineEmits<{
  setVoltage: [number]
  setCurrent: [number]
  setOutput: [boolean]
}>()

const voltage = ref(0)
const current = ref(0)
const editingVoltage = ref(false)
const editingCurrent = ref(false)

watch(
  () => props.basicSet,
  (next) => {
    if (!next) return
    if (!editingVoltage.value) {
      voltage.value = next.vo_set / 1000
    }
    if (!editingCurrent.value) {
      current.value = next.io_set / 1000
    }
  },
  { immediate: true },
)

const outputOn = computed(() => props.basicSet?.state === 1)
const disableControls = computed(() => !props.basicSet || Boolean(props.busy))
</script>

<template>
  <v-card>
    <v-card-title>Device Control</v-card-title>
    <v-card-text>
      <v-row>
        <v-col cols="12" md="6">
          <v-text-field
            v-model.number="voltage"
            label="Voltage (V)"
            type="number"
            :min="0"
            :max="30"
            :step="0.01"
            :disabled="disableControls"
            @focus="editingVoltage = true"
            @blur="editingVoltage = false"
            @change="emit('setVoltage', Number(voltage))"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
            v-model.number="current"
            label="Current (A)"
            type="number"
            :min="0"
            :max="5"
            :step="0.01"
            :disabled="disableControls"
            @focus="editingCurrent = true"
            @blur="editingCurrent = false"
            @change="emit('setCurrent', Number(current))"
          />
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="6">
          <v-btn
            block
            :color="outputOn ? 'warning' : 'success'"
            :disabled="disableControls"
            @click="emit('setOutput', !outputOn)"
          >
            {{ outputOn ? 'Output OFF' : 'Output ON' }}
          </v-btn>
        </v-col>
        <v-col cols="12" md="6" class="d-flex align-center">
          <v-chip :color="outputOn ? 'success' : 'default'" label>
            {{ outputOn ? 'Output enabled' : 'Output disabled' }}
          </v-chip>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>
