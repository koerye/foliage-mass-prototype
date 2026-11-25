// Optional Electron Desktop Bridge helper.
// In standard Web / Vite dev mode, `window.desktopApi` is undefined and all helpers return false
// so the web app falls back seamlessly to standard browser downloads (100% dual-mode safe).

export interface DesktopSaveResult {
  canceled: boolean
  filePath?: string
  bytes?: number
}

export interface DesktopBundleSaveResult {
  canceled: boolean
  dirPath?: string
  fileCount?: number
  bytes?: number
}

export interface DesktopBridgeInfo {
  isDesktop: true
  platform: string
  appVersion: string
  dataDir: string
  bridgeUrl: string
  mcpPort: number
  tokenFile: string
  mcpServerEntry: string
}

export interface DesktopApi {
  readonly isDesktop: true
  readonly platform: string
  getInfo(): Promise<DesktopBridgeInfo>
  saveBinaryFile(options: {
    defaultName: string
    title?: string
    filters?: { name: string; extensions: string[] }[]
    base64Data: string
  }): Promise<DesktopSaveResult>
  saveTextFile(options: {
    defaultName: string
    title?: string
    filters?: { name: string; extensions: string[] }[]
    text: string
  }): Promise<DesktopSaveResult>
  saveExportBundle?(options: {
    folderName: string
    title?: string
    files: { path: string; base64Data: string }[]
  }): Promise<DesktopBundleSaveResult>
  openDataFolder(): Promise<void>
  openPopoutWindow(route: string): Promise<void>
  copyMcpConfig(): Promise<string>
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function tryDesktopSaveBundle(
  folderName: string,
  files: { path: string; data: Uint8Array }[],
  title?: string,
): Promise<{ handled: boolean; canceled?: boolean; dirPath?: string; fileCount?: number }> {
  const api = getDesktopApi()
  if (!api?.saveExportBundle) return { handled: false }
  const encoded = files.map(f => ({ path: f.path, base64Data: bytesToBase64(f.data) }))
  const res = await api.saveExportBundle({ folderName, title, files: encoded })
  return { handled: true, canceled: res.canceled, dirPath: res.dirPath, fileCount: res.fileCount }
}

export function getDesktopApi(): DesktopApi | undefined {
  if (typeof window === 'undefined') return undefined
  const api = (window as unknown as { desktopApi?: DesktopApi }).desktopApi
  return api?.isDesktop ? api : undefined
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Save a Blob natively via OS Save Dialog when running inside Electron desktop app.
 *  Returns `{ handled: false }` in browser mode so caller can trigger standard `<a download>`. */
export async function tryDesktopSaveBlob(
  blob: Blob,
  defaultName: string,
  filters?: { name: string; extensions: string[] }[],
  title?: string,
): Promise<{ handled: boolean; canceled?: boolean; filePath?: string }> {
  const api = getDesktopApi()
  if (!api) return { handled: false }
  const base64Data = await blobToBase64(blob)
  const res = await api.saveBinaryFile({ defaultName, title, filters, base64Data })
  return { handled: true, canceled: res.canceled, filePath: res.filePath }
}

/** Mount a subtle desktop MCP badge into the studio top navigation bar when running inside Electron `.exe`. */
export function mountDesktopToolbarBadge(navSelector = 'header.bar nav', onNotify?: (msg: string) => void): void {
  const api = getDesktopApi()
  if (!api || typeof document === 'undefined') return
  const nav = document.querySelector(navSelector)
  if (!nav || nav.querySelector('#desktop-mcp-badge')) return

  const btn = document.createElement('button')
  btn.id = 'desktop-mcp-badge'
  btn.type = 'button'
  btn.textContent = '⚡ MCP 已就绪'
  btn.title = '桌面版已内置 MCP 控制桥（点击复制 mcp_config.json 配置，右键打开本地数据目录）'
  btn.style.cssText = 'background:#163d2d;color:#d6ffe7;border-color:#2c7a56;font-weight:600;'
  btn.onclick = async () => {
    try {
      await api.copyMcpConfig()
      onNotify?.('已复制 Vegetation Studio MCP 配置到剪贴板（可粘贴进 Antigravity / Cursor / Claude）')
    } catch (err) {
      onNotify?.('复制 MCP 配置失败：' + String(err))
    }
  }
  btn.oncontextmenu = ev => {
    ev.preventDefault()
    void api.openDataFolder()
    onNotify?.('已打开本地数据与预设目录')
  }
  nav.appendChild(btn)
}
