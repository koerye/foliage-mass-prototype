// Shared 3D Export Options popover for Classic Tree Studio, AI Mode, Scene Assembly, and Rock Studio.
// Supports:
// - 3 Output formats: GLB (single embedded file) / glTF + TEX (split model + PNGs) / FBX + TEX (FBX 7.4 Binary + PNGs)
// - Auto-baking default procedural bark (BaseColor + Normal PNG) & sculpted bark (Normal + AO PNG)
// - Auto-baking modeled 3D grass blades into lightweight 64x256 gradient PNG + clear COLOR_0 guidance
// - Merged vs Separate hierarchy, decoration stripping, bark moss vertex bake, and Wind UV1
import type { Object3D } from 'three'
import { zipSync } from 'three/addons/libs/fflate.module.js'
import {
  exportFbxBundle, exportSplitGltfBundle, extractStandaloneBarkBakePngsAsync, inspectGlbExport,
  type BakeResolution, type ExportFileFormat, type ExportGlbOptions,
} from '../export-glb'
import type { NormalMapConvention } from '../tree/wood-weld'
import { activityLog } from './activity-log'
import { getDesktopApi, tryDesktopSaveBundle } from './desktop-bridge'

export interface GlbExportHost {
  triggerButton: HTMLButtonElement
  getRoot(): Object3D | undefined
  exportBlob(options: ExportGlbOptions): Promise<Blob>
  /** Optional multi-LOD builder for one-click LOD0..LOD3 ZIP packaging. */
  exportLodGlb?: (lodLevel: 0 | 1 | 2 | 3, options: ExportGlbOptions) => Promise<Blob>
  getFilename(options: ExportGlbOptions): string
  saveBlob(blob: Blob, filename: string): void
  message(text: unknown, error?: boolean): void
  emptyMessage?: string
  /** Optional hook run right before inspecting / exporting (e.g. flushing lazy vertex colors). */
  onBeforeExport?: () => void
}

const fmt = new Intl.NumberFormat('zh-CN')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const formatNotes: Record<ExportFileFormat, string> = {
  glb: '单文件二进制 .glb（贴图全部内嵌，适合快速预览与通用传输）',
  'gltf-split': '拆分导出 .gltf + .bin + textures/*.png（独立可编辑 PNG 贴图目录）',
  fbx: '标准 FBX 7.4 Binary (.fbx) + textures/*.png（原生兼容 Blender / UE / Unity / Maya）',
}

export function bindGlbExportPopover(host: GlbExportHost) {
  let exportFormat: ExportFileFormat = 'glb'

  const pop = document.createElement('div')
  pop.className = 'glb-popover'
  pop.id = 'glb-export-popover'
  pop.setAttribute('role', 'dialog')
  pop.setAttribute('aria-label', '导出模型与贴图设置')
  pop.hidden = true
  pop.innerHTML = `
    <div class="glb-pop-head">
      <b>导出模型与贴图设置</b>
      <button type="button" class="glb-pop-close" id="glb-pop-close" title="关闭">✕</button>
    </div>
    <div class="glb-fmt-tabs" role="tablist" aria-label="导出格式">
      <button type="button" data-exp-fmt="glb" aria-pressed="true">GLB 单文件</button>
      <button type="button" data-exp-fmt="gltf-split" aria-pressed="false">glTF + 贴图</button>
      <button type="button" data-exp-fmt="fbx" aria-pressed="false">FBX + TEX</button>
    </div>
    <div class="glb-fmt-note" id="glb-fmt-note">${esc(formatNotes.glb)}</div>
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
      <div class="glb-opt-row" id="glb-opt-bake-normal-row">
        <input type="checkbox" id="glb-opt-bake-normal" checked>
        <div>
          <label for="glb-opt-bake-normal"><b>5. 自动烘焙树皮纹理与法线贴图</b></label>
          <span id="glb-opt-bake-normal-desc">默认程序树皮自动烘焙无缝 BaseColor + Normal PNG；开启雕刻的树干同步烘焙高模法线与 AO</span>
          <div class="glb-bake-sub">
            <select id="glb-opt-bake-size" title="树皮 BaseColor / 法线 / AO 烘焙分辨率">
              <option value="512" selected>512²</option>
              <option value="1024">1024²</option>
              <option value="2048">2048²</option>
            </select>
            <select id="glb-opt-bake-conv" title="法线贴图绿通道约定（glTF 2.0 / Blender / Unity 推荐 OpenGL +Y；DirectX -Y 供 Unreal / 3dsMax）">
              <option value="opengl" selected>OpenGL (+Y)</option>
              <option value="directx">DirectX (-Y · UE)</option>
            </select>
            <button type="button" id="glb-opt-bake-download" title="单独导出烘焙的树皮 BaseColor / 法线 / AO PNG">↓ 树皮贴图 PNG</button>
          </div>
        </div>
      </div>
      <label class="glb-opt-row" id="glb-opt-grass-row">
        <input type="checkbox" id="glb-opt-bake-grass" checked>
        <div>
          <b>6. 烘焙实体 3D 草叶渐变贴图（64×256 PNG）</b>
          <span>实体 3D 草默认使用顶点色（COLOR_0）；勾选后自动生成轻量叶脉渐变 BaseColor 贴图，兼容不读顶点色的查看器与引擎</span>
        </div>
      </label>
      <label class="glb-opt-row">
        <input type="checkbox" id="glb-opt-wind-uv">
        <div>
          <b>7. 导出引擎风动权重 (UV1 / TEXCOORD_1)</b>
          <span>写入 Unity / UE 可直接读取的标准 UV1 通道（X = 高度摇曳权重，Y = 叶缘 / 枝梢颤动权重）</span>
        </div>
      </label>
    </div>
    <div class="glb-pop-preview" id="glb-opt-summary"></div>
    <div class="glb-pop-foot">
      <button type="button" id="glb-pop-cancel">取消</button>
      ${host.exportLodGlb ? '<button type="button" class="secondary" id="glb-opt-lod-zip" title="按当前导出勾选配置，一键依次构建并打包导出 LOD0~LOD3 四个 GLB 文件">📦 导出多档 LOD（ZIP）</button>' : ''}
      <button type="button" class="primary" id="glb-opt-confirm">确认导出 GLB</button>
    </div>`
  document.body.append(pop)

  const fmtNoteEl = pop.querySelector<HTMLElement>('#glb-fmt-note')!
  const mergedCb = pop.querySelector<HTMLInputElement>('#glb-opt-merged')!
  const separateCb = pop.querySelector<HTMLInputElement>('#glb-opt-separate')!
  const noDecorCb = pop.querySelector<HTMLInputElement>('#glb-opt-no-decor')!
  const bakeMossCb = pop.querySelector<HTMLInputElement>('#glb-opt-bake-moss')!
  const bakeNormalRow = pop.querySelector<HTMLElement>('#glb-opt-bake-normal-row')!
  const bakeNormalDescEl = pop.querySelector<HTMLElement>('#glb-opt-bake-normal-desc')!
  const bakeNormalCb = pop.querySelector<HTMLInputElement>('#glb-opt-bake-normal')!
  let userWantedBakeNormal = bakeNormalCb.checked
  const bakeSizeSel = pop.querySelector<HTMLSelectElement>('#glb-opt-bake-size')!
  const bakeConvSel = pop.querySelector<HTMLSelectElement>('#glb-opt-bake-conv')!
  const bakeDlBtn = pop.querySelector<HTMLButtonElement>('#glb-opt-bake-download')!
  const bakeGrassCb = pop.querySelector<HTMLInputElement>('#glb-opt-bake-grass')!
  const windUvCb = pop.querySelector<HTMLInputElement>('#glb-opt-wind-uv')!
  const summaryEl = pop.querySelector<HTMLElement>('#glb-opt-summary')!
  const lodZipBtn = pop.querySelector<HTMLButtonElement>('#glb-opt-lod-zip')
  const confirmBtn = pop.querySelector<HTMLButtonElement>('#glb-opt-confirm')!

  const confirmLabelForFormat = () => {
    const isDesktop = Boolean(getDesktopApi()?.saveExportBundle)
    if (exportFormat === 'fbx') return isDesktop ? '导出 FBX + TEX 目录' : '导出 FBX + TEX (.zip)'
    if (exportFormat === 'gltf-split') return isDesktop ? '拆分导出 glTF + 贴图' : '导出 glTF + 贴图 (.zip)'
    return '确认导出 GLB'
  }

  const getOptions = (): ExportGlbOptions => ({
    exportFormat,
    mode: separateCb.checked ? 'separate' : 'merged',
    excludeDecorations: noDecorCb.checked,
    bakeBarkMoss: bakeMossCb.checked,
    bakeProceduralBark: bakeNormalCb.checked,
    bakeBarkNormal: bakeNormalCb.checked,
    bakeBarkNormalSize: (Number(bakeSizeSel.value) as BakeResolution) || 512,
    bakeBarkNormalConvention: (bakeConvSel.value === 'directx' ? 'directx' : 'opengl') as NormalMapConvention,
    bakeGrassTexture: bakeGrassCb.checked,
    exportWindUv: windUvCb.checked,
  })

  const refreshSummary = () => {
    fmtNoteEl.textContent = formatNotes[exportFormat]
    confirmBtn.textContent = confirmLabelForFormat()
    const root = host.getRoot()
    if (!root) {
      summaryEl.innerHTML = `<span class="glb-warn">${esc(host.emptyMessage || '当前画布为空，请先生成植物')}</span>`
      bakeNormalCb.checked = false
      bakeNormalCb.disabled = true
      bakeNormalRow?.classList?.add('is-disabled')
      if (bakeNormalDescEl) bakeNormalDescEl.textContent = '当前画布为空，暂无可烘焙的树皮模型'
      bakeSizeSel.disabled = true
      bakeConvSel.disabled = true
      bakeDlBtn.disabled = true
      confirmBtn.disabled = true
      if (lodZipBtn) lodZipBtn.disabled = true
      return
    }
    // Priority rule: keep option 5 enabled whenever EITHER sculpted bark OR default procedural bark exists;
    // auto-uncheck and disable ONLY when neither exists (e.g. grass, rock, lotus, custom bitmap bark).
    const probeOpts = getOptions()
    const anyBarkBakeable = inspectGlbExport(root, { ...probeOpts, bakeBarkNormal: true, bakeProceduralBark: true })
    const canSculptBake = anyBarkBakeable.normalBakedMeshes > 0
    const canProcBake = anyBarkBakeable.proceduralBarkMeshes > 0
    const canBakeBark = canSculptBake || canProcBake
    if (!canBakeBark) {
      bakeNormalCb.checked = false
      bakeNormalCb.disabled = true
      bakeNormalRow?.classList?.add('is-disabled')
      if (bakeNormalDescEl) bakeNormalDescEl.textContent = '当前模型不含默认程序化树皮或雕刻树干，已自动禁用树皮烘焙'
    } else {
      bakeNormalCb.disabled = false
      bakeNormalCb.checked = userWantedBakeNormal
      bakeNormalRow?.classList?.remove('is-disabled')
      if (bakeNormalDescEl) {
        bakeNormalDescEl.textContent = canProcBake && canSculptBake
          ? '将自动烘焙默认程序化树皮 BaseColor + 高模雕刻法线与 Cavity AO PNG'
          : canSculptBake
            ? '将烘焙高模雕刻树干的法线与 Cavity AO PNG'
            : '将自动烘焙默认程序化树皮的无缝 BaseColor + Normal PNG'
      }
    }
    const opts = getOptions()
    const info = inspectGlbExport(root, opts)
    bakeSizeSel.disabled = !canBakeBark
    bakeConvSel.disabled = !canBakeBark
    bakeDlBtn.disabled = !canBakeBark
    confirmBtn.disabled = info.meshCount === 0
    if (lodZipBtn) lodZipBtn.disabled = info.meshCount === 0
    const modeLabel = opts.mode === 'merged' ? '1 个合并网格（多材质槽）' : `${info.meshCount} 个独立网格`
    const tags: string[] = []
    if (info.excludedDecorations > 0) tags.push(`<span class="glb-decor-tag">已去除 ${info.excludedDecorations} 个装饰网格</span>`)
    const convLabel = opts.bakeBarkNormalConvention === 'directx' ? 'DX' : 'GL'
    if (info.proceduralBarkMeshes > 0 && info.normalBakedMeshes > 0) {
      tags.push(`<span class="glb-decor-tag">树皮自动烘焙 BaseColor+高模法线+AO (${opts.bakeBarkNormalSize}² ${convLabel})</span>`)
    } else if (info.proceduralBarkMeshes > 0) {
      tags.push(`<span class="glb-decor-tag">树皮自动烘焙 BaseColor+Normal (${opts.bakeBarkNormalSize}² ${convLabel})</span>`)
    } else if (info.normalBakedMeshes > 0) {
      tags.push(`<span class="glb-decor-tag">已烘焙 ${info.normalBakedMeshes} 处高模法线+AO (${opts.bakeBarkNormalSize}² ${convLabel})</span>`)
    }
    if (info.grassBakedMeshes > 0) {
      tags.push(`<span class="glb-decor-tag">草叶渐变贴图 (64×256 PNG)</span>`)
    }
    if (info.mossBakedMeshes > 0) {
      tags.push(`<span class="glb-decor-tag">已烘焙 ${info.mossBakedMeshes} 处青苔</span>`)
    }
    if (info.windUvMeshes > 0) {
      tags.push(`<span class="glb-decor-tag">UV1 风动权重 (${info.windUvMeshes} 网格)</span>`)
    }
    const vcolSet = new Set(info.vertexColorOnlyMaterials)
    const chips = info.materials.map(m => (
      vcolSet.has(m)
        ? `<i class="is-vcol" title="此材质不含位图贴图，颜色存储在顶点色通道 COLOR_0">${esc(m)}<span class="glb-vcol-badge">仅顶点色 COLOR_0</span></i>`
        : `<i>${esc(m)}</i>`
    )).join('')
    const vcolHint = info.vertexColorOnlyMaterials.length > 0
      ? `<div class="glb-vcol-hint">💡 标有「仅顶点色 COLOR_0」的材质（如未烘焙贴图的实体 3D 草/岩石/花茎）不含位图；在 Blender/UE/Unity 中请启用顶点色（Color Attribute），或勾选上方第 5/6 项自动烘焙为 PNG 贴图。</div>`
      : ''
    summaryEl.innerHTML = `
      <div class="glb-sum-top"><span>${modeLabel} · ${fmt.format(info.triangles)} 面</span>${tags.join('')}</div>
      <div class="glb-mat-chips">${chips || '<i>无材质</i>'}</div>
      ${vcolHint}`
  }

  for (const btn of pop.querySelectorAll<HTMLButtonElement>('[data-exp-fmt]')) {
    btn.onclick = () => {
      exportFormat = btn.dataset.expFmt as ExportFileFormat
      for (const b of pop.querySelectorAll<HTMLButtonElement>('[data-exp-fmt]')) {
        b.setAttribute('aria-pressed', String(b.dataset.expFmt === exportFormat))
      }
      refreshSummary()
    }
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
  bakeNormalCb.onchange = () => {
    userWantedBakeNormal = bakeNormalCb.checked
    refreshSummary()
  }
  bakeSizeSel.onchange = () => refreshSummary()
  bakeConvSel.onchange = () => refreshSummary()
  bakeGrassCb.onchange = () => refreshSummary()
  windUvCb.onchange = () => refreshSummary()

  const nextFrame = () => new Promise<void>(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })

  const triggerDataUrlDownload = (dataUrl: string, filename: string) => {
    fetch(dataUrl).then(r => r.blob()).then(blob => {
      host.saveBlob(blob, filename)
    }).catch(() => {
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = filename
      a.click()
    })
  }

  bakeDlBtn.onclick = async () => {
    host.onBeforeExport?.()
    const root = host.getRoot()
    if (!root) return
    const opts = getOptions()
    const prevLabel = bakeDlBtn.textContent || '↓ 树皮贴图 PNG'
    bakeDlBtn.disabled = true
    bakeDlBtn.textContent = '正在烘焙树皮贴图…'
    confirmBtn.disabled = true
    if (lodZipBtn) lodZipBtn.disabled = true
    try {
      await nextFrame()
      const items = await extractStandaloneBarkBakePngsAsync(root, {
        size: opts.bakeBarkNormalSize,
        normalConvention: opts.bakeBarkNormalConvention,
        includeMoss: opts.bakeBarkMoss,
      })
      if (!items.length) {
        host.message('当前模型不包含可烘焙的程序化或雕刻树干', true)
        return
      }
      const convTag = opts.bakeBarkNormalConvention === 'directx' ? 'dx' : 'gl'
      const downloads: [string, string][] = []
      for (const item of items) {
        if (item.colorDataUrl) downloads.push([item.colorDataUrl, `${item.name}_basecolor_${item.width}.png`])
        downloads.push([item.normalDataUrl, `${item.name}_normal_${item.width}_${convTag}.png`])
        if (item.aoDataUrl) downloads.push([item.aoDataUrl, `${item.name}_ao_${item.width}.png`])
      }
      downloads.forEach(([url, fname], idx) => {
        if (idx === 0) triggerDataUrlDownload(url, fname)
        else setTimeout(() => triggerDataUrlDownload(url, fname), idx * 120)
      })
      activityLog.exportStep(`单独导出树皮烘焙贴图（${downloads.length} 张 PNG）`, {
        size: opts.bakeBarkNormalSize,
        convention: opts.bakeBarkNormalConvention,
        files: downloads.map(([, f]) => f),
      })
      host.message(`已独立导出 ${downloads.length} 张树皮烘焙贴图（${opts.bakeBarkNormalSize}² ${convTag.toUpperCase()} PNG）`)
    } catch (error) {
      activityLog.exportStep(`独立烘焙贴图导出失败：${error instanceof Error ? error.message : String(error)}`, error, 'error')
      host.message(error, true)
    } finally {
      bakeDlBtn.textContent = prevLabel
      refreshSummary()
    }
  }

  const positionPopover = () => {
    const r = host.triggerButton.getBoundingClientRect()
    const pw = 392
    const left = Math.max(10, Math.min(window.innerWidth - pw - 10, r.right - pw))
    pop.style.top = `${Math.round(r.bottom + 8)}px`
    pop.style.left = `${Math.round(left)}px`
  }

  const close = () => { pop.hidden = true }
  const open = () => {
    host.onBeforeExport?.()
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

  const runExportLodZip = async (): Promise<Blob | undefined> => {
    if (!host.exportLodGlb) return undefined
    host.onBeforeExport?.()
    const root = host.getRoot()
    if (!root) return undefined
    const opts: ExportGlbOptions = { ...getOptions(), exportFormat: 'glb' }
    const prevLabel = lodZipBtn?.textContent || '📦 导出多档 LOD（ZIP）'
    if (lodZipBtn) lodZipBtn.disabled = true
    confirmBtn.disabled = true
    bakeDlBtn.disabled = true
    host.triggerButton.disabled = true
    try {
      const rawFilename = host.getFilename(opts)
      const baseSlug = rawFilename.replace(/\.(glb|gltf|fbx|zip)$/i, '')
      const files: Record<string, Uint8Array> = {}
      const entrySizes: Record<string, number> = {}
      const levels: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3]
      for (const lv of levels) {
        if (lodZipBtn) lodZipBtn.textContent = `导出 LOD ${lv + 1}/4…`
        await nextFrame()
        const blob = await host.exportLodGlb(lv, opts)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const entryName = `${baseSlug}_LOD${lv}.glb`
        files[entryName] = bytes
        entrySizes[entryName] = bytes.byteLength
      }
      if (lodZipBtn) lodZipBtn.textContent = '打包 ZIP…'
      await nextFrame()
      const zipped = zipSync(files, { level: 0 })
      const zipCopy = new Uint8Array(zipped.byteLength)
      zipCopy.set(zipped)
      const zipBlob = new Blob([zipCopy.buffer], { type: 'application/zip' })
      const zipName = `${baseSlug}_lods.zip`
      activityLog.exportStep(`一键导出多档 LOD ZIP：${zipName}（${(zipBlob.size / 1024).toFixed(1)} KB · 4 档 GLB）`, {
        filename: zipName,
        bytes: zipBlob.size,
        entries: entrySizes,
        mode: opts.mode,
        excludeDecorations: opts.excludeDecorations,
        bakeBarkMoss: opts.bakeBarkMoss,
        bakeBarkNormal: opts.bakeBarkNormal,
        exportWindUv: opts.exportWindUv,
      })
      host.saveBlob(zipBlob, zipName)
      host.message(`已导出多档 LOD 压缩包 ${zipName}（含 LOD0~LOD3 共 4 个 GLB）`)
      close()
      return zipBlob
    } catch (error) {
      activityLog.exportStep(`导出多档 LOD ZIP 失败：${error instanceof Error ? error.message : String(error)}`, error, 'error')
      host.message(error, true)
      return undefined
    } finally {
      if (lodZipBtn) {
        lodZipBtn.textContent = prevLabel
        lodZipBtn.disabled = false
      }
      confirmBtn.disabled = false
      host.triggerButton.disabled = false
      refreshSummary()
    }
  }

  if (lodZipBtn) {
    lodZipBtn.onclick = () => { void runExportLodZip() }
  }

  confirmBtn.onclick = async () => {
    host.onBeforeExport?.()
    const root = host.getRoot()
    if (!root) return
    const opts = getOptions()
    const info = inspectGlbExport(root, opts)
    const willBakeBark = info.normalBakedMeshes > 0 || info.proceduralBarkMeshes > 0
    confirmBtn.disabled = true
    confirmBtn.textContent = willBakeBark ? '正在烘焙树皮贴图…' : '正在导出…'
    bakeDlBtn.disabled = true
    if (lodZipBtn) lodZipBtn.disabled = true
    host.triggerButton.disabled = true
    try {
      await nextFrame()
      const rawFilename = host.getFilename(opts)
      const baseSlug = rawFilename.replace(/\.(glb|gltf|fbx|zip)$/i, '')

      if (exportFormat === 'gltf-split' || exportFormat === 'fbx') {
        const bundle = exportFormat === 'fbx'
          ? await exportFbxBundle(root, baseSlug, opts)
          : await exportSplitGltfBundle(root, baseSlug, opts)
        const folderName = `${baseSlug}-${exportFormat === 'fbx' ? 'fbx-tex' : 'gltf-tex'}`
        const desktopRes = await tryDesktopSaveBundle(
          folderName,
          bundle.files,
          exportFormat === 'fbx' ? '选择 FBX + TEX 导出目录' : '选择 glTF + 贴图导出目录',
        )
        if (desktopRes.handled) {
          if (desktopRes.canceled) {
            host.message('已取消导出')
            return
          }
          host.message(`已拆分导出 ${bundle.primaryFilename} + ${bundle.textureFiles.length} 张 PNG 贴图至 ${desktopRes.dirPath}`)
          close()
          return
        }
        const zipBlob = bundle.toZipBlob()
        const zipName = `${folderName}.zip`
        activityLog.exportStep(`触发浏览器下载 ${zipName}（${(zipBlob.size / 1024).toFixed(1)} KB · ${bundle.files.length} 文件）`, {
          filename: zipName,
          bytes: zipBlob.size,
          primaryFilename: bundle.primaryFilename,
          textureFiles: bundle.textureFiles,
          triangles: info.triangles,
        })
        host.saveBlob(zipBlob, zipName)
        host.message(`已导出 ${zipName}（内含 ${bundle.primaryFilename} + ${bundle.textureFiles.length} 张独立 PNG 贴图）`)
        close()
        return
      }

      const blob = await host.exportBlob(opts)
      const filename = rawFilename
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
      const barkTxt = info.proceduralBarkMeshes > 0
        ? `，已自动烘焙树皮贴图(${opts.bakeBarkNormalSize}² ${convTag})`
        : (info.normalBakedMeshes > 0 ? `，已烘焙 ${info.normalBakedMeshes} 处高模法线+AO(${opts.bakeBarkNormalSize}² ${convTag})` : '')
      const grassTxt = info.grassBakedMeshes > 0 ? '，已烘焙草叶渐变贴图(64×256)' : ''
      const windTxt = info.windUvMeshes > 0 ? '，含 UV1 风动权重' : ''
      host.message(`已导出 ${filename} · ${modeTxt}${decorTxt}${barkTxt}${grassTxt}${windTxt}`)
      close()
    } catch (error) {
      activityLog.exportStep(`确认导出模型过程异常：${error instanceof Error ? error.message : String(error)}`, error, 'error')
      host.message(error, true)
    } finally {
      confirmBtn.textContent = confirmLabelForFormat()
      confirmBtn.disabled = false
      if (lodZipBtn) lodZipBtn.disabled = false
      host.triggerButton.disabled = false
      refreshSummary()
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

  return { open, close, getOptions, refreshSummary, exportLodZip: runExportLodZip }
}
