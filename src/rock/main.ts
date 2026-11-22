import '../style.css'
import '../studio/studio.css'
import './rock.css'
import { Vector3 } from 'three'
import { exportGlb } from '../export-glb'
import { createDefaultOverrideStore } from '../studio/default-overrides'
import { lightingPresets, Viewer, type Camera, type LightingPreset } from '../viewport'
import { buildRockGroup, type RockBuildStats } from './geometry'
import { makeRockMaterial, updateRockMaterialLive, type RockViewMode } from './material'
import {
  parseRockSpec, rockPresetIds, rockPresets, rockPresetSpec,
  type RockPresetId, type RockSpec, type RockStyle, type RockTopMode,
} from './spec'

const cameras: Record<Camera, string> = { front: '正面', angle: '45°', side: '侧面', top: '斜俯视' }
const viewModes: [RockViewMode, string][] = [['final', '成品'], ['clay', '灰模'], ['wireframe', '线框']]
const topModeDefaultColors: Record<RockTopMode, string> = {
  none: '#cbb67b',
  sand: '#cbb67b',
  moss: '#78894a',
  snow: '#eef4fa',
}
const presetBadges: Record<RockPresetId, string> = {
  'boulder-sand-cap': '厚涂',
  'cel-anime-rock': '赛璐璐',
  'boulder-chiseled': '精雕',
  'boulder-slab': '厚涂',
  'mossy-forest-rock': '青苔',
  'rock-cluster': '石堆',
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const fmt = new Intl.NumberFormat('zh-CN')

type FieldDef =
  | { kind: 'range'; path: string; label: string; min: number; max: number; step: number; live?: boolean }
  | { kind: 'color'; path: string; label: string; live?: boolean }
  | { kind: 'select'; path: string; label: string; options: [string, string][]; live?: boolean }
  | { kind: 'subdiv'; path: string; label: string }

const sections: { title: string; open: boolean; fields: FieldDef[] }[] = [
  {
    title: '形态与切面',
    open: true,
    fields: [
      { kind: 'range', path: 'shape.width', label: '宽度 m', min: 0.4, max: 4.0, step: 0.02 },
      { kind: 'range', path: 'shape.height', label: '高度 m', min: 0.35, max: 3.5, step: 0.02 },
      { kind: 'range', path: 'shape.depth', label: '纵深 m', min: 0.4, max: 4.0, step: 0.02 },
      { kind: 'range', path: 'shape.facetCount', label: '切面数量', min: 6, max: 26, step: 1 },
      { kind: 'range', path: 'shape.flatness', label: '平面宽阔度', min: 0, max: 1, step: 0.02 },
      { kind: 'range', path: 'shape.bevel', label: '棱边倒角', min: 0, max: 0.32, step: 0.005 },
      { kind: 'range', path: 'shape.asymmetry', label: '非对称造型', min: 0, max: 1, step: 0.02 },
      { kind: 'range', path: 'shape.taperTop', label: '顶部收窄', min: -0.35, max: 0.55, step: 0.02 },
      { kind: 'range', path: 'shape.bottomFlat', label: '底面压平', min: 0, max: 1, step: 0.02 },
    ],
  },
  {
    title: '雕刻与细节',
    open: true,
    fields: [
      { kind: 'subdiv', path: 'detail.subdivisions', label: '网格细分' },
      { kind: 'range', path: 'detail.chisel', label: '二次凿痕', min: 0, max: 1, step: 0.02 },
      { kind: 'range', path: 'detail.undulation', label: '表面起伏', min: 0, max: 1, step: 0.02 },
      { kind: 'range', path: 'detail.cracks', label: '裂纹层理', min: 0, max: 1, step: 0.02 },
      { kind: 'range', path: 'detail.sharpness', label: '棱面锐利度', min: 0, max: 1, step: 0.02 },
    ],
  },
  {
    title: '材质与棱边着色',
    open: true,
    fields: [
      { kind: 'color', path: 'shading.baseColor', label: '石体基色', live: true },
      { kind: 'color', path: 'shading.shadowColor', label: '暗部冷影', live: true },
      { kind: 'color', path: 'shading.edgeColor', label: '棱边高光色', live: true },
      { kind: 'range', path: 'shading.edgeWear', label: '棱边提亮', min: 0, max: 1, step: 0.02, live: true },
      { kind: 'range', path: 'shading.edgeBreakup', label: '高光断续感', min: 0, max: 1, step: 0.02, live: true },
      { kind: 'range', path: 'shading.cavityAO', label: '凹缝暗影', min: 0, max: 1, step: 0.02, live: true },
      { kind: 'range', path: 'shading.facetVariation', label: '切面明暗差', min: 0, max: 1, step: 0.02, live: true },
      { kind: 'range', path: 'shading.grain', label: '手绘颗粒感', min: 0, max: 1, step: 0.02, live: true },
      { kind: 'range', path: 'shading.roughness', label: '表面粗糙度', min: 0.25, max: 1, step: 0.02, live: true },
    ],
  },
  {
    title: '顶部覆层与石堆',
    open: true,
    fields: [
      {
        kind: 'select',
        path: 'top.mode',
        label: '顶层覆层',
        live: true,
        options: [['none', '无覆层'], ['sand', '暖沙 / 地衣'], ['moss', '青苔'], ['snow', '积雪']],
      },
      { kind: 'color', path: 'top.color', label: '覆层色调', live: true },
      { kind: 'range', path: 'top.coverage', label: '覆盖范围', min: 0, max: 1, step: 0.02, live: true },
      { kind: 'range', path: 'top.softness', label: '过渡柔和度', min: 0.05, max: 0.65, step: 0.02, live: true },
      { kind: 'range', path: 'cluster.count', label: '石块数量', min: 1, max: 5, step: 1 },
      { kind: 'range', path: 'cluster.spread', label: '石堆间距', min: 0.45, max: 1.8, step: 0.04 },
      { kind: 'range', path: 'cluster.scaleDecay', label: '副石比例', min: 0.3, max: 0.85, step: 0.02 },
    ],
  },
]

function renderField(f: FieldDef): string {
  if (f.kind === 'range') {
    return `<label class="s-field" data-path="${f.path}"><span>${f.label}</span><input type="range" data-r="${f.path}" min="${f.min}" max="${f.max}" step="${f.step}"><input type="number" data-n="${f.path}" min="${f.min}" max="${f.max}" step="${f.step}"></label>`
  }
  if (f.kind === 'color') {
    return `<label class="s-field" data-path="${f.path}"><span>${f.label}</span><input type="color" data-c="${f.path}"></label>`
  }
  if (f.kind === 'select') {
    return `<label class="s-field" data-path="${f.path}"><span>${f.label}</span><select data-s="${f.path}">${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`
  }
  return `<div class="s-field" data-path="${f.path}"><span>${f.label}</span><div class="rk-sub-row" role="group" aria-label="${f.label}">
    <button type="button" data-sub="0" aria-pressed="false">低模切面</button>
    <button type="button" data-sub="1" aria-pressed="false">中模游戏</button>
    <button type="button" data-sub="2" aria-pressed="false">精雕细凿</button>
  </div></div>`
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined), obj)
}

function setPath(obj: unknown, path: string, value: unknown) {
  const keys = path.split('.')
  let cur = obj as Record<string, unknown>
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] as Record<string, unknown>
  cur[keys[keys.length - 1]] = value
}

byId('app').classList.add('s-studio')
byId('app').innerHTML = `
<header class="bar">
  <div class="brand"><span class="mark rk-mark" aria-hidden="true">◈</span><div><h1>Rock Studio</h1><span>风格化石头工作台 · 切面雕刻 &amp; 赛璐璐</span></div></div>
  <nav aria-label="项目操作">
    <a class="b-link" href="./broadleaf.html" title="返回程序化树木工作台">← 树木工作台</a>
    <a class="b-link" href="./ai.html" title="前往 AI 模式空白工程">✦ AI 模式</a>
    <button id="rk-quick-reseed" title="随机生成新外形">🎲 随机石形</button>
    <input id="file" type="file" accept=".json,application/json" hidden>
    <button id="import">导入 JSON</button>
    <button id="json">保存 JSON</button>
    <button id="png">截图 PNG</button>
    <button id="glb" class="primary">导出 GLB</button>
  </nav>
</header>
<section class="workspace">
  <section class="viewport panel" aria-label="三维工作区">
    <header class="viewport-head">
      <h2 id="rock-title">沙顶切面岩</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="lighting" title="预览氛围光预设" style="font-size:12px;padding:4px 8px;border-radius:8px;border:1px solid rgba(40,56,44,.16);background:rgba(255,255,255,.78)">
          ${Object.entries(lightingPresets).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
        <div class="switcher" role="group" aria-label="显示模式">
          ${viewModes.map(([v, l]) => `<button type="button" data-view="${v}" aria-pressed="${v === 'final'}">${l}</button>`).join('')}
        </div>
      </div>
    </header>
    <div class="stage">
      <div id="canvas"></div>
      <div class="camera-tools switcher" role="group" aria-label="固定机位">
        ${Object.entries(cameras).map(([k, l]) => `<button type="button" data-camera="${k}" aria-pressed="${k === 'angle'}">${l}</button>`).join('')}
      </div>
      <div class="gesture">拖动旋转 · 滚轮缩放 · 右键平移</div>
      <div class="error" id="webgl" hidden>预览需要支持 WebGL 2 的浏览器。</div>
    </div>
    <div class="stats rk-stats">
      <div><span>石块数</span><output id="stat-stones">—</output></div>
      <div><span>顶点数</span><output id="stat-vertices">—</output></div>
      <div><span>三角面</span><output id="stat-triangles">—</output></div>
      <div><span>生成 ms</span><output id="stat-ms">—</output></div>
      <div><span>Draw Calls</span><output id="stat-calls">—</output></div>
    </div>
  </section>
  <form class="inspector panel s-inspector" id="form" aria-label="石头参数" onsubmit="return false">
    <header class="inspect-head"><h2>石头参数</h2><button id="reset" type="button">恢复预设</button></header>
    <div class="s-scroll" id="panel">
      <div class="rk-preset-grid" role="group" aria-label="石头预设">
        ${rockPresetIds.map(id => `<button type="button" class="rk-preset-btn" data-preset="${id}" aria-pressed="false"><span>${rockPresets[id].name}</span><span class="rk-preset-tag">${presetBadges[id]}</span></button>`).join('')}
      </div>
      <div class="dp-bar" id="default-preset-bar">
        <button type="button" id="save-default" class="dp-save-btn" title="将当前参数保存并替换当前默认预设（写入本地文件，刷新后永久生效）">★ 保存替换默认预设</button>
        <button type="button" id="reset-factory" class="dp-factory-btn" title="清除自定义覆盖，恢复出厂内置默认参数" hidden>恢复出厂</button>
      </div>
      <label class="s-field s-top"><span>随机种子</span><input id="seed" type="number" min="0" step="1"><button type="button" id="reseed" title="随机种子">🎲</button></label>
      <div class="rk-style-tabs" role="group" aria-label="着色风格">
        <button type="button" data-style="painterly" aria-pressed="true">厚涂风格化</button>
        <button type="button" data-style="cel" aria-pressed="false">赛璐璐简面</button>
      </div>
      ${sections.map(s => `<details class="s-section"${s.open ? ' open' : ''}><summary>${s.title}</summary>${s.fields.map(renderField).join('')}</details>`).join('')}
    </div>
  </form>
</section>
<div id="toast" class="toast" role="status" hidden></div>`

const livePaths = new Set<string>(
  sections.flatMap(s => s.fields).filter(f => 'live' in f && f.live).map(f => f.path),
)

interface RockDefaultOverride {
  version: 2
  spec: RockSpec
  lighting: LightingPreset
}

const validLightingKeys = new Set<string>(Object.keys(lightingPresets))

const rockDefaults = createDefaultOverrideStore<RockPresetId, RockDefaultOverride>({
  scope: 'rock',
  validIds: rockPresetIds,
  parse: (raw, id) => {
    const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if ('spec' in rec && rec.spec && typeof rec.spec === 'object') {
      const parsed = parseRockSpec(rec.spec)
      const mood: LightingPreset = typeof rec.lighting === 'string' && validLightingKeys.has(rec.lighting)
        ? rec.lighting as LightingPreset
        : 'neutral'
      return { version: 2, spec: { ...parsed, preset: id, name: rockPresets[id].name }, lighting: mood }
    }
    const parsed = parseRockSpec(raw)
    return { version: 2, spec: { ...parsed, preset: id, name: rockPresets[id].name }, lighting: 'neutral' }
  },
})

function effectivePresetState(id: RockPresetId): { spec: RockSpec; lighting: LightingPreset } {
  const custom = rockDefaults.get(id)
  if (custom) return { spec: custom.spec, lighting: custom.lighting }
  return { spec: rockPresetSpec(id), lighting: 'neutral' }
}

const urlPreset = new URL(location.href).searchParams.get('preset') as RockPresetId | null
let presetId: RockPresetId = urlPreset && rockPresetIds.includes(urlPreset) ? urlPreset : 'boulder-sand-cap'
const bootRock = effectivePresetState(presetId)
let spec: RockSpec = bootRock.spec
let userDirty = false
let viewMode: RockViewMode = 'final'
let camera: Camera = 'angle'
let lighting: LightingPreset = bootRock.lighting
let built: ReturnType<typeof buildRockGroup> | undefined
let rockMaterial = makeRockMaterial(spec, viewMode)
let vertexColorsDirty = false
let buildCount = 0
let toastTimer: ReturnType<typeof setTimeout>

function message(value: unknown, error = false) {
  const toast = byId('toast')
  clearTimeout(toastTimer)
  toast.textContent = value instanceof Error ? value.message : String(value)
  toast.classList.toggle('is-error', error)
  toast.hidden = false
  toastTimer = setTimeout(() => { toast.hidden = true }, 3600)
}

let viewer: Viewer | undefined
try {
  viewer = new Viewer(byId('canvas'), (_, calls) => {
    byId('stat-calls').textContent = fmt.format(calls)
  })
  viewer.setWind(false)
} catch (error) {
  console.warn(error)
  byId('webgl').hidden = false
}

function syncPanel() {
  const overridden = rockDefaults.has(presetId)
  byId('rock-title').textContent = overridden ? `${spec.name} · 已改默认` : spec.name
  ;(byId('seed') as HTMLInputElement).value = String(spec.seed)
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
    const id = btn.dataset.preset as RockPresetId
    const isMod = rockDefaults.has(id)
    btn.setAttribute('aria-pressed', String(id === presetId))
    btn.classList.toggle('is-overridden', isMod)
    const tag = btn.querySelector<HTMLElement>('.rk-preset-tag')
    if (tag) tag.textContent = isMod ? '已改' : presetBadges[id]
  })
  byId('reset-factory').hidden = !overridden
  byId('save-default').textContent = overridden ? '★ 更新当前默认预设' : '★ 保存替换默认预设'
  document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.style === spec.style))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.sub) === spec.detail.subdivisions))
  })
  document.querySelectorAll<HTMLInputElement>('[data-r]').forEach(el => {
    const v = getPath(spec, el.dataset.r!)
    el.value = String(v ?? 0)
  })
  document.querySelectorAll<HTMLInputElement>('[data-n]').forEach(el => {
    const v = getPath(spec, el.dataset.n!)
    el.value = String(typeof v === 'number' ? Number(v.toFixed(3)) : v ?? 0)
  })
  document.querySelectorAll<HTMLInputElement>('[data-c]').forEach(el => {
    const v = getPath(spec, el.dataset.c!)
    el.value = String(v ?? '#a6acb6')
  })
  document.querySelectorAll<HTMLSelectElement>('[data-s]').forEach(el => {
    const v = getPath(spec, el.dataset.s!)
    el.value = String(v ?? 'none')
  })
  // Toggle top-cap sub-fields visibility cleanly
  const topDisabled = spec.top.mode === 'none'
  for (const p of ['top.color', 'top.coverage', 'top.softness']) {
    const row = document.querySelector<HTMLElement>(`.s-field[data-path="${p}"]`)
    if (row) row.hidden = topDisabled
  }
  const singleStone = spec.cluster.count <= 1
  for (const p of ['cluster.spread', 'cluster.scaleDecay']) {
    const row = document.querySelector<HTMLElement>(`.s-field[data-path="${p}"]`)
    if (row) row.hidden = singleStone
  }
}

function updateStats(stats: RockBuildStats) {
  byId('stat-stones').textContent = fmt.format(stats.stones)
  byId('stat-vertices').textContent = fmt.format(stats.vertices)
  byId('stat-triangles').textContent = fmt.format(stats.triangles)
  byId('stat-ms').textContent = stats.ms.toFixed(1)
}

function rebuild(reframe = false) {
  const prev = built
  updateRockMaterialLive(rockMaterial, spec, viewMode)
  built = buildRockGroup(spec, rockMaterial)
  vertexColorsDirty = false
  buildCount++

  const size = built.bounds.getSize(new Vector3())
  const span = Math.max(1.05, size.length() * .76)
  viewer?.showModel(built.group, span, false)
  if (reframe) viewer?.frame(camera, built.bounds.getCenter(new Vector3()))
  viewer?.refreshShadows()
  prev?.dispose()
  updateStats(built.stats)
}

function applyParam(path: string, value: unknown, final: boolean) {
  userDirty = true
  setPath(spec, path, value)
  if (path === 'top.mode' && value !== 'none') {
    const mode = value as RockTopMode
    spec.top.color = topModeDefaultColors[mode]
    if (spec.top.coverage < 0.1) spec.top.coverage = 0.52
    syncPanel()
  }
  if (path === 'cluster.count' || path === 'top.mode') syncPanel()

  if (livePaths.has(path) && built) {
    updateRockMaterialLive(rockMaterial, spec, viewMode)
    vertexColorsDirty = true
    if (final) {
      // Refresh baked vertex colors for GLB fidelity on release
      rebuild(false)
    }
    return
  }
  rebuild(false)
}

function setLightingMood(mood: LightingPreset) {
  lighting = mood
  ;(byId('lighting') as HTMLSelectElement).value = mood
  viewer?.setLighting(mood)
}

function loadPreset(id: RockPresetId) {
  presetId = id
  const state = effectivePresetState(id)
  spec = state.spec
  setLightingMood(state.lighting)
  userDirty = false
  syncPanel()
  rebuild(true)
}

async function saveCurrentAsDefault() {
  const saved = await rockDefaults.save(presetId, {
    version: 2,
    spec: { ...spec, preset: presetId, name: rockPresets[presetId].name },
    lighting,
  })
  spec = saved.spec
  setLightingMood(saved.lighting)
  userDirty = false
  syncPanel()
  const where = rockDefaults.storageMode === 'file' ? '本地文件' : '浏览器存储'
  message(`已将当前全部参数与光照保存并替换默认预设「${rockPresets[presetId].name}」（已写入${where}）`)
  return saved.spec
}

async function resetCurrentToFactory() {
  await rockDefaults.resetOne(presetId)
  spec = rockPresetSpec(presetId)
  setLightingMood('neutral')
  userDirty = false
  syncPanel()
  rebuild(true)
  message(`已恢复「${rockPresets[presetId].name}」为出厂默认参数`)
}

function randomizeSeed() {
  userDirty = true
  spec.seed = Math.floor(100 + Math.random() * 99899)
  syncPanel()
  rebuild(false)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Bind preset chips
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => loadPreset(btn.dataset.preset as RockPresetId))
})

// Bind shading style toggle
document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.style as RockStyle
    if (spec.style === next) return
    userDirty = true
    spec.style = next
    syncPanel()
    rebuild(false)
  })
})

// Bind subdivision level buttons
document.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach(btn => {
  btn.addEventListener('click', () => {
    const sub = Number(btn.dataset.sub) as 0 | 1 | 2
    if (spec.detail.subdivisions === sub) return
    userDirty = true
    spec.detail.subdivisions = sub
    syncPanel()
    rebuild(false)
  })
})

// Bind sliders, numbers, colors & selects
const panelEl = byId('panel')
panelEl.addEventListener('input', ev => {
  const t = ev.target as HTMLInputElement | HTMLSelectElement
  if (t.id === 'seed') {
    const n = Math.max(0, Math.round(Number(t.value) || 0))
    userDirty = true
    spec.seed = n
    rebuild(false)
    return
  }
  if (t.dataset.r) {
    const v = Number(t.value)
    const num = panelEl.querySelector<HTMLInputElement>(`[data-n="${t.dataset.r}"]`)
    if (num) num.value = String(Number(v.toFixed(3)))
    applyParam(t.dataset.r, v, false)
  } else if (t.dataset.n) {
    const v = Number(t.value)
    if (!Number.isFinite(v)) return
    const rngEl = panelEl.querySelector<HTMLInputElement>(`[data-r="${t.dataset.n}"]`)
    if (rngEl) rngEl.value = String(v)
    applyParam(t.dataset.n, v, false)
  } else if (t.dataset.c) {
    applyParam(t.dataset.c, t.value, false)
  } else if (t.dataset.s) {
    applyParam(t.dataset.s, t.value, true)
  }
})

panelEl.addEventListener('change', ev => {
  const t = ev.target as HTMLInputElement
  const path = t.dataset.r || t.dataset.n || t.dataset.c
  if (!path) return
  if (livePaths.has(path) && vertexColorsDirty) rebuild(false)
})

byId('reseed').addEventListener('click', randomizeSeed)
byId('rk-quick-reseed').addEventListener('click', randomizeSeed)
byId('save-default').addEventListener('click', () => {
  void saveCurrentAsDefault().catch(err => message(err, true))
})
byId('reset-factory').addEventListener('click', () => {
  void resetCurrentToFactory().catch(err => message(err, true))
})
byId('reset').addEventListener('click', () => {
  loadPreset(presetId)
  message(rockDefaults.has(presetId) ? '已恢复至你保存的默认预设参数' : '已恢复当前预设默认参数')
})

// Lighting, view mode & camera buttons
;(byId('lighting') as HTMLSelectElement).addEventListener('change', ev => {
  userDirty = true
  setLightingMood((ev.target as HTMLSelectElement).value as LightingPreset)
})

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    viewMode = btn.dataset.view as RockViewMode
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.view === viewMode))
    })
    updateRockMaterialLive(rockMaterial, spec, viewMode)
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(btn => {
  btn.addEventListener('click', () => {
    camera = btn.dataset.camera as Camera
    document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.camera === camera))
    })
    viewer?.frame(camera, built?.bounds.getCenter(new Vector3()))
  })
})

// JSON Import / Export, PNG Snapshot, GLB Export
byId('json').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `${spec.preset}-${spec.seed}.rock.json`)
  message('已导出石头参数 JSON')
})

byId('import').addEventListener('click', () => byId<HTMLInputElement>('file').click())
byId<HTMLInputElement>('file').addEventListener('change', async ev => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const parsed = parseRockSpec(JSON.parse(await file.text()))
    presetId = parsed.preset
    spec = parsed
    syncPanel()
    rebuild(true)
    message(`已导入石头参数：${parsed.name}`)
  } catch (err) {
    message(err instanceof Error ? `JSON 解析失败：${err.message}` : 'JSON 解析失败', true)
  } finally {
    ;(ev.target as HTMLInputElement).value = ''
  }
})

byId('png').addEventListener('click', () => {
  if (!viewer) return
  const a = document.createElement('a')
  a.href = viewer.snapshot()
  a.download = `${spec.preset}-${spec.seed}.png`
  a.click()
  message('已保存 3D 截图 PNG')
})

byId('glb').addEventListener('click', async () => {
  if (!built) return
  if (vertexColorsDirty) rebuild(false)
  try {
    const blob = await exportGlb(built.group, { mode: 'merged', excludeDecorations: false })
    const filename = `${spec.preset}-${spec.seed}.glb`
    downloadBlob(blob, filename)
    message(`已导出 ${filename}（${(blob.size / 1024).toFixed(1)} KB · ${fmt.format(built.stats.triangles)} 面）`)
  } catch (err) {
    message(err instanceof Error ? `GLB 导出失败：${err.message}` : 'GLB 导出失败', true)
  }
})

// Expose clean automation & debug handle
;(window as unknown as Record<string, unknown>).__rockStudio = {
  getSpec: () => parseRockSpec(spec),
  setPreset: (id: RockPresetId) => { loadPreset(id); return built?.stats },
  setParam: (path: string, value: unknown, final = true) => { applyParam(path, value, final); syncPanel(); return built?.stats },
  setStyle: (style: RockStyle) => { spec.style = style; syncPanel(); rebuild(false); return built?.stats },
  setView: (v: RockViewMode) => {
    viewMode = v
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)))
    updateRockMaterialLive(rockMaterial, spec, viewMode)
  },
  setCamera: (c: Camera) => {
    camera = c
    document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.camera === c)))
    viewer?.frame(c, built?.bounds.getCenter(new Vector3()))
  },
  setLighting: (l: LightingPreset) => {
    lighting = l
    ;(byId('lighting') as HTMLSelectElement).value = l
    viewer?.setLighting(l)
  },
  stats: () => ({ ...built?.stats, buildCount }),
  ready: () => rockDefaults.ready(),
  saveAsDefault: () => saveCurrentAsDefault(),
  resetFactory: () => resetCurrentToFactory(),
  hasDefaultOverride: (id?: RockPresetId) => rockDefaults.has(id ?? presetId),
  exportGlbSize: async () => {
    if (!built) return 0
    if (vertexColorsDirty) rebuild(false)
    const blob = await exportGlb(built.group, { mode: 'merged', excludeDecorations: false })
    return blob.size
  },
}

// Initial boot + disk override sync
setLightingMood(lighting)
syncPanel()
rebuild(true)
void rockDefaults.ready().then(() => {
  if (!userDirty) {
    const diskState = effectivePresetState(presetId)
    if (JSON.stringify(diskState.spec) !== JSON.stringify(spec) || diskState.lighting !== lighting) {
      spec = diskState.spec
      setLightingMood(diskState.lighting)
      rebuild(true)
    }
  }
  syncPanel()
})
