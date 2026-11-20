import { defineConfig } from 'vite'
import { userPresetsPlugin } from './scripts/presets-plugin.mjs'

export default defineConfig({
  base: './',
  plugins: [userPresetsPlugin()],
  server: { port: 5867 },
  optimizeDeps: { include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/exporters/GLTFExporter.js'] },
  build: {
    chunkSizeWarningLimit: 610,
    rollupOptions: { input: { index: 'index.html', broadleaf: 'broadleaf.html', ai: 'ai.html', legacy: 'legacy.html' } },
  },
})
