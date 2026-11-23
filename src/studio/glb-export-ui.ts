// Shared GLB Export Options popover for Classic Studio (broadleaf.html) and AI Mode (ai.html).
// Exposes the 3 requested options with live mesh/material/triangle preview:
// 1. 整体合并导出（单网格、材质分明：树干/树叶/花朵/其他）
// 2. 不合并（保留独立部件与子网格）
// 3. 去除装饰类网格体（草、石头、粒子/落瓣等）
import type { Object3D } from 'three'
import {
  extractStandaloneBarkBakePngs, inspectGlbExport,
  type BakeResolution, type ExportGlbOptions,
} from '../export-glb'
import type { NormalMapConvention } from '../tree/wood-weld'
import { activityLog } from './activity-log'

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
      <label class="glb-opt-row">
        <input type="checkbox" id="glb-opt-bake-moss" checked>
        <div>
          <b>4. 烘焙 3D 朝上青苔与根部阴影</b>
          <span>将 3D 世界空间朝上青苔与盘根接地阴影写入木质顶点色，外部引擎无须自定义 Shader 即可还原</span>
        </div>
      </label>
      <div class="glb-opt-row">
        <input type="checkbox" id="glb-opt-bake-normal" checked>
        <div>
          <label for="glb-opt-bake-normal"><b>5. 烘焙高模树干法线与 AO 贴图</b></label>
          <span>将雕刻主脊与木纹烘焙为切线法线与沟壑 AO 贴图，低面数游戏 LOD 也能还原高模立体感</span>
          <div class="glb-bake-sub">
            <select id="glb-opt-bake-size" title="法线与 AO 烘焙分辨率">
              <option value="512" selected>512²</option>
              <option value="1024">1024²</option>
              <option value="2048">2048²</option>
            </select>
            <select id="glb-opt-bake-conv" title="法线贴图绿通道约定（glTF 2.0 / Blender / Unity 推荐 OpenGL +Y；DirectX -Y 供 Unreal / 3dsMax）">
              <option value="opengl" selected>OpenGL (+Y)</option>
              <option value="directx">DirectX (-Y · UE)</option>
            </select>
            <button type="button" id="glb-opt-bake-download" title="单独导出切线法线 PNG 与沟壑 AO PNG">↓ 法线+AO PNG</button>
          </div>
        </div>
      </div>
      <label class="glb-opt-row">
        <input type="checkbox" id="glb-opt-wind-uv">
        <div>
          <b>6. 导出引擎风动权重 (UV1 / TEXCOORD_1)</b>
          <span>写入 Unity / UE 可直接读取的标准 UV1 通道（X = 高度摇曳权重，Y = 叶缘 / 枝梢颤动权重）</span>
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
  const bakeMossCb = pop.querySelector<HTMLInputElement>('#glb-opt-bake-moss')!
  const bakeNormalCb = pop.querySelector<HTMLInputElement>('#glb-opt-bake-normal')!
  const bakeSizeSel = pop.querySelector<HTMLSelectElement>('#glb-opt-bake-size')!
  const bakeConvSel = pop.querySelector<HTMLSelectElement>('#glb-opt-bake-conv')!
  const bakeDlBtn = pop.querySelector<HTMLButtonElement>('#glb-opt-bake-download')!
  const windUvCb = pop.querySelector<HTMLInputElement>('#glb-opt-wind-uv')!
  const summaryEl = pop.querySelector<HTMLElement>('#glb-opt-summary')!
  const confirmBtn = pop.querySelector<HTMLButtonElement>('#glb-opt-confirm')!

  const getOptions = (): ExportGlbOptions => ({
    mode: separateCb.checked ? 'separate' : 'merged',
    excludeDecorations: noDecorCb.checked,
    bakeBarkMoss: bakeMossCb.checked,
    bakeBarkNormal: bakeNormalCb.checked,
    bakeBarkNormalSize: (Number(bakeSizeSel.value) as BakeResolution) || 512,
    bakeBarkNormalConvention: (bakeConvSel.value === 'directx' ? 'directx' : 'opengl') as NormalMapConvention,
    exportWindUv: windUvCb.checked,
  })

  const refreshSummary = () => {
    const root = host.getRoot()
    if (!root) {
      summaryEl.innerHTML = `<span class="glb-warn">${esc(host.emptyMessage || '当前画布为空，请先生成植物')}</span>`
      confirmBtn.disabled = true
      bakeDlBtn.disabled = true
      return
    }
    const opts = getOptions()
    const info = inspectGlbExport(root, opts)
    const anySculpt = inspectGlbExport(root, { ...opts, bakeBarkNormal: true }).normalBakedMeshes > 0
    bakeSizeSel.disabled = !anySculpt
    bakeConvSel.disabled = !anySculpt
    bakeDlBtn.disabled = !anySculpt
    confirmBtn.disabled = info.meshCount === 0
    const modeLabel = opts.mode === 'merged' ? '1 个合并网格（多材质槽）' : `${info.meshCount} 个独立网格`
    const decorNote = info.excludedDecorations > 0
      ? `<span class="glb-decor-tag">已去除 ${info.excludedDecorations} 个装饰网格</span>`
      : ''
    const mossNote = info.mossBakedMeshes > 0
      ? `<span class="glb-decor-tag">已烘焙 ${info.mossBakedMeshes} 处木质青苔</span>`
      : ''
    const convLabel = opts.bakeBarkNormalConvention === 'directx' ? 'DX' : 'GL'
    const normalNote = info.normalBakedMeshes > 0
      ? `<span class="glb-decor-tag">已烘焙 ${info.normalBakedMeshes} 处树干法线+AO (${opts.bakeBarkNormalSize}² ${convLabel})</span>`
      : ''
    const windNote = info.windUvMeshes > 0
      ? `<span class="glb-decor-tag">UV1 风动权重 (${info.windUvMeshes} 网格)</span>`
      : ''
    const chips = info.materials.map(m => `<i>${esc(m)}</i>`).join('')
    summaryEl.innerHTML = `
      <div class="glb-sum-top"><span>${modeLabel} · ${fmt.format(info.triangles)} 面</span>${decorNote}${mossNote}${normalNote}${windNote}</div>
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
  bakeMossCb.onchange = () => refreshSummary()
  bakeNormalCb.onchange = () => refreshSummary()
  bakeSizeSel.onchange = () => refreshSummary()
  bakeConvSel.onchange = () => refreshSummary()
  windUvCb.onchange = () => refreshSummary()

  const triggerDataUrlDownload = (dataUrl: string, filename: string) => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    a.click()
  }

  bakeDlBtn.onclick = () => {
    const root = host.getRoot()
    if (!root) return
    const opts = getOptions()
    bakeDlBtn.disabled = true
    try {
      const items = extractStandaloneBarkBakePngs(root, {
        size: opts.bakeBarkNormalSize,
        normalConvention: opts.bakeBarkNormalConvention,
      })
      if (!items.length) {
        host.message('当前模型未启用树干雕刻，无需烘焙独立法线贴图', true)
        return
      }
      const convTag = opts.bakeBarkNormalConvention === 'directx' ? 'dx' : 'gl'
      const downloads: [string, string][] = []
      for (const item of items) {
        downloads.push([item.normalDataUrl, `${item.name}_normal_${item.width}_${convTag}.png`])
        downloads.push([item.aoDataUrl, `${item.name}_ao_${item.width}.png`])
      }
      // Stagger multi-file browser downloads so Chromium never throttles rapid synchronous clicks
      downloads.forEach(([url, fname], idx) => {
        if (idx === 0) triggerDataUrlDownload(url, fname)
        else setTimeout(() => triggerDataUrlDownload(url, fname), idx * 120)
      })
      activityLog.exportStep(`单独导出树干法线+AO贴图（${downloads.length} 张 PNG）`, {
        size: opts.bakeBarkNormalSize,
        convention: opts.bakeBarkNormalConvention,
        files: downloads.map(([, f]) => f),
      })
      host.message(`已独立导出 ${items.length * 2} 张烘焙贴图（Normal ${opts.bakeBarkNormalSize}² ${convTag.toUpperCase()} + Cavity AO PNG）`)
    } catch (error) {
      activityLog.exportStep(`独立烘焙贴图导出失败：${error instanceof Error ? error.message : String(error)}`, error, 'error')
      host.message(error, true)
    } finally {
      refreshSummary()
    }
  }

  const positionPopover = () => {
    const r = host.triggerButton.getBoundingClientRect()
    const pw = 368
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
      activityLog.exportStep(`触发浏览器下载 ${filename}（${(blob.size / 1024).toFixed(1)} KB）`, {
        filename,
        bytes: blob.size,
        mimeType: blob.type,
        materials: info.materials,
        triangles: info.triangles,
      })
      host.saveBlob(blob, filename)
      const modeTxt = opts.mode === 'merged' ? `整体合并（${info.materials.length} 材质槽）` : `独立分体（${info.meshCount} 网格）`
      const decorTxt = info.excludedDecorations > 0 ? `，已去除 ${info.excludedDecorations} 个装饰网格` : ''
      const convTag = opts.bakeBarkNormalConvention === 'directx' ? 'DX' : 'GL'
      const normalTxt = info.normalBakedMeshes > 0 ? `，已烘焙 ${info.normalBakedMeshes} 处高模法线+AO(${opts.bakeBarkNormalSize}² ${convTag})` : ''
      const windTxt = info.windUvMeshes > 0 ? '，含 UV1 风动权重' : ''
      host.message(`已导出 ${filename} · ${modeTxt}${decorTxt}${normalTxt}${windTxt}`)
      close()
    } catch (error) {
      activityLog.exportStep(`确认导出 GLB 过程异常：${error instanceof Error ? error.message : String(error)}`, error, 'error')
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
