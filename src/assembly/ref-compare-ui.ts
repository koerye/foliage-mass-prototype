// Interactive Viewport Reference Image Comparator for Scene Assembly Studio.
// Supports user upload (file picker, drag-and-drop, Ctrl+V paste) AND direct Agent injection
// via AssemblySceneSpec.reference, URL `?ref=`, or `window.__sceneStudio.setReferenceImage(...)`.
// Provides 4 live comparison modes over the 3D viewport: PiP, Split Wipe, Onion-Skin Overlay, and Side-by-Side.
import type { AssemblyReferenceSpec, RefCompareMode } from './spec'

export interface RefCompareController {
  /** Syncs UI state from `sceneSpec.reference` (called on load / undo / case switch / Agent injection). */
  sync(ref: AssemblyReferenceSpec | undefined): void
  /** Opens/toggles the comparator control panel (auto-activating `wipe` if an image is already loaded and mode is `off`). */
  togglePanel(): void
  /** Sets a reference image programmatically (Agent auto-injection or user upload). */
  setImage(src: string, name?: string, opts?: Partial<Omit<AssemblyReferenceSpec, 'src' | 'name'>>): AssemblyReferenceSpec
  /** Switches comparison mode directly. */
  setMode(mode: RefCompareMode): void
  /** Clears the active reference image. */
  clear(): void
  /** Returns current reference spec (if loaded). */
  getCurrent(): AssemblyReferenceSpec | undefined
  /** Triggers file picker dialog for user upload. */
  openUploadPicker(): void
  dispose(): void
}

export interface RefCompareOptions {
  stageEl: HTMLElement
  onChange: (next: AssemblyReferenceSpec | undefined) => void
  onRequestResize: () => void
  onRequestIou?: (imgSrc: string) => void
  onNotify?: (msg: string) => void
}

const MODE_LABELS: { mode: RefCompareMode; label: string; title: string }[] = [
  { mode: 'off', label: '隐藏', title: '隐藏参考图叠加' },
  { mode: 'pip', label: '浮窗', title: '右下角浮窗对照' },
  { mode: 'wipe', label: '卷帘', title: '左右拖拽卷帘 1:1 对比 3D 视口' },
  { mode: 'overlay', label: '叠图', title: '半透明叠图（可穿透操作 3D 视口与刷草）' },
  { mode: 'split', label: '并排', title: '左右分屏 50/50 并排对比' },
]

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('无法读取参考图文件'))
    }
    reader.onerror = () => reject(new Error('读取参考图失败'))
    reader.readAsDataURL(file)
  })
}

export function createRefCompareController(opts: RefCompareOptions): RefCompareController {
  const { stageEl } = opts
  let current: AssemblyReferenceSpec | undefined
  let panelOpen = false

  // 1. Split-screen left pane (shown only in `split` mode)
  const splitPane = document.createElement('div')
  splitPane.className = 'as-ref-split-pane'
  splitPane.id = 'as-ref-split-pane'
  splitPane.hidden = true
  splitPane.innerHTML = `
    <span class="as-ref-badge">参考图</span>
    <img id="as-ref-split-img" alt="参考图并排对比">
  `
  stageEl.insertBefore(splitPane, stageEl.firstChild)

  // 2. Viewport overlay / wipe / PiP layer
  const overlayLayer = document.createElement('div')
  overlayLayer.className = 'as-ref-layer'
  overlayLayer.id = 'as-ref-layer'
  overlayLayer.hidden = true
  overlayLayer.innerHTML = `
    <div class="as-ref-clip" id="as-ref-clip">
      <img id="as-ref-img" alt="参考图对比">
    </div>
    <div class="as-ref-wipe-line" id="as-ref-wipe-line" hidden>
      <div class="as-ref-wipe-handle" id="as-ref-wipe-handle" title="左右拖动卷帘对比">◀▶</div>
      <span class="as-ref-wipe-tag is-left">参考图</span>
      <span class="as-ref-wipe-tag is-right">3D 视口</span>
    </div>
    <div class="as-ref-pip-head" id="as-ref-pip-head" hidden>
      <span id="as-ref-pip-title">参考图</span>
      <button type="button" id="as-ref-pip-expand" title="切换卷帘对比">卷帘</button>
      <button type="button" id="as-ref-pip-close" title="隐藏参考图">✕</button>
    </div>
  `
  stageEl.appendChild(overlayLayer)

  // 3. Floating Comparator Control Bar (top-right inside `.as-stage`)
  const bar = document.createElement('div')
  bar.className = 'as-ref-bar'
  bar.id = 'as-ref-bar'
  bar.hidden = true
  bar.innerHTML = `
    <div class="as-ref-bar-head">
      <strong id="as-ref-name">🖼 参考图对比</strong>
      <div class="as-ref-bar-acts">
        <button type="button" id="as-ref-upload-btn" title="上传本地 PNG/JPG/WebP（也支持拖放或 Ctrl+V 粘贴）">上传</button>
        <button type="button" id="as-ref-iou-btn" title="计算当前 3D 构图与参考图轮廓重合度 (IoU)">IoU</button>
        <button type="button" id="as-ref-clear-btn" class="is-danger" title="移除参考图">清除</button>
        <button type="button" id="as-ref-close-bar" title="收起控制条">✕</button>
      </div>
    </div>
    <div class="as-ref-modes" id="as-ref-modes">
      ${MODE_LABELS.map(m => `<button type="button" data-ref-mode="${m.mode}" title="${m.title}">${m.label}</button>`).join('')}
    </div>
    <div class="as-ref-tune" id="as-ref-tune">
      <label class="as-ref-slider">
        <span>透明</span>
        <input id="as-ref-opacity" type="range" min="0.08" max="1" step="0.02" value="0.55">
        <output id="as-ref-opacity-v">55%</output>
      </label>
      <label class="as-ref-slider">
        <span>缩放</span>
        <input id="as-ref-scale" type="range" min="0.5" max="2.0" step="0.02" value="1">
        <output id="as-ref-scale-v">100%</output>
      </label>
      <div class="as-ref-offsets">
        <label><span>X</span><input id="as-ref-offx" type="range" min="-40" max="40" step="1" value="0"></label>
        <label><span>Y</span><input id="as-ref-offy" type="range" min="-40" max="40" step="1" value="0"></label>
        <button type="button" id="as-ref-reset-align" title="重置缩放与偏移">重置</button>
      </div>
    </div>
    <div class="as-ref-empty-hint" id="as-ref-empty-hint" hidden>
      点击「上传」、拖放图片到画布，或直接 <code>Ctrl+V</code> 粘贴参考图。<br>
      <small>提示：若直接发给 Agent 参考图，Agent 会自动写入此处。</small>
    </div>
    <input id="as-ref-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
  `
  stageEl.appendChild(bar)

  const splitImg = splitPane.querySelector<HTMLImageElement>('#as-ref-split-img')!
  const overlayImg = overlayLayer.querySelector<HTMLImageElement>('#as-ref-img')!
  const clipEl = overlayLayer.querySelector<HTMLDivElement>('#as-ref-clip')!
  const wipeLine = overlayLayer.querySelector<HTMLDivElement>('#as-ref-wipe-line')!
  const wipeHandle = overlayLayer.querySelector<HTMLDivElement>('#as-ref-wipe-handle')!
  const pipHead = overlayLayer.querySelector<HTMLDivElement>('#as-ref-pip-head')!
  const pipTitle = overlayLayer.querySelector<HTMLSpanElement>('#as-ref-pip-title')!
  const nameEl = bar.querySelector<HTMLElement>('#as-ref-name')!
  const tuneEl = bar.querySelector<HTMLDivElement>('#as-ref-tune')!
  const emptyHintEl = bar.querySelector<HTMLDivElement>('#as-ref-empty-hint')!
  const fileInput = bar.querySelector<HTMLInputElement>('#as-ref-file-input')!
  const opInput = bar.querySelector<HTMLInputElement>('#as-ref-opacity')!
  const opOut = bar.querySelector<HTMLOutputElement>('#as-ref-opacity-v')!
  const scInput = bar.querySelector<HTMLInputElement>('#as-ref-scale')!
  const scOut = bar.querySelector<HTMLOutputElement>('#as-ref-scale-v')!
  const offXInput = bar.querySelector<HTMLInputElement>('#as-ref-offx')!
  const offYInput = bar.querySelector<HTMLInputElement>('#as-ref-offy')!
  const iouBtn = bar.querySelector<HTMLButtonElement>('#as-ref-iou-btn')!
  const clearBtn = bar.querySelector<HTMLButtonElement>('#as-ref-clear-btn')!

  let wasSplit = false

  function applyVisualState() {
    const hasRef = Boolean(current?.src)
    const mode: RefCompareMode = hasRef ? (current!.mode ?? 'wipe') : 'off'
    const opacity = clamp(current?.opacity ?? 0.55, 0.05, 1)
    const split = clamp(current?.split ?? 0.5, 0.02, 0.98)
    const scale = clamp(current?.scale ?? 1, 0.4, 2.5)
    const offX = clamp(current?.offsetX ?? 0, -60, 60)
    const offY = clamp(current?.offsetY ?? 0, -60, 60)

    bar.hidden = !panelOpen
    nameEl.textContent = hasRef ? `🖼 ${current!.name || '参考图'}` : '🖼 参考图对比'
    emptyHintEl.hidden = hasRef
    tuneEl.hidden = !hasRef || mode === 'off'
    iouBtn.disabled = !hasRef
    clearBtn.disabled = !hasRef

    bar.querySelectorAll<HTMLButtonElement>('[data-ref-mode]').forEach(btn => {
      const m = btn.dataset.refMode as RefCompareMode
      btn.disabled = !hasRef && m !== 'off'
      btn.setAttribute('aria-pressed', String(m === mode))
    })

    opInput.value = String(opacity)
    opOut.textContent = `${Math.round(opacity * 100)}%`
    scInput.value = String(scale)
    scOut.textContent = `${Math.round(scale * 100)}%`
    offXInput.value = String(offX)
    offYInput.value = String(offY)

    const imgTransform = `translate(${offX}%, ${offY}%) scale(${scale})`
    if (hasRef) {
      if (overlayImg.getAttribute('src') !== current!.src) overlayImg.src = current!.src
      if (splitImg.getAttribute('src') !== current!.src) splitImg.src = current!.src
      overlayImg.style.transform = imgTransform
      splitImg.style.transform = imgTransform
      pipTitle.textContent = current!.name || '参考图'
    } else {
      overlayImg.removeAttribute('src')
      splitImg.removeAttribute('src')
    }

    const isSplit = hasRef && mode === 'split'
    stageEl.classList.toggle('is-ref-split', isSplit)
    splitPane.hidden = !isSplit

    overlayLayer.classList.remove('is-mode-pip', 'is-mode-wipe', 'is-mode-overlay')
    if (!hasRef || mode === 'off' || mode === 'split') {
      overlayLayer.hidden = true
      wipeLine.hidden = true
      pipHead.hidden = true
    } else {
      overlayLayer.hidden = false
      overlayLayer.classList.add(`is-mode-${mode}`)
      wipeLine.hidden = mode !== 'wipe'
      pipHead.hidden = mode !== 'pip'
      if (mode === 'wipe') {
        const pct = `${(split * 100).toFixed(2)}%`
        clipEl.style.clipPath = `inset(0 calc(100% - ${pct}) 0 0)`
        clipEl.style.opacity = '1'
        wipeLine.style.left = pct
      } else if (mode === 'overlay') {
        clipEl.style.clipPath = 'none'
        clipEl.style.opacity = String(opacity)
      } else {
        // pip
        clipEl.style.clipPath = 'none'
        clipEl.style.opacity = String(Math.max(0.35, opacity))
      }
    }

    if (isSplit !== wasSplit) {
      wasSplit = isSplit
      requestAnimationFrame(() => opts.onRequestResize())
    }
  }

  function emitChange() {
    applyVisualState()
    opts.onChange(current ? { ...current } : undefined)
  }

  // ---- Wipe Divider Dragging ----
  let draggingWipe = false
  const updateWipeFromClientX = (clientX: number) => {
    if (!current) return
    const rect = stageEl.getBoundingClientRect()
    if (rect.width <= 0) return
    current.split = Number(clamp((clientX - rect.left) / rect.width, 0.03, 0.97).toFixed(3))
    applyVisualState()
  }
  const onWipeDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    draggingWipe = true
    wipeHandle.setPointerCapture?.(e.pointerId)
    updateWipeFromClientX(e.clientX)
  }
  const onWipeMove = (e: PointerEvent) => {
    if (!draggingWipe) return
    e.preventDefault()
    updateWipeFromClientX(e.clientX)
  }
  const onWipeUp = (e: PointerEvent) => {
    if (!draggingWipe) return
    draggingWipe = false
    wipeHandle.releasePointerCapture?.(e.pointerId)
    emitChange()
  }
  wipeLine.addEventListener('pointerdown', onWipeDown)
  window.addEventListener('pointermove', onWipeMove)
  window.addEventListener('pointerup', onWipeUp)

  // ---- Bar Controls ----
  bar.querySelector('#as-ref-upload-btn')!.addEventListener('click', () => fileInput.click())
  bar.querySelector('#as-ref-close-bar')!.addEventListener('click', () => {
    panelOpen = false
    applyVisualState()
  })
  clearBtn.addEventListener('click', () => controller.clear())
  iouBtn.addEventListener('click', () => {
    if (current?.src && opts.onRequestIou) opts.onRequestIou(current.src)
  })
  bar.querySelector('#as-ref-reset-align')!.addEventListener('click', () => {
    if (!current) return
    current.scale = 1
    current.offsetX = 0
    current.offsetY = 0
    current.split = 0.5
    emitChange()
  })
  overlayLayer.querySelector('#as-ref-pip-expand')!.addEventListener('click', () => controller.setMode('wipe'))
  overlayLayer.querySelector('#as-ref-pip-close')!.addEventListener('click', () => controller.setMode('off'))

  bar.querySelectorAll<HTMLButtonElement>('[data-ref-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      controller.setMode(btn.dataset.refMode as RefCompareMode)
    })
  })

  opInput.addEventListener('input', () => {
    if (!current) return
    current.opacity = Number(opInput.value)
    if (current.mode === 'wipe') current.mode = 'overlay'
    emitChange()
  })
  scInput.addEventListener('input', () => {
    if (!current) return
    current.scale = Number(scInput.value)
    emitChange()
  })
  offXInput.addEventListener('input', () => {
    if (!current) return
    current.offsetX = Number(offXInput.value)
    emitChange()
  })
  offYInput.addEventListener('input', () => {
    if (!current) return
    current.offsetY = Number(offYInput.value)
    emitChange()
  })

  async function ingestImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      opts.onNotify?.('请上传 PNG / JPG / WebP 格式的参考图')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      controller.setImage(dataUrl, file.name, { mode: current?.mode && current.mode !== 'off' ? current.mode : 'wipe' })
      opts.onNotify?.(`已加载参考图「${file.name}」，可切换卷帘/叠图/并排对比`)
    } catch (err) {
      opts.onNotify?.(err instanceof Error ? err.message : '参考图加载失败')
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (file) await ingestImageFile(file)
  })

  // Drag-and-drop image directly onto the 3D stage
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    stageEl.classList.add('is-ref-drop')
  }
  const onDragLeave = () => stageEl.classList.remove('is-ref-drop')
  const onDrop = async (e: DragEvent) => {
    stageEl.classList.remove('is-ref-drop')
    const file = Array.from(e.dataTransfer?.files ?? []).find(f => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    await ingestImageFile(file)
  }
  stageEl.addEventListener('dragover', onDragOver)
  stageEl.addEventListener('dragleave', onDragLeave)
  stageEl.addEventListener('drop', onDrop)

  // Clipboard paste (`Ctrl+V` image)
  const onPaste = async (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          await ingestImageFile(file)
          return
        }
      }
    }
  }
  window.addEventListener('paste', onPaste)

  const controller: RefCompareController = {
    sync(ref) {
      current = ref ? { ...ref } : undefined
      panelOpen = Boolean(current && current.mode && current.mode !== 'off')
      applyVisualState()
    },
    togglePanel() {
      if (!panelOpen) {
        panelOpen = true
        if (current && (!current.mode || current.mode === 'off')) {
          current.mode = 'wipe'
          emitChange()
          return
        }
      } else {
        panelOpen = false
        if (current && current.mode !== 'off') {
          current.mode = 'off'
          emitChange()
          return
        }
      }
      applyVisualState()
    },
    setImage(src, name, overrides) {
      const next: AssemblyReferenceSpec = {
        src,
        name: name?.trim() || current?.name || '参考图',
        mode: overrides?.mode ?? (current?.mode && current.mode !== 'off' ? current.mode : 'wipe'),
        opacity: overrides?.opacity ?? current?.opacity ?? 0.55,
        split: overrides?.split ?? current?.split ?? 0.5,
        scale: overrides?.scale ?? 1,
        offsetX: overrides?.offsetX ?? 0,
        offsetY: overrides?.offsetY ?? 0,
      }
      current = next
      panelOpen = next.mode !== 'off'
      emitChange()
      return { ...next }
    },
    setMode(mode) {
      if (!current) {
        if (mode === 'off') {
          panelOpen = false
          applyVisualState()
        }
        return
      }
      current.mode = mode
      panelOpen = mode !== 'off'
      emitChange()
    },
    clear() {
      current = undefined
      applyVisualState()
      opts.onChange(undefined)
      opts.onNotify?.('已清除参考图')
    },
    getCurrent() {
      return current ? { ...current } : undefined
    },
    openUploadPicker() {
      fileInput.click()
    },
    dispose() {
      wipeLine.removeEventListener('pointerdown', onWipeDown)
      window.removeEventListener('pointermove', onWipeMove)
      window.removeEventListener('pointerup', onWipeUp)
      stageEl.removeEventListener('dragover', onDragOver)
      stageEl.removeEventListener('dragleave', onDragLeave)
      stageEl.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
      splitPane.remove()
      overlayLayer.remove()
      bar.remove()
      stageEl.classList.remove('is-ref-split', 'is-ref-drop')
    },
  }

  applyVisualState()
  return controller
}
