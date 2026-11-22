// Shared SpeedTree-style Node Edit + Crown Sculpt toolbar markup & bindings
// used identically by Classic Studio (broadleaf.html) and AI Mode (ai.html).
import type { CrownHandle, LeafNormalMode, TreeSpec } from '../tree/spec'
import type { CrownEditor, EditSubMode, NormalTool, SelectedBranchInfo } from './editor'

const fmt = new Intl.NumberFormat('zh-CN')

export function editToolsHtml(toggleLabel = '✎ 节点编辑'): string {
  return `
<div class="edit-tools" id="edit-tools">
  <button id="edit-toggle" type="button" aria-pressed="false" title="开启 SpeedTree 风格枝干节点编辑、树冠塑形与树叶自定义法线编辑">${toggleLabel}</button>
  <div class="edit-group st-edit-panel" id="edit-group" hidden>
    <div class="st-mode-tabs" role="tablist" aria-label="编辑子模式">
      <button type="button" data-edit-sub="nodes" aria-pressed="true" title="SpeedTree 模式：直接点选三维枝干，拖拽弯弧/金色柄/曲线节点精细编辑">❖ 枝干</button>
      <button type="button" data-edit-sub="crown" aria-pressed="false" title="树冠包络控制点与裸枝区塑形">◎ 树冠</button>
      <button type="button" data-edit-sub="normals" aria-pressed="false" title="树叶自定义法线编辑：拖拽 3D 法线球心、树冠局部法线笔刷、RGB 法线视图与 3D 法线向量">↗ 法线</button>
    </div>

    <div id="edit-nodes-pane" class="st-pane">
      <div class="st-node-hud" id="st-node-hud">
        <div class="st-hud-head">
          <span>多边形 - 已选</span>
          <b id="st-hud-bones">骨骼: —</b>
        </div>
        <div class="st-hud-grid">
          <span>树枝:</span><output id="st-hud-tris">—</output>
          <span>节点:</span><output id="st-hud-node">点击三维枝干选中</output>
          <span>长度 / 粗细:</span><output id="st-hud-dim">—</output>
        </div>
      </div>

      <div class="st-btn-row">
        <button type="button" id="st-pick-trunk" title="快速选中树干 (#0)">树干</button>
        <button type="button" id="st-prev-branch" title="切换上一条枝干">◀</button>
        <button type="button" id="st-next-branch" title="切换下一条枝干">▶</button>
        <button type="button" id="st-undo" title="撤销上一步节点/树冠编辑 (Ctrl+Z)" disabled>↩ 撤销</button>
      </div>

      <div class="st-sliders" id="st-sliders" hidden>
        <label class="st-slider"><span>长度</span><input id="st-sl-length" type="range" min="0.25" max="2.5" step="0.02"><output id="st-out-length">1.00×</output></label>
        <label class="st-slider"><span>粗细</span><input id="st-sl-radius" type="range" min="0.3" max="2.5" step="0.02"><output id="st-out-radius">1.00×</output></label>
        <label class="st-slider"><span>仰角</span><input id="st-sl-pitch" type="range" min="-65" max="65" step="1"><output id="st-out-pitch">0°</output></label>
        <label class="st-slider"><span>旋转</span><input id="st-sl-yaw" type="range" min="-180" max="180" step="1"><output id="st-out-yaw">0°</output></label>
        <label class="st-slider"><span>弯曲</span><input id="st-sl-gravity" type="range" min="-1.5" max="1.5" step="0.02"><output id="st-out-gravity">0.00</output></label>
        <label class="st-slider" id="st-row-socket" title="沿父干/父枝上下滑动枝根挂点（不脱离父干，焊缝与子枝自动跟随）"><span>挂点</span><input id="st-sl-socket" type="range" min="0.04" max="0.98" step="0.01"><output id="st-out-socket">58%</output></label>
        <label class="st-slider" title="当前枝条及附属子枝沿 X 轴自由位移"><span>位移X</span><input id="st-sl-offx" type="range" min="-3" max="3" step="0.02"><output id="st-out-offx">0.00m</output></label>
        <label class="st-slider" title="当前枝条及附属子枝沿 Y 轴自由升降"><span>位移Y</span><input id="st-sl-offy" type="range" min="-3" max="3" step="0.02"><output id="st-out-offy">0.00m</output></label>
        <label class="st-slider" title="当前枝条及附属子枝沿 Z 轴自由位移"><span>位移Z</span><input id="st-sl-offz" type="range" min="-3" max="3" step="0.02"><output id="st-out-offz">0.00m</output></label>
      </div>

      <div class="st-btn-row" id="st-node-actions">
        <button type="button" id="st-bare-branch" title="隐藏/恢复当前选中枝干的叶片，露出枝条">🍃 去叶</button>
        <button type="button" id="st-prune-branch" title="修剪删除当前枝干及其子枝 (Delete)">✂ 修剪</button>
        <button type="button" id="st-reset-branch" title="仅还原当前枝干的修改">重置此枝</button>
        <button type="button" id="st-reset-all" title="还原所有枝干节点编辑">重置全部</button>
      </div>

      <label class="st-guides-check"><input id="st-show-guides" type="checkbox" checked> 显示枝干骨架参考线</label>
      <p class="edit-hint" id="st-node-hint">点选任意枝干：拖绿点沿父干滑动挂点（Shift+拖自由平移），拖金色柄/弯弧/白点塑形；Delete 修剪，Ctrl+Z 撤销。</p>
    </div>

    <div id="edit-crown-pane" class="st-pane" hidden>
      <div class="st-btn-row">
        <button type="button" id="add-shape" title="点击树冠表面添加形变控制点">＋ 控制点</button>
        <button type="button" id="add-bare" title="点击树冠表面添加裸枝区：区域内不长叶，露出枝条">＋ 裸枝区</button>
        <button type="button" id="remove-handle" title="删除选中（Delete）">删除</button>
        <button type="button" id="reset-handles">重置控制点</button>
      </div>
      <label class="edit-radius" id="radius-row" hidden><span>影响半径</span><input id="handle-radius" type="range" min=".2" max="6" step=".05"><output id="handle-radius-out"></output></label>
      <p class="edit-hint" id="edit-hint">拖动橙色点微调树冠外廓；红色球为裸枝区。</p>
    </div>

    <div id="edit-normals-pane" class="st-pane" hidden>
      <div class="st-node-hud">
        <div class="st-hud-head">
          <span>↗ 树叶自定义法线</span>
          <b id="st-norm-count">局部笔刷: 0</b>
        </div>
        <div class="st-hud-grid">
          <span>投射模式:</span><output id="st-norm-mode">默认</output>
          <span>球心偏移:</span><output id="st-norm-center">0.0, 0.0, 0.0</output>
        </div>
      </div>

      <div class="st-btn-row" role="group" aria-label="法线快速预设">
        <button type="button" data-norm-preset="auto" title="还原默认算法法线">默认</button>
        <button type="button" data-norm-preset="dome" title="半球穹顶法线：消除树冠底面死黑（原神/吉卜力推荐）">穹顶提亮</button>
        <button type="button" data-norm-preset="radial" title="从可拖拽 3D 青色球心均匀向外放射">球心放射</button>
        <button type="button" data-norm-preset="directional" title="所有叶面法线锁定统一方向，形成插画感明暗">定向打光</button>
      </div>

      <div class="st-btn-row" role="group" aria-label="3D 法线交互工具">
        <button type="button" data-norm-tool="center" aria-pressed="true" title="在 3D 视口直接拖动青色「法线投射中心」球体">⊕ 拖球心</button>
        <button type="button" data-norm-tool="up" aria-pressed="false" title="在树冠暗部点击/涂刷，将局部叶面法线抬升朝天提亮">⬆ 提亮刷</button>
        <button type="button" data-norm-tool="comb" aria-pressed="false" title="在树冠上按住拖动，将局部法线梳理为你的拖动方向">〰 梳向刷</button>
        <button type="button" data-norm-tool="puff" aria-pressed="false" title="在点击处局部放射外推，塑出蓬松云团体积高光">◎ 球凸刷</button>
        <button type="button" data-norm-tool="erase" aria-pressed="false" title="点击擦除附近的局部法线笔刷">🧹 擦除</button>
      </div>

      <div class="st-sliders">
        <label class="st-slider"><span>半径</span><input id="st-norm-rad" type="range" min="0.25" max="3.5" step="0.05" value="1.15"><output id="st-norm-rad-out">1.15 m</output></label>
        <label class="st-slider"><span>强度</span><input id="st-norm-str" type="range" min="0.1" max="1" step="0.02" value="0.72"><output id="st-norm-str-out">72%</output></label>
      </div>

      <div class="st-btn-row">
        <button type="button" id="st-norm-undo" title="撤销上一步法线编辑 (Ctrl+Z)" disabled>↩ 撤销</button>
        <button type="button" id="st-norm-clear" title="清空所有树冠局部笔刷">清空笔刷</button>
        <button type="button" id="st-norm-reset" title="重置全部自定义法线设置">重置法线</button>
      </div>

      <label class="st-guides-check"><input id="st-norm-rgb" type="checkbox"> 🎨 RGB 法线色视图（即时检视法线分布）</label>
      <label class="st-guides-check"><input id="st-norm-vec" type="checkbox" checked> ↗ 显示 3D 法线向量箭头</label>
      <p class="edit-hint" id="st-norm-hint">拖动 3D 青色球心可即时雕塑整树受光面，或切至提亮刷/梳向刷直接在树冠上刷法线；导出 GLB 完整保留。</p>
    </div>
  </div>
</div>`
}

export interface EditToolsOptions {
  editor: CrownEditor | undefined
  getSpec: () => TreeSpec | undefined
  canEnable?: () => boolean
  onBeforeEnable?: () => void
  onEnabledChange?: (on: boolean) => void
  onHandlesChange: (handles: CrownHandle[], final: boolean) => void
  onResetHandles: () => void
  onMessage?: (msg: string) => void
}

export function bindEditToolsUi(opts: EditToolsOptions) {
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const toggle = byId<HTMLButtonElement>('edit-toggle')
  const group = byId('edit-group')
  const nodesPane = byId('edit-nodes-pane')
  const crownPane = byId('edit-crown-pane')
  const normalsPane = byId('edit-normals-pane')
  const tabBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-edit-sub]')]

  const normCountEl = byId('st-norm-count')
  const normModeEl = byId('st-norm-mode')
  const normCenterEl = byId('st-norm-center')
  const normRadEl = byId<HTMLInputElement>('st-norm-rad')
  const normRadOut = byId('st-norm-rad-out')
  const normStrEl = byId<HTMLInputElement>('st-norm-str')
  const normStrOut = byId('st-norm-str-out')
  const normUndoBtn = byId<HTMLButtonElement>('st-norm-undo')
  const normClearBtn = byId<HTMLButtonElement>('st-norm-clear')
  const normResetBtn = byId<HTMLButtonElement>('st-norm-reset')
  const normRgbCb = byId<HTMLInputElement>('st-norm-rgb')
  const normVecCb = byId<HTMLInputElement>('st-norm-vec')
  const normPresetBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-norm-preset]')]
  const normToolBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-norm-tool]')]

  const normModeLabels: Record<LeafNormalMode, string> = {
    auto: '默认', dome: '半球穹顶', radial: '球心放射', cylinder: '圆柱环向', directional: '统一朝向', original: '原始面法线',
  }

  const hudTris = byId('st-hud-tris')
  const hudNode = byId('st-hud-node')
  const hudDim = byId('st-hud-dim')
  const hudBones = byId('st-hud-bones')
  const slidersBox = byId('st-sliders')
  const bareBtn = byId<HTMLButtonElement>('st-bare-branch')
  const pruneBtn = byId<HTMLButtonElement>('st-prune-branch')
  const resetBranchBtn = byId<HTMLButtonElement>('st-reset-branch')
  const resetAllBtn = byId<HTMLButtonElement>('st-reset-all')
  const undoBtn = byId<HTMLButtonElement>('st-undo')
  const guidesCheck = byId<HTMLInputElement>('st-show-guides')
  const nodeHint = byId('st-node-hint')

  const slLength = byId<HTMLInputElement>('st-sl-length')
  const slRadius = byId<HTMLInputElement>('st-sl-radius')
  const slPitch = byId<HTMLInputElement>('st-sl-pitch')
  const slYaw = byId<HTMLInputElement>('st-sl-yaw')
  const slGravity = byId<HTMLInputElement>('st-sl-gravity')
  const rowSocket = byId('st-row-socket')
  const slSocket = byId<HTMLInputElement>('st-sl-socket')
  const slOffX = byId<HTMLInputElement>('st-sl-offx')
  const slOffY = byId<HTMLInputElement>('st-sl-offy')
  const slOffZ = byId<HTMLInputElement>('st-sl-offz')
  const outLength = byId('st-out-length')
  const outRadius = byId('st-out-radius')
  const outPitch = byId('st-out-pitch')
  const outYaw = byId('st-out-yaw')
  const outGravity = byId('st-out-gravity')
  const outSocket = byId('st-out-socket')
  const outOffX = byId('st-out-offx')
  const outOffY = byId('st-out-offy')
  const outOffZ = byId('st-out-offz')

  const radius = byId<HTMLInputElement>('handle-radius')
  const radiusRow = byId('radius-row')
  const radiusOut = byId('handle-radius-out')
  const editHint = byId('edit-hint')

  let sliderDragStarted = false

  function syncModeTabs() {
    const ed = opts.editor
    const sub: EditSubMode = ed?.subMode ?? 'nodes'
    const spec = opts.getSpec()
    const ground = spec ? (spec.kind === 'grass' || spec.kind === 'fern' || spec.kind === 'flowerbed') : false
    for (const btn of tabBtns) {
      const isNodes = btn.dataset.editSub === 'nodes'
      btn.disabled = isNodes && ground
      btn.setAttribute('aria-pressed', String(btn.dataset.editSub === sub))
    }
    nodesPane.hidden = sub !== 'nodes'
    crownPane.hidden = sub !== 'crown'
    normalsPane.hidden = sub !== 'normals'
    undoBtn.disabled = !ed?.canUndo()
    normUndoBtn.disabled = !ed?.canUndo()
    resetAllBtn.disabled = !(spec?.branchEdits?.length)
    const ne = spec?.normalEdit
    normCountEl.textContent = `局部笔刷: ${ne?.brushes?.length ?? 0}`
    normModeEl.textContent = normModeLabels[ne?.mode ?? 'auto'] ?? '默认'
    normCenterEl.textContent = ne
      ? `${ne.centerOffsetX.toFixed(1)}, ${ne.centerOffsetY.toFixed(1)}, ${ne.centerOffsetZ.toFixed(1)}`
      : '0.0, 0.0, 0.0'
    normClearBtn.disabled = !(ne?.brushes?.length)
    for (const b of normPresetBtns) b.setAttribute('aria-pressed', String(b.dataset.normPreset === (ne?.mode ?? 'auto')))
    for (const b of normToolBtns) b.setAttribute('aria-pressed', String(b.dataset.normTool === (ed?.normalTool ?? 'center')))
    if (ed) {
      normRgbCb.checked = ed.normalDebugColor
      normVecCb.checked = ed.showNormalVectors
    }
  }

  function showSelectedBranch(info: SelectedBranchInfo | undefined) {
    syncModeTabs()
    if (!info) {
      hudTris.textContent = '—'
      hudNode.textContent = '点击三维枝干选中'
      hudDim.textContent = '—'
      hudBones.textContent = '骨骼: 0'
      slidersBox.hidden = true
      bareBtn.disabled = true
      pruneBtn.disabled = true
      resetBranchBtn.disabled = true
      nodeHint.textContent = '点击任意树干或枝条即可出现 SpeedTree 弧形操控柄与曲线节点。'
      return
    }
    hudTris.textContent = `${fmt.format(info.triangles)} tris`
    hudNode.textContent = (info.partLabel ? `${info.partLabel} · ` : '') + info.label + (info.bare ? ' · 无叶' : '')
    hudDim.textContent = `${info.length.toFixed(2)} m · ${info.edit.radiusScale.toFixed(2)}×`
    hudBones.textContent = info.descendants > 0 ? `骨骼: 1 (+${info.descendants})` : '骨骼: 1'
    slidersBox.hidden = false

    const e = info.edit
    slLength.value = String(e.lengthScale)
    outLength.textContent = `${e.lengthScale.toFixed(2)}×`
    slRadius.value = String(e.radiusScale)
    outRadius.textContent = `${e.radiusScale.toFixed(2)}×`
    slPitch.value = String(e.pitchDelta)
    outPitch.textContent = `${e.pitchDelta >= 0 ? '+' : ''}${Math.round(e.pitchDelta)}°`
    slYaw.value = String(e.yawDelta)
    outYaw.textContent = `${e.yawDelta >= 0 ? '+' : ''}${Math.round(e.yawDelta)}°`
    slGravity.value = String(e.gravityDelta)
    outGravity.textContent = `${e.gravityDelta >= 0 ? '+' : ''}${e.gravityDelta.toFixed(2)}`
    rowSocket.hidden = info.role === 'trunk'
    slSocket.value = String(Number(info.socket.toFixed(2)))
    outSocket.textContent = `${Math.round(info.socket * 100)}%`
    const fmtM = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}m`
    slOffX.value = String(e.offset[0])
    outOffX.textContent = fmtM(e.offset[0])
    slOffY.value = String(e.offset[1])
    outOffY.textContent = fmtM(e.offset[1])
    slOffZ.value = String(e.offset[2])
    outOffZ.textContent = fmtM(e.offset[2])

    bareBtn.disabled = info.role === 'trunk'
    bareBtn.textContent = info.edit.bare ? '🍃 恢复长叶' : '🍃 去叶'
    bareBtn.setAttribute('aria-pressed', String(info.edit.bare))
    pruneBtn.disabled = info.role === 'trunk'
    const spec = opts.getSpec()
    resetBranchBtn.disabled = !(spec?.branchEdits?.some(x => x.id === info.id))
    nodeHint.textContent = info.role === 'trunk'
      ? '已选树干：拖金色柄调高度，拖弯弧调倾角/旋转/弯曲/粗细，拖绿点自由平移整树，拖 4 个白点弯折主干曲线。'
      : '已选枝条：拖绿点沿父干滑动挂点（按住 Shift 自由 3D 平移），拖金色柄/弯弧/白点塑形，子枝自动联动。'
  }

  function showSelectedHandle(handle: CrownHandle | undefined) {
    const spec = opts.getSpec()
    radiusRow.hidden = !handle
    editHint.textContent = handle
      ? (handle.kind === 'bare' ? '裸枝区：拖动移动位置，调节半径控制露枝范围。' : '控制点：拖动改变轮廓，半径控制影响范围。')
      : '拖动橙色点微调树冠外廓：外拉变宽、下拉下垂、顶点下压变扁；红色球为裸枝区。'
    if (handle && spec) {
      radius.max = String(Math.max(6, spec.crown.width * 2.5))
      radius.value = String(handle.radius)
      radiusOut.textContent = handle.radius.toFixed(2)
    }
  }

  function setEnabled(on: boolean) {
    if (on && opts.canEnable && !opts.canEnable()) return
    toggle.setAttribute('aria-pressed', String(on))
    group.hidden = !on
    if (on) opts.onBeforeEnable?.()
    opts.editor?.setEnabled(on)
    opts.onEnabledChange?.(on)
    syncModeTabs()
  }

  toggle.onclick = () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true'
    setEnabled(on)
  }

  for (const btn of tabBtns) {
    btn.onclick = () => {
      const sub = btn.dataset.editSub as EditSubMode
      opts.editor?.setSubMode(sub)
      syncModeTabs()
    }
  }

  byId('st-pick-trunk').onclick = () => opts.editor?.selectBranch(0)
  byId('st-prev-branch').onclick = () => opts.editor?.cycleBranch(-1)
  byId('st-next-branch').onclick = () => opts.editor?.cycleBranch(1)
  undoBtn.onclick = () => {
    if (opts.editor?.undo()) opts.onMessage?.('已撤销上一步编辑')
  }
  bareBtn.onclick = () => opts.editor?.toggleSelectedBare()
  pruneBtn.onclick = () => opts.editor?.pruneSelectedBranch()
  resetBranchBtn.onclick = () => opts.editor?.resetSelectedBranch()
  resetAllBtn.onclick = () => opts.editor?.resetAllBranches()
  guidesCheck.onchange = () => opts.editor?.setShowGuides(guidesCheck.checked)

  const bindNodeSlider = (
    input: HTMLInputElement,
    output: HTMLElement,
    format: (v: number) => string,
    makePatch: (v: number) => Partial<Omit<import('../tree/spec').BranchEdit, 'id'>>,
  ) => {
    input.oninput = () => {
      const v = input.valueAsNumber
      output.textContent = format(v)
      const recordUndo = !sliderDragStarted
      sliderDragStarted = true
      opts.editor?.updateSelectedBranch(makePatch(v), false, recordUndo)
    }
    input.onchange = () => {
      sliderDragStarted = false
      const v = input.valueAsNumber
      opts.editor?.updateSelectedBranch(makePatch(v), true, false)
    }
  }

  bindNodeSlider(slLength, outLength, v => `${v.toFixed(2)}×`, v => ({ lengthScale: v }))
  bindNodeSlider(slRadius, outRadius, v => `${v.toFixed(2)}×`, v => ({ radiusScale: v }))
  bindNodeSlider(slPitch, outPitch, v => `${v >= 0 ? '+' : ''}${Math.round(v)}°`, v => ({ pitchDelta: v }))
  bindNodeSlider(slYaw, outYaw, v => `${v >= 0 ? '+' : ''}${Math.round(v)}°`, v => ({ yawDelta: v }))
  bindNodeSlider(slGravity, outGravity, v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`, v => ({ gravityDelta: v }))
  bindNodeSlider(slSocket, outSocket, v => `${Math.round(v * 100)}%`, v => {
    const base = opts.editor?.getSelectedBranchInfo()?.baseSocket ?? .5
    const raw = Math.min(.95, Math.max(-.95, v - base))
    return { socketDelta: Math.abs(raw) < .004 ? 0 : raw }
  })
  const patchOffsetAxis = (axis: 0 | 1 | 2) => (v: number) => {
    const cur = opts.editor?.getSelectedBranchInfo()?.edit.offset ?? [0, 0, 0]
    const next: [number, number, number] = [cur[0], cur[1], cur[2]]
    next[axis] = v
    return { offset: next }
  }
  const fmtMeters = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}m`
  bindNodeSlider(slOffX, outOffX, fmtMeters, patchOffsetAxis(0))
  bindNodeSlider(slOffY, outOffY, fmtMeters, patchOffsetAxis(1))
  bindNodeSlider(slOffZ, outOffZ, fmtMeters, patchOffsetAxis(2))

  // Crown sculpt mode buttons
  byId('add-shape').onclick = () => {
    opts.editor?.setMode('add-shape')
    syncModeTabs()
    editHint.textContent = '点击树冠表面放置控制点…'
  }
  byId('add-bare').onclick = () => {
    opts.editor?.setMode('add-bare')
    syncModeTabs()
    editHint.textContent = '点击树冠表面放置裸枝区…'
  }
  byId('remove-handle').onclick = () => opts.editor?.removeSelected()
  byId('reset-handles').onclick = () => {
    if (opts.editor) opts.editor.selectedId = undefined
    showSelectedHandle(undefined)
    opts.onResetHandles()
  }
  radius.oninput = () => {
    const spec = opts.getSpec(), id = opts.editor?.selectedId
    if (!spec || id === undefined) return
    const value = radius.valueAsNumber
    radiusOut.textContent = value.toFixed(2)
    opts.onHandlesChange(spec.handles.map(h => h.id === id ? { ...h, radius: value } : h), false)
    opts.editor?.refresh()
  }
  radius.onchange = () => {
    const spec = opts.getSpec()
    if (spec) opts.onHandlesChange(spec.handles, true)
  }

  // Custom Leaf Normal Editor controls
  for (const btn of normPresetBtns) {
    btn.onclick = () => {
      const m = btn.dataset.normPreset as LeafNormalMode
      const patch = m === 'dome' ? { flatten: 0.35, upLift: 0.14 }
        : m === 'radial' ? { centerOffsetY: -0.65 }
          : m === 'directional' ? { azimuth: 35, elevation: 50, strength: 0.9 }
            : {}
      opts.editor?.applyNormalPreset(m, patch)
      syncModeTabs()
    }
  }
  for (const btn of normToolBtns) {
    btn.onclick = () => {
      opts.editor?.setNormalTool(btn.dataset.normTool as NormalTool)
      syncModeTabs()
    }
  }
  normRadEl.oninput = () => {
    if (opts.editor) opts.editor.normalBrushRadius = normRadEl.valueAsNumber
    normRadOut.textContent = `${normRadEl.valueAsNumber.toFixed(2)} m`
  }
  normStrEl.oninput = () => {
    if (opts.editor) opts.editor.normalBrushStrength = normStrEl.valueAsNumber
    normStrOut.textContent = `${Math.round(normStrEl.valueAsNumber * 100)}%`
  }
  normUndoBtn.onclick = () => {
    if (opts.editor?.undo()) opts.onMessage?.('已撤销上一步法线编辑')
  }
  normClearBtn.onclick = () => {
    opts.editor?.clearNormalBrushes()
    opts.onMessage?.('已清空局部法线笔刷')
  }
  normResetBtn.onclick = () => {
    opts.editor?.resetNormalEdit()
    opts.onMessage?.('已重置全部自定义叶面法线')
  }
  normRgbCb.onchange = () => opts.editor?.setNormalDebugColor(normRgbCb.checked)
  normVecCb.onchange = () => opts.editor?.setShowNormalVectors(normVecCb.checked)

  return {
    setEnabled,
    sync: syncModeTabs,
    showSelectedHandle,
    showSelectedBranch,
  }
}
