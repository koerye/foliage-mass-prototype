// Vegetation Studio — Dual-Mode Electron Desktop Shell + Built-in MCP Control Bridge.
// - Dev mode (`ELECTRON_DEV_URL` set): loads live Vite dev server while still running the local MCP bridge.
// - Standalone / Packaged `.exe` mode: serves built `dist/` + `/api/*` local persistence directly in-process.
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startAppServer } from './app-server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

const isHeadless = process.argv.includes('--headless') || process.env.VEG_HEADLESS === '1'
const devUrl = (process.env.ELECTRON_DEV_URL || '').trim().replace(/\/+$/, '')

// Enable reliable WebGL2 rendering (and SwiftShader fallback for headless / automated CI runs)
app.commandLine.appendSwitch('ignore-gpu-blocklist')
if (isHeadless) {
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  app.commandLine.appendSwitch('use-gl', 'angle')
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined
}

function resolveDataDir() {
  if (process.env.VEG_DATA_DIR) return path.resolve(process.env.VEG_DATA_DIR)
  if (!app.isPackaged) return PROJECT_ROOT
  // Portable `.exe` prefers a sibling `data/` directory beside the executable so presets & textures stay portable
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
  const candidate = path.join(portableDir, 'data')
  try {
    fs.mkdirSync(candidate, { recursive: true })
    return candidate
  } catch {
    return path.join(app.getPath('userData'), 'data')
  }
}

function seedBundledDataIfEmpty(dataDir) {
  if (!app.isPackaged) return
  const bundled = path.join(process.resourcesPath, 'seed-data')
  if (!fs.existsSync(bundled)) return
  for (const sub of ['user-presets', 'user-textures']) {
    const srcDir = path.join(bundled, sub)
    const dstDir = path.join(dataDir, sub)
    if (!fs.existsSync(srcDir)) continue
    fs.mkdirSync(dstDir, { recursive: true })
    for (const file of fs.readdirSync(srcDir)) {
      const dstFile = path.join(dstDir, file)
      if (!fs.existsSync(dstFile)) {
        try { fs.copyFileSync(path.join(srcDir, file), dstFile) } catch {}
      }
    }
  }
}

function resolveTokenFile(dataDir) {
  const cli = getArgValue('--token-file') || process.env.VEG_MCP_TOKEN_FILE
  if (cli) return path.resolve(cli)
  return path.join(dataDir, '.vegetation_studio_mcp.json')
}

function resolveMcpServerEntry() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mcp', 'server.mjs')
  }
  return path.join(PROJECT_ROOT, 'mcp', 'server.mjs')
}

export const ALLOWED_SCREENSHOT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
export const ALLOWED_EXPORT_EXTS = new Set(['.glb', '.json', '.png', '.jpg', '.jpeg', '.webp'])

export function validateOutputPath(outputPath, allowedExts) {
  const raw = String(outputPath || '').trim()
  if (!raw || raw.includes('\0')) {
    throw new Error('Invalid outputPath: empty or contains null byte')
  }
  const resolved = path.resolve(raw)
  const ext = path.extname(resolved).toLowerCase()
  if (!allowedExts.has(ext)) {
    throw new Error(`Disallowed outputPath extension "${ext || '(none)'}". Allowed: ${[...allowedExts].join(', ')}`)
  }
  return resolved
}

export function sanitizeDefaultFilename(name, fallback) {
  const normalized = String(name || '').replace(/\\/g, '/')
  const base = path.basename(normalized).replace(/[/:*?"<>|\0]+/g, '_').replace(/^\.+/, '').trim()
  return base || fallback
}

export function classifyWindowOpenUrl(url, baseUrl) {
  try {
    const parsed = new URL(String(url))
    const base = new URL(String(baseUrl))
    if (parsed.origin === base.origin) {
      return { kind: 'internal', route: `${parsed.pathname}${parsed.search}${parsed.hash}` }
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { kind: 'external', url: parsed.toString() }
    }
    return { kind: 'deny' }
  } catch {
    return { kind: 'deny' }
  }
}

export const CANVAS_SNAPSHOT_SCRIPT = `(() => {
  if (window.__studio && typeof window.__studio.snapshotCanvas === 'function') return window.__studio.snapshotCanvas();
  if (window.__aiStudio && typeof window.__aiStudio.snapshotCanvas === 'function') return window.__aiStudio.snapshotCanvas();
  if (window.__rockStudio && typeof window.__rockStudio.snapshotCanvas === 'function') return window.__rockStudio.snapshotCanvas();
  if (window.__sceneStudio && typeof window.__sceneStudio.snapshot === 'function') return window.__sceneStudio.snapshot();
  const c = document.querySelector('#canvas canvas, canvas');
  return c ? c.toDataURL('image/png') : '';
})()`

export const PRE_CAPTURE_RENDER_SCRIPT = `new Promise(resolve => {
  if (window.__studio && typeof window.__studio.snapshotCanvas === 'function') window.__studio.snapshotCanvas();
  if (window.__aiStudio && typeof window.__aiStudio.snapshotCanvas === 'function') window.__aiStudio.snapshotCanvas();
  if (window.__rockStudio && typeof window.__rockStudio.snapshotCanvas === 'function') window.__rockStudio.snapshotCanvas();
  if (window.__sceneStudio && typeof window.__sceneStudio.snapshot === 'function') window.__sceneStudio.snapshot();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
})`

function detectWorkbench(urlStr) {
  const s = String(urlStr || '').toLowerCase()
  if (s.includes('scene.html')) return 'scene'
  if (s.includes('ai.html')) return 'ai'
  if (s.includes('rock.html')) return 'rock'
  if (s.includes('legacy.html')) return 'legacy'
  return 'broadleaf'
}

let mainWindow = null
let appServer = null
let activeDataDir = ''
let activeTokenFile = ''
let activeBaseUrl = ''

function buildMcpConfigSnippet() {
  const mcpEntry = resolveMcpServerEntry().replace(/\\/g, '/')
  const tokenPath = activeTokenFile.replace(/\\/g, '/')
  return JSON.stringify({
    mcpServers: {
      'vegetation-studio': {
        command: 'node',
        args: [mcpEntry, '--token-file', tokenPath],
      },
    },
  }, null, 2)
}

function writeBridgeMetadata(info) {
  const targets = new Set([activeTokenFile, path.join(app.getPath('userData'), '.vegetation_studio_mcp.json')])
  const payload = JSON.stringify(info, null, 2)
  for (const file of targets) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, payload, { encoding: 'utf8', mode: 0o600 })
    } catch {}
  }
}

function cleanupBridgeMetadata() {
  const targets = [activeTokenFile, path.join(app.getPath('userData'), '.vegetation_studio_mcp.json')]
  for (const file of targets) {
    if (!file) continue
    try {
      if (!fs.existsSync(file)) continue
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed?.pid === process.pid) fs.unlinkSync(file)
    } catch {}
  }
}

async function waitForStudioReady(win, workbench, timeoutMs = 15000) {
  const globalName = workbench === 'scene' ? '__sceneStudio'
    : workbench === 'ai' ? '__aiStudio'
      : workbench === 'rock' ? '__rockStudio'
        : workbench === 'legacy' ? 'document'
          : '__studio'
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (win.isDestroyed()) throw new Error('Window closed')
    try {
      const ok = await win.webContents.executeJavaScript(
        `Boolean(window[${JSON.stringify(globalName)}] && document.querySelector('#canvas canvas, canvas'))`,
      )
      if (ok) {
        await new Promise(r => setTimeout(r, 220))
        return true
      }
    } catch {}
    await new Promise(r => setTimeout(r, 120))
  }
  return false
}

const bypassUnloadWindows = new WeakSet()

async function navigateWindow(win, workbench, query) {
  const pageMap = {
    broadleaf: 'broadleaf.html',
    scene: 'scene.html',
    ai: 'ai.html',
    rock: 'rock.html',
    legacy: 'legacy.html',
  }
  const file = pageMap[workbench] || 'broadleaf.html'
  const qs = query && typeof query === 'object'
    ? new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
    : ''
  const targetUrl = `${activeBaseUrl}/${file}${qs ? `?${qs}` : ''}`
  bypassUnloadWindows.add(win.webContents)
  try {
    await win.loadURL(targetUrl)
  } finally {
    bypassUnloadWindows.delete(win.webContents)
  }
  await waitForStudioReady(win, workbench)
  return { workbench, url: win.webContents.getURL() }
}

async function handleBridgeCommand(action, params = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Vegetation Studio window is not available')
  }
  const wc = mainWindow.webContents

  switch (action) {
    case 'status': {
      const url = wc.getURL()
      const workbench = detectWorkbench(url)
      const [width, height] = mainWindow.getSize()
      let live = null
      try {
        live = await wc.executeJavaScript(`(() => {
          if (window.__studio) return { name: window.__studio.spec.name, kind: window.__studio.spec.kind, stats: window.__studio.stats, lighting: window.__studio.lighting, wind: window.__studio.wind };
          if (window.__sceneStudio) return { name: window.__sceneStudio.scene.name, stats: window.__sceneStudio.stats(), wind: window.__sceneStudio.scene.wind };
          if (window.__aiStudio) return { name: window.__aiStudio.scene.name, stats: window.__aiStudio.stats };
          if (window.__rockStudio) return { name: window.__rockStudio.getSpec().name, stats: window.__rockStudio.stats() };
          return null;
        })()`)
      } catch {}
      return {
        ok: true,
        app: 'vegetation-studio',
        version: app.getVersion(),
        packaged: app.isPackaged,
        workbench,
        url,
        windowSize: { width, height },
        dataDir: activeDataDir,
        bridgePort: appServer?.port,
        live,
      }
    }

    case 'switch': {
      const wb = String(params.workbench || 'broadleaf')
      return await navigateWindow(mainWindow, wb, params.query)
    }

    case 'eval': {
      const code = String(params.code || '').trim()
      if (!code) throw new Error('Empty eval code')
      const wrapped = `(async () => { return await (${code}); })()`
      return await wc.executeJavaScript(wrapped, true)
    }

    case 'screenshot': {
      const target = params.target === 'window' ? 'window' : 'canvas'
      const outDir = path.join(activeDataDir, 'mcp-screenshots')
      const outPath = params.outputPath
        ? validateOutputPath(params.outputPath, ALLOWED_SCREENSHOT_EXTS)
        : path.join(outDir, `shot-${Date.now()}.png`)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })

      let pngBuffer = null
      if (target === 'canvas') {
        try {
          const dataUrl = await wc.executeJavaScript(CANVAS_SNAPSHOT_SCRIPT)
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
            pngBuffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
          }
        } catch {}
      }
      if (!pngBuffer) {
        try {
          await wc.executeJavaScript(PRE_CAPTURE_RENDER_SCRIPT)
        } catch {}
        if (isHeadless) {
          try { wc.invalidate() } catch {}
          await new Promise(r => setTimeout(r, 120))
        }
        const image = await wc.capturePage()
        pngBuffer = image.toPNG()
      }
      fs.writeFileSync(outPath, pngBuffer)
      return { path: outPath, bytes: pngBuffer.length, target }
    }

    case 'writeExportFile': {
      const exportsDir = path.join(activeDataDir, 'exports')
      const defaultName = sanitizeDefaultFilename(params.defaultFilename, 'export.glb')
      const outPath = params.outputPath
        ? validateOutputPath(params.outputPath, ALLOWED_EXPORT_EXTS)
        : validateOutputPath(path.join(exportsDir, defaultName), ALLOWED_EXPORT_EXTS)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      const buf = Buffer.from(String(params.base64 || ''), 'base64')
      fs.writeFileSync(outPath, buf)
      return { path: outPath, bytes: buf.length }
    }

    default:
      throw new Error(`Unknown bridge action: ${action}`)
  }
}

function createWindow(route = 'broadleaf.html', isPrimary = true) {
  const iconPath = path.join(__dirname, 'icon.png')
  const workArea = !isHeadless ? screen.getPrimaryDisplay().workAreaSize : { width: 1480, height: 940 }
  const targetWidth = isHeadless ? 1440 : Math.min(isPrimary ? 1480 : 1280, Math.max(1024, workArea.width))
  const targetHeight = isHeadless ? 900 : Math.min(isPrimary ? 940 : 840, Math.max(680, workArea.height))
  const win = new BrowserWindow({
    width: targetWidth,
    height: targetHeight,
    minWidth: 1024,
    minHeight: 680,
    frame: !isHeadless,
    show: false,
    paintWhenInitiallyHidden: true,
    title: 'Vegetation Studio',
    backgroundColor: '#f0efe5',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: isHeadless,
      backgroundThrottling: false,
    },
  })

  if (isHeadless) {
    win.webContents.setFrameRate(60)
    win.webContents.on('paint', () => {})
  } else {
    win.once('ready-to-show', () => {
      if (isPrimary && workArea.width <= 1520) win.maximize()
      win.show()
    })
  }

  const cleanRoute = String(route || 'broadleaf.html').replace(/^\/+/, '') || 'broadleaf.html'
  let safeUrl = `${activeBaseUrl}/broadleaf.html`
  try {
    const candidate = new URL(cleanRoute, `${activeBaseUrl}/`)
    if (candidate.origin === new URL(activeBaseUrl).origin) {
      safeUrl = candidate.toString()
    }
  } catch {}
  void win.loadURL(safeUrl)

  win.webContents.on('will-prevent-unload', event => {
    if (isHeadless || bypassUnloadWindows.has(win.webContents)) {
      event.preventDefault()
      return
    }
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['继续编辑', '离开且不保存'],
      defaultId: 0,
      cancelId: 0,
      title: '未保存的改动',
      message: '当前工作台存在未保存的改动，确定离开或关闭窗口吗？',
    })
    if (choice === 1) event.preventDefault()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = classifyWindowOpenUrl(url, activeBaseUrl)
    if (decision.kind === 'internal') {
      createWindow(decision.route, false)
    } else if (decision.kind === 'external') {
      void shell.openExternal(decision.url)
    }
    return { action: 'deny' }
  })

  return win
}

function installAppMenu() {
  const template = [
    {
      label: '工作台',
      submenu: [
        { label: '🌳 树木与植物工作台', accelerator: 'CmdOrCtrl+1', click: () => mainWindow && void navigateWindow(mainWindow, 'broadleaf') },
        { label: '❖ 场景组装工作台', accelerator: 'CmdOrCtrl+2', click: () => mainWindow && void navigateWindow(mainWindow, 'scene') },
        { label: '✦ AI 模式', accelerator: 'CmdOrCtrl+3', click: () => mainWindow && void navigateWindow(mainWindow, 'ai') },
        { label: '◈ 石头工作台', accelerator: 'CmdOrCtrl+4', click: () => mainWindow && void navigateWindow(mainWindow, 'rock') },
        { type: 'separator' },
        { label: '新开副屏窗口（树木工作台）', click: () => createWindow('broadleaf.html', false) },
        { label: '新开副屏窗口（场景组装）', click: () => createWindow('scene.html', false) },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '桌面与 MCP',
      submenu: [
        {
          label: '📋 复制 MCP 配置 (mcp_config.json)',
          click: () => {
            clipboard.writeText(buildMcpConfigSnippet())
            if (mainWindow && !mainWindow.isDestroyed()) {
              void dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Vegetation Studio MCP',
                message: '已复制 MCP 配置到剪贴板',
                detail: `桥接地址：http://127.0.0.1:${appServer?.port}\n令牌文件：${activeTokenFile}\n数据目录：${activeDataDir}`,
              })
            }
          },
        },
        { label: '📂 打开本地数据与导出目录', click: () => void shell.openPath(activeDataDir) },
        { type: 'separator' },
        { role: 'reload', label: '刷新当前工作台' },
        { role: 'toggleDevTools', label: '开发者工具 (F12)', accelerator: 'F12' },
        { role: 'togglefullscreen', label: '全屏切换' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerDesktopIpc() {
  ipcMain.handle('desktop:get-info', () => ({
    isDesktop: true,
    platform: process.platform,
    appVersion: app.getVersion(),
    dataDir: activeDataDir,
    bridgeUrl: appServer?.url ?? '',
    mcpPort: appServer?.port ?? 0,
    tokenFile: activeTokenFile,
    mcpServerEntry: resolveMcpServerEntry(),
  }))

  ipcMain.handle('desktop:save-binary', async (_ev, opts) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const defaultDir = path.join(activeDataDir, 'exports')
    fs.mkdirSync(defaultDir, { recursive: true })
    const safeName = sanitizeDefaultFilename(opts?.defaultName, 'export.glb')
    const res = await dialog.showSaveDialog(win, {
      title: opts?.title || '保存导出文件',
      defaultPath: path.join(defaultDir, safeName),
      filters: Array.isArray(opts?.filters) ? opts.filters : undefined,
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    const buf = Buffer.from(String(opts?.base64Data || ''), 'base64')
    fs.writeFileSync(res.filePath, buf)
    return { canceled: false, filePath: res.filePath, bytes: buf.length }
  })

  ipcMain.handle('desktop:save-text', async (_ev, opts) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const defaultDir = path.join(activeDataDir, 'exports')
    fs.mkdirSync(defaultDir, { recursive: true })
    const safeName = sanitizeDefaultFilename(opts?.defaultName, 'export.json')
    const res = await dialog.showSaveDialog(win, {
      title: opts?.title || '保存文件',
      defaultPath: path.join(defaultDir, safeName),
      filters: Array.isArray(opts?.filters) ? opts.filters : undefined,
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    const text = String(opts?.text || '')
    fs.writeFileSync(res.filePath, text, 'utf8')
    return { canceled: false, filePath: res.filePath, bytes: Buffer.byteLength(text, 'utf8') }
  })

  ipcMain.handle('desktop:save-bundle', async (_ev, opts) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const defaultDir = path.join(activeDataDir, 'exports')
    fs.mkdirSync(defaultDir, { recursive: true })
    const folderName = sanitizeDefaultFilename(opts?.folderName, 'vegetation-export')
    const res = await dialog.showOpenDialog(win, {
      title: opts?.title || '选择模型与贴图导出目录',
      defaultPath: defaultDir,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths?.length) return { canceled: true }
    const targetDir = path.join(res.filePaths[0], folderName)
    fs.mkdirSync(targetDir, { recursive: true })
    const resolvedRoot = path.resolve(targetDir) + path.sep
    let totalBytes = 0
    const written = []
    for (const file of (Array.isArray(opts?.files) ? opts.files : [])) {
      const rel = String(file?.path || '').replace(/^\/+/, '').replace(/\\/g, '/')
      if (!rel || rel.includes('..')) continue
      const fullPath = path.resolve(targetDir, rel)
      if (!fullPath.startsWith(resolvedRoot)) continue
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      const buf = Buffer.from(String(file?.base64Data || ''), 'base64')
      fs.writeFileSync(fullPath, buf)
      totalBytes += buf.length
      written.push(rel)
    }
    return { canceled: false, dirPath: targetDir, fileCount: written.length, bytes: totalBytes }
  })

  ipcMain.handle('desktop:open-data-folder', async () => {
    fs.mkdirSync(activeDataDir, { recursive: true })
    await shell.openPath(activeDataDir)
  })

  ipcMain.handle('desktop:open-popout', (_ev, route) => {
    createWindow(String(route || 'broadleaf.html'), false)
  })

  ipcMain.handle('desktop:copy-mcp-config', () => {
    const snippet = buildMcpConfigSnippet()
    clipboard.writeText(snippet)
    return snippet
  })
}

async function boot() {
  activeDataDir = resolveDataDir()
  fs.mkdirSync(activeDataDir, { recursive: true })
  seedBundledDataIfEmpty(activeDataDir)
  activeTokenFile = resolveTokenFile(activeDataDir)

  const preferredPort = Number(getArgValue('--port') || process.env.VEG_BRIDGE_PORT || 27890)
  const distDir = app.isPackaged
    ? path.join(app.getAppPath(), 'dist')
    : path.join(PROJECT_ROOT, 'dist')

  appServer = await startAppServer({
    distDir,
    dataDir: activeDataDir,
    preferredPort,
    appVersion: app.getVersion(),
    onBridgeCommand: handleBridgeCommand,
  })

  activeBaseUrl = devUrl || appServer.url
  const initialRoute = getArgValue('--route') || 'broadleaf.html'

  registerDesktopIpc()
  installAppMenu()
  mainWindow = createWindow(initialRoute, true)
  await waitForStudioReady(mainWindow, detectWorkbench(initialRoute))

  writeBridgeMetadata({
    schemaVersion: 1,
    app: 'vegetation-studio',
    version: app.getVersion(),
    pid: process.pid,
    port: appServer.port,
    bridgeUrl: appServer.url,
    mcpHttpUrl: `${appServer.url}/mcp`,
    token: appServer.token,
    dataDir: activeDataDir,
    startedAt: new Date().toISOString(),
  })

  if (isHeadless) {
    console.log(`[vegetation-studio] headless bridge ready on ${appServer.url} (tokenFile=${activeTokenFile})`)
  }
}

app.whenReady().then(() => {
  void boot().catch(err => {
    console.error('[vegetation-studio] boot failed:', err)
    app.exit(1)
  })
})

app.on('window-all-closed', () => {
  cleanupBridgeMetadata()
  if (appServer) void appServer.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cleanupBridgeMetadata()
})
