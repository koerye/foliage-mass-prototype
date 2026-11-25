#!/usr/bin/env node
// Standalone Zero-Dependency MCP Server (JSON-RPC 2.0 over Stdio) for Vegetation Studio.
// Connects to the live Electron desktop app over the authenticated loopback control bridge
// and auto-launches Vegetation Studio on demand if it is not already running!
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleMcpJsonRpc } from './tools.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

export function resolveElectronExecutable(projectRoot = PROJECT_ROOT) {
  const electronPkgDir = path.join(projectRoot, 'node_modules', 'electron')
  const pathTxt = path.join(electronPkgDir, 'path.txt')
  if (fs.existsSync(pathTxt)) {
    const rel = fs.readFileSync(pathTxt, 'utf8').trim()
    if (rel) {
      const candidate = process.env.ELECTRON_OVERRIDE_DIST_PATH
        ? path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, rel)
        : path.join(electronPkgDir, 'dist', rel)
      if (fs.existsSync(candidate)) return { command: candidate, argsPrefix: [] }
    }
  }
  const directExe = path.join(
    electronPkgDir,
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  )
  if (fs.existsSync(directExe)) return { command: directExe, argsPrefix: [] }
  const cliJs = path.join(electronPkgDir, 'cli.js')
  if (fs.existsSync(cliJs)) return { command: process.execPath, argsPrefix: [cliJs] }
  if (process.platform !== 'win32') {
    const bin = path.join(projectRoot, 'node_modules', '.bin', 'electron')
    if (fs.existsSync(bin)) return { command: bin, argsPrefix: [] }
  }
  return null
}

export function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 4000,
      })
      return
    } catch {}
  }
  try { child.kill('SIGTERM') } catch {}
}

function getArg(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined
}

const explicitTokenFile = getArg('--token-file') || process.env.VEG_MCP_TOKEN_FILE
const explicitBridge = getArg('--bridge') || process.env.VEG_MCP_BRIDGE
const explicitToken = getArg('--token') || process.env.VEG_MCP_TOKEN
const autoLaunchDisabled = process.argv.includes('--no-autolaunch') || process.env.VEG_MCP_NO_AUTOLAUNCH === '1'

function candidateTokenFiles() {
  const list = []
  if (explicitTokenFile) list.push(path.resolve(explicitTokenFile))
  list.push(path.join(PROJECT_ROOT, '.vegetation_studio_mcp.json'))
  list.push(path.join(PROJECT_ROOT, 'data', '.vegetation_studio_mcp.json'))
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  list.push(path.join(appData, 'Vegetation Studio', '.vegetation_studio_mcp.json'))
  list.push(path.join(appData, 'foliage-mass-prototype', '.vegetation_studio_mcp.json'))
  return [...new Set(list)]
}

function listBridgeDiscoveries() {
  if (explicitBridge && explicitToken) {
    const url = explicitBridge.startsWith('http') ? explicitBridge : `http://${explicitBridge}`
    return [{ bridgeUrl: url.replace(/\/+$/, ''), token: explicitToken }]
  }
  const found = []
  for (const file of candidateTokenFiles()) {
    try {
      if (!fs.existsSync(file)) continue
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (data?.bridgeUrl && data?.token) found.push(data)
    } catch {}
  }
  return found
}

async function findHealthyBridge() {
  for (const info of listBridgeDiscoveries()) {
    if (await isBridgeHealthy(info)) return info
  }
  return null
}

function httpJson(urlStr, method, headers, bodyObj, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const payload = bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try {
          resolve({ status: res.statusCode ?? 0, data: text ? JSON.parse(text) : null })
        } catch {
          resolve({ status: res.statusCode ?? 0, data: { ok: false, error: text } })
        }
      })
    })
    req.on('timeout', () => { req.destroy(new Error(`Bridge timeout after ${timeoutMs}ms`)) })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function isBridgeHealthy(info) {
  if (!info?.bridgeUrl || !info?.token) return false
  try {
    const res = await httpJson(
      `${info.bridgeUrl}/mcp-bridge/health`,
      'GET',
      { Authorization: `Bearer ${info.token}` },
      undefined,
      1500,
    )
    return res.status === 200 && res.data?.ok === true && res.data?.tokenValid === true
  } catch {
    return false
  }
}

let launchPromise = null
let spawnedHeadlessChild = null

function cleanupSpawnedHeadless() {
  if (spawnedHeadlessChild) {
    killProcessTree(spawnedHeadlessChild)
    spawnedHeadlessChild = null
  }
}

async function launchDesktopApp() {
  if (launchPromise) return launchPromise
  launchPromise = (async () => {
    const tokenFile = explicitTokenFile ? path.resolve(explicitTokenFile) : path.join(PROJECT_ROOT, '.vegetation_studio_mcp.json')
    const headless = process.env.VEG_HEADLESS === '1'
    const headlessFlag = headless ? ['--headless'] : []
    const env = { ...process.env, VEG_MCP_TOKEN_FILE: tokenFile }

    // 1. Prefer explicit exe, else packaged win-unpacked exe beside repo, else dev Electron binary
    const exeCandidates = process.env.VEG_FORCE_DEV === '1' ? [] : [
      process.env.VEG_APP_EXE,
      path.join(PROJECT_ROOT, 'release', 'win-unpacked', 'Vegetation Studio.exe'),
      path.resolve(__dirname, '..', '..', 'Vegetation Studio.exe'),
    ].filter(Boolean)

    const foundExe = exeCandidates.find(p => fs.existsSync(p))
    let child
    if (foundExe) {
      child = spawn(foundExe, ['--token-file', tokenFile, ...headlessFlag], {
        detached: !headless,
        stdio: 'ignore',
        env,
        shell: false,
        windowsHide: headless,
      })
    } else {
      const electronLaunch = resolveElectronExecutable(PROJECT_ROOT)
      if (!electronLaunch) {
        throw new Error('Vegetation Studio desktop app is not running and Electron executable was not found.')
      }
      const mainEntry = path.join(PROJECT_ROOT, 'electron', 'main.mjs')
      child = spawn(
        electronLaunch.command,
        [...electronLaunch.argsPrefix, mainEntry, '--token-file', tokenFile, ...headlessFlag],
        {
          cwd: PROJECT_ROOT,
          detached: !headless,
          stdio: 'ignore',
          env,
          shell: false,
          windowsHide: headless,
        },
      )
    }

    let childExited = null
    let childError = null
    const onExit = (code, signal) => {
      childExited = { code, signal }
      if (spawnedHeadlessChild === child) spawnedHeadlessChild = null
    }
    const onError = err => {
      childError = err
      if (spawnedHeadlessChild === child) spawnedHeadlessChild = null
    }
    child.once('exit', onExit)
    child.once('error', onError)
    if (headless) {
      spawnedHeadlessChild = child
    }
    child.unref()

    const deadline = Date.now() + 25000
    try {
      while (Date.now() < deadline) {
        if (childError) {
          throw new Error(`Failed to launch Vegetation Studio Electron: ${childError.message}`)
        }
        if (childExited) {
          const info = await findHealthyBridge()
          if (info) return info
          throw new Error(`Vegetation Studio Electron exited early before bridge became ready (code=${childExited.code}, signal=${childExited.signal})`)
        }
        const info = await findHealthyBridge()
        if (info) return info
        await new Promise(r => setTimeout(r, 300))
      }
      killProcessTree(child)
      if (spawnedHeadlessChild === child) spawnedHeadlessChild = null
      throw new Error('Timed out waiting for Vegetation Studio Electron bridge to start.')
    } finally {
      child.off('exit', onExit)
      child.off('error', onError)
    }
  })()

  try {
    return await launchPromise
  } finally {
    launchPromise = null
  }
}

async function resolveActiveBridge() {
  const existing = await findHealthyBridge()
  if (existing) return existing
  if (autoLaunchDisabled) {
    throw new Error('Vegetation Studio desktop app is not running (auto-launch disabled). Start the Electron app first.')
  }
  return await launchDesktopApp()
}

async function bridgeCall(action, params) {
  const info = await resolveActiveBridge()
  const res = await httpJson(
    `${info.bridgeUrl}/mcp-bridge/command`,
    'POST',
    { Authorization: `Bearer ${info.token}` },
    { action, params },
    60000,
  )
  if (res.status !== 200 || !res.data?.ok) {
    throw new Error(res.data?.error || `Bridge HTTP ${res.status}`)
  }
  return res.data.result
}

// ---- Dual-Framing Stdio JSON-RPC 2.0 Loop (supports both newline JSON & Content-Length) ----
let rawBuffer = Buffer.alloc(0)
let responseMode = 'newline' // auto-switches to 'content-length' if client sends Content-Length headers

function writeResponse(obj) {
  if (!obj) return
  const json = JSON.stringify(obj)
  if (responseMode === 'content-length') {
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`
    process.stdout.write(header + json)
  } else {
    process.stdout.write(json + '\n')
  }
}

async function dispatchRawMessage(text) {
  const trimmed = text.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch (err) {
    writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${String(err)}` } })
    return
  }
  const resp = await handleMcpJsonRpc(msg, bridgeCall)
  if (resp) writeResponse(resp)
}

function drainBuffer() {
  while (rawBuffer.length > 0) {
    // Trim leading CR/LF before inspecting framing
    let start = 0
    while (start < rawBuffer.length && (rawBuffer[start] === 0x0d || rawBuffer[start] === 0x0a)) start++
    if (start > 0) rawBuffer = rawBuffer.subarray(start)
    if (rawBuffer.length === 0) return

    const headAscii = rawBuffer.subarray(0, Math.min(32, rawBuffer.length)).toString('ascii')
    if (headAscii.toLowerCase().startsWith('content-length:')) {
      responseMode = 'content-length'
      const sepIdx = rawBuffer.indexOf('\r\n\r\n')
      if (sepIdx < 0) return
      const headerStr = rawBuffer.subarray(0, sepIdx).toString('ascii')
      const match = /content-length:\s*(\d+)/i.exec(headerStr)
      if (!match) {
        rawBuffer = rawBuffer.subarray(sepIdx + 4)
        continue
      }
      const len = Number(match[1])
      const bodyStart = sepIdx + 4
      if (rawBuffer.length < bodyStart + len) return
      const bodyText = rawBuffer.subarray(bodyStart, bodyStart + len).toString('utf8')
      rawBuffer = rawBuffer.subarray(bodyStart + len)
      void dispatchRawMessage(bodyText)
    } else {
      const nlIdx = rawBuffer.indexOf(0x0a)
      if (nlIdx < 0) return
      const line = rawBuffer.subarray(0, nlIdx).toString('utf8')
      rawBuffer = rawBuffer.subarray(nlIdx + 1)
      void dispatchRawMessage(line)
    }
  }
}

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false
  try {
    const a = fs.realpathSync(process.argv[1])
    const b = fs.realpathSync(fileURLToPath(metaUrl))
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  } catch {
    const a = path.resolve(process.argv[1])
    const b = path.resolve(fileURLToPath(metaUrl))
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  }
}

if (isMainModule(import.meta.url)) {
  process.on('SIGINT', () => { cleanupSpawnedHeadless(); process.exit(0) })
  process.on('SIGTERM', () => { cleanupSpawnedHeadless(); process.exit(0) })
  process.on('exit', () => { cleanupSpawnedHeadless() })

  process.stdin.on('data', chunk => {
    rawBuffer = Buffer.concat([rawBuffer, chunk])
    drainBuffer()
  })

  process.stdin.on('end', () => {
    if (rawBuffer.length > 0) {
      const rest = rawBuffer.toString('utf8').trim()
      if (rest) void dispatchRawMessage(rest)
    }
  })
}
