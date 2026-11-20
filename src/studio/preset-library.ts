// Non-modal right-docked Preset Library drawer with live 3D hover preview,
// real-time cover thumbnail capture, save/overwrite/rename/delete, and bundle import/export.
import './presets.css'
import type { AiSceneSpec } from '../ai/scene'
import type { TreeKind, TreeSpec } from '../tree/spec'
import type { LightingPreset } from '../viewport'
import type { PresetScope, PresetStore, SavedPreset } from './preset-store'

export interface CurrentCapture<T> {
  defaultName: string
  kind: TreeKind | 'multi'
  kindLabel: string
  triangles: number
  lighting: LightingPreset
  thumbnail: string
  payload: T
  canSave?: boolean
  emptyReason?: string
}

export interface ShowcaseOption<T> {
  id: string
  name: string
  subtitle: string
  tag: string
  lighting: LightingPreset
  thumbnail: string
  build: () => T
}

export interface PresetLibraryHost<T extends TreeSpec | AiSceneSpec, S> {
  scope: PresetScope
  store: PresetStore
  /** Optional built-in curated showcases displayed in a dedicated tab with live 3D hover preview. */
  showcases?: ShowcaseOption<T>[]
  /** Capture the live scene/tree state + fresh 3D thumbnail for saving. */
  capture(): CurrentCapture<T>
  /** Snapshot current working state before entering hover live-preview. */
  snapshotState(): S
  /** Restore working state when hover live-preview ends without clicking. */
  restoreState(snapshot: S): void
  /** Live-preview a saved preset directly in the 3D viewport (non-destructive). */
  preview(preset: SavedPreset<T>): void
  /** Permanently apply a saved preset to the workspace. */
  apply(preset: SavedPreset<T>): void
  /** Optional hook when user applies a built-in showcase (defaults to `apply`). */
  applyShowcase?(showcase: ShowcaseOption<T>): void
  /** Notify status / error toast. */
  message(text: string, error?: boolean): void
  /** Optional callback whenever active saved preset id changes (e.g. sync #preset select). */
  onActiveChange?(id: string | undefined): void
}

const fmt = new Intl.NumberFormat('zh-CN')
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

export type PresetLibraryTab = 'mine' | 'showcases'

export interface PresetLibraryController {
  open(focusSaveInput?: boolean, tab?: PresetLibraryTab): void
  close(): void
  toggle(tab?: PresetLibraryTab): void
  isOpen(): boolean
  isPreviewing(): boolean
  getActiveId(): string | undefined
  setActiveId(id: string | undefined): void
  setActiveShowcaseId(id: string | undefined): void
  refreshCapture(syncName?: boolean): void
  dispose(): void
}

export function mountPresetLibrary<T extends TreeSpec | AiSceneSpec, S>(
  host: PresetLibraryHost<T, S>,
): PresetLibraryController {
  const showcases = host.showcases ?? []
  const hasShowcases = showcases.length > 0
  const drawer = document.createElement('aside')
  drawer.className = 'pl-drawer'
  drawer.id = 'preset-library-drawer'
  drawer.setAttribute('aria-label', hasShowcases ? '案例库与我的预设库' : '我的预设库与实时预览')
  drawer.hidden = true
  drawer.innerHTML = `
    <header class="pl-head">
      ${hasShowcases
        ? `<div class="pl-tabs" role="tablist">
            <button type="button" data-pl-tab="showcases" aria-pressed="false">✿ 案例库 <span class="pl-badge" id="pl-showcase-count">${showcases.length}</span></button>
            <button type="button" data-pl-tab="mine" aria-pressed="true">★ 我的预设 <span class="pl-badge" id="pl-count">0</span></button>
          </div>`
        : `<h3>★ 我的预设库 <span class="pl-badge" id="pl-count">0</span></h3>`}
      <button type="button" class="pl-close" id="pl-close">收起</button>
    </header>
    <div class="pl-preview-bar" id="pl-preview-bar" hidden>
      <span id="pl-preview-text">👁 正在实时预览</span>
      <span>单击应用 · 移开恢复</span>
    </div>
    <section class="pl-capture" id="pl-capture-box">
      <div class="pl-thumb-box">
        <img id="pl-cap-img" alt="当前 3D 实时封面">
        <button type="button" class="pl-thumb-refresh" id="pl-cap-refresh" title="按当前 3D 视角重新截取封面">🔄 刷新封面</button>
      </div>
      <div class="pl-capture-form">
        <input id="pl-cap-name" type="text" maxlength="80" placeholder="输入预设名称（如：风吹老柳 / 夕阳红枫）">
        <div class="pl-meta-line" id="pl-cap-meta"></div>
        <div class="pl-capture-btns">
          <button type="button" class="primary" id="pl-save-new">★ 保存为新预设</button>
          <button type="button" class="pl-update-btn" id="pl-overwrite-active" hidden>覆盖当前预设</button>
        </div>
      </div>
    </section>
    <div class="pl-toolbar">
      <input id="pl-search" class="pl-search" type="search" placeholder="搜索已保存预设…">
      <label class="pl-hover-toggle" title="鼠标移入卡片时在左侧 3D 视口实时预览模型">
        <input id="pl-hover-on" type="checkbox" checked>
        <span>悬停实时 3D 预览</span>
      </label>
    </div>
    <div class="pl-grid-wrap" id="pl-grid-wrap">
      <div class="pl-grid" id="pl-grid"></div>
      <div class="pl-empty" id="pl-empty" hidden>
        还没有保存的预设。<br>在左侧调好植物后，填个名字点上方「★ 保存为新预设」，即可带 3D 缩略图永久收藏并随时悬停预览。
      </div>
    </div>
    <footer class="pl-foot">
      <div class="pl-foot-storage" id="pl-storage-info"><span class="pl-foot-dot"></span><span>本地预设库</span></div>
      <div class="pl-foot-btns">
        <input id="pl-import-file" type="file" accept=".json,application/json" hidden>
        <button type="button" id="pl-import-btn" title="导入预设库合集 JSON">导入</button>
        <button type="button" id="pl-export-btn" title="导出当前预设库合集备份">导出合集</button>
      </div>
    </footer>`
  document.body.append(drawer)

  const q = <E extends HTMLElement = HTMLElement>(sel: string) => drawer.querySelector(sel) as E
  const countEl = q('#pl-count')
  const previewBar = q('#pl-preview-bar')
  const previewText = q('#pl-preview-text')
  const captureBox = q('#pl-capture-box')
  const capImg = q<HTMLImageElement>('#pl-cap-img')
  const capName = q<HTMLInputElement>('#pl-cap-name')
  const capMeta = q('#pl-cap-meta')
  const saveNewBtn = q<HTMLButtonElement>('#pl-save-new')
  const overwriteBtn = q<HTMLButtonElement>('#pl-overwrite-active')
  const searchInput = q<HTMLInputElement>('#pl-search')
  const hoverCheck = q<HTMLInputElement>('#pl-hover-on')
  const gridWrap = q('#pl-grid-wrap')
  const gridEl = q('#pl-grid')
  const emptyEl = q('#pl-empty')
  const storageInfo = q('#pl-storage-info')
  const importFile = q<HTMLInputElement>('#pl-import-file')
  const tabBtns = [...drawer.querySelectorAll<HTMLButtonElement>('[data-pl-tab]')]

  let currentTab: PresetLibraryTab = 'mine'
  let activeId: string | undefined
  let activeShowcaseId: string | undefined
  let previewSnapshot: { state: S } | undefined
  let previewingId: string | undefined

  const showcaseToPreset = (s: ShowcaseOption<T>): SavedPreset<T> => ({
    id: 'showcase:' + s.id,
    scope: host.scope,
    name: s.name,
    kind: 'multi',
    kindLabel: s.tag,
    triangles: 0,
    lighting: s.lighting,
    thumbnail: s.thumbnail,
    createdAt: '',
    updatedAt: '',
    payload: s.build(),
  })

  const setTab = (tab: PresetLibraryTab) => {
    const next: PresetLibraryTab = hasShowcases && tab === 'showcases' ? 'showcases' : 'mine'
    if (next !== currentTab && (previewSnapshot || hoverTimer !== undefined)) endHoverPreview(true)
    currentTab = next
    for (const b of tabBtns) b.setAttribute('aria-pressed', String(b.dataset.plTab === currentTab))
    captureBox.hidden = currentTab === 'showcases'
    searchInput.placeholder = currentTab === 'showcases' ? '搜索内置案例库…' : '搜索已保存预设…'
    if (currentTab === 'mine' && !drawer.hidden && !previewSnapshot) refreshCapture(false)
    renderGrid()
  }
  for (const b of tabBtns) b.onclick = () => setTab(b.dataset.plTab as PresetLibraryTab)
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let renamingId: string | undefined
  let confirmDeleteId: string | undefined
  let confirmTimer: ReturnType<typeof setTimeout> | undefined

  const clearHoverTimer = () => {
    if (hoverTimer !== undefined) { clearTimeout(hoverTimer); hoverTimer = undefined }
  }

  const endHoverPreview = (restore: boolean) => {
    clearHoverTimer()
    const snap = previewSnapshot
    previewSnapshot = undefined
    previewingId = undefined
    previewBar.hidden = true
    updateCardClasses()
    if (restore && snap) host.restoreState(snap.state)
  }

  const startHoverPreview = (preset: SavedPreset<T>) => {
    if (!hoverCheck.checked || renamingId) return
    if (previewingId === preset.id) return
    clearHoverTimer()
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined
      if (drawer.hidden || !hoverCheck.checked) return
      if (!previewSnapshot) previewSnapshot = { state: host.snapshotState() }
      previewingId = preset.id
      previewText.textContent = `👁 正在实时预览：「${preset.name}」`
      previewBar.hidden = false
      updateCardClasses()
      host.preview(preset)
    }, 85)
  }

  const updateCardClasses = () => {
    for (const card of gridEl.querySelectorAll<HTMLElement>('.pl-card')) {
      const pid = card.dataset.presetId
      const sid = card.dataset.showcaseId
      if (sid) {
        card.classList.toggle('is-active', sid === activeShowcaseId)
        card.classList.toggle('is-previewing', 'showcase:' + sid === previewingId)
      } else {
        card.classList.toggle('is-active', Boolean(pid && pid === activeId))
        card.classList.toggle('is-previewing', Boolean(pid && pid === previewingId))
      }
    }
  }

  const refreshCapture = (updateNameIfEmpty = false) => {
    if (previewSnapshot) endHoverPreview(true)
    const cap = host.capture()
    if (cap.thumbnail) {
      capImg.src = cap.thumbnail
      capImg.style.visibility = 'visible'
    } else {
      capImg.removeAttribute('src')
      capImg.style.visibility = 'hidden'
    }
    if (updateNameIfEmpty || !capName.value.trim()) {
      const existing = activeId ? host.store.get<T>(activeId) : undefined
      capName.value = existing ? existing.name : cap.defaultName
    }
    capMeta.textContent = cap.canSave === false
      ? (cap.emptyReason || '当前画布为空')
      : `${cap.kindLabel} · ${fmt.format(cap.triangles)} 面`
    saveNewBtn.disabled = cap.canSave === false
    const activePreset = activeId ? host.store.get<T>(activeId) : undefined
    overwriteBtn.hidden = !activePreset || cap.canSave === false
    if (activePreset) overwriteBtn.textContent = `覆盖「${activePreset.name.slice(0, 10)}」`
  }

  const updateStorageBadge = () => {
    storageInfo.innerHTML = host.store.storageMode === 'file'
      ? '<span class="pl-foot-dot"></span><span>本地落盘 user-presets/presets.json</span>'
      : '<span class="pl-foot-dot"></span><span>浏览器本地持久存储</span>'
  }

  const renderGrid = () => {
    const all = host.store.list<T>(host.scope)
    countEl.textContent = String(all.length)
    updateStorageBadge()
    const kw = searchInput.value.trim().toLowerCase()

    if (currentTab === 'showcases' && hasShowcases) {
      const filteredCases = kw
        ? showcases.filter(s => s.name.toLowerCase().includes(kw) || s.subtitle.toLowerCase().includes(kw) || s.tag.toLowerCase().includes(kw))
        : showcases
      emptyEl.hidden = filteredCases.length > 0
      if (!filteredCases.length) {
        emptyEl.innerHTML = '没有匹配的内置案例，试试清空搜索词。'
        gridEl.innerHTML = ''
        return
      }
      gridEl.innerHTML = filteredCases.map(s => {
        const sid = esc(s.id)
        const name = esc(s.name)
        const sub = esc(s.subtitle)
        const tag = esc(s.tag)
        const activeCls = s.id === activeShowcaseId ? 'is-active' : ''
        const prevCls = 'showcase:' + s.id === previewingId ? 'is-previewing' : ''
        return `<article class="pl-card ${activeCls} ${prevCls}" data-showcase-id="${sid}" title="单击加载全参数案例；悬停实时 3D 预览">
          <div class="pl-card-thumb">
            <div class="pl-card-noimg">✿</div>
            ${s.thumbnail ? `<img src="${esc(s.thumbnail)}" alt="${name}" loading="lazy" style="position:absolute;inset:0" onerror="this.remove()">` : ''}
            <span class="pl-card-tag">${tag}</span>
          </div>
          <div class="pl-card-body">
            <div class="pl-card-title">${name}</div>
            <div class="pl-card-sub is-multi">${sub}</div>
            <div class="pl-card-actions">
              <button type="button" data-act="load-case" data-id="${sid}" title="载入此案例并可任意调参">载入编辑</button>
              <button type="button" data-act="fork-case" data-id="${sid}" title="载入并收藏一份到我的预设库">★ 收藏</button>
            </div>
          </div>
        </article>`
      }).join('')
      return
    }

    const filtered = kw
      ? all.filter(p => p.name.toLowerCase().includes(kw) || p.kindLabel.toLowerCase().includes(kw))
      : all
    emptyEl.hidden = filtered.length > 0
    if (!filtered.length) {
      emptyEl.innerHTML = all.length
        ? '没有匹配的预设，试试清空搜索词。'
        : '还没有保存的预设。<br>在左侧调好植物后，填个名字点上方「★ 保存为新预设」，即可带 3D 缩略图永久收藏并随时悬停预览。'
      gridEl.innerHTML = ''
      return
    }
    gridEl.innerHTML = filtered.map(p => {
      const id = esc(p.id)
      const name = esc(p.name)
      const kind = esc(p.kindLabel)
      const isRenaming = renamingId === p.id
      const isConfirmDel = confirmDeleteId === p.id
      return `<article class="pl-card ${p.id === activeId ? 'is-active' : ''} ${p.id === previewingId ? 'is-previewing' : ''}" data-preset-id="${id}" title="单击应用预设；悬停可实时预览">
        <div class="pl-card-thumb">
          ${p.thumbnail ? `<img src="${p.thumbnail}" alt="${name}" loading="lazy">` : '<div class="pl-card-noimg">🌿</div>'}
          <span class="pl-card-tag">${kind}</span>
        </div>
        <div class="pl-card-body">
          ${isRenaming
            ? `<input class="pl-card-rename" data-rename-input="${id}" value="${name}" maxlength="80">`
            : `<div class="pl-card-title">${name}</div>`}
          <div class="pl-card-sub">${fmt.format(p.triangles)} 面 · ${formatDate(p.updatedAt)}</div>
          <div class="pl-card-actions">
            <button type="button" data-act="overwrite" data-id="${id}" title="用当前画布模型覆盖此预设">更新</button>
            <button type="button" data-act="rename" data-id="${id}" title="重命名预设">${isRenaming ? '确定' : '改名'}</button>
            <button type="button" class="is-danger ${isConfirmDel ? 'is-confirm' : ''}" data-act="delete" data-id="${id}" title="删除此预设">${isConfirmDel ? '确认删' : '删除'}</button>
          </div>
        </div>
      </article>`
    }).join('')

    if (renamingId) {
      const inp = gridEl.querySelector<HTMLInputElement>(`[data-rename-input="${CSS.escape(renamingId)}"]`)
      if (inp) {
        inp.focus()
        inp.select()
        inp.onkeydown = async e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            await commitRename(renamingId!, inp.value)
          } else if (e.key === 'Escape') {
            renamingId = undefined
            renderGrid()
          }
        }
      }
    }
  }

  const commitRename = async (id: string, value: string) => {
    const trimmed = value.trim()
    renamingId = undefined
    if (!trimmed) { renderGrid(); return }
    try {
      const updated = await host.store.rename(id, trimmed)
      if (activeId === id) capName.value = updated.name
      host.message(`已重命名为「${updated.name}」`)
    } catch (err) {
      host.message(err instanceof Error ? err.message : String(err), true)
    }
    renderGrid()
  }

  const saveNew = async () => {
    if (previewSnapshot) endHoverPreview(true)
    const cap = host.capture()
    if (cap.canSave === false) {
      host.message(cap.emptyReason || '当前没有可保存的内容', true)
      return
    }
    const name = capName.value.trim() || cap.defaultName || '我的植物预设'
    saveNewBtn.disabled = true
    try {
      const saved = await host.store.saveNew<T>({
        scope: host.scope,
        name,
        kind: cap.kind,
        kindLabel: cap.kindLabel,
        triangles: cap.triangles,
        lighting: cap.lighting,
        thumbnail: cap.thumbnail,
        payload: cap.payload,
      })
      activeId = saved.id
      host.onActiveChange?.(activeId)
      refreshCapture(false)
      renderGrid()
      host.message(`已保存预设「${saved.name}」`)
    } catch (err) {
      host.message(err instanceof Error ? err.message : String(err), true)
    } finally {
      saveNewBtn.disabled = false
    }
  }

  const overwritePreset = async (id: string, customName?: string) => {
    if (previewSnapshot) endHoverPreview(true)
    const cap = host.capture()
    if (cap.canSave === false) {
      host.message(cap.emptyReason || '当前画布为空，无法覆盖预设', true)
      return
    }
    try {
      const updated = await host.store.overwrite<T>(id, {
        name: customName,
        kind: cap.kind,
        kindLabel: cap.kindLabel,
        triangles: cap.triangles,
        lighting: cap.lighting,
        thumbnail: cap.thumbnail,
        payload: cap.payload,
      })
      activeId = updated.id
      host.onActiveChange?.(activeId)
      refreshCapture(false)
      renderGrid()
      host.message(`已用当前画面更新预设「${updated.name}」`)
    } catch (err) {
      host.message(err instanceof Error ? err.message : String(err), true)
    }
  }

  // ---- DOM events ----------------------------------------------------------
  q('#pl-close').onclick = () => controller.close()
  q('#pl-cap-refresh').onclick = () => {
    refreshCapture(false)
    host.message('已按当前 3D 视角刷新封面')
  }
  saveNewBtn.onclick = () => { void saveNew() }
  overwriteBtn.onclick = () => {
    if (activeId) void overwritePreset(activeId, capName.value.trim() || undefined)
  }
  capName.onkeydown = e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void saveNew()
    }
  }
  searchInput.oninput = () => renderGrid()
  hoverCheck.onchange = () => {
    if (!hoverCheck.checked && previewSnapshot) endHoverPreview(true)
  }

  gridEl.addEventListener('pointerover', e => {
    const target = e.target as HTMLElement
    if (target.closest('button, input')) return
    const card = target.closest<HTMLElement>('.pl-card')
    if (card?.dataset.showcaseId) {
      const sc = showcases.find(s => s.id === card.dataset.showcaseId)
      if (sc) startHoverPreview(showcaseToPreset(sc))
      return
    }
    if (!card?.dataset.presetId) return
    const preset = host.store.get<T>(card.dataset.presetId)
    if (preset) startHoverPreview(preset)
  })
  gridWrap.addEventListener('pointerleave', () => {
    if (previewSnapshot || hoverTimer !== undefined) endHoverPreview(true)
  })

  const applyShowcaseCard = (sc: ShowcaseOption<T>) => {
    endHoverPreview(false)
    activeId = undefined
    activeShowcaseId = sc.id
    host.onActiveChange?.(undefined)
    if (host.applyShowcase) host.applyShowcase(sc)
    else host.apply(showcaseToPreset(sc))
    capName.value = sc.name
    refreshCapture(false)
    renderGrid()
  }

  gridEl.addEventListener('click', async e => {
    const target = e.target as HTMLElement
    if (target.closest('input')) return
    const btn = target.closest<HTMLButtonElement>('button[data-act]')
    if (btn) {
      e.stopPropagation()
      const act = btn.dataset.act
      const id = btn.dataset.id!
      if (act === 'load-case') {
        const sc = showcases.find(s => s.id === id)
        if (sc) applyShowcaseCard(sc)
      } else if (act === 'fork-case') {
        const sc = showcases.find(s => s.id === id)
        if (sc) {
          applyShowcaseCard(sc)
          capName.value = sc.name
          await saveNew()
          setTab('mine')
        }
      } else if (act === 'overwrite') {
        await overwritePreset(id)
      } else if (act === 'rename') {
        if (renamingId === id) {
          const inp = gridEl.querySelector<HTMLInputElement>(`[data-rename-input="${CSS.escape(id)}"]`)
          await commitRename(id, inp?.value ?? '')
        } else {
          if (previewSnapshot) endHoverPreview(true)
          renamingId = id
          renderGrid()
        }
      } else if (act === 'delete') {
        if (confirmDeleteId !== id) {
          confirmDeleteId = id
          if (confirmTimer) clearTimeout(confirmTimer)
          confirmTimer = setTimeout(() => { confirmDeleteId = undefined; renderGrid() }, 3200)
          renderGrid()
        } else {
          if (confirmTimer) clearTimeout(confirmTimer)
          confirmDeleteId = undefined
          if (previewingId === id) endHoverPreview(true)
          const item = host.store.get<T>(id)
          await host.store.remove(id)
          if (activeId === id) {
            activeId = undefined
            host.onActiveChange?.(undefined)
          }
          refreshCapture(false)
          renderGrid()
          if (item) host.message(`已删除预设「${item.name}」`)
        }
      }
      return
    }
    const card = target.closest<HTMLElement>('.pl-card')
    if (card?.dataset.showcaseId) {
      const sc = showcases.find(s => s.id === card.dataset.showcaseId)
      if (sc) applyShowcaseCard(sc)
      return
    }
    if (!card?.dataset.presetId) return
    const preset = host.store.get<T>(card.dataset.presetId)
    if (!preset) return
    endHoverPreview(false)
    activeId = preset.id
    activeShowcaseId = undefined
    host.apply(preset)
    host.onActiveChange?.(activeId)
    capName.value = preset.name
    refreshCapture(false)
    renderGrid()
    host.message(`已应用预设「${preset.name}」`)
  })

  q('#pl-export-btn').onclick = () => {
    const bundle = host.store.exportBundle(host.scope)
    if (!bundle.items.length) { host.message('当前没有可导出的预设', true); return }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `vegetation-presets-${host.scope}.json`
    link.href = url
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    host.message(`已导出 ${bundle.items.length} 个预设合集`)
  }
  q('#pl-import-btn').onclick = () => importFile.click()
  importFile.onchange = async () => {
    const f = importFile.files?.[0]
    if (!f) return
    try {
      const res = await host.store.importBundle(JSON.parse(await f.text()), host.scope)
      renderGrid()
      host.message(`已导入预设：新增 ${res.added} 个，更新 ${res.updated} 个`)
    } catch (err) {
      host.message(err instanceof Error ? err.message : String(err), true)
    } finally {
      importFile.value = ''
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !drawer.hidden && !renamingId) controller.close()
  }
  window.addEventListener('keydown', onKeyDown)

  const unsub = host.store.subscribe(() => {
    if (activeId && !host.store.get(activeId)) {
      activeId = undefined
      host.onActiveChange?.(undefined)
    }
    renderGrid()
  })
  void host.store.ready().then(() => renderGrid())

  const controller: PresetLibraryController = {
    open(focusSaveInput = false, tab?: PresetLibraryTab) {
      drawer.hidden = false
      document.body.classList.add('pl-open')
      setTab(tab ?? (focusSaveInput ? 'mine' : currentTab))
      if (currentTab === 'mine') refreshCapture(true)
      renderGrid()
      requestAnimationFrame(() => { if (!drawer.hidden && !previewSnapshot && currentTab === 'mine') refreshCapture(false) })
      if (focusSaveInput && currentTab === 'mine') {
        capName.focus()
        capName.select()
      }
    },
    close() {
      if (previewSnapshot || hoverTimer !== undefined) endHoverPreview(true)
      renamingId = undefined
      confirmDeleteId = undefined
      drawer.hidden = true
      document.body.classList.remove('pl-open')
    },
    toggle(tab?: PresetLibraryTab) {
      if (drawer.hidden) controller.open(false, tab)
      else if (tab && tab !== currentTab) setTab(tab)
      else controller.close()
    },
    isOpen: () => !drawer.hidden,
    isPreviewing: () => Boolean(previewSnapshot || previewingId),
    getActiveId: () => activeId,
    setActiveId(id) {
      activeId = id
      if (id) activeShowcaseId = undefined
      if (!drawer.hidden) {
        if (currentTab === 'mine') refreshCapture(false)
        renderGrid()
      }
    },
    setActiveShowcaseId(id) {
      activeShowcaseId = id
      if (id) activeId = undefined
      if (!drawer.hidden) renderGrid()
    },
    refreshCapture: (syncName = false) => { if (!drawer.hidden && !previewSnapshot && currentTab === 'mine') refreshCapture(syncName) },
    dispose() {
      endHoverPreview(false)
      unsub()
      window.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('pl-open')
      drawer.remove()
    },
  }

  return controller
}
