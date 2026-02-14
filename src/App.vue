<script setup lang="ts">
import { ref } from 'vue'
import ConnectionPanel from './components/ConnectionPanel.vue'
import I2CPanel from './components/I2CPanel.vue'
import LEDPanel from './components/LEDPanel.vue'
import DebugPanel from './components/DebugPanel.vue'
import AnkerConnectionPanel from './components/AnkerConnectionPanel.vue'
import AnkerPowerPanel from './components/AnkerPowerPanel.vue'

const activeTab = ref('anker')
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
          <v-tab value="anker" prepend-icon="mdi-bluetooth">Anker Battery</v-tab>
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
        </v-tabs-window>
      </v-container>
    </v-main>
  </v-app>
</template>
