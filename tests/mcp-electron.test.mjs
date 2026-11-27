import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startAppServer } from '../electron/app-server.mjs'
import { resolveElectronExecutable as resolveDevElectron, resolveViteCommand, waitForUrl } from '../electron/dev-runner.mjs'
import { resolveElectronExecutable as resolveMcpElectron } from '../mcp/server.mjs'
import { executeMcpTool, MCP_TOOLS } from '../mcp/tools.mjs'
import { lightingPresets, Viewer } from '../src/viewport'

vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: vi.fn() },
    whenReady: () => new Promise(() => {}),
    on: vi.fn(),
    getVersion: () => '1.0.0-test',
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getAppPath: () => process.cwd(),
    exit: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: class {},
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn(), showMessageBoxSync: vi.fn(), showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1480, height: 940 } }) },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}))

const electronMain = await import('../electron/main.mjs')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'veg-electron-mcp-'))
}

describe('Electron Dual-Mode Server & MCP Protocol', () => {
  it('serves static dist, reuses disk persistence APIs, guards bridge auth & handles Streamable HTTP /mcp', async () => {
    const tmp = makeTempDir()
    const distDir = path.join(tmp, 'dist')
    fs.mkdirSync(distDir, { recursive: true })
    fs.writeFileSync(path.join(distDir, 'broadleaf.html'), '<html><body>Vegetation Studio</body></html>', 'utf8')

    const seenCommands = []
    const srv = await startAppServer({
      distDir,
      dataDir: tmp,
      preferredPort: 0,
      appVersion: '1.0.0-test',
      onBridgeCommand: async (action, params) => {
        seenCommands.push({ action, params })
        if (action === 'status') return { ok: true, workbench: 'broadleaf', app: 'vegetation-studio' }
        if (action === 'eval') return { echoed: params.code }
        return { action, ok: true }
      },
    })

    try {
      // 1. Static HTML served cleanly
      const htmlRes = await fetch(`${srv.url}/broadleaf.html`)
      expect(htmlRes.status).toBe(200)
      expect(await htmlRes.text()).toContain('Vegetation Studio')

      // 2. Reused disk persistence (/api/presets & /api/textures) — PUT + application/json only
      const postReject = await fetch(`${srv.url}/api/presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      })
      expect(postReject.status).toBe(405)
      expect(postReject.headers.get('allow')).toBe('GET, PUT')

      const badCtReject = await fetch(`${srv.url}/api/presets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ items: [] }),
      })
      expect(badCtReject.status).toBe(415)

      const saveRes = await fetch(`${srv.url}/api/presets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: 'p1', name: '测试竹子' }] }),
      })
      expect(saveRes.status).toBe(200)
      const loadRes = await fetch(`${srv.url}/api/presets`)
      expect((await loadRes.json()).items[0].name).toBe('测试竹子')

      // 3. Bridge health reports tokenValid accurately; command & /mcp require Bearer token
      const health = await (await fetch(`${srv.url}/mcp-bridge/health`)).json()
      expect(health.ok).toBe(true)
      expect(health.tokenValid).toBe(false)
      const authHealth = await (await fetch(`${srv.url}/mcp-bridge/health`, {
        headers: { Authorization: `Bearer ${srv.token}` },
      })).json()
      expect(authHealth.tokenValid).toBe(true)
      const unauth = await fetch(`${srv.url}/mcp-bridge/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      })
      expect(unauth.status).toBe(401)

      // 4. Streamable HTTP POST /mcp works end-to-end with Bearer token
      const mcpListRes = await fetch(`${srv.url}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${srv.token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      expect(mcpListRes.status).toBe(200)
      const listJson = await mcpListRes.json()
      expect(listJson.result.tools.length).toBe(MCP_TOOLS.length)

      const mcpCallRes = await fetch(`${srv.url}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${srv.token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'studio_status', arguments: {} } }),
      })
      const callJson = await mcpCallRes.json()
      expect(callJson.result.isError).toBe(false)
      expect(JSON.parse(callJson.result.content[0].text).workbench).toBe('broadleaf')
      expect(seenCommands.length).toBeGreaterThanOrEqual(1)
    } finally {
      await srv.close()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('runs standalone stdio mcp/server.mjs end-to-end (initialize, tools/list, tools/call)', async () => {
    const tmp = makeTempDir()
    const tokenFile = path.join(tmp, '.vegetation_studio_mcp.json')
    const srv = await startAppServer({
      distDir: tmp,
      dataDir: tmp,
      preferredPort: 0,
      appVersion: '1.0.0-test',
      onBridgeCommand: async (action, params) => {
        if (action === 'status') return { ok: true, workbench: 'broadleaf', live: { name: '竹子 · Q版卡通' } }
        if (action === 'eval') return { ok: true, code: params.code }
        return { ok: true, action }
      },
    })
    fs.writeFileSync(tokenFile, JSON.stringify({ bridgeUrl: srv.url, token: srv.token }), 'utf8')

    const serverPath = path.resolve('mcp', 'server.mjs')
    const child = spawn(process.execPath, [serverPath, '--token-file', tokenFile, '--no-autolaunch'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const replies = []
    let buf = ''
    child.stdout.on('data', chunk => {
      buf += chunk.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) replies.push(JSON.parse(line))
      }
    })

    const waitReply = id => new Promise((resolve, reject) => {
      const deadline = Date.now() + 8000
      const poll = () => {
        const hit = replies.find(r => r.id === id)
        if (hit) return resolve(hit)
        if (Date.now() > deadline) return reject(new Error(`Timeout waiting for MCP reply id=${id}`))
        setTimeout(poll, 20)
      }
      poll()
    })

    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }) + '\n')
      const initR = await waitReply(1)
      expect(initR.result.serverInfo.name).toBe('vegetation-studio')
      expect(initR.result.instructions).toContain('vegetation-studio-asset-pipeline')
      expect(initR.result.instructions).toContain('G0')
      expect(initR.result.instructions).toContain('G5')

      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
      const listR = await waitReply(2)
      expect(listR.result.tools.map(t => t.name)).toContain('tree_load_preset')
      expect(listR.result.tools.map(t => t.name)).toContain('scene_add_item')
      expect(listR.result.tools.map(t => t.name)).toContain('studio_screenshot')

      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'studio_status', arguments: {} } }) + '\n')
      const callR = await waitReply(3)
      expect(callR.result.isError).toBe(false)
      expect(JSON.parse(callR.result.content[0].text).live.name).toBe('竹子 · Q版卡通')
    } finally {
      child.kill()
      await srv.close()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns HTTP 400 on malformed URI (GET /%) and stays alive for subsequent GET /', async () => {
    const tmp = makeTempDir()
    const distDir = path.join(tmp, 'dist')
    fs.mkdirSync(distDir, { recursive: true })
    fs.writeFileSync(path.join(distDir, 'broadleaf.html'), '<html><body>Alive Studio</body></html>', 'utf8')

    const srv = await startAppServer({
      distDir,
      dataDir: tmp,
      preferredPort: 0,
      appVersion: '1.0.0-test',
      onBridgeCommand: async () => ({ ok: true }),
    })

    try {
      const bad1 = await fetch(`${srv.url}/%`)
      expect(bad1.status).toBe(400)
      expect(bad1.headers.get('content-type') || '').toContain('text/plain')

      const bad2 = await fetch(`${srv.url}/%E0%A4%A`)
      expect(bad2.status).toBe(400)

      const badNull = await fetch(`${srv.url}/broadleaf%00.html`)
      expect(badNull.status).toBe(400)

      const okRes = await fetch(`${srv.url}/`)
      expect(okRes.status).toBe(200)
      expect(await okRes.text()).toContain('Alive Studio')
    } finally {
      await srv.close()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('enforces exact MCP lighting & scene_set_reference enums and Viewer.setLighting unknown fallback', () => {
    const expectedLighting = ['neutral', 'ghibli', 'sakura', 'forest', 'celestial']
    const treeLightingTool = MCP_TOOLS.find(t => t.name === 'tree_set_camera_lighting')
    const rockTool = MCP_TOOLS.find(t => t.name === 'rock_control')
    const refTool = MCP_TOOLS.find(t => t.name === 'scene_set_reference')

    expect(treeLightingTool?.inputSchema.properties.lighting.enum).toEqual(expectedLighting)
    expect(treeLightingTool?.description).not.toContain('studio/')
    expect(rockTool?.inputSchema.properties.lighting.enum).toEqual(expectedLighting)
    expect(refTool?.inputSchema.properties.mode.enum).toEqual(['off', 'pip', 'wipe', 'overlay', 'split'])

    // Viewer.setLighting must never throw TypeError on unknown or prototype preset keys
    const fakeViewer = {
      lighting: 'ghibli',
      shownHeight: 6,
      scene: { background: null },
      key: { color: { set: vi.fn() }, intensity: 0, position: { set: vi.fn() }, shadow: { camera: { updateProjectionMatrix: vi.fn() } } },
      fill: { color: { set: vi.fn() }, intensity: 0 },
      hemi: { color: { set: vi.fn() }, groundColor: { set: vi.fn() }, intensity: 0 },
      floorMat: { color: { set: vi.fn() }, opacity: 0 },
      renderer: { toneMappingExposure: 1, shadowMap: { needsUpdate: false } },
      animLighting: Viewer.prototype['animLighting'],
    }
    expect(() => Viewer.prototype.setLighting.call(fakeViewer, 'studio')).not.toThrow()
    expect(fakeViewer.lighting).toBe('neutral')
    expect(fakeViewer.scene.background.getHexString()).toBe(lightingPresets.neutral.bg.slice(1).toLowerCase())

    expect(() => Viewer.prototype.setLighting.call(fakeViewer, 'toString')).not.toThrow()
    expect(fakeViewer.lighting).toBe('neutral')
  })

  it('awaits lazy textureStore.ensureLoaded() in texture_list, texture_apply, and texture_editor_open', async () => {
    let loaded = false
    let editorGraph = { name: 'stale-graph', targetSlot: 'leaf', nodes: [] }
    const savedItems = [
      { id: 'tex-bark-1', name: '古木树皮', category: 'bark', targetSlot: 'bark', resolution: 512, updatedAt: '2026-11-25T00:00:00Z' },
    ]
    const mockWindow = {
      __studio: {
        textures: {
          store: {
            ready: vi.fn(async () => { /* lazy summary-only ready does NOT populate items */ }),
            ensureLoaded: vi.fn(async () => {
              await new Promise(r => setTimeout(r, 10))
              loaded = true
            }),
            list: () => (loaded ? savedItems : []),
          },
          agent: {
            getSchema: () => ({ templates: [{ id: 'tpl-bark', name: '树皮模板' }] }),
          },
          library: {
            applySavedById: vi.fn(async id => loaded && savedItems.some(t => t.id === id)),
          },
          openEditor: vi.fn(async slot => {
            await new Promise(r => setTimeout(r, 10))
            editorGraph = { name: `loaded-${slot}`, targetSlot: slot, nodes: [{ id: 'n1' }] }
          }),
          closeEditor: vi.fn(),
          editor: {
            getGraph: () => editorGraph,
          },
        },
      },
    }

    const runInMockWindow = async (action, params) => {
      if (action === 'status') return { ok: true, workbench: 'broadleaf' }
      if (action === 'eval') {
        const fn = new Function('window', `return (${params.code});`)
        return await fn(mockWindow)
      }
      return { ok: true }
    }

    const listed = await executeMcpTool('texture_list', {}, runInMockWindow)
    expect(mockWindow.__studio.textures.store.ensureLoaded).toHaveBeenCalledTimes(1)
    expect(listed.saved).toHaveLength(1)
    expect(listed.saved[0].id).toBe('tex-bark-1')

    loaded = false
    const applied = await executeMcpTool('texture_apply', { savedId: 'tex-bark-1' }, runInMockWindow)
    expect(mockWindow.__studio.textures.store.ensureLoaded).toHaveBeenCalledTimes(2)
    expect(applied).toEqual({ ok: true, kind: 'saved', id: 'tex-bark-1' })

    loaded = false
    const opened = await executeMcpTool('texture_editor_open', { open: true, slot: 'bark' }, runInMockWindow)
    expect(mockWindow.__studio.textures.store.ensureLoaded).toHaveBeenCalledTimes(3)
    expect(mockWindow.__studio.textures.openEditor).toHaveBeenCalledWith('bark')
    expect(opened.open).toBe(true)
    expect(opened.graph.name).toBe('loaded-bark')
    expect(opened.graph.targetSlot).toBe('bark')
  })

  it('wires ai.html / rock.html snapshotCanvas hooks, strict origin/external URL checks, sandbox, and file boundaries', () => {
    // 1. Canvas snapshot hook prefers __studio / __aiStudio / __rockStudio / __sceneStudio before raw canvas
    const evalSnapshot = mockWin => {
      const fn = new Function('window', 'document', `return (${electronMain.CANVAS_SNAPSHOT_SCRIPT});`)
      return fn(mockWin, { querySelector: () => ({ toDataURL: () => 'data:image/png;base64,RAW_FALLBACK' }) })
    }
    expect(evalSnapshot({ __aiStudio: { snapshotCanvas: () => 'data:image/png;base64,AI_PNG' } })).toBe('data:image/png;base64,AI_PNG')
    expect(evalSnapshot({ __rockStudio: { snapshotCanvas: () => 'data:image/png;base64,ROCK_PNG' } })).toBe('data:image/png;base64,ROCK_PNG')
    expect(evalSnapshot({ __studio: { snapshotCanvas: () => 'data:image/png;base64,TREE_PNG' } })).toBe('data:image/png;base64,TREE_PNG')
    expect(evalSnapshot({ __sceneStudio: { snapshot: () => 'data:image/png;base64,SCENE_PNG' } })).toBe('data:image/png;base64,SCENE_PNG')

    // Confirm rock & ai studio source files expose snapshotCanvas
    const rockSrc = fs.readFileSync(path.resolve('src', 'rock', 'main.ts'), 'utf8')
    const aiSrc = fs.readFileSync(path.resolve('src', 'ai', 'main.ts'), 'utf8')
    const mainSrc = fs.readFileSync(path.resolve('electron', 'main.mjs'), 'utf8')
    expect(rockSrc).toContain('snapshotCanvas:')
    expect(aiSrc).toContain('snapshotCanvas:')
    expect(mainSrc).toContain('sandbox: true')
    expect(mainSrc).not.toContain('sandbox: false')

    // 2. Strict origin comparison & safe external URL protocol guard
    const base = 'http://127.0.0.1:5867'
    expect(electronMain.classifyWindowOpenUrl('http://127.0.0.1:5867/scene.html?x=1', base)).toEqual({
      kind: 'internal',
      route: '/scene.html?x=1',
    })
    expect(electronMain.classifyWindowOpenUrl('http://127.0.0.1:58670/scene.html', base).kind).toBe('external')
    expect(electronMain.classifyWindowOpenUrl('http://127.0.0.1:5867@evil.com/scene.html', base).kind).toBe('external')
    expect(electronMain.classifyWindowOpenUrl('http://127.0.0.1:5867.evil.com/scene.html', base).kind).toBe('deny')
    expect(electronMain.classifyWindowOpenUrl('https://example.com/help', base)).toEqual({
      kind: 'external',
      url: 'https://example.com/help',
    })
    expect(electronMain.classifyWindowOpenUrl('file:///C:/Windows/System32/cmd.exe', base)).toEqual({ kind: 'deny' })
    expect(electronMain.classifyWindowOpenUrl('javascript:alert(1)', base)).toEqual({ kind: 'deny' })
    expect(electronMain.classifyWindowOpenUrl('cmd://calc', base)).toEqual({ kind: 'deny' })
    expect(electronMain.classifyWindowOpenUrl('not a valid url', base)).toEqual({ kind: 'deny' })

    // 3. outputPath extension guards & defaultName basename sanitization
    expect(electronMain.validateOutputPath('C:/tmp/shot.png', electronMain.ALLOWED_SCREENSHOT_EXTS)).toMatch(/shot\.png$/i)
    expect(electronMain.validateOutputPath('C:/tmp/shot.webp', electronMain.ALLOWED_SCREENSHOT_EXTS)).toMatch(/shot\.webp$/i)
    expect(() => electronMain.validateOutputPath('C:/tmp/evil.exe', electronMain.ALLOWED_SCREENSHOT_EXTS)).toThrow(/Disallowed/)
    expect(() => electronMain.validateOutputPath('C:/tmp/model.glb', electronMain.ALLOWED_SCREENSHOT_EXTS)).toThrow(/Disallowed/)
    expect(electronMain.validateOutputPath('C:/tmp/tree.glb', electronMain.ALLOWED_EXPORT_EXTS)).toMatch(/tree\.glb$/i)
    expect(electronMain.validateOutputPath('C:/tmp/spec.json', electronMain.ALLOWED_EXPORT_EXTS)).toMatch(/spec\.json$/i)
    expect(() => electronMain.validateOutputPath('C:/tmp/run.bat', electronMain.ALLOWED_EXPORT_EXTS)).toThrow(/Disallowed/)
    expect(() => electronMain.validateOutputPath('C:/tmp/noext', electronMain.ALLOWED_EXPORT_EXTS)).toThrow(/Disallowed/)

    expect(electronMain.sanitizeDefaultFilename('../../Desktop/model.glb', 'export.glb')).toBe('model.glb')
    expect(electronMain.sanitizeDefaultFilename('..\\..\\evil.json', 'export.json')).toBe('evil.json')
    expect(electronMain.sanitizeDefaultFilename('..', 'export.glb')).toBe('export.glb')
  })

  it('validates local reference image extensions, awaits openInTreeStudio, and avoids shell:true on spaced paths', async () => {
    const tmp = makeTempDir()
    try {
      const dummyBridge = vi.fn(async (action, params) => {
        if (action === 'status') return { ok: true, workbench: 'scene' }
        if (action === 'eval') {
          const mockWin = {
            __sceneStudio: {
              openInTreeStudio: vi.fn(async () => {
                await new Promise(r => setTimeout(r, 10))
                return true
              }),
              setReferenceImage: vi.fn(),
              getReference: vi.fn(() => ({ mode: 'pip', name: 'ref.png' })),
            },
          }
          const fn = new Function('window', `return (${params.code});`)
          return await fn(mockWin)
        }
        return { ok: true }
      })

      // Non-image local files and unsafe URI schemes must be rejected before reading disk
      const secretFile = path.join(tmp, 'secret.json')
      fs.writeFileSync(secretFile, '{"secret":true}', 'utf8')
      await expect(executeMcpTool('scene_set_reference', { imagePath: secretFile }, dummyBridge)).rejects.toThrow(/Disallowed/)
      await expect(executeMcpTool('scene_set_reference', { imagePath: 'file:///C:/secret.png' }, dummyBridge)).rejects.toThrow(/Disallowed/)
      await expect(executeMcpTool('studio_screenshot', { outputPath: path.join(tmp, 'bad.cmd') }, dummyBridge)).rejects.toThrow(/Disallowed/)
      await expect(executeMcpTool('tree_export_glb', { outputPath: path.join(tmp, 'bad.exe') }, dummyBridge)).rejects.toThrow(/Disallowed/)

      // Valid local image succeeds with real RefCompareMode
      const validPng = path.join(tmp, 'ref.png')
      fs.writeFileSync(validPng, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const refRes = await executeMcpTool('scene_set_reference', { imagePath: validPng, mode: 'pip' }, dummyBridge)
      expect(refRes.mode).toBe('pip')

      // scene_update_item awaits async openInTreeStudio(id)
      const openRes = await executeMcpTool('scene_update_item', { id: 'tree-1', openInTreeStudio: true }, dummyBridge)
      expect(openRes).toEqual({ openedInTreeStudio: 'tree-1', ok: true })

      // Spaced Windows project path resolves directly to node/exe without .cmd or shell: true
      const spacedRoot = path.join(tmp, 'My Vegetation Studio (v2)')
      fs.mkdirSync(path.join(spacedRoot, 'node_modules', 'vite', 'bin'), { recursive: true })
      fs.writeFileSync(path.join(spacedRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '// mock vite\n')
      fs.mkdirSync(path.join(spacedRoot, 'node_modules', 'electron', 'dist'), { recursive: true })
      const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron'
      fs.writeFileSync(path.join(spacedRoot, 'node_modules', 'electron', 'path.txt'), exeName)
      fs.writeFileSync(path.join(spacedRoot, 'node_modules', 'electron', 'dist', exeName), 'stub')

      const viteLaunch = resolveViteCommand(spacedRoot)
      expect(viteLaunch.command).toBe(process.execPath)
      expect(viteLaunch.argsPrefix[0]).toContain('My Vegetation Studio (v2)')

      const devElec = resolveDevElectron(spacedRoot)
      const mcpElec = resolveMcpElectron(spacedRoot)
      expect(devElec.command).toMatch(/electron(\.exe)?$/i)
      expect(devElec.command).not.toMatch(/\.cmd$/i)
      expect(mcpElec?.command).toBe(devElec.command)

      // waitForUrl fails fast when child exits early instead of hanging until timeout
      const dyingChild = spawn(process.execPath, ['-e', 'process.exit(2)'], { stdio: 'ignore', shell: false })
      const t0 = Date.now()
      await expect(waitForUrl('http://127.0.0.1:1', dyingChild, 15000)).rejects.toThrow(/exited early/)
      expect(Date.now() - t0).toBeLessThan(5000)

      // Verify neither launcher uses shell: true
      const devRunnerSrc = fs.readFileSync(path.resolve('electron', 'dev-runner.mjs'), 'utf8')
      const mcpServerSrc = fs.readFileSync(path.resolve('mcp', 'server.mjs'), 'utf8')
      expect(devRunnerSrc).not.toMatch(/shell:\s*(true|process\.platform)/)
      expect(mcpServerSrc).not.toMatch(/shell:\s*(true|process\.platform)/)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
