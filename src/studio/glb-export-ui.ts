// Shared GLB Export Options popover for Classic Studio (broadleaf.html) and AI Mode (ai.html).
// Exposes the 3 requested options with live mesh/material/triangle preview:
// 1. 整体合并导出（单网格、材质分明：树干/树叶/花朵/其他）
// 2. 不合并（保留独立部件与子网格）
// 3. 去除装饰类网格体（草、石头、粒子/落瓣等）
import type { Object3D } from 'three'
import { inspectGlbExport, type ExportGlbOptions } from '../export-glb'

export interface GlbExportHost {
  triggerButton: HTMLButtonElement
  getRoot(): Object3D | undefined
  exportBlob(options: ExportGlbOptions): Promise<Blob>
  getFilename(options: ExportGlbOptions): string
  saveBlob(blob: Blob, filename: string): void
  message(text: unknown, error?: boolean): void
  emptyMessage?: string
}

const fmt = new Intl.NumberFormat('zh-CN')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function bindGlbExportPopover(host: GlbExportHost) {
  const pop = document.createElement('div')
  pop.className = 'glb-popover'
  pop.id = 'glb-export-popover'
  pop.setAttribute('role', 'dialog')
  pop.setAttribute('aria-label', '导出 GLB 选项')
  pop.hidden = true
  pop.innerHTML = `
    <div class="glb-pop-head">
      <b>导出 GLB 设置</b>
      <button type="button" class="glb-pop-close" id="glb-pop-close" title="关闭">✕</button>
    </div>
    <div class="glb-pop-opts">
      <label class="glb-opt-row">
        <input type="checkbox" id="glb-opt-merged" checked>
        <div>
          <b>1. 整体合并导出（材质分明）</b>
          <span>合为单个网格，保留独立命名材质槽：树干、树叶、花朵、草或其他网格体</span>
        </div>
      </label>
      <label class="glb-opt-row">
        <input type="checkbox" id="glb-opt-separate">
        <div>
          <b>2. 不合并</b>
          <span>保留原始多部件与各子网格体独立层级结构</span>
        </div>
      </label>
      <label class="glb-opt-row is-sep">
        <input type="checkbox" id="glb-opt-no-decor">
        <div>
          <b>3. 去除装饰类网格体</b>
          <span>剔除根部草丛、石头、飘落花瓣 / 粒子等非主体装饰网格</span>
        </div>
      </label>
    </div>
    <div class="glb-pop-preview" id="glb-opt-summary"></div>
    <div class="glb-pop-foot">
      <button type="button" id="glb-pop-cancel">取消</button>
      <button type="button" class="primary" id="glb-opt-confirm">确认导出 GLB</button>
    </div>`
  document.body.append(pop)

  const mergedCb = pop.querySelector<HTMLInputElement>('#glb-opt-merged')!
  const separateCb = pop.querySelector<HTMLInputElement>('#glb-opt-separate')!
  const noDecorCb = pop.querySelector<HTMLInputElement>('#glb-opt-no-decor')!
  const summaryEl = pop.querySelector<HTMLElement>('#glb-opt-summary')!
  const confirmBtn = pop.querySelector<HTMLButtonElement>('#glb-opt-confirm')!

  const getOptions = (): ExportGlbOptions => ({
    mode: separateCb.checked ? 'separate' : 'merged',
    excludeDecorations: noDecorCb.checked,
  })

  const refreshSummary = () => {
    const root = host.getRoot()
    if (!root) {
      summaryEl.innerHTML = `<span class="glb-warn">${esc(host.emptyMessage || '当前画布为空，请先生成植物')}</span>`
      confirmBtn.disabled = true
      return
    }
    const opts = getOptions()
    const info = inspectGlbExport(root, opts)
    confirmBtn.disabled = info.meshCount === 0
    const modeLabel = opts.mode === 'merged' ? '1 个合并网格（多材质槽）' : `${info.meshCount} 个独立网格`
    const decorNote = info.excludedDecorations > 0
      ? `<span class="glb-decor-tag">已去除 ${info.excludedDecorations} 个装饰网格</span>`
      : ''
    const chips = info.materials.map(m => `<i>${esc(m)}</i>`).join('')
    summaryEl.innerHTML = `
      <div class="glb-sum-top"><span>${modeLabel} · ${fmt.format(info.triangles)} 面</span>${decorNote}</div>
      <div class="glb-mat-chips">${chips || '<i>无材质</i>'}</div>`
  }

  // Keep options 1 & 2 mutually exclusive while displaying both requested checkboxes clearly
  mergedCb.onchange = () => {
    if (mergedCb.checked) separateCb.checked = false
    else separateCb.checked = true
    refreshSummary()
  }
  separateCb.onchange = () => {
    if (separateCb.checked) mergedCb.checked = false
    else mergedCb.checked = true
    refreshSummary()
  }
  noDecorCb.onchange = () => refreshSummary()

  const positionPopover = () => {
    const r = host.triggerButton.getBoundingClientRect()
    const pw = 344
    const left = Math.max(10, Math.min(window.innerWidth - pw - 10, r.right - pw))
    pop.style.top = `${Math.round(r.bottom + 8)}px`
    pop.style.left = `${Math.round(left)}px`
  }

  const close = () => { pop.hidden = true }
  const open = () => {
    if (!host.getRoot()) {
      host.message(host.emptyMessage || '当前为空白工程，请先上传图片或添加部件', true)
      return
    }
    refreshSummary()
    pop.hidden = false
    positionPopover()
  }

  host.triggerButton.onclick = e => {
    e.stopPropagation()
    if (pop.hidden) open()
    else close()
  }
  pop.querySelector<HTMLButtonElement>('#glb-pop-close')!.onclick = close
  pop.querySelector<HTMLButtonElement>('#glb-pop-cancel')!.onclick = close

  confirmBtn.onclick = async () => {
    const root = host.getRoot()
    if (!root) return
    const opts = getOptions()
    const info = inspectGlbExport(root, opts)
    confirmBtn.disabled = true
    host.triggerButton.disabled = true
    try {
      const blob = await host.exportBlob(opts)
      const filename = host.getFilename(opts)
      host.saveBlob(blob, filename)
      const modeTxt = opts.mode === 'merged' ? `整体合并（${info.materials.length} 材质槽）` : `独立分体（${info.meshCount} 网格）`
      const decorTxt = info.excludedDecorations > 0 ? `，已去除 ${info.excludedDecorations} 个装饰网格` : ''
      host.message(`已导出 ${filename} · ${modeTxt}${decorTxt}`)
      close()
    } catch (error) {
      host.message(error, true)
    } finally {
      confirmBtn.disabled = false
      host.triggerButton.disabled = false
    }
  }

  const onDocClick = (e: MouseEvent) => {
    if (pop.hidden) return
    const t = e.target as Node
    if (!pop.contains(t) && t !== host.triggerButton && !host.triggerButton.contains(t)) close()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !pop.hidden) close()
  }
  window.addEventListener('pointerdown', onDocClick)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', () => { if (!pop.hidden) positionPopover() })

  return { open, close, getOptions, refreshSummary }
}
