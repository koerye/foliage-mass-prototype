// Right-docked Real-Time Texture Library Drawer (non-modal, zero viewport obstruction).
// Features: User Saved Textures + Built-in Substance Templates, category filters,
// live hover 3D tree preview & seamless restore, 1-click apply, open in Node Editor,
// rename/duplicate/delete, PNG export, and JSON bundle import/export.
import './texgraph.css'
import type { Texture } from 'three'
import type { EditableTextureSlot } from '../studio/texture-slots'
import {
  dataUrlToThreeTexture, evaluateTextureGraph, materialOutputToDataUrl,
  materialOutputToThreeTexture,
} from './engine'
import type { SavedTextureItem, TextureLibraryStore } from './store'
import {
  detectGraphAtlasGrid, detectGraphAtlasRegions, getTextureTemplate, textureTemplates,
} from './templates'
import type { AtlasRegion, TextureCategory, TextureGraph } from './types'
import { categoryLabels, defaultSlotForCategory, slotLabels } from './types'

export type TextureLibraryTab = 'mine' | 'templates'

export interface AppliedTextureMeta {
  atlasCols?: number
  atlasRows?: number
  atlasRegions?: AtlasRegion[]
}

export interface TextureLibraryHost<S> {
  store: TextureLibraryStore
  /** Snapshot current state of a texture slot before live hover preview. */
  snapshotSlot(slot: EditableTextureSlot): S
  /** Restore slot back to snapshot when hover preview ends without clicking. */
  restoreSlot(snapshot: S): void
  /** Apply texture to the 3D tree (used both for hover preview and permanent apply). */
  applyTexture(slot: EditableTextureSlot, texture: Texture, label: string, isPreview: boolean, meta?: AppliedTextureMeta): void
  /** Open the Substance Node Graph Editor with a specific graph / saved item / slot. */
  openEditor(options: { slot?: EditableTextureSlot; graph?: TextureGraph; savedId?: string; templateId?: string }): void
  /** Optional callback before drawer opens (e.g. close Preset Library drawer). */
  onOpen?(): void
  /** Notify toast message. */
  message(text: string, error?: boolean): void
}

export interface TextureLibraryController {
  open(tab?: TextureLibraryTab, filterCategory?: TextureCategory | 'all'): void
  close(): void
  toggle(tab?: TextureLibraryTab): void
  isOpen(): boolean
  isPreviewing(): boolean
  applySavedById(id: string): Promise<boolean>
  applyTemplateById(id: string): Promise<boolean>
  dispose(): void
}

const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

export function mountTextureLibrary<S>(host: TextureLibraryHost<S>): TextureLibraryController {
  let openState = false
  let tab: TextureLibraryTab = 'mine'
  let category: TextureCategory | 'all' = 'all'
  let searchQuery = ''
  let hoverPreviewEnabled = true
  let activeAppliedId: string | undefined
  let suppressHoverKey: string | undefined
  let editingNameId: string | undefined
  let confirmDeleteId: string | undefined

  // Hover preview snapshot management
  let previewSnap: S | undefined
  let previewSnapSlot: EditableTextureSlot | undefined
  let previewingId: string | undefined
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let previewGen = 0

  // Lazy cached thumbnails + baked dataUrls for built-in templates (zero startup cost!)
  const templateThumbCache = new Map<string, string>()
  const templateBakeCache = new Map<string, string>()

  const drawer = document.createElement('aside')
  drawer.className = 'tl-drawer'
  drawer.id = 'texture-library-drawer'
  drawer.setAttribute('aria-label', '实时贴图库（支持悬停 3D 实时预览）')
  drawer.hidden = true

  drawer.innerHTML = `
    <header class="tl-head">
      <h3>🎨 实时贴图库</h3>
      <div class="tl-head-actions">
        <button type="button" id="tl-new" class="tl-new-btn" title="打开节点贴图编辑器新建贴图">＋ 新建节点贴图</button>
        <button type="button" id="tl-close" class="tl-close">收起</button>
      </div>
    </header>
    <div class="tl-tabs-row">
      <div class="tl-tabs" role="tablist">
        <button type="button" data-tl-tab="mine" aria-pressed="true">★ 我的贴图 <span class="pl-badge" id="tl-mine-count">0</span></button>
        <button type="button" data-tl-tab="templates" aria-pressed="false">◈ 内置模板 <span class="pl-badge">${textureTemplates.length}</span></button>
      </div>
      <span class="tl-storage-pill" id="tl-storage-pill">本地落盘</span>
    </div>
    <div class="tl-filters">
      <div class="tl-cats" role="group" aria-label="贴图分类">
        <button type="button" data-tl-cat="all" aria-pressed="true">全部</button>
        <button type="button" data-tl-cat="leaf" aria-pressed="false">树叶</button>
        <button type="button" data-tl-cat="bark" aria-pressed="false">树皮</button>
        <button type="button" data-tl-cat="needle" aria-pressed="false">针叶</button>
        <button type="button" data-tl-cat="flower" aria-pressed="false">花朵</button>
      </div>
      <div class="tl-search-row">
        <input id="tl-search" class="tl-search" type="search" placeholder="搜索贴图名称或槽位…">
        <label class="tl-hover-toggle" title="鼠标悬停贴图卡片时，直接在左侧 3D 树木上实时预览效果">
          <input id="tl-hover-cb" type="checkbox" checked>悬停实时 3D 预览
        </label>
      </div>
    </div>
    <div class="tl-preview-bar" id="tl-preview-bar" hidden>
      <span id="tl-preview-text">👁 正在实时预览</span>
      <span>单击应用 · 移开恢复</span>
    </div>
    <div class="tl-scroll"><div class="tl-grid" id="tl-grid"></div></div>
    <footer class="tl-foot">
      <div class="tl-foot-btns">
        <input id="tl-import-file" type="file" accept=".json,application/json" hidden>
        <button type="button" id="tl-import">导入贴图库</button>
        <button type="button" id="tl-export">导出贴图库</button>
      </div>
      <small id="tl-foot-note">保存即落盘，刷新不丢失</small>
    </footer>
  `
  document.body.appendChild(drawer)

  const q = <T extends HTMLElement = HTMLElement>(sel: string) => drawer.querySelector(sel) as T
  const mineCountEl = q('#tl-mine-count')
  const storagePill = q('#tl-storage-pill')
  const searchInput = q<HTMLInputElement>('#tl-search')
  const hoverCb = q<HTMLInputElement>('#tl-hover-cb')
  const previewBar = q('#tl-preview-bar')
  const previewText = q('#tl-preview-text')
  const gridEl = q('#tl-grid')
  const importFile = q<HTMLInputElement>('#tl-import-file')

  function ensureTemplateThumb(tplId: string): string {
    const cached = templateThumbCache.get(tplId)
    if (cached) return cached
    const tpl = getTextureTemplate(tplId)
    if (!tpl) return ''
    const ev = evaluateTextureGraph(tpl.build(), 160)
    const url = materialOutputToDataUrl(ev.output, tpl.targetSlot, 160)
    templateThumbCache.set(tplId, url)
    return url
  }

  async function resolveSavedTexture(item: SavedTextureItem): Promise<Texture> {
    if (item.dataUrl) {
      return dataUrlToThreeTexture(item.dataUrl, item.targetSlot, item.name, {
        normalDataUrl: item.normalDataUrl,
        heightDataUrl: item.heightDataUrl,
        roughnessDataUrl: item.roughnessDataUrl,
      })
    }
    const ev = evaluateTextureGraph(item.graph, item.resolution)
    return materialOutputToThreeTexture(ev.output, item.targetSlot, item.name)
  }

  async function resolveTemplateTexture(tplId: string): Promise<{ slot: EditableTextureSlot; name: string; texture: Texture; meta?: AppliedTextureMeta } | undefined> {
    const tpl = getTextureTemplate(tplId)
    if (!tpl) return undefined
    const graph = tpl.build()
    const grid = detectGraphAtlasGrid(graph)
    const regions = detectGraphAtlasRegions(graph)
    const meta: AppliedTextureMeta | undefined = (grid || regions)
      ? { atlasCols: grid?.cols, atlasRows: grid?.rows, atlasRegions: regions }
      : undefined
    // Evaluate full multi-channel PBR output for templates so 3D gets live Normal + Roughness + Height!
    const ev = evaluateTextureGraph(graph, 512)
    if (!templateBakeCache.has(tplId)) {
      templateBakeCache.set(tplId, materialOutputToDataUrl(ev.output, tpl.targetSlot))
    }
    const texture = materialOutputToThreeTexture(ev.output, tpl.targetSlot, tpl.name)
    return { slot: tpl.targetSlot, name: tpl.name, texture, meta }
  }

  function endHoverPreview(restore: boolean, applyingSlot?: EditableTextureSlot) {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = undefined }
    previewGen++
    if (previewSnap !== undefined) {
      const snap = previewSnap
      const snapSlot = previewSnapSlot
      previewSnap = undefined
      previewSnapSlot = undefined
      previewingId = undefined
      previewBar.hidden = true
      // Always restore if caller requested restore OR if applying to a DIFFERENT slot (prevents cross-slot UAF!)
      if (restore || (applyingSlot !== undefined && snapSlot !== applyingSlot)) {
        host.restoreSlot(snap)
      }
    }
  }

  function startHoverPreview(
    key: string,
    slot: EditableTextureSlot,
    name: string,
    loader: () => Promise<Texture | undefined>,
    meta?: AppliedTextureMeta,
  ) {
    if (!hoverPreviewEnabled || suppressHoverKey === key) return
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = setTimeout(async () => {
      hoverTimer = undefined
      if (!openState || previewingId === key) return
      const gen = ++previewGen
      try {
        const tex = await loader()
        if (!tex || gen !== previewGen || !openState) {
          tex?.dispose()
          return
        }
        // Restore any previous hover slot before snapshotting the new slot (strictly after await succeeds!)
        if (previewSnap !== undefined) {
          host.restoreSlot(previewSnap)
          previewSnap = undefined
          previewSnapSlot = undefined
        }
        const snap = host.snapshotSlot(slot)
        previewSnap = snap
        previewSnapSlot = slot
        previewingId = key
        previewText.textContent = `👁 正在 3D 预览「${name}」(${slotLabels[slot]})`
        previewBar.hidden = false
        host.applyTexture(slot, tex, `预览：${name}`, true, meta)
      } catch {
        // Ignore hover preview errors silently
      }
    }, 85)
  }

  async function applySavedById(id: string): Promise<boolean> {
    const item = host.store.get(id)
    if (!item) return false
    const tex = await resolveSavedTexture(item)
    endHoverPreview(false, item.targetSlot)
    suppressHoverKey = `saved:${id}`
    const grid = detectGraphAtlasGrid(item.graph)
    const regions = item.atlasRegions ?? detectGraphAtlasRegions(item.graph)
    const meta: AppliedTextureMeta | undefined = (grid || regions)
      ? { atlasCols: grid?.cols, atlasRows: grid?.rows, atlasRegions: regions }
      : undefined
    activeAppliedId = item.id
    host.applyTexture(item.targetSlot, tex, item.name, false, meta)
    host.message(`已应用贴图「${item.name}」到 ${slotLabels[item.targetSlot]}`)
    render()
    return true
  }

  async function applyTemplateById(id: string): Promise<boolean> {
    const resolved = await resolveTemplateTexture(id)
    if (!resolved) return false
    endHoverPreview(false, resolved.slot)
    suppressHoverKey = `tpl:${id}`
    activeAppliedId = `tpl:${id}`
    host.applyTexture(resolved.slot, resolved.texture, resolved.name, false, resolved.meta)
    host.message(`已应用模板贴图「${resolved.name}」到 ${slotLabels[resolved.slot]}`)
    render()
    return true
  }

  function syncTabsAndFilters() {
    for (const btn of drawer.querySelectorAll<HTMLButtonElement>('[data-tl-tab]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tlTab === tab))
    }
    for (const btn of drawer.querySelectorAll<HTMLButtonElement>('[data-tl-cat]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tlCat === category))
    }
    mineCountEl.textContent = String(host.store.list().length)
    storagePill.textContent = host.store.storageMode === 'file' ? '本地落盘' : '浏览器缓存'
  }

  function render() {
    syncTabsAndFilters()
    if (!openState) return

    const qStr = searchQuery.trim().toLowerCase()

    if (tab === 'mine') {
      const allMine = host.store.list()
      const filtered = allMine.filter(item => {
        if (category !== 'all' && item.category !== category) return false
        if (qStr && !item.name.toLowerCase().includes(qStr) && !slotLabels[item.targetSlot].toLowerCase().includes(qStr)) return false
        return true
      })

      if (!filtered.length) {
        gridEl.innerHTML = `<div class="tl-empty">
          ${allMine.length === 0
            ? '你的实时贴图库还没有自制贴图。<br>打开「节点贴图工坊」制作树皮或树叶贴图，或先浏览「◈ 内置模板」一键试用与二次编辑！'
            : '当前筛选条件下没有匹配的贴图。'}
          <div>
            <button type="button" id="tl-empty-new">◈ 打开贴图节点工坊</button>
          </div>
        </div>`
        gridEl.querySelector('#tl-empty-new')?.addEventListener('click', () => {
          const slot = category === 'all' ? 'leaf' : defaultSlotForCategory(category)
          host.openEditor({ slot })
        })
        return
      }

      gridEl.innerHTML = filtered.map(item => {
        const active = item.id === activeAppliedId ? ' is-active' : ''
        const isRenaming = editingNameId === item.id
        const isDelConfirm = confirmDeleteId === item.id
        const atlasTag = item.atlasRegions?.length
          ? ` · ${item.atlasRegions.length}区`
          : (item.atlasCols && item.atlasRows && (item.atlasCols > 1 || item.atlasRows > 1)
            ? ` · ${item.atlasCols}×${item.atlasRows}`
            : '')
        const pbrTag = item.normalDataUrl ? ' · PBR' : ''
        return `<article class="tl-card${active}" data-saved-id="${esc(item.id)}">
          <div class="tl-card-thumb">
            <img src="${item.thumbnail || item.dataUrl}" alt="${esc(item.name)}">
            <span class="tl-card-tag">${categoryLabels[item.category]}</span>
            <span class="tl-card-res">${item.resolution}px${atlasTag}${pbrTag}</span>
          </div>
          <div class="tl-card-body">
            ${isRenaming
              ? `<input class="tl-rename-input" data-rename-input="${esc(item.id)}" value="${esc(item.name)}" maxlength="80">`
              : `<div class="tl-card-title" title="${esc(item.name)}">${esc(item.name)}</div>`}
            <div class="tl-card-sub">${slotLabels[item.targetSlot]} · ${formatDate(item.updatedAt)}</div>
            <div class="tl-card-actions">
              <button type="button" class="tl-act-apply" data-act="apply" data-id="${esc(item.id)}">应用到 3D</button>
              <button type="button" class="tl-act-edit" data-act="edit" data-id="${esc(item.id)}" title="在节点工坊中继续编辑此贴图">◈ 编辑</button>
            </div>
            <div class="tl-card-actions-sub">
              <button type="button" data-act="rename" data-id="${esc(item.id)}" title="重命名">改名</button>
              <button type="button" data-act="png" data-id="${esc(item.id)}" title="下载 PNG 图片">PNG</button>
              <button type="button" class="tl-act-del${isDelConfirm ? ' is-confirm' : ''}" data-act="del" data-id="${esc(item.id)}" title="删除此贴图">${isDelConfirm ? '确认删?' : '删'}</button>
            </div>
          </div>
        </article>`
      }).join('')

      // Bind rename input focus if active
      if (editingNameId) {
        const inp = gridEl.querySelector<HTMLInputElement>(`[data-rename-input="${CSS.escape(editingNameId)}"]`)
        if (inp) {
          inp.focus()
          inp.select()
          const commit = async () => {
            const id = editingNameId
            editingNameId = undefined
            const next = inp.value.trim()
            if (id && next) {
              try {
                await host.store.rename(id, next)
                host.message(`已重命名为「${next}」`)
              } catch (err) { host.message(String(err), true) }
            }
            render()
          }
          inp.onkeydown = e => {
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
            else if (e.key === 'Escape') { editingNameId = undefined; render() }
          }
          inp.onblur = () => { if (editingNameId) void commit() }
        }
      }

      // Bind saved card hover & click
      for (const card of gridEl.querySelectorAll<HTMLElement>('[data-saved-id]')) {
        const id = card.dataset.savedId!
        const item = host.store.get(id)
        if (!item) continue
        card.addEventListener('pointerenter', () => {
          const grid = detectGraphAtlasGrid(item.graph)
          const regions = item.atlasRegions ?? detectGraphAtlasRegions(item.graph)
          const meta: AppliedTextureMeta | undefined = (grid || regions)
            ? { atlasCols: grid?.cols, atlasRows: grid?.rows, atlasRegions: regions }
            : undefined
          startHoverPreview(`saved:${id}`, item.targetSlot, item.name, () => resolveSavedTexture(item), meta)
        })
        card.addEventListener('pointerleave', () => {
          if (suppressHoverKey === `saved:${id}`) suppressHoverKey = undefined
          endHoverPreview(true)
        })
        card.addEventListener('click', e => {
          if ((e.target as HTMLElement).closest('button, input')) return
          void applySavedById(id)
        })
      }

      for (const btn of gridEl.querySelectorAll<HTMLButtonElement>('[data-act]')) {
        btn.onclick = async e => {
          e.stopPropagation()
          const act = btn.dataset.act!
          const id = btn.dataset.id!
          const item = host.store.get(id)
          if (!item) return
          if (act === 'apply') {
            await applySavedById(id)
          } else if (act === 'edit') {
            endHoverPreview(true)
            host.openEditor({ graph: item.graph, savedId: item.id })
          } else if (act === 'rename') {
            confirmDeleteId = undefined
            editingNameId = id
            render()
          } else if (act === 'png') {
            const link = document.createElement('a')
            link.download = `${item.name.replace(/[\\/:*?"<>|]/g, '_')}-${item.resolution}.png`
            link.href = item.dataUrl || item.thumbnail
            link.click()
            host.message(`已下载 ${link.download}`)
          } else if (act === 'del') {
            if (confirmDeleteId !== id) {
              confirmDeleteId = id
              render()
              return
            }
            confirmDeleteId = undefined
            endHoverPreview(true)
            await host.store.remove(id)
            host.message(`已删除贴图「${item.name}」`)
          }
        }
      }
      return
    }

    // Built-in procedural templates tab
    const filteredTpls = textureTemplates.filter(t => {
      if (category !== 'all' && t.category !== category) return false
      if (qStr && !t.name.toLowerCase().includes(qStr) && !t.subtitle.toLowerCase().includes(qStr)) return false
      return true
    })

    gridEl.innerHTML = filteredTpls.map(tpl => {
      const thumb = ensureTemplateThumb(tpl.id)
      const active = activeAppliedId === `tpl:${tpl.id}` ? ' is-active' : ''
      return `<article class="tl-card${active}" data-tpl-id="${esc(tpl.id)}">
        <div class="tl-card-thumb">
          <img src="${thumb}" alt="${esc(tpl.name)}">
          <span class="tl-card-tag">${categoryLabels[tpl.category]}</span>
          <span class="tl-card-res">节点模板</span>
        </div>
        <div class="tl-card-body">
          <div class="tl-card-title" title="${esc(tpl.name)}">${esc(tpl.name)}</div>
          <div class="tl-card-sub" title="${esc(tpl.subtitle)}">${esc(tpl.subtitle)}</div>
          <div class="tl-card-actions">
            <button type="button" class="tl-act-apply" data-tpl-act="apply" data-id="${esc(tpl.id)}">应用到 3D</button>
            <button type="button" class="tl-act-edit" data-tpl-act="edit" data-id="${esc(tpl.id)}" title="以此模板为基础打开节点工坊自由改造">◈ 节点改造</button>
          </div>
        </div>
      </article>`
    }).join('')

    for (const card of gridEl.querySelectorAll<HTMLElement>('[data-tpl-id]')) {
      const id = card.dataset.tplId!
      const tpl = getTextureTemplate(id)
      if (!tpl) continue
      card.addEventListener('pointerenter', () => {
        const g = tpl.build()
        const grid = detectGraphAtlasGrid(g)
        const regions = detectGraphAtlasRegions(g)
        const meta: AppliedTextureMeta | undefined = (grid || regions)
          ? { atlasCols: grid?.cols, atlasRows: grid?.rows, atlasRegions: regions }
          : undefined
        startHoverPreview(`tpl:${id}`, tpl.targetSlot, tpl.name, async () => (await resolveTemplateTexture(id))?.texture, meta)
      })
      card.addEventListener('pointerleave', () => {
        if (suppressHoverKey === `tpl:${id}`) suppressHoverKey = undefined
        endHoverPreview(true)
      })
      card.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('button')) return
        void applyTemplateById(id)
      })
    }

    for (const btn of gridEl.querySelectorAll<HTMLButtonElement>('[data-tpl-act]')) {
      btn.onclick = async e => {
        e.stopPropagation()
        const act = btn.dataset.tplAct!
        const id = btn.dataset.id!
        if (act === 'apply') {
          await applyTemplateById(id)
        } else if (act === 'edit') {
          endHoverPreview(true)
          host.openEditor({ templateId: id })
        }
      }
    }
  }

  // ---- Controls Wiring -----------------------------------------------------
  for (const btn of drawer.querySelectorAll<HTMLButtonElement>('[data-tl-tab]')) {
    btn.onclick = () => {
      endHoverPreview(true)
      tab = btn.dataset.tlTab as TextureLibraryTab
      confirmDeleteId = undefined
      editingNameId = undefined
      render()
    }
  }
  for (const btn of drawer.querySelectorAll<HTMLButtonElement>('[data-tl-cat]')) {
    btn.onclick = () => {
      category = btn.dataset.tlCat as TextureCategory | 'all'
      render()
    }
  }
  searchInput.oninput = () => { searchQuery = searchInput.value; render() }
  hoverCb.onchange = () => {
    hoverPreviewEnabled = hoverCb.checked
    if (!hoverPreviewEnabled) endHoverPreview(true)
  }
  q('#tl-new').onclick = () => {
    endHoverPreview(true)
    const slot = category === 'all' ? 'leaf' : defaultSlotForCategory(category)
    host.openEditor({ slot })
  }
  q('#tl-close').onclick = () => close()

  q('#tl-export').onclick = () => {
    const bundle = host.store.exportBundle()
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `vegetation-textures-${bundle.items.length}.json`
    link.href = url
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    host.message(`已导出 ${bundle.items.length} 张贴图到 JSON`)
  }
  q('#tl-import').onclick = () => importFile.click()
  importFile.onchange = async () => {
    const file = importFile.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const res = await host.store.importBundle(parsed)
      tab = 'mine'
      render()
      host.message(`已导入贴图库：新增 ${res.added} 项，更新 ${res.updated} 项`)
    } catch (err) {
      host.message('导入贴图库失败：' + String(err), true)
    } finally {
      importFile.value = ''
    }
  }

  const unsub = host.store.subscribe(() => {
    syncTabsAndFilters()
    if (openState) render()
  })

  function open(nextTab?: TextureLibraryTab, filterCategory?: TextureCategory | 'all') {
    host.onOpen?.()
    if (nextTab) tab = nextTab
    else if (host.store.list().length === 0) tab = 'templates'
    if (filterCategory) category = filterCategory
    openState = true
    drawer.hidden = false
    document.body.classList.add('tl-open')
    window.dispatchEvent(new Event('resize'))
    render()
  }

  function close() {
    if (!openState) return
    endHoverPreview(true)
    openState = false
    drawer.hidden = true
    confirmDeleteId = undefined
    editingNameId = undefined
    document.body.classList.remove('tl-open')
    window.dispatchEvent(new Event('resize'))
  }

  return {
    open,
    close,
    toggle(nextTab?: TextureLibraryTab) {
      if (openState && (!nextTab || nextTab === tab)) close()
      else open(nextTab)
    },
    isOpen: () => openState,
    isPreviewing: () => previewSnap !== undefined,
    applySavedById,
    applyTemplateById,
    dispose() {
      unsub()
      close()
      drawer.remove()
    },
  }
}
