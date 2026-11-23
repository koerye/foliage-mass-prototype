import { defineConfig } from 'vite'
import { userPresetsPlugin } from './scripts/presets-plugin.mjs'
import { userTexturesPlugin } from './scripts/textures-plugin.mjs'

export default defineConfig({
  base: './',
  plugins: [userPresetsPlugin(), userTexturesPlugin()],
  server: { port: 5867 },
  optimizeDeps: { include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/controls/TransformControls.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/exporters/GLTFExporter.js'] },
  build: {
    chunkSizeWarningLimit: 610,
    rollupOptions: { input: { index: 'index.html', broadleaf: 'broadleaf.html', ai: 'ai.html', rock: 'rock.html', scene: 'scene.html', legacy: 'legacy.html' } },
  },
})
