import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { userPresetsPlugin } from './scripts/presets-plugin.mjs'
import { userTexturesPlugin } from './scripts/textures-plugin.mjs'

/** Exposes manifold-3d's offline WASM as a base64 string so `?worker&inline` Workers work even under Electron `file://`. */
function manifoldWasmBase64Plugin(): Plugin {
  const virtualId = 'virtual:manifold-wasm-b64'
  const resolvedId = '\0' + virtualId
  return {
    name: 'manifold-wasm-b64',
    resolveId(id) {
      return id === virtualId ? resolvedId : null
    },
    load(id) {
      if (id !== resolvedId) return null
      // In Node/Vitest, manifold-3d reads manifold.wasm directly from disk so skip embedding in test runtime
      if (process.env.VITEST) return 'export default ""'
      const wasmPath = path.resolve(process.cwd(), 'node_modules/manifold-3d/manifold.wasm')
      const b64 = fs.readFileSync(wasmPath).toString('base64')
      return `export default ${JSON.stringify(b64)}`
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [userPresetsPlugin(), userTexturesPlugin(), manifoldWasmBase64Plugin()],
  worker: {
    plugins: () => [manifoldWasmBase64Plugin()],
  },
  server: { port: 5867 },
  optimizeDeps: {
    exclude: ['manifold-3d'],
    include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/controls/TransformControls.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/exporters/GLTFExporter.js'],
  },
  build: {
    chunkSizeWarningLimit: 610,
    rollupOptions: { input: { index: 'index.html', broadleaf: 'broadleaf.html', ai: 'ai.html', rock: 'rock.html', scene: 'scene.html', legacy: 'legacy.html' } },
  },
})
