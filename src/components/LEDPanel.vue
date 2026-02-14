<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useBusPirate } from '../composables/useBusPirate'

const { connected, status, loading, setLedColors, resumeLeds } = useBusPirate()

const ledCount = computed(() => status.value?.ledCount ?? 0)

// Per-LED color state
const ledColors = ref<string[]>([])

// Sync ledColors array length when ledCount changes
watch(ledCount, (count) => {
  if (count > 0 && ledColors.value.length !== count) {
    ledColors.value = Array.from({ length: count }, (_, i) =>
      ledColors.value[i] ?? '#FF6600'
    )
  }
}, { immediate: true })

// Quick presets
const presets = [
  { name: 'Orange', color: '#FF6600' },
  { name: 'Red', color: '#FF0000' },
  { name: 'Green', color: '#00FF00' },
  { name: 'Blue', color: '#0000FF' },
  { name: 'White', color: '#FFFFFF' },
  { name: 'Off', color: '#000000' },
]

function hexToUint32(hex: string): number {
  return parseInt(hex.replace('#', ''), 16) & 0xffffff
}

function uint32ToHex(val: number): string {
  return '#' + (val & 0xffffff).toString(16).padStart(6, '0')
}

// --- HSV helpers ---
function hsvToRgb(h: number, s: number, v: number): number {
  let r = 0, g = 0, b = 0
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  return ((Math.round(r * 255) & 0xff) << 16)
       | ((Math.round(g * 255) & 0xff) << 8)
       | (Math.round(b * 255) & 0xff)
}

// --- Animation engine ---
type AnimationType = 'none' | 'rainbow' | 'breathe' | 'chase' | 'wave' | 'sparkle' | 'fire'

const activeAnimation = ref<AnimationType>('none')
const animSpeed = ref(50) // 1-100
const animColor1 = ref('#FF0000')
const animColor2 = ref('#0000FF')
let animTimer: ReturnType<typeof setInterval> | null = null
let animFrame = 0
let animSending = false

const animations: { type: AnimationType; name: string; icon: string }[] = [
  { type: 'rainbow', name: 'Rainbow', icon: 'mdi-looks' },
  { type: 'breathe', name: 'Breathe', icon: 'mdi-sine-wave' },
  { type: 'chase', name: 'Chase', icon: 'mdi-arrow-right-bold' },
  { type: 'wave', name: 'Wave', icon: 'mdi-wave' },
  { type: 'sparkle', name: 'Sparkle', icon: 'mdi-creation' },
  { type: 'fire', name: 'Fire', icon: 'mdi-fire' },
]

function lerpColor(c1: number, c2: number, t: number): number {
  const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff
  const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return (r << 16) | (g << 8) | b
}

function generateFrame(type: AnimationType, frame: number, count: number): number[] {
  const t = frame / 100 // normalized time

  switch (type) {
    case 'rainbow':
      return Array.from({ length: count }, (_, i) =>
        hsvToRgb((t + i / count) % 1, 1, 1)
      )

    case 'breathe': {
      const brightness = (Math.sin(t * Math.PI * 2) + 1) / 2
      const base = hexToUint32(animColor1.value)
      const r = Math.round(((base >> 16) & 0xff) * brightness)
      const g = Math.round(((base >> 8) & 0xff) * brightness)
      const b = Math.round((base & 0xff) * brightness)
      const c = (r << 16) | (g << 8) | b
      return Array.from({ length: count }, () => c)
    }

    case 'chase': {
      const pos = Math.floor((frame % count * 3) / 3) % count
      const base = hexToUint32(animColor1.value)
      return Array.from({ length: count }, (_, i) => {
        const dist = Math.min(
          Math.abs(i - pos),
          Math.abs(i - pos + count),
          Math.abs(i - pos - count)
        )
        if (dist === 0) return base
        if (dist === 1) return lerpColor(base, 0x000000, 0.7)
        return 0x000000
      })
    }

    case 'wave': {
      const c1 = hexToUint32(animColor1.value)
      const c2 = hexToUint32(animColor2.value)
      return Array.from({ length: count }, (_, i) => {
        const phase = (t * 2 + i / count) % 1
        const blend = (Math.sin(phase * Math.PI * 2) + 1) / 2
        return lerpColor(c1, c2, blend)
      })
    }

    case 'sparkle': {
      const base = hexToUint32(animColor1.value)
      return Array.from({ length: count }, () => {
        if (Math.random() < 0.15) return 0xffffff
        if (Math.random() < 0.3) return base
        return lerpColor(base, 0x000000, 0.8)
      })
    }

    case 'fire':
      return Array.from({ length: count }, (_, i) => {
        const flicker = 0.4 + Math.random() * 0.6
        const cooling = i / count * 0.3
        const heat = Math.max(0, flicker - cooling)
        if (heat > 0.66) return lerpColor(0xff4400, 0xffff00, (heat - 0.66) / 0.34)
        if (heat > 0.33) return lerpColor(0x880000, 0xff4400, (heat - 0.33) / 0.33)
        return lerpColor(0x000000, 0x880000, heat / 0.33)
      })

    default:
      return Array.from({ length: count }, () => 0)
  }
}

function startAnimation(type: AnimationType) {
  stopAnimation()
  activeAnimation.value = type
  animFrame = 0

  const intervalMs = Math.max(30, 200 - animSpeed.value * 1.7)

  animTimer = setInterval(async () => {
    if (animSending || ledCount.value === 0) return
    animSending = true
    try {
      const colors = generateFrame(type, animFrame, ledCount.value)
      // Update the visual preview
      ledColors.value = colors.map(uint32ToHex)
      await setLedColors(colors)
      animFrame = (animFrame + 1) % 300
    } catch {
      // Silently skip frame on error
    } finally {
      animSending = false
    }
  }, intervalMs)
}

function stopAnimation() {
  if (animTimer !== null) {
    clearInterval(animTimer)
    animTimer = null
  }
  activeAnimation.value = 'none'
}

// Restart animation when speed changes (if one is running)
watch(animSpeed, () => {
  if (activeAnimation.value !== 'none') {
    startAnimation(activeAnimation.value)
  }
})

// Clean up on unmount
onUnmounted(stopAnimation)

// Stop animation on disconnect
watch(connected, (val) => {
  if (!val) stopAnimation()
})

async function handleApply() {
  stopAnimation()
  const colors = ledColors.value.map(hexToUint32)
  await setLedColors(colors)
}

async function handleSetAll(hex: string) {
  stopAnimation()
  ledColors.value = ledColors.value.map(() => hex)
  const color = hexToUint32(hex)
  await setLedColors(Array.from({ length: ledCount.value }, () => color))
}

async function handleResume() {
  stopAnimation()
  await resumeLeds()
}
</script>

<template>
  <v-card :disabled="!connected">
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-led-on</v-icon>
      LED Control
      <v-spacer />
      <v-chip v-if="activeAnimation !== 'none'" color="primary" size="small" variant="flat" class="mr-2">
        {{ activeAnimation }}
      </v-chip>
      <v-chip v-if="ledCount > 0" size="small" variant="tonal">
        {{ ledCount }} LEDs
      </v-chip>
    </v-card-title>

    <v-card-text>
      <v-alert v-if="!connected" type="info" variant="tonal" density="compact" class="mb-4">
        Connect to a Bus Pirate first.
      </v-alert>

      <v-alert v-else-if="ledCount === 0" type="warning" variant="tonal" density="compact" class="mb-4">
        No LEDs reported. Try refreshing status.
      </v-alert>

      <template v-else>
        <!-- LED Preview Strip -->
        <div class="d-flex ga-1 mb-4 pa-2 rounded" style="background: rgba(0,0,0,0.3)">
          <div
            v-for="(color, idx) in ledColors"
            :key="idx"
            :style="{
              flex: '1',
              height: '20px',
              borderRadius: '4px',
              backgroundColor: color,
              boxShadow: color !== '#000000' ? `0 0 8px ${color}` : 'none',
              transition: activeAnimation === 'none' ? 'background-color 0.2s' : 'none',
            }"
          />
        </div>

        <!-- Quick presets -->
        <div class="text-subtitle-2 mb-2">Solid Colors</div>
        <div class="d-flex flex-wrap ga-2 mb-4">
          <v-btn
            v-for="preset in presets"
            :key="preset.name"
            size="small"
            variant="tonal"
            :loading="loading && activeAnimation === 'none'"
            @click="handleSetAll(preset.color)"
          >
            <template #prepend>
              <div
                :style="{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: preset.color,
                  border: preset.color === '#000000' ? '1px solid rgba(255,255,255,0.3)' : 'none',
                }"
              />
            </template>
            {{ preset.name }}
          </v-btn>
          <v-btn
            size="small"
            variant="outlined"
            :loading="loading && activeAnimation === 'none'"
            @click="handleResume"
          >
            Resume Normal
          </v-btn>
        </div>

        <!-- Animations -->
        <div class="text-subtitle-2 mb-2">Animations</div>
        <div class="d-flex flex-wrap ga-2 mb-3">
          <v-btn
            v-for="anim in animations"
            :key="anim.type"
            size="small"
            :variant="activeAnimation === anim.type ? 'flat' : 'tonal'"
            :color="activeAnimation === anim.type ? 'primary' : undefined"
            :prepend-icon="anim.icon"
            @click="activeAnimation === anim.type ? stopAnimation() : startAnimation(anim.type)"
          >
            {{ anim.name }}
          </v-btn>
          <v-btn
            v-if="activeAnimation !== 'none'"
            size="small"
            variant="outlined"
            color="error"
            prepend-icon="mdi-stop"
            @click="stopAnimation"
          >
            Stop
          </v-btn>
        </div>

        <!-- Animation settings -->
        <v-row v-if="activeAnimation !== 'none'" dense class="mb-4">
          <v-col cols="12" sm="4">
            <v-slider
              v-model="animSpeed"
              :min="1"
              :max="100"
              :step="1"
              label="Speed"
              density="compact"
              hide-details
              thumb-label
            />
          </v-col>
          <v-col v-if="activeAnimation !== 'rainbow' && activeAnimation !== 'fire'" cols="6" sm="3">
            <div class="d-flex align-center ga-2">
              <span class="text-caption">Color 1</span>
              <input
                type="color"
                v-model="animColor1"
                style="width: 32px; height: 32px; border: none; padding: 0; cursor: pointer; background: transparent;"
              />
            </div>
          </v-col>
          <v-col v-if="activeAnimation === 'wave'" cols="6" sm="3">
            <div class="d-flex align-center ga-2">
              <span class="text-caption">Color 2</span>
              <input
                type="color"
                v-model="animColor2"
                style="width: 32px; height: 32px; border: none; padding: 0; cursor: pointer; background: transparent;"
              />
            </div>
          </v-col>
        </v-row>

        <v-divider class="my-3" />

        <!-- Individual LED controls -->
        <div class="text-subtitle-2 mb-2">Individual LEDs</div>
        <v-row dense>
          <v-col
            v-for="(_, idx) in ledColors"
            :key="idx"
            cols="6"
            sm="4"
            md="3"
          >
            <div class="d-flex align-center ga-2">
              <div class="text-caption text-disabled" style="min-width: 16px">{{ idx }}</div>
              <input
                type="color"
                v-model="ledColors[idx]"
                style="width: 36px; height: 36px; border: none; padding: 0; cursor: pointer; background: transparent;"
              />
              <span class="text-caption" style="font-family: monospace">
                {{ ledColors[idx] }}
              </span>
            </div>
          </v-col>
        </v-row>

        <v-btn
          color="primary"
          :loading="loading && activeAnimation === 'none'"
          :disabled="!connected"
          prepend-icon="mdi-send"
          class="mt-3"
          @click="handleApply"
        >
          Apply Colors
        </v-btn>
      </template>
    </v-card-text>
  </v-card>
</template>
