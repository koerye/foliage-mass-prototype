// Shared SpeedTree-style Node Edit + Crown Sculpt toolbar markup & bindings
// used identically by Classic Studio (broadleaf.html) and AI Mode (ai.html).
import type { CrownHandle, TreeSpec } from '../tree/spec'
import type { CrownEditor, EditSubMode, SelectedBranchInfo } from './editor'

const fmt = new Intl.NumberFormat('zh-CN')

export function editToolsHtml(toggleLabel = '✎ 节点编辑'): string {
  return `
<div class="edit-tools" id="edit-tools">
  <button id="edit-toggle" type="button" aria-pressed="false" title="开启 SpeedTree 风格枝干节点编辑与树冠塑形">${toggleLabel}</button>
  <div class="edit-group st-edit-panel" id="edit-group" hidden>
    <div class="st-mode-tabs" role="tablist" aria-label="编辑子模式">
      <button type="button" data-edit-sub="nodes" aria-pressed="true" title="SpeedTree 模式：直接点选三维枝干，拖拽弯弧/金色柄/曲线节点精细编辑">❖ 枝干节点</button>
      <button type="button" data-edit-sub="crown" aria-pressed="false" title="树冠包络控制点与裸枝区塑形">◎ 树冠塑形</button>
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
      </div>

      <div class="st-btn-row" id="st-node-actions">
        <button type="button" id="st-bare-branch" title="隐藏/恢复当前选中枝干的叶片，露出枝条">🍃 去叶</button>
        <button type="button" id="st-prune-branch" title="修剪删除当前枝干及其子枝 (Delete)">✂ 修剪</button>
        <button type="button" id="st-reset-branch" title="仅还原当前枝干的修改">重置此枝</button>
        <button type="button" id="st-reset-all" title="还原所有枝干节点编辑">重置全部</button>
      </div>

      <label class="st-guides-check"><input id="st-show-guides" type="checkbox" checked> 显示枝干骨架参考线</label>
      <p class="edit-hint" id="st-node-hint">点选任意枝干：拖金色柄调长度，拖白色弯弧调仰角/旋转/弯曲/粗细，拖白点塑形曲线；Delete 修剪，Ctrl+Z 撤销。</p>
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
  const tabBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-edit-sub]')]

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
  const outLength = byId('st-out-length')
  const outRadius = byId('st-out-radius')
  const outPitch = byId('st-out-pitch')
  const outYaw = byId('st-out-yaw')
  const outGravity = byId('st-out-gravity')

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
    undoBtn.disabled = !ed?.canUndo()
    resetAllBtn.disabled = !(spec?.branchEdits?.length)
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

    bareBtn.disabled = info.role === 'trunk'
    bareBtn.textContent = info.edit.bare ? '🍃 恢复长叶' : '🍃 去叶'
    bareBtn.setAttribute('aria-pressed', String(info.edit.bare))
    pruneBtn.disabled = info.role === 'trunk'
    const spec = opts.getSpec()
    resetBranchBtn.disabled = !(spec?.branchEdits?.some(x => x.id === info.id))
    nodeHint.textContent = info.role === 'trunk'
      ? '已选树干：拖金色柄调高度，拖弯弧调倾角/旋转/弯曲/粗细，拖 4 个白点直接弯折主干曲线。'
      : '已选枝条：拖金色柄调长度，拖白色弯弧调仰角/旋转/下垂/粗细，拖白点手绘弧度，子枝自动联动。'
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
    makePatch: (v: number) => Record<string, number>,
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

  return {
    setEnabled,
    sync: syncModeTabs,
    showSelectedHandle,
    showSelectedBranch,
  }
}
