<script setup lang="ts">
import { ref } from 'vue'
import ConnectionPanel from './components/ConnectionPanel.vue'
import I2CPanel from './components/I2CPanel.vue'
import LEDPanel from './components/LEDPanel.vue'
import DebugPanel from './components/DebugPanel.vue'
import AnkerConnectionPanel from './components/AnkerConnectionPanel.vue'
import AnkerPowerPanel from './components/AnkerPowerPanel.vue'
import AnkerChargerConnectionPanel from './components/AnkerChargerConnectionPanel.vue'
import AnkerChargerPowerPanel from './components/AnkerChargerPowerPanel.vue'
import AlientekConnectionPanel from './components/AlientekConnectionPanel.vue'
import AlientekModeOnePanel from './components/AlientekModeOnePanel.vue'

const activeTab = ref('alientek')
</script>

<template>
  <v-app>
    <v-app-bar flat density="compact" color="surface">
      <v-app-bar-title>
        <span class="font-weight-bold">KinoBench</span>
        <span class="text-caption text-disabled ml-2">Hardware Workbench</span>
      </v-app-bar-title>
    </v-app-bar>

    <v-main>
      <v-container fluid class="pa-4">
        <v-tabs v-model="activeTab" class="mb-4">
          <v-tab value="buspirate" prepend-icon="mdi-usb">Bus Pirate</v-tab>
          <v-tab value="anker" prepend-icon="mdi-battery">Anker Powerbank</v-tab>
          <v-tab value="anker-charger" prepend-icon="mdi-flash">Anker Charger</v-tab>
          <v-tab value="alientek" prepend-icon="mdi-gauge">Alientek EL15</v-tab>
        </v-tabs>

        <v-tabs-window v-model="activeTab">
          <v-tabs-window-item value="buspirate" eager>
            <v-row>
              <v-col cols="12" md="5" lg="4">
                <ConnectionPanel />
              </v-col>
              <v-col cols="12" md="7" lg="8">
                <I2CPanel class="mb-4" />
                <LEDPanel class="mb-4" />
                <DebugPanel />
              </v-col>
            </v-row>
          </v-tabs-window-item>

          <v-tabs-window-item value="anker" eager>
            <v-row>
              <v-col cols="12" md="5" lg="4">
                <AnkerConnectionPanel />
              </v-col>
              <v-col cols="12" md="7" lg="8">
                <AnkerPowerPanel />
              </v-col>
            </v-row>
          </v-tabs-window-item>

          <v-tabs-window-item value="anker-charger" eager>
            <v-row>
              <v-col cols="12" md="5" lg="4">
                <AnkerChargerConnectionPanel />
              </v-col>
              <v-col cols="12" md="7" lg="8">
                <AnkerChargerPowerPanel />
              </v-col>
            </v-row>
          </v-tabs-window-item>

          <v-tabs-window-item value="alientek" eager>
            <v-row>
              <v-col cols="12" md="5" lg="4">
                <AlientekConnectionPanel />
              </v-col>
              <v-col cols="12" md="7" lg="8">
                <AlientekModeOnePanel />
              </v-col>
            </v-row>
          </v-tabs-window-item>
        </v-tabs-window>
      </v-container>
    </v-main>
  </v-app>
</template>
