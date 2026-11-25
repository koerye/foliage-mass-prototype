// Electron Preload Script (strict contextIsolation: true, nodeIntegration: false).
// Exposes optional `window.desktopApi` for native file dialogs, local data directory access,
// multi-window popout, and 1-click MCP config copying.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApi', {
  isDesktop: true,
  platform: process.platform,
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  saveBinaryFile: options => ipcRenderer.invoke('desktop:save-binary', options),
  saveTextFile: options => ipcRenderer.invoke('desktop:save-text', options),
  saveExportBundle: options => ipcRenderer.invoke('desktop:save-bundle', options),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data-folder'),
  openPopoutWindow: route => ipcRenderer.invoke('desktop:open-popout', route),
  copyMcpConfig: () => ipcRenderer.invoke('desktop:copy-mcp-config'),
})
