// Dual-mode Electron Dev Runner: launches Vite HMR dev server + Electron desktop shell together.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.VITE_PORT || 5867)
const URL = `http://127.0.0.1:${PORT}`

export function resolveViteCommand(projectRoot = ROOT) {
  const viteJs = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  if (fs.existsSync(viteJs)) {
    return { command: process.execPath, argsPrefix: [viteJs] }
  }
  if (process.platform !== 'win32') {
    const bin = path.join(projectRoot, 'node_modules', '.bin', 'vite')
    if (fs.existsSync(bin)) return { command: bin, argsPrefix: [] }
  }
  throw new Error(`Vite CLI not found at ${viteJs}. Run npm install first.`)
}

export function resolveElectronExecutable(projectRoot = ROOT) {
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
  throw new Error(`Electron executable not found under ${electronPkgDir}. Run npm install first.`)
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

export function waitForUrl(url, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    let activeReq = null
    const finish = err => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (child) {
        child.off('exit', onExit)
        child.off('error', onError)
      }
      if (activeReq) {
        try { activeReq.destroy() } catch {}
      }
      if (err) reject(err)
      else resolve()
    }
    const onExit = (code, signal) => {
      finish(new Error(`Child process exited early before ${url} became ready (code=${code}, signal=${signal})`))
    }
    const onError = err => {
      finish(new Error(`Failed to spawn child process while waiting for ${url}: ${err?.message || err}`))
    }
    if (child) {
      child.once('exit', onExit)
      child.once('error', onError)
      if (child.exitCode !== null) {
        onExit(child.exitCode, child.signalCode)
        return
      }
    }
    const check = () => {
      if (settled) return
      activeReq = http.get(url, res => {
        res.resume()
        finish(null)
      })
      activeReq.on('error', () => {
        if (settled) return
        if (Date.now() > deadline) finish(new Error(`Timed out waiting for ${url}`))
        else timer = setTimeout(check, 250)
      })
    }
    check()
  })
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

async function runDev() {
  const viteLaunch = resolveViteCommand(ROOT)
  const vite = spawn(viteLaunch.command, [...viteLaunch.argsPrefix, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })

  let elec = null
  let shuttingDown = false
  const shutdown = (exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    killProcessTree(elec)
    killProcessTree(vite)
    process.exit(exitCode)
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
  process.on('SIGHUP', () => shutdown(0))
  process.on('exit', () => {
    killProcessTree(elec)
    killProcessTree(vite)
  })

  try {
    await waitForUrl(`${URL}/broadleaf.html`, vite)
  } catch (err) {
    console.error(err)
    shutdown(1)
    return
  }

  let electronLaunch
  try {
    electronLaunch = resolveElectronExecutable(ROOT)
  } catch (err) {
    console.error(err)
    shutdown(1)
    return
  }

  elec = spawn(electronLaunch.command, [...electronLaunch.argsPrefix, path.join(ROOT, 'electron', 'main.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ELECTRON_DEV_URL: URL },
  })

  elec.on('error', err => {
    console.error('Failed to launch Electron:', err)
    shutdown(1)
  })

  elec.on('exit', code => {
    shutdown(code ?? 0)
  })
}

if (isMainModule(import.meta.url)) {
  void runDev()
}
