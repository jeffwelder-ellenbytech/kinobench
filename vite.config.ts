import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  // GitHub Pages project site path: https://<user>.github.io/kinobench/
  base: '/kinobench/',
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
})
