<script setup lang="ts">
import { computed, ref } from 'vue'
import DP100ConnectionPanel from './DP100ConnectionPanel.vue'
import DP100StatusPanel from './DP100StatusPanel.vue'
import DP100ControlPanel from './DP100ControlPanel.vue'
import DP100MonitorChart from './DP100MonitorChart.vue'
import { useDP100WebHID } from '../../composables/dp100/useDP100WebHID'
import { useDP100 } from '../../composables/dp100/useDP100'
import { useDP100Control } from '../../composables/dp100/useDP100Control'
import { useDP100Monitor } from '../../composables/dp100/useDP100Monitor'

const connecting = ref(false)
const busyControl = ref(false)

const unsupported = !('hid' in navigator)
const { device, error, connect, disconnect } = useDP100WebHID()
const { dp100, basicInfo, basicSet } = useDP100(device)
const { setVoltage, setCurrent, setOutputState } = useDP100Control(dp100, basicSet)
const { chartData, showPower } = useDP100Monitor(basicInfo)

const connected = computed(() => Boolean(device.value))

const onConnect = async () => {
  connecting.value = true
  try {
    await connect()
  } finally {
    connecting.value = false
  }
}

const withControlBusy = async (action: () => Promise<boolean>) => {
  busyControl.value = true
  try {
    await action()
  } finally {
    busyControl.value = false
  }
}
</script>

<template>
  <v-row>
    <v-col cols="12" md="5" lg="4">
      <DP100ConnectionPanel
        :busy="connecting"
        :connected="connected"
        :unsupported="unsupported"
        :error="error"
        @connect="onConnect"
        @disconnect="disconnect"
      />
    </v-col>

    <v-col cols="12" md="7" lg="8" class="d-flex flex-column ga-4">
      <DP100StatusPanel :info="basicInfo" :setpoint="basicSet" />
      <DP100ControlPanel
        :basic-set="basicSet"
        :busy="busyControl"
        @set-voltage="withControlBusy(() => setVoltage($event))"
        @set-current="withControlBusy(() => setCurrent($event))"
        @set-output="withControlBusy(() => setOutputState($event))"
      />
      <v-card>
        <v-card-text class="pb-0">
          <v-switch
            v-model="showPower"
            color="secondary"
            inset
            label="Show power series"
          />
        </v-card-text>
      </v-card>
      <DP100MonitorChart :data="chartData" :show-power="showPower" />
    </v-col>
  </v-row>
</template>
