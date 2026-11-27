// Right-docked Real-Time Texture Library Drawer (non-modal, zero viewport obstruction).
// Features: User Saved Textures + Built-in Substance Templates, category filters,
// live hover 3D tree preview & seamless restore, 1-click apply, open in Node Editor,
// rename/duplicate/delete, PNG export, and JSON bundle import/export.
import './texgraph.css'
import type { Texture } from 'three'
import type { EditableTextureSlot } from '../studio/texture-slots'
import type { TreeSpec } from '../tree/spec'
import {
  dataUrlToThreeTexture, evaluateTextureGraph, materialOutputToDataUrl,
  materialOutputToThreeTexture,
} from './engine'
import { cloneGraph } from './nodes'
import type { SavedTextureItem, TextureLibraryStore } from './store'
import {
  detectGraphAtlasGrid, detectGraphAtlasRegions, getTextureTemplate, textureTemplates,
} from './templates'
import type { AtlasRegion, TextureCategory, TextureGraph, TextureGraphSource } from './types'
import { categoryLabels, defaultSlotForCategory, slotLabels } from './types'

export type TextureLibraryTab = 'mine' | 'templates'

export interface AppliedTextureMeta {
  atlasCols?: number
  atlasRows?: number
  atlasRegions?: AtlasRegion[]
  graph?: TextureGraph
  savedId?: string
  templateId?: string
}

/** Attach node-graph / library provenance onto a live Three.js Texture. */
export function attachTextureGraphSource(texture: Texture, source?: TextureGraphSource): void {
  if (!source || (!source.graph && !source.savedId && !source.templateId)) return
  const ud = (texture.userData ??= {}) as Record<string, unknown>
  ud.texGraphSource = {
    ...(source.graph ? { graph: cloneGraph(source.graph) } : {}),
    ...(source.savedId ? { savedId: source.savedId } : {}),
    ...(source.templateId ? { templateId: source.templateId } : {}),
  } satisfies TextureGraphSource
}

/** Read node-graph / library provenance from a live Three.js Texture. */
export function readTextureGraphSource(texture?: Texture): TextureGraphSource | undefined {
  if (!texture?.userData) return undefined
  const raw = (texture.userData as Record<string, unknown>).texGraphSource as TextureGraphSource | undefined
  if (!raw || typeof raw !== 'object') return undefined
  if (!raw.graph && !raw.savedId && !raw.templateId) return undefined
  return raw
}

/** Resolve the exact Texture Editor open options for a given slot so clicking「节点编辑」
 *  always loads the currently active texture's node graph / library item / style template
 *  instead of resetting to a generic default node graph. */
export function resolveSlotEditorOptions(
  slot: EditableTextureSlot,
  customTex: Texture | undefined,
  store: TextureLibraryStore,
  spec?: Pick<TreeSpec, 'kind' | 'shading' | 'leaves' | 'trunk'>,
): { slot: EditableTextureSlot; graph?: TextureGraph; savedId?: string; templateId?: string } {
  // 1. Direct provenance attached to the currently active custom texture
  const src = readTextureGraphSource(customTex)
  if (src) {
    if (src.graph) {
      return { slot, graph: cloneGraph(src.graph), savedId: src.savedId, templateId: src.templateId }
    }
    if (src.savedId) {
      const saved = store.get(src.savedId)
      if (saved) return { slot, graph: cloneGraph(saved.graph), savedId: saved.id }
    }
    if (src.templateId && getTextureTemplate(src.templateId)) {
      return { slot, templateId: src.templateId }
    }
  }

  // 2. Legacy/persisted custom texture without embedded graph: match by name in Texture Library or Templates
  if (customTex?.name) {
    const cleanName = customTex.name.replace(/^[◈◆★]\s*/, '').trim()
    if (cleanName) {
      const allSaved = store.list()
      const exactSlotMatch = allSaved.find(it => it.targetSlot === slot && it.name.trim() === cleanName)
      const anySlotMatch = exactSlotMatch ?? allSaved.find(it => it.name.trim() === cleanName)
      if (anySlotMatch) {
        return { slot, graph: cloneGraph(anySlotMatch.graph), savedId: anySlotMatch.id }
      }
      const tplMatch = textureTemplates.find(t => t.name.trim() === cleanName)
      if (tplMatch) {
        return { slot, templateId: tplMatch.id }
      }
    }
  }

  // 3. No custom texture bound: match the currently active built-in style template on the tree
  if (!customTex && spec) {
    if (slot === 'leaf' && spec.kind === 'broadleaf') {
      const ls = spec.shading.leafStyle
      if (ls === 'oak') {
        const isAtlas = (spec.leaves.atlasCols ?? 1) > 1 || (spec.leaves.atlasRows ?? 1) > 1
        return { slot, templateId: isAtlas ? 'leaf-oak-atlas' : 'leaf-oak-painterly' }
      }
      if (ls === 'maple') return { slot, templateId: 'leaf-maple' }
      if (ls === 'willow') return { slot, templateId: 'leaf-willow' }
      if (ls === 'sakura' || ls === 'flower') return { slot, templateId: 'flower-sakura' }
    }
    if (slot === 'bark' && spec.trunk.barkStyle === 'moss') {
      return { slot, templateId: 'bark-painterly-moss' }
    }
  }

  // 4. Fallback to slot default template
  return { slot }
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
  let activeAppliedId: string | undefined
  let editingNameId: string | undefined
  let confirmDeleteId: string | undefined
  let loadingLibrary = false
  let disposed = false

  // Lazy cached thumbnails for built-in templates (zero startup cost, bounded cache)
  const templateThumbCache = new Map<string, string>()

  const drawer = document.createElement('aside')
  drawer.className = 'tl-drawer'
  drawer.id = 'texture-library-drawer'
  drawer.setAttribute('aria-label', '实时贴图库（单击预览 · 双击应用并返回）')
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
        <button type="button" data-tl-cat="grass" aria-pressed="false">草蕨</button>
      </div>
      <div class="tl-search-row">
        <input id="tl-search" class="tl-search" type="search" placeholder="搜索贴图名称或槽位…">
        <span class="tl-hover-toggle" title="仅在单击卡片时载入并预览贴图，杜绝鼠标划过卡顿；双击直接应用并返回">单击预览 · 双击返回</span>
      </div>
    </div>
    <div class="tl-scroll"><div class="tl-grid" id="tl-grid"></div></div>
    <div class="tl-preview-bar" id="tl-preview-bar" hidden>
      <span id="tl-preview-text">👁 已预览贴图</span>
      <span>单击切换 · 双击应用并返回</span>
    </div>
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
    const texture = materialOutputToThreeTexture(ev.output, tpl.targetSlot, tpl.name)
    return { slot: tpl.targetSlot, name: tpl.name, texture, meta }
  }

  let applySeq = 0
  let pendingApply: { key: string; seq: number; promise: Promise<boolean> } | undefined
  let lastApplied: { key: string; at: number } | undefined

  function syncActiveCards() {
    for (const card of gridEl.querySelectorAll<HTMLElement>('[data-saved-id]')) {
      card.classList.toggle('is-active', card.dataset.savedId === activeAppliedId)
    }
    for (const card of gridEl.querySelectorAll<HTMLElement>('[data-tpl-id]')) {
      card.classList.toggle('is-active', `tpl:${card.dataset.tplId}` === activeAppliedId)
    }
  }

  async function applySavedById(id: string): Promise<boolean> {
    const key = `saved:${id}`
    if (pendingApply?.key === key && pendingApply.seq === applySeq) return pendingApply.promise
    if (!pendingApply && lastApplied?.key === key && activeAppliedId === id && performance.now() - lastApplied.at < 450) {
      return true
    }
    const seq = ++applySeq
    const run = (async () => {
      try {
        await host.store.ensureLoaded?.()
        if (seq !== applySeq || disposed) return false
        const item = host.store.get(id)
        if (!item) return false
        const tex = await resolveSavedTexture(item)
        if (seq !== applySeq || disposed) {
          tex.dispose()
          return false
        }
        const graphCopy = cloneGraph(item.graph)
        attachTextureGraphSource(tex, { graph: graphCopy, savedId: item.id })
        const grid = detectGraphAtlasGrid(item.graph)
        const regions = item.atlasRegions ?? detectGraphAtlasRegions(item.graph)
        const meta: AppliedTextureMeta = {
          ...(grid ? { atlasCols: grid.cols, atlasRows: grid.rows } : {}),
          ...(regions ? { atlasRegions: regions } : {}),
          graph: graphCopy,
          savedId: item.id,
        }
        activeAppliedId = item.id
        lastApplied = { key, at: performance.now() }
        host.applyTexture(item.targetSlot, tex, item.name, false, meta)
        previewText.textContent = `👁 当前已应用「${item.name}」(${slotLabels[item.targetSlot]})`
        previewBar.hidden = false
        host.message(`已应用贴图「${item.name}」到 ${slotLabels[item.targetSlot]}`)
        syncActiveCards()
        return true
      } catch (err) {
        if (seq === applySeq && !disposed) {
          host.message(`应用贴图失败：${err instanceof Error ? err.message : String(err)}`, true)
        }
        return false
      }
    })()
    pendingApply = { key, seq, promise: run }
    try {
      return await run
    } finally {
      if (pendingApply?.promise === run) pendingApply = undefined
    }
  }

  async function applyTemplateById(id: string): Promise<boolean> {
    const key = `tpl:${id}`
    if (pendingApply?.key === key && pendingApply.seq === applySeq) return pendingApply.promise
    if (!pendingApply && lastApplied?.key === key && activeAppliedId === key && performance.now() - lastApplied.at < 450) {
      return true
    }
    const seq = ++applySeq
    const run = (async () => {
      try {
        const resolved = await resolveTemplateTexture(id)
        if (!resolved) return false
        if (seq !== applySeq || disposed) {
          resolved.texture.dispose()
          return false
        }
        const tpl = getTextureTemplate(id)
        const graphCopy = tpl ? tpl.build() : undefined
        attachTextureGraphSource(resolved.texture, { graph: graphCopy, templateId: id })
        activeAppliedId = key
        lastApplied = { key, at: performance.now() }
        const meta: AppliedTextureMeta = {
          ...(resolved.meta ?? {}),
          ...(graphCopy ? { graph: graphCopy } : {}),
          templateId: id,
        }
        host.applyTexture(resolved.slot, resolved.texture, resolved.name, false, meta)
        previewText.textContent = `👁 当前已应用「${resolved.name}」(${slotLabels[resolved.slot]})`
        previewBar.hidden = false
        host.message(`已应用模板贴图「${resolved.name}」到 ${slotLabels[resolved.slot]}`)
        syncActiveCards()
        return true
      } catch (err) {
        if (seq === applySeq && !disposed) {
          host.message(`应用模板贴图失败：${err instanceof Error ? err.message : String(err)}`, true)
        }
        return false
      }
    })()
    pendingApply = { key, seq, promise: run }
    try {
      return await run
    } finally {
      if (pendingApply?.promise === run) pendingApply = undefined
    }
  }

  function syncTabsAndFilters() {
    for (const btn of drawer.querySelectorAll<HTMLButtonElement>('[data-tl-tab]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tlTab === tab))
    }
    for (const btn of drawer.querySelectorAll<HTMLButtonElement>('[data-tl-cat]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tlCat === category))
    }
    mineCountEl.textContent = String(host.store.count ?? host.store.list().length)
    storagePill.textContent = host.store.storageMode === 'file' ? '本地落盘' : '浏览器缓存'
  }

  function render() {
    syncTabsAndFilters()
    if (!openState) return

    const qStr = searchQuery.trim().toLowerCase()

    if (tab === 'mine') {
      if (loadingLibrary) {
        gridEl.innerHTML = '<div class="tl-empty">正在载入本地贴图库…</div>'
        return
      }
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
            <img src="${item.thumbnail || item.dataUrl}" alt="${esc(item.name)}" loading="lazy" decoding="async">
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
              } catch (err) {
                host.message(`重命名失败：${err instanceof Error ? err.message : String(err)}`, true)
              }
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

      // Bind saved card click & double-click (click-only preview; no hover decoding/rebuilds)
      for (const card of gridEl.querySelectorAll<HTMLElement>('[data-saved-id]')) {
        const id = card.dataset.savedId!
        const item = host.store.get(id)
        if (!item) continue
        card.addEventListener('click', e => {
          if ((e.target as HTMLElement).closest('button, input')) return
          void applySavedById(id)
        })
        card.addEventListener('dblclick', async e => {
          const target = e.target as HTMLElement
          if (target.closest('input') || target.closest('button:not([data-act="apply"])')) return
          e.preventDefault()
          const ok = await applySavedById(id)
          if (ok) close()
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
            try {
              const removed = await host.store.remove(id)
              if (removed) {
                if (activeAppliedId === id) activeAppliedId = undefined
                host.message(`已删除贴图「${item.name}」`)
              }
            } catch (err) {
              host.message(`删除贴图失败：${err instanceof Error ? err.message : String(err)}`, true)
              render()
            }
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
          <img src="${thumb}" alt="${esc(tpl.name)}" loading="lazy" decoding="async">
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
      if (!getTextureTemplate(id)) continue
      card.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('button')) return
        void applyTemplateById(id)
      })
      card.addEventListener('dblclick', async e => {
        const target = e.target as HTMLElement
        if (target.closest('button:not([data-tpl-act="apply"])')) return
        e.preventDefault()
        const ok = await applyTemplateById(id)
        if (ok) close()
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
          host.openEditor({ templateId: id })
        }
      }
    }
  }

  // ---- Controls Wiring -----------------------------------------------------
  for (const btn of drawer.querySelectorAll<HTMLButtonElement>('[data-tl-tab]')) {
    btn.onclick = () => {
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
  q('#tl-new').onclick = () => {
    const slot = category === 'all' ? 'leaf' : defaultSlotForCategory(category)
    host.openEditor({ slot })
  }
  q('#tl-close').onclick = () => close()

  q('#tl-export').onclick = async () => {
    try {
      await host.store.ensureLoaded?.()
      const bundle = host.store.exportBundle()
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `vegetation-textures-${bundle.items.length}.json`
      link.href = url
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      host.message(`已导出 ${bundle.items.length} 张贴图到 JSON`)
    } catch (err) {
      host.message(`导出贴图库失败：${err instanceof Error ? err.message : String(err)}`, true)
    }
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
      host.message(`导入贴图库失败：${err instanceof Error ? err.message : String(err)}`, true)
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
    const totalCount = host.store.count ?? host.store.list().length
    if (nextTab) tab = nextTab
    else if (totalCount === 0) tab = 'templates'
    if (filterCategory) category = filterCategory
    openState = true
    drawer.hidden = false
    document.body.classList.add('tl-open')
    window.dispatchEvent(new Event('resize'))
    if (host.store.ensureLoaded && !host.store.isLoaded) {
      loadingLibrary = true
      render()
      void host.store.ensureLoaded().catch(err => {
        if (!disposed) host.message(`载入贴图库失败：${err instanceof Error ? err.message : String(err)}`, true)
      }).finally(() => {
        loadingLibrary = false
        if (openState && !disposed) {
          if (!nextTab && host.store.list().length === 0) tab = 'templates'
          render()
        }
      })
    } else {
      render()
    }
  }

  function close() {
    if (!openState) return
    openState = false
    drawer.hidden = true
    previewBar.hidden = true
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
    isPreviewing: () => false,
    applySavedById,
    applyTemplateById,
    dispose() {
      disposed = true
      applySeq++
      unsub()
      close()
      drawer.remove()
    },
  }
}
