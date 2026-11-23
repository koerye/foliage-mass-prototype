// Scene Assembly Studio (scene.html) — unlimited 3D vegetation & rock scene composition workbench.
import '../style.css'
import '../studio/studio.css'
import '../studio/presets.css'
import './assembly.css'
import { Box3 } from 'three'
import type { AiSceneSpec } from '../ai/scene'
import { exportGlb } from '../export-glb'
import { parseRockSpec, rockPresetIds, rockPresets, rockPresetSpec, type RockPresetId, type RockSpec } from '../rock/spec'
import { activityLog, initStudioLogging } from '../studio/activity-log'
import { mountActivityLogDrawer } from '../studio/activity-log-ui'
import { createDefaultOverrideStore } from '../studio/default-overrides'
import { bindGlbExportPopover } from '../studio/glb-export-ui'
import { createPresetStore, type SavedPreset } from '../studio/preset-store'
import { parseSavedTextureMap, type SavedTextureMap } from '../studio/texture-serialize'
import { createTextureRegistry } from '../studio/texture-slots'
import { parseTreeSpec, presetIds, presets, presetSpec, type PresetId, type TreeSpec } from '../tree/spec'
import {
  applyItemTransform, buildAssemblyItem,
  type AssemblySharedTextures, type BuiltAssemblyInstance,
} from './builder'
import { buildAssemblyGround, type BuiltGround } from './ground'
import {
  builtInAssemblyCases, curatedAssemblyAssets, getBuiltInAssemblyCase,
} from './showcases'
import {
  backdropMeta, blankAssemblyScene, categoryIcons, categoryLabels, cloneJson,
  createAiItem, createRockItem, createTreeItem, detectImportedAssetJson,
  makeItemId, parseAssemblyScene,
  type AssemblyBarkStyle, type AssemblyCameraPreset, type AssemblyItem,
  type AssemblySceneSpec, type BackdropTheme, type GroundStyle, type PathLayout,
} from './spec'
import { createAssemblySceneStore } from './store'
import { compareSceneReference } from './reference'
import { AssemblyViewport, type GizmoMode } from './viewport'

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const fmt = new Intl.NumberFormat('zh-CN')
const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

type PaletteTab = 'featured' | 'trees' | 'plants' | 'rocks'
type CasesTab = 'builtin' | 'mine'

const cameraLabels: Record<AssemblyCameraPreset, string> = {
  illustration: '插画视角',
  iso: '等轴 45°',
  front: '正面',
  side: '侧面',
  top: '俯视',
}

byId('app').classList.add('s-studio')
document.body.classList.add('as-body')
byId('app').innerHTML = `
<header class="bar">
  <div class="brand">
    <span class="mark" aria-hidden="true">❖</span>
    <div><h1>Scene Studio</h1><span>场景组装工作台 · 自由摆放树木花草石头 · 数量不限</span></div>
  </div>
  <nav aria-label="项目操作">
    <a class="b-link" href="./broadleaf.html" title="返回程序化树木工作台">← 树木工作台</a>
    <a class="b-link" href="./ai.html" title="前往 AI 模式">✦ AI 模式</a>
    <a class="b-link" href="./rock.html" title="前往风格化石头工作台">◈ 石头工作台</a>
    <button id="as-cases-btn" class="pl-showcase-btn" title="打开参考案例与我保存的组装场景">✿ 场景案例<span class="pl-badge" id="as-cases-badge">${builtInAssemblyCases.length}</span></button>
    <button id="as-save-btn" class="pl-save-btn" title="带 3D 封面保存当前组装场景为案例">★ 保存场景</button>
    <button id="as-clear-btn" title="清空所有已摆放资产">清空画布</button>
    <input id="as-scene-file" type="file" accept=".json,application/json" hidden>
    <button id="as-import-btn" title="导入组装场景或单个树木/花草/石头 JSON">导入 JSON</button>
    <button id="as-json-btn" title="导出当前组装场景 JSON 工程文件">保存 JSON</button>
    <button id="as-png-btn" title="截取当前 3D 画面 PNG">截图 PNG</button>
    <button id="glb" class="primary" title="将整个组装场景导出为 GLB">导出 GLB</button>
    <button id="activity-log-btn" class="al-open-btn" title="查看每一步操作与导出诊断日志">📋 日志<span class="pl-badge" id="al-badge">0</span></button>
  </nav>
</header>

<section class="as-workspace">
  <!-- Left Asset Palette -->
  <aside class="panel as-panel" aria-label="资产摆放库">
    <header class="as-panel-head">
      <h2>资产摆放库</h2>
      <span style="font-size:10.5px;color:#5f7664">单击即放置</span>
    </header>
    <div class="as-palette-tabs" role="tablist">
      <button type="button" data-ptab="featured" aria-pressed="true">★ 精选</button>
      <button type="button" data-ptab="trees" aria-pressed="false">🌳 树木</button>
      <button type="button" data-ptab="plants" aria-pressed="false">🌿 灌花草</button>
      <button type="button" data-ptab="rocks" aria-pressed="false">🪨 石头</button>
    </div>
    <div class="as-search-box">
      <input type="search" id="as-palette-search" placeholder="搜索树木、花草、石头、我的预设…">
    </div>
    <div class="as-palette-list" id="as-palette-list"></div>
    <footer class="as-palette-foot">
      <input id="as-asset-file" type="file" accept=".json,application/json" hidden>
      <button type="button" id="as-import-asset-btn" title="导入 .json / .rock.json 单个资产并放置进场景">＋ 导入资产 JSON</button>
    </footer>
  </aside>

  <!-- Center 3D Assembly Viewport -->
  <section class="viewport panel as-viewport" aria-label="三维组装视口">
    <header class="viewport-head">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap">
        <h2 id="as-scene-title">林间白桦孤树地块</h2>
        <div class="as-case-pills" role="group" aria-label="快速切换参考案例">
          ${builtInAssemblyCases.map((c, idx) =>
            `<button type="button" class="as-case-pill" data-quick-scene="${c.id}" aria-pressed="${idx === 0}" title="${esc(c.subtitle)}">✿ 案例${idx + 1}: ${esc(c.name.replace(/地块$/, ''))}</button>`
          ).join('')}
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <button type="button" id="as-wind-btn" aria-pressed="true" title="开关微风动画" style="font-size:12px;padding:4px 8px;border-radius:8px">🍃 微风</button>
        <select id="as-backdrop" title="展示台背景与光照氛围" style="font-size:12px;padding:4px 8px;border-radius:8px;border:1px solid rgba(40,56,44,.16);background:rgba(255,255,255,.82)">
          ${Object.entries(backdropMeta).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
        <div class="switcher" role="group" aria-label="固定机位">
          ${Object.entries(cameraLabels).map(([k, l]) => `<button type="button" data-camera="${k}" aria-pressed="${k === 'iso'}">${l}</button>`).join('')}
        </div>
      </div>
    </header>
    <div class="stage as-stage">
      <div id="canvas"></div>
      <div class="as-gizmo-bar" role="toolbar" aria-label="三维变换工具">
        <button type="button" data-gizmo="translate" aria-pressed="true" title="移动工具 (快捷键 W)">✥ 移动 W</button>
        <button type="button" data-gizmo="rotate" aria-pressed="false" title="旋转工具 (快捷键 E)">↻ 旋转 E</button>
        <button type="button" data-gizmo="scale" aria-pressed="false" title="缩放工具 (快捷键 R)">⤢ 缩放 R</button>
        <span class="as-gizmo-sep"></span>
        <button type="button" id="as-tool-ground" title="将选中资产底部自动贴合地面 (快捷键 G)">⬇ 贴地 G</button>
        <button type="button" id="as-tool-dup" title="复制选中资产 (快捷键 Ctrl+D)">⧉ 复制</button>
        <button type="button" id="as-tool-focus" title="相机聚焦选中资产 (快捷键 F)">◎ 聚焦</button>
        <button type="button" id="as-tool-del" class="is-danger" title="删除选中资产 (快捷键 Delete)">✕ 删除</button>
        <span class="as-gizmo-sep"></span>
        <button type="button" id="as-tool-undo" title="撤销 (Ctrl+Z)" disabled>↩ 撤销</button>
        <button type="button" id="as-tool-redo" title="重做 (Ctrl+Y)" disabled>↪ 重做</button>
      </div>
      <div class="gesture">单击选中资产 · W移动 E旋转 R缩放 G贴地 · 左键旋转视角 · 滚轮缩放 · 右键平移</div>
      <div class="error" id="webgl" hidden>预览需要支持 WebGL 2 的浏览器。</div>
    </div>
    <div class="stats as-stats">
      <div><span>资产总数</span><output id="stat-items">0</output></div>
      <div><span>树木/花草</span><output id="stat-plants">0</output></div>
      <div><span>石头资产</span><output id="stat-rocks">0</output></div>
      <div><span>总三角面</span><output id="stat-triangles">0</output></div>
      <div><span>Draw Calls</span><output id="stat-calls">0</output></div>
    </div>
  </section>

  <!-- Right Inspector: Selected Transform + Hierarchy + Diorama Ground -->
  <aside class="panel as-panel" aria-label="选中变换与场景层级">
    <header class="as-panel-head">
      <h2>属性与场景层级</h2>
      <span class="pl-badge" id="as-hier-count">0</span>
    </header>
    <div class="as-inspector-scroll">
      <!-- Selected Item Transform Card -->
      <section class="as-card" id="as-transform-card">
        <div class="as-card-head">
          <b>选中资产变换</b>
          <span id="as-sel-cat" style="font-size:10.5px;color:#5a7260"></span>
        </div>
        <div class="as-empty-sel" id="as-empty-sel">
          单击视口中任意树木、花草或石头，或在下方层级列表点选，即可调整位置、旋转、缩放与随机造型。
        </div>
        <div id="as-sel-controls" hidden>
          <div class="as-sel-name-row">
            <input type="text" id="as-sel-name" maxlength="64" placeholder="资产名称">
          </div>
          <div class="as-quick-acts">
            <button type="button" id="as-act-ground" title="底部贴齐地块表面">⬇ 贴地</button>
            <button type="button" id="as-act-reseed" title="随机种子重新生成该资产外形">🎲 换形</button>
            <button type="button" id="as-act-mirror" title="沿 X 轴水平镜像">⇄ 镜像</button>
            <button type="button" id="as-act-del" class="is-danger" title="从场景移除">✕ 删除</button>
          </div>
          <div class="as-vec-group">
            <div class="as-vec-label">
              <span>位置 Position (m)</span>
              <button type="button" class="as-mini-btn" id="as-pos-zero">归零</button>
            </div>
            <div class="as-xyz-grid">
              <label class="as-axis-box is-x"><span>X</span><input type="number" id="as-px" step="0.05"></label>
              <label class="as-axis-box is-y"><span>Y</span><input type="number" id="as-py" step="0.05"></label>
              <label class="as-axis-box is-z"><span>Z</span><input type="number" id="as-pz" step="0.05"></label>
            </div>
          </div>
          <div class="as-vec-group">
            <div class="as-vec-label">
              <span>旋转 Rotation (°)</span>
              <span style="display:flex;gap:3px">
                <button type="button" class="as-mini-btn" id="as-rot-45">+45°</button>
                <button type="button" class="as-mini-btn" id="as-rot-rand">随机朝向</button>
                <button type="button" class="as-mini-btn" id="as-rot-zero">归零</button>
              </span>
            </div>
            <div class="as-xyz-grid">
              <label class="as-axis-box is-x"><span>X</span><input type="number" id="as-rx" step="1"></label>
              <label class="as-axis-box is-y"><span>Y</span><input type="number" id="as-ry" step="1"></label>
              <label class="as-axis-box is-z"><span>Z</span><input type="number" id="as-rz" step="1"></label>
            </div>
            <div class="as-range-row">
              <span>水平朝向</span>
              <input type="range" id="as-ry-range" min="-180" max="180" step="1" value="0">
              <output id="as-ry-out">0°</output>
            </div>
          </div>
          <div class="as-vec-group">
            <div class="as-vec-label">
              <span>缩放 Scale</span>
              <label><input type="checkbox" id="as-scale-lock" checked> 等比锁定</label>
            </div>
            <div class="as-xyz-grid">
              <label class="as-axis-box is-x"><span>X</span><input type="number" id="as-sx" min="0.05" max="12" step="0.05"></label>
              <label class="as-axis-box is-y"><span>Y</span><input type="number" id="as-sy" min="0.05" max="12" step="0.05"></label>
              <label class="as-axis-box is-z"><span>Z</span><input type="number" id="as-sz" min="0.05" max="12" step="0.05"></label>
            </div>
            <div class="as-range-row">
              <span>整体倍率</span>
              <input type="range" id="as-scale-range" min="0.2" max="2.5" step="0.02" value="1">
              <output id="as-scale-out">1.00×</output>
            </div>
          </div>
          <label class="as-select-row" id="as-crown-row" hidden>
            <span>树冠画法</span>
            <select id="as-crown-style">
              <option value="default">原资产叶片</option>
              <option value="painted">实体叶片 · 手绘配色</option>
            </select>
          </label>
          <div class="as-select-row" id="as-bark-row" hidden>
            <span>树皮外观</span>
            <select id="as-bark-style">
              <option value="default">默认程序树皮</option>
              <option value="birch">白桦浅灰下干（参考图1）</option>
              <option value="driftwood">厚涂宽纹古木</option>
              <option value="moss">苍古苔藓木皮</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Scene Hierarchy Card -->
      <section class="as-card">
        <div class="as-card-head">
          <b>场景层级列表（数量不限）</b>
          <span id="as-hier-hint" style="font-size:10.5px;color:#667b6a">单击选中</span>
        </div>
        <div class="as-hier-list" id="as-hier-list"></div>
      </section>

      <!-- Diorama Ground & Scene Card -->
      <section class="as-card">
        <details class="as-ground-details as-reference">
          <summary>参考图构图对照</summary>
          <label>自选单张参考（纯色或透明背景）<input type="file" id="as-ref-file" accept="image/png,image/jpeg,image/webp"></label>
          <button id="as-ref-check" type="button" disabled>对照当前机位</button>
          <output id="as-ref-status" aria-live="polite"></output>
          <div id="as-ref-images" hidden>
            <figure><img alt="参考图色块"><figcaption>参考</figcaption></figure>
            <figure><img alt="场景色块"><figcaption>本次取景</figcaption></figure>
            <figure><img alt="轮廓差异"><figcaption>轮廓差异</figcaption></figure>
          </div>
        </details>
        <details class="as-ground-details" open>
          <summary>🗺 地块底座与小径设置</summary>
          <div class="as-select-row">
            <span>地块模式</span>
            <select id="as-g-style">
              <option value="diorama-path">草地土路地块（参考图风）</option>
              <option value="diorama-meadow">纯翠绿草地地块</option>
              <option value="studio">极简画室阴影底</option>
              <option value="none">无地面</option>
            </select>
          </div>
          <div class="as-select-row">
            <span>小径走势</span>
            <select id="as-g-path">
              <option value="birch-curve">弧形林间小径（参考图1）</option>
              <option value="boulder-trail">宽阔斜贯沙径（参考图2）</option>
              <option value="straight">直行草间小径</option>
              <option value="none">无土路</option>
            </select>
          </div>
          <div class="as-range-row">
            <span>地块边长</span>
            <input type="range" id="as-g-size" min="4.5" max="22" step="0.2" value="9">
            <output id="as-g-size-out">9.0m</output>
          </div>
          <div class="as-range-row">
            <span>土路宽度</span>
            <input type="range" id="as-g-pwidth" min="0.4" max="1.9" step="0.05" value="1">
            <output id="as-g-pwidth-out">1.00×</output>
          </div>
          <div class="as-ground-colors">
            <label><span>主草色</span><input type="color" id="as-g-grass"></label>
            <label><span>受光草</span><input type="color" id="as-g-hi"></label>
            <label><span>暗影草</span><input type="color" id="as-g-sh"></label>
            <label><span>沙土路</span><input type="color" id="as-g-pcol"></label>
          </div>
        </details>
      </section>
    </div>
  </aside>
</section>

<!-- Scene Cases & Saved Scenes Drawer -->
<aside class="as-cases-drawer" id="as-cases-drawer" aria-label="场景案例与已保存场景" hidden>
  <header class="pl-head">
    <div class="pl-tabs" role="tablist">
      <button type="button" data-ctab="builtin" aria-pressed="true">✿ 参考案例 <span class="pl-badge" id="as-builtin-cnt">${builtInAssemblyCases.length}</span></button>
      <button type="button" data-ctab="mine" aria-pressed="false">★ 我的场景 <span class="pl-badge" id="as-mine-cnt">0</span></button>
    </div>
    <button type="button" class="pl-close" id="as-cases-close">收起</button>
  </header>
  <section class="pl-capture" id="as-save-box">
    <div class="pl-thumb-box">
      <img id="as-cap-img" alt="当前 3D 场景封面">
      <button type="button" class="pl-thumb-refresh" id="as-cap-refresh">🔄 刷新封面</button>
    </div>
    <div class="pl-capture-form">
      <input id="as-cap-name" type="text" maxlength="80" placeholder="输入场景案例名称（如：林间花径地块）">
      <div class="pl-meta-line" id="as-cap-meta"></div>
      <div class="pl-capture-btns">
        <button type="button" class="primary" id="as-save-new">★ 保存为新案例</button>
        <button type="button" class="pl-update-btn" id="as-save-overwrite" hidden>覆盖当前</button>
      </div>
    </div>
  </section>
  <div class="pl-grid-wrap">
    <div class="pl-grid" id="as-cases-grid"></div>
    <div class="pl-empty" id="as-cases-empty" hidden>还没有保存的场景案例。<br>摆好树木花草石头后，点击上方「★ 保存为新案例」即可永久保存到本地。</div>
  </div>
  <footer class="pl-foot">
    <div class="pl-foot-storage" id="as-storage-info"><span class="pl-foot-dot"></span><span>本地落盘 user-presets/scenes.json</span></div>
  </footer>
</aside>

<div id="toast" class="toast" role="status" hidden></div>`

// ---- Toast & Logging -------------------------------------------------------
let toastTimer: ReturnType<typeof setTimeout>
function message(value: unknown, error = false, logIt = true) {
  const toast = byId('toast')
  clearTimeout(toastTimer)
  const text = value instanceof Error ? value.message : String(value)
  toast.textContent = text
  toast.classList.toggle('is-error', error)
  toast.hidden = false
  toastTimer = setTimeout(() => { toast.hidden = true }, 4000)
  if (logIt) {
    if (error) activityLog.error('system', `提示错误：${text}`, value instanceof Error ? value : undefined)
    else activityLog.info('system', `状态提示：${text}`)
  }
}

// ---- Stores (user presets, default overrides, saved assembly scenes) -------
const registry = createTextureRegistry()
const sharedTextures: AssemblySharedTextures = { registry, barkTemplates: {} }
const presetStore = createPresetStore()
const sceneStore = createAssemblySceneStore()

interface TreeOverrideLite {
  spec: TreeSpec
  textures?: SavedTextureMap
}
const treeDefaults = createDefaultOverrideStore<PresetId, TreeOverrideLite>({
  scope: 'tree',
  validIds: presetIds,
  parse(raw, id) {
    const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if ('spec' in rec && rec.spec && typeof rec.spec === 'object') {
      return {
        spec: { ...parseTreeSpec(rec.spec), name: presets[id].name },
        textures: parseSavedTextureMap(rec.textures),
      }
    }
    return { spec: { ...parseTreeSpec(raw), name: presets[id].name } }
  },
})

const rockDefaults = createDefaultOverrideStore<RockPresetId, { spec: RockSpec }>({
  scope: 'rock',
  validIds: rockPresetIds,
  parse(raw, id) {
    const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const src = ('spec' in rec && rec.spec && typeof rec.spec === 'object') ? rec.spec : raw
    return { spec: { ...parseRockSpec(src), preset: id, name: rockPresets[id].name } }
  },
})

// ---- State -----------------------------------------------------------------
let sceneSpec: AssemblySceneSpec = blankAssemblyScene()
let selectedId: string | undefined
let activeBuiltInCaseId: string | undefined
let activeSavedSceneId: string | undefined
let currentPaletteTab: PaletteTab = 'featured'
let currentCasesTab: CasesTab = 'builtin'
let confirmDeleteSceneId: string | undefined
let confirmDeleteTimer: ReturnType<typeof setTimeout> | undefined
let builtGround: BuiltGround | undefined
const instances = new Map<string, BuiltAssemblyInstance>()
const refFile = byId<HTMLInputElement>('as-ref-file')
const refCheck = byId<HTMLButtonElement>('as-ref-check')
let refRevision = 0
let buildSeq = 0
const mountRevisions = new WeakMap<AssemblyItem, number>()

// Undo / Redo history (stores deep-cloned snapshots of sceneSpec + selectedId)
interface HistorySnap { scene: AssemblySceneSpec; selectedId?: string }
const undoStack: HistorySnap[] = []
const redoStack: HistorySnap[] = []
const MAX_HISTORY = 40

function pushUndo() {
  undoStack.push({ scene: cloneJson(sceneSpec), selectedId })
  if (undoStack.length > MAX_HISTORY) undoStack.shift()
  redoStack.length = 0
  syncHistoryButtons()
}

function syncHistoryButtons() {
  byId<HTMLButtonElement>('as-tool-undo').disabled = undoStack.length === 0
  byId<HTMLButtonElement>('as-tool-redo').disabled = redoStack.length === 0
}

// ---- Viewport Setup --------------------------------------------------------
let viewport: AssemblyViewport | undefined
try {
  viewport = new AssemblyViewport(byId('canvas'), {
    onSelect: id => selectItem(id),
    onTransformChange: (id, pos, rotDeg, scale) => {
      const item = sceneSpec.items.find(x => x.id === id)
      if (!item || item.locked) return
      item.position = pos
      item.rotation = rotDeg
      item.scale = scale
      if (selectedId === id) syncSelectedTransformInputs()
    },
    onTransformCommit: id => {
      const item = sceneSpec.items.find(x => x.id === id)
      if (item) {
        activityLog.action(`拖拽变换「${item.name}」`, {
          id: item.id,
          position: item.position,
          rotation: item.rotation,
          scale: item.scale,
        }, 'scene')
      }
      pushUndo()
    },
    onStats: (_, calls) => {
      byId('stat-calls').textContent = fmt.format(calls)
    },
  })
} catch (error) {
  console.warn(error)
  byId('webgl').hidden = false
}

initStudioLogging({
  page: 'scene',
  getWebGLContext: () => viewport?.renderer.getContext() ?? null,
})

// ---- Ground & Scene Sync ---------------------------------------------------
function rebuildGround(refitShadow = true) {
  if (!viewport) return
  if (builtGround) {
    viewport.groundRoot.remove(builtGround.group)
    builtGround.dispose()
    builtGround = undefined
  }
  builtGround = buildAssemblyGround(sceneSpec.ground)
  viewport.groundRoot.add(builtGround.group)
  if (refitShadow) viewport.updateShadowFrustum(Math.max(5.5, sceneSpec.ground.size * 0.78))
  else viewport.refreshShadows()
}

function updateStatsUi() {
  let plantCount = 0
  let rockCount = 0
  let totalTris = 0
  for (const item of sceneSpec.items) {
    if (item.kind === 'rock') rockCount++
    else plantCount++
    const inst = instances.get(item.id)
    if (inst && item.visible) totalTris += inst.triangles
  }
  byId('stat-items').textContent = fmt.format(sceneSpec.items.length)
  byId('stat-plants').textContent = fmt.format(plantCount)
  byId('stat-rocks').textContent = fmt.format(rockCount)
  byId('stat-triangles').textContent = fmt.format(totalTris)
  byId('as-hier-count').textContent = String(sceneSpec.items.length)
}

function syncCasePills() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-quick-scene]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.quickScene === activeBuiltInCaseId))
  }
  refCheck.disabled = !refFile.files?.length && !activeBuiltInCaseId
  byId('as-scene-title').textContent = sceneSpec.name || '未命名场景'
}

function syncGroundInputs() {
  const g = sceneSpec.ground
  ;(byId('as-g-style') as HTMLSelectElement).value = g.style
  ;(byId('as-g-path') as HTMLSelectElement).value = g.pathLayout
  ;(byId('as-g-size') as HTMLInputElement).value = String(g.size)
  byId('as-g-size-out').textContent = `${g.size.toFixed(1)}m`
  ;(byId('as-g-pwidth') as HTMLInputElement).value = String(g.pathWidth)
  byId('as-g-pwidth-out').textContent = `${g.pathWidth.toFixed(2)}×`
  ;(byId('as-g-grass') as HTMLInputElement).value = g.grassColor
  ;(byId('as-g-hi') as HTMLInputElement).value = g.grassHighlight
  ;(byId('as-g-sh') as HTMLInputElement).value = g.grassShadow
  ;(byId('as-g-pcol') as HTMLInputElement).value = g.pathColor
  ;(byId('as-backdrop') as HTMLSelectElement).value = sceneSpec.backdrop
  byId('as-wind-btn').setAttribute('aria-pressed', String(sceneSpec.wind))
}

function syncSelectedTransformInputs() {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const emptyEl = byId('as-empty-sel')
  const ctrlEl = byId('as-sel-controls')
  const hasSel = Boolean(item)
  emptyEl.hidden = hasSel
  ctrlEl.hidden = !hasSel
  byId<HTMLButtonElement>('as-tool-ground').disabled = !hasSel || Boolean(item?.locked)
  byId<HTMLButtonElement>('as-tool-dup').disabled = !hasSel
  byId<HTMLButtonElement>('as-tool-focus').disabled = !hasSel
  byId<HTMLButtonElement>('as-tool-del').disabled = !hasSel
  byId('as-sel-cat').textContent = item ? `${categoryIcons[item.category]} ${categoryLabels[item.category]}${item.locked ? ' · 已锁定' : ''}` : ''
  if (!item) return

  const setVal = (id: string, v: number, digits = 2) => {
    const inp = byId<HTMLInputElement>(id)
    if (document.activeElement !== inp) inp.value = String(Number(v.toFixed(digits)))
  }
  const nameInp = byId<HTMLInputElement>('as-sel-name')
  if (document.activeElement !== nameInp) nameInp.value = item.name
  setVal('as-px', item.position[0], 2)
  setVal('as-py', item.position[1], 2)
  setVal('as-pz', item.position[2], 2)
  setVal('as-rx', item.rotation[0], 1)
  setVal('as-ry', item.rotation[1], 1)
  setVal('as-rz', item.rotation[2], 1)
  const ryNorm = ((item.rotation[1] + 180) % 360 + 360) % 360 - 180
  ;(byId('as-ry-range') as HTMLInputElement).value = String(Math.round(ryNorm))
  byId('as-ry-out').textContent = `${Math.round(item.rotation[1])}°`
  setVal('as-sx', item.scale[0], 2)
  setVal('as-sy', item.scale[1], 2)
  setVal('as-sz', item.scale[2], 2)
  const avgS = (item.scale[0] + item.scale[1] + item.scale[2]) / 3
  ;(byId('as-scale-range') as HTMLInputElement).value = String(Math.min(2.5, Math.max(0.2, avgS)))
  byId('as-scale-out').textContent = `${avgS.toFixed(2)}×`

  byId('as-crown-row').hidden = item.kind !== 'tree' || (item.payload as TreeSpec).kind !== 'broadleaf' || item.category === 'deadwood'
  byId<HTMLSelectElement>('as-crown-style').disabled = item.locked
  byId<HTMLSelectElement>('as-crown-style').value = item.crownStyle ?? 'default'
  const barkRow = byId('as-bark-row')
  const showBark = item.kind === 'tree' && (item.category === 'tree' || item.category === 'deadwood')
  barkRow.hidden = !showBark
  if (showBark) {
    ;(byId('as-bark-style') as HTMLSelectElement).value = item.barkStyle ?? 'default'
  }
}

function renderHierarchy() {
  const listEl = byId('as-hier-list')
  if (!sceneSpec.items.length) {
    listEl.innerHTML = '<div class="as-empty-sel">场景中暂无资产。<br>请从左侧「资产摆放库」单击放置树木、花草或石头。</div>'
    updateStatsUi()
    return
  }
  listEl.innerHTML = sceneSpec.items.map(item => {
    const sel = item.id === selectedId ? 'is-selected' : ''
    const hid = !item.visible ? 'is-hidden' : ''
    const icon = categoryIcons[item.category] ?? '✦'
    return `<div class="as-hier-item ${sel} ${hid}" data-hid="${esc(item.id)}">
      <span>${icon}</span>
      <span class="as-hier-name" title="${esc(item.name)}">${esc(item.name)}</span>
      <div class="as-hier-btns">
        <button type="button" data-hact="vis" data-hid="${esc(item.id)}" title="${item.visible ? '隐藏' : '显示'}">${item.visible ? '👁' : '🚫'}</button>
        <button type="button" data-hact="lock" data-hid="${esc(item.id)}" title="${item.locked ? '解锁编辑' : '锁定位置'}">${item.locked ? '🔒' : '🔓'}</button>
        <button type="button" data-hact="dup" data-hid="${esc(item.id)}" title="复制一份">⧉</button>
        <button type="button" class="is-danger" data-hact="del" data-hid="${esc(item.id)}" title="删除">✕</button>
      </div>
    </div>`
  }).join('')
  updateStatsUi()
}

function selectItem(id: string | undefined) {
  selectedId = id && sceneSpec.items.some(x => x.id === id) ? id : undefined
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const inst = selectedId ? instances.get(selectedId) : undefined
  viewport?.attachSelection(selectedId, inst?.wrapper, Boolean(item?.locked))
  syncSelectedTransformInputs()
  renderHierarchy()
}

function clearAllInstances() {
  viewport?.attachSelection(undefined, undefined)
  for (const inst of instances.values()) {
    viewport?.itemsRoot.remove(inst.wrapper)
    inst.dispose()
  }
  instances.clear()
}

async function mountSingleItem(item: AssemblyItem): Promise<BuiltAssemblyInstance | undefined> {
  if (!viewport) return undefined
  const revision = (mountRevisions.get(item) ?? 0) + 1
  mountRevisions.set(item, revision)
  const inst = await buildAssemblyItem(item, sharedTextures)
  if (mountRevisions.get(item) !== revision || !sceneSpec.items.includes(item)) {
    inst.dispose()
    return
  }
  const existing = instances.get(item.id)
  if (existing) {
    viewport.itemsRoot.remove(existing.wrapper)
    existing.dispose()
    instances.delete(item.id)
  }
  instances.set(item.id, inst)
  viewport.itemsRoot.add(inst.wrapper)
  return inst
}

async function rebuildAllItems(reframe = false) {
  const token = ++buildSeq
  clearAllInstances()
  if (!viewport) return
  viewport.setBackdrop(sceneSpec.backdrop, sceneSpec.lighting)
  viewport.setWind(sceneSpec.wind)
  rebuildGround(false)
  for (const item of sceneSpec.items) {
    if (token !== buildSeq) return
    await mountSingleItem(item)
  }
  if (token !== buildSeq) return
  viewport.refreshShadows()
  if (reframe) setAssemblyCamera(sceneSpec.cameraPreset ?? 'iso')
  selectItem(selectedId && instances.has(selectedId) ? selectedId : undefined)
  syncCasePills()
  syncGroundInputs()
  updateStatsUi()
  activityLog.info('scene', `组装场景加载完成：${sceneSpec.name}（${sceneSpec.items.length} 个资产）`, {
    name: sceneSpec.name,
    items: sceneSpec.items.length,
    backdrop: sceneSpec.backdrop,
    groundStyle: sceneSpec.ground.style,
  })
}

// ---- Item Operations (Add / Duplicate / Ground / Reseed / Mirror / Delete) -
function pickPlacementPosition(item: AssemblyItem): [number, number, number] {
  const limit = Math.max(1.5, sceneSpec.ground.size * 0.36)
  // Try origin first if unoccupied; otherwise spiral outward cleanly so multiple clicks never stack identically
  const candidates: [number, number][] = [[0, 0]]
  for (let ring = 1; ring <= 14; ring++) {
    const r = Math.min(limit, ring * 0.72)
    const ang = ring * 2.399963 // golden angle scatter
    candidates.push([Math.cos(ang) * r, Math.sin(ang) * r])
  }
  const minGap = item.kind === 'rock' || item.category === 'grass' || item.category === 'flower' ? 0.65 : 1.05
  for (const [cx, cz] of candidates) {
    const crowded = sceneSpec.items.some(other => Math.hypot(other.position[0] - cx, other.position[2] - cz) < minGap)
    if (!crowded) return [Number(cx.toFixed(2)), 0, Number(cz.toFixed(2))]
  }
  const idx = sceneSpec.items.length
  const ang = idx * 2.399963
  const r = Math.min(limit, 0.5 + (idx % 7) * 0.45)
  return [Number((Math.cos(ang) * r).toFixed(2)), 0, Number((Math.sin(ang) * r).toFixed(2))]
}

async function addAssetItem(templateItem: AssemblyItem, customPos?: [number, number, number]) {
  pushUndo()
  const item = cloneJson(templateItem)
  item.id = makeItemId(item.kind)
  item.position = customPos ?? pickPlacementPosition(item)
  sceneSpec.items.push(item)
  const inst = await mountSingleItem(item)
  if (inst && item.position[1] === 0 && Math.abs(inst.localMinY) > 0.002) {
    item.position[1] = Number((-inst.localMinY * item.scale[1]).toFixed(3))
    applyItemTransform(inst.wrapper, item)
  }
  viewport?.refreshShadows()
  selectItem(item.id)
  activityLog.action(`放置资产「${item.name}」`, { id: item.id, kind: item.kind, position: item.position }, 'scene')
  message(`已放置「${item.name}」（当前共 ${sceneSpec.items.length} 个资产）`)
}

async function duplicateItem(id: string) {
  const src = sceneSpec.items.find(x => x.id === id)
  if (!src) return
  pushUndo()
  const copy = cloneJson(src)
  copy.id = makeItemId(copy.kind)
  copy.name = `${src.name.replace(/\s+#\d+$/, '')} #${sceneSpec.items.length + 1}`
  copy.locked = false
  copy.position = [
    Number((src.position[0] + 0.65).toFixed(2)),
    src.position[1],
    Number((src.position[2] + 0.52).toFixed(2)),
  ]
  sceneSpec.items.push(copy)
  await mountSingleItem(copy)
  viewport?.refreshShadows()
  selectItem(copy.id)
  activityLog.action(`复制资产「${src.name}」→「${copy.name}」`, { srcId: id, newId: copy.id }, 'scene')
  message(`已复制「${copy.name}」`)
}

function groundSelectedItem() {
  if (!selectedId) return
  const item = sceneSpec.items.find(x => x.id === selectedId)
  const inst = instances.get(selectedId)
  if (!item || !inst || item.locked) return
  pushUndo()
  inst.wrapper.updateMatrixWorld(true)
  const box = new Box3().setFromObject(inst.wrapper)
  if (!box.isEmpty() && Number.isFinite(box.min.y)) {
    item.position[1] = Number((item.position[1] - box.min.y).toFixed(3))
    applyItemTransform(inst.wrapper, item)
    viewport?.refreshSelectionBox()
    viewport?.refreshShadows()
    syncSelectedTransformInputs()
    activityLog.action(`贴地「${item.name}」→ Y=${item.position[1]}m`, { id: item.id, y: item.position[1] }, 'scene')
    message(`已将「${item.name}」底部贴合地面`)
  }
}

async function reseedSelectedItem() {
  if (!selectedId) return
  const item = sceneSpec.items.find(x => x.id === selectedId)
  if (!item || item.locked) return
  pushUndo()
  const nextSeed = Math.floor(100 + Math.random() * 99800)
  if (item.kind === 'tree') {
    const t = item.payload as TreeSpec
    t.seed = nextSeed
    t.leaves = { ...t.leaves, leafSeed: nextSeed + 17 }
  } else if (item.kind === 'rock') {
    ;(item.payload as RockSpec).seed = nextSeed
  } else {
    const ai = item.payload as AiSceneSpec
    for (let i = 0; i < ai.parts.length; i++) {
      ai.parts[i].spec.seed = nextSeed + i * 31
    }
  }
  await mountSingleItem(item)
  viewport?.refreshShadows()
  selectItem(item.id)
  activityLog.action(`随机新造型「${item.name}」(seed=${nextSeed})`, { id: item.id, seed: nextSeed }, 'scene')
}

function mirrorSelectedItem() {
  if (!selectedId) return
  const item = sceneSpec.items.find(x => x.id === selectedId)
  const inst = instances.get(selectedId)
  if (!item || !inst || item.locked) return
  pushUndo()
  item.rotation[1] = Number((((item.rotation[1] + 180) % 360 + 540) % 360 - 180).toFixed(1))
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
  activityLog.action(`水平转向「${item.name}」→ ${item.rotation[1]}°`, { id: item.id }, 'scene')
}

function deleteItem(id: string) {
  const idx = sceneSpec.items.findIndex(x => x.id === id)
  if (idx < 0) return
  const removed = sceneSpec.items[idx]
  pushUndo()
  sceneSpec.items.splice(idx, 1)
  const inst = instances.get(id)
  if (inst) {
    viewport?.itemsRoot.remove(inst.wrapper)
    inst.dispose()
    instances.delete(id)
  }
  viewport?.refreshShadows()
  if (selectedId === id) selectItem(undefined)
  else renderHierarchy()
  activityLog.action(`删除场景资产「${removed.name}」`, { id, remaining: sceneSpec.items.length }, 'scene')
  message(`已移除「${removed.name}」`)
}

async function applyUndo() {
  const snap = undoStack.pop()
  if (!snap) return
  redoStack.push({ scene: cloneJson(sceneSpec), selectedId })
  sceneSpec = snap.scene
  selectedId = snap.selectedId
  syncHistoryButtons()
  await rebuildAllItems(false)
  message('已撤销上一步操作')
}

async function applyRedo() {
  const snap = redoStack.pop()
  if (!snap) return
  undoStack.push({ scene: cloneJson(sceneSpec), selectedId })
  sceneSpec = snap.scene
  selectedId = snap.selectedId
  syncHistoryButtons()
  await rebuildAllItems(false)
  message('已重做操作')
}

// ---- Left Asset Palette Rendering ------------------------------------------
interface PaletteEntry {
  key: string
  group: string
  name: string
  subtitle: string
  icon: string
  thumb?: string
  create: () => AssemblyItem
}

function buildPaletteEntries(tab: PaletteTab): PaletteEntry[] {
  const entries: PaletteEntry[] = []

  if (tab === 'featured') {
    // 1. User's own saved presets from Tree Studio & AI Mode (`user-presets/presets.json`)
    const savedPresets = presetStore.list()
    for (const p of savedPresets) {
      entries.push({
        key: `saved:${p.id}`,
        group: `★ 我的预设库（${savedPresets.length}）`,
        name: p.name,
        subtitle: `${p.kindLabel} · ${fmt.format(p.triangles)} 面`,
        icon: p.scope === 'ai' ? '✦' : '🌳',
        thumb: p.thumbnail || undefined,
        create: () => p.scope === 'ai'
          ? createAiItem((p as SavedPreset<AiSceneSpec>).payload, { name: p.name })
          : createTreeItem((p as SavedPreset<TreeSpec>).payload, { name: p.name }),
      })
    }
    // 2. Curated Ref 1 & Ref 2 stylized assets
    for (const c of curatedAssemblyAssets) {
      entries.push({
        key: c.id,
        group: '✿ 参考图精选资产',
        name: c.name,
        subtitle: c.subtitle,
        icon: categoryIcons[c.category],
        create: c.create,
      })
    }
    return entries
  }

  if (tab === 'trees') {
    for (const c of curatedAssemblyAssets.filter(x => x.category === 'tree' || x.category === 'deadwood')) {
      entries.push({
        key: c.id,
        group: '✿ 参考图精选树木 / 枯木',
        name: c.name,
        subtitle: c.subtitle,
        icon: categoryIcons[c.category],
        create: c.create,
      })
    }
    const treeIds = presetIds.filter(id => {
      const k = presets[id].kind
      return (k === 'broadleaf' || k === 'conifer' || k === 'palm') && !id.startsWith('shrub-') && id !== 'conifer-shrub'
    })
    for (const id of treeIds) {
      const over = treeDefaults.get(id)
      const base = over?.spec ?? presetSpec(id)
      entries.push({
        key: `tree:${id}`,
        group: '内置树木预设（自动同步已改默认）',
        name: over ? `${presets[id].name} · 已改` : presets[id].name,
        subtitle: base.kind === 'conifer' ? '针叶树' : base.kind === 'palm' ? '棕榈树' : '阔叶/观花树',
        icon: '🌳',
        create: () => createTreeItem(over?.spec ?? presetSpec(id), {
          name: presets[id].name,
          customTextures: over?.textures,
        }),
      })
    }
    return entries
  }

  if (tab === 'plants') {
    for (const c of curatedAssemblyAssets.filter(x => x.category === 'shrub' || x.category === 'grass' || x.category === 'flower')) {
      entries.push({
        key: c.id,
        group: '✿ 参考图精选灌木 / 花草',
        name: c.name,
        subtitle: c.subtitle,
        icon: categoryIcons[c.category],
        create: c.create,
      })
    }
    const lowIds = presetIds.filter(id =>
      id.startsWith('shrub-') || id === 'conifer-shrub' || presets[id].kind === 'grass' || presets[id].kind === 'fern' || presets[id].kind === 'flowerbed',
    )
    for (const id of lowIds) {
      const over = treeDefaults.get(id)
      const base = over?.spec ?? presetSpec(id)
      const cat = base.kind === 'flowerbed' ? 'flower' : base.kind === 'grass' || base.kind === 'fern' ? 'grass' : 'shrub'
      entries.push({
        key: `plant:${id}`,
        group: '内置灌木 / 草丛 / 花丛模板',
        name: over ? `${presets[id].name} · 已改` : presets[id].name,
        subtitle: categoryLabels[cat],
        icon: categoryIcons[cat],
        create: () => createTreeItem(over?.spec ?? presetSpec(id), {
          name: presets[id].name,
          category: cat,
          customTextures: over?.textures,
        }),
      })
    }
    return entries
  }

  // rocks tab
  for (const c of curatedAssemblyAssets.filter(x => x.category === 'rock')) {
    entries.push({
      key: c.id,
      group: '✿ 参考图精选石头',
      name: c.name,
      subtitle: c.subtitle,
      icon: '🪨',
      create: c.create,
    })
  }
  for (const id of rockPresetIds) {
    const over = rockDefaults.get(id)
    entries.push({
      key: `rock:${id}`,
      group: '石头工作台预设（自动同步已改默认）',
      name: over ? `${rockPresets[id].name} · 已改` : rockPresets[id].name,
      subtitle: rockPresets[id].style === 'cel' ? '赛璐璐风格' : '厚涂切面风格',
      icon: '🪨',
      create: () => createRockItem(over?.spec ?? rockPresetSpec(id), { name: rockPresets[id].name }),
    })
  }
  return entries
}

let activePaletteEntries: PaletteEntry[] = []

function renderPalette() {
  const kw = byId<HTMLInputElement>('as-palette-search').value.trim().toLowerCase()
  const raw = buildPaletteEntries(currentPaletteTab)
  activePaletteEntries = kw
    ? raw.filter(e => e.name.toLowerCase().includes(kw) || e.subtitle.toLowerCase().includes(kw) || e.group.toLowerCase().includes(kw))
    : raw
  const listEl = byId('as-palette-list')
  if (!activePaletteEntries.length) {
    listEl.innerHTML = '<div class="as-empty-sel">没有匹配的资产，试试清空搜索词或切换分类。</div>'
    return
  }
  let html = ''
  let lastGroup = ''
  for (const e of activePaletteEntries) {
    if (e.group !== lastGroup) {
      lastGroup = e.group
      html += `<div class="as-group-label">${esc(e.group)}</div>`
    }
    html += `<button type="button" class="as-asset-btn" data-add-key="${esc(e.key)}" title="点击放置「${esc(e.name)}」到场景">
      <div class="as-asset-icon">${e.thumb ? `<img src="${e.thumb}" alt="">` : e.icon}</div>
      <div class="as-asset-meta"><b>${esc(e.name)}</b><span>${esc(e.subtitle)}</span></div>
      <span class="as-asset-plus">＋</span>
    </button>`
  }
  listEl.innerHTML = html
}

byId('as-palette-list').addEventListener('click', ev => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-add-key]')
  if (!btn) return
  const entry = activePaletteEntries.find(e => e.key === btn.dataset.addKey)
  if (entry) void addAssetItem(entry.create())
})

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-ptab]')) {
  btn.onclick = () => {
    currentPaletteTab = btn.dataset.ptab as PaletteTab
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ptab]')) {
      b.setAttribute('aria-pressed', String(b.dataset.ptab === currentPaletteTab))
    }
    renderPalette()
  }
}
byId<HTMLInputElement>('as-palette-search').oninput = renderPalette

// ---- Built-in Case & Saved Scenes Drawer -----------------------------------
const casesDrawer = byId('as-cases-drawer')

function syncCasesBadge() {
  const mineCount = sceneStore.list().length
  byId('as-mine-cnt').textContent = String(mineCount)
  byId('as-cases-badge').textContent = String(builtInAssemblyCases.length + mineCount)
  byId('as-storage-info').innerHTML = sceneStore.storageMode === 'file'
    ? '<span class="pl-foot-dot"></span><span>本地落盘 user-presets/scenes.json</span>'
    : '<span class="pl-foot-dot"></span><span>浏览器本地持久存储</span>'
}

function refreshSceneCapture(forceName = false) {
  const capImg = byId<HTMLImageElement>('as-cap-img')
  const capName = byId<HTMLInputElement>('as-cap-name')
  const capMeta = byId('as-cap-meta')
  const owBtn = byId<HTMLButtonElement>('as-save-overwrite')
  if (viewport) {
    capImg.src = viewport.snapshotDataUrl('image/jpeg', 320, 220)
  }
  if (forceName || !capName.value.trim()) {
    capName.value = sceneSpec.name || '我的组装场景'
  }
  let totalTris = 0
  for (const inst of instances.values()) totalTris += inst.triangles
  capMeta.textContent = `${sceneSpec.items.length} 个资产 · ${fmt.format(totalTris)} 面`
  const activeSaved = activeSavedSceneId ? sceneStore.get(activeSavedSceneId) : undefined
  owBtn.hidden = !activeSaved
  if (activeSaved) owBtn.textContent = `覆盖「${activeSaved.name.slice(0, 8)}」`
}

function renderCasesGrid() {
  syncCasesBadge()
  const gridEl = byId('as-cases-grid')
  const emptyEl = byId('as-cases-empty')
  const saveBox = byId('as-save-box')
  saveBox.hidden = currentCasesTab === 'builtin'

  if (currentCasesTab === 'builtin') {
    emptyEl.hidden = true
    gridEl.innerHTML = builtInAssemblyCases.map(c => {
      const act = c.id === activeBuiltInCaseId ? 'is-active' : ''
      const thumbUrl = `./showcases/scene-${c.id}.jpg`
      return `<article class="pl-card ${act}" data-builtin-case="${esc(c.id)}">
        <div class="pl-card-thumb">
          <div class="pl-card-noimg">❖</div>
          <img src="${thumbUrl}" alt="${esc(c.name)}" loading="lazy" style="position:absolute;inset:0" onerror="this.remove()">
          <span class="pl-card-tag">${esc(c.tag)}</span>
        </div>
        <div class="pl-card-body">
          <div class="pl-card-title">${esc(c.name)}</div>
          <div class="pl-card-sub is-multi">${esc(c.subtitle)}</div>
          <div class="pl-card-actions">
            <button type="button" data-cact="load-builtin" data-cid="${esc(c.id)}">载入编辑</button>
            <button type="button" data-cact="fork-builtin" data-cid="${esc(c.id)}">★ 收藏</button>
          </div>
        </div>
      </article>`
    }).join('')
    return
  }

  const saved = sceneStore.list()
  emptyEl.hidden = saved.length > 0
  if (!saved.length) {
    gridEl.innerHTML = ''
    return
  }
  gridEl.innerHTML = saved.map(s => {
    const act = s.id === activeSavedSceneId ? 'is-active' : ''
    const isConf = confirmDeleteSceneId === s.id
    return `<article class="pl-card ${act}" data-saved-scene="${esc(s.id)}">
      <div class="pl-card-thumb">
        ${s.thumbnail ? `<img src="${s.thumbnail}" alt="${esc(s.name)}" loading="lazy">` : '<div class="pl-card-noimg">❖</div>'}
        <span class="pl-card-tag">${s.itemCount} 资产</span>
      </div>
      <div class="pl-card-body">
        <div class="pl-card-title">${esc(s.name)}</div>
        <div class="pl-card-sub">${fmt.format(s.triangles)} 面 · ${s.updatedAt.slice(5, 16).replace('T', ' ')}</div>
        <div class="pl-card-actions">
          <button type="button" data-cact="load-saved" data-cid="${esc(s.id)}">载入</button>
          <button type="button" data-cact="overwrite-saved" data-cid="${esc(s.id)}">更新</button>
          <button type="button" class="is-danger ${isConf ? 'is-confirm' : ''}" data-cact="del-saved" data-cid="${esc(s.id)}">${isConf ? '确认删' : '删除'}</button>
        </div>
      </div>
    </article>`
  }).join('')
}

function openCasesDrawer(tab: CasesTab, focusName = false) {
  activityLogDrawer.close()
  currentCasesTab = tab
  for (const b of casesDrawer.querySelectorAll<HTMLButtonElement>('[data-ctab]')) {
    b.setAttribute('aria-pressed', String(b.dataset.ctab === currentCasesTab))
  }
  casesDrawer.hidden = false
  if (tab === 'mine') {
    refreshSceneCapture(true)
    if (focusName) {
      const inp = byId<HTMLInputElement>('as-cap-name')
      inp.focus()
      inp.select()
    }
  }
  renderCasesGrid()
}

function closeCasesDrawer() {
  casesDrawer.hidden = true
  confirmDeleteSceneId = undefined
  if (confirmDeleteTimer) { clearTimeout(confirmDeleteTimer); confirmDeleteTimer = undefined }
}

async function loadBuiltInCase(id: string) {
  const entry = getBuiltInAssemblyCase(id)
  if (!entry) return
  undoStack.length = 0
  redoStack.length = 0
  syncHistoryButtons()
  sceneSpec = entry.build()
  selectedId = undefined
  activeBuiltInCaseId = entry.id
  refRevision++
  refFile.value = ''
  byId('as-ref-images').hidden = true
  byId('as-ref-status').textContent = ''
  activeSavedSceneId = undefined
  await rebuildAllItems(true)
  renderCasesGrid()
  message(`已加载「${entry.name}」（共 ${sceneSpec.items.length} 个独立可编辑资产）`)
}

async function saveCurrentSceneAsNew(customName?: string) {
  const name = (customName ?? byId<HTMLInputElement>('as-cap-name').value).trim() || sceneSpec.name || '我的组装场景'
  let totalTris = 0
  for (const inst of instances.values()) totalTris += inst.triangles
  const thumb = viewport ? viewport.snapshotDataUrl('image/jpeg', 320, 220) : ''
  const saved = await sceneStore.saveNew({
    name,
    description: sceneSpec.description,
    itemCount: sceneSpec.items.length,
    triangles: totalTris,
    thumbnail: thumb,
    scene: sceneSpec,
  })
  sceneSpec.name = saved.name
  activeSavedSceneId = saved.id
  activeBuiltInCaseId = undefined
  syncCasePills()
  refreshSceneCapture(false)
  renderCasesGrid()
  message(`已保存组装场景案例「${saved.name}」（${saved.itemCount} 个资产）`)
}

async function overwriteSavedScene(id: string, customName?: string) {
  let totalTris = 0
  for (const inst of instances.values()) totalTris += inst.triangles
  const thumb = viewport ? viewport.snapshotDataUrl('image/jpeg', 320, 220) : ''
  const updated = await sceneStore.overwrite(id, {
    name: customName,
    description: sceneSpec.description,
    itemCount: sceneSpec.items.length,
    triangles: totalTris,
    thumbnail: thumb,
    scene: sceneSpec,
  })
  sceneSpec.name = updated.name
  activeSavedSceneId = updated.id
  syncCasePills()
  refreshSceneCapture(false)
  renderCasesGrid()
  message(`已更新场景案例「${updated.name}」`)
}

// ---- Inspector & Toolbar Event Wiring --------------------------------------
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-quick-scene]')) {
  btn.onclick = () => { void loadBuiltInCase(btn.dataset.quickScene!) }
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-gizmo]')) {
  btn.onclick = () => {
    const mode = btn.dataset.gizmo as GizmoMode
    viewport?.setGizmoMode(mode)
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-gizmo]')) {
      b.setAttribute('aria-pressed', String(b.dataset.gizmo === mode))
    }
  }
}

function setAssemblyCamera(cam: AssemblyCameraPreset) {
  sceneSpec.cameraPreset = cam
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
    button.setAttribute('aria-pressed', String(button.dataset.camera === cam))
  }
  viewport?.frameScene(cam, sceneSpec.ground.size)
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
  btn.onclick = () => setAssemblyCamera(btn.dataset.camera as AssemblyCameraPreset)
}

byId('as-wind-btn').onclick = () => {
  sceneSpec.wind = !sceneSpec.wind
  byId('as-wind-btn').setAttribute('aria-pressed', String(sceneSpec.wind))
  viewport?.setWind(sceneSpec.wind)
}

byId<HTMLSelectElement>('as-backdrop').onchange = ev => {
  const theme = (ev.target as HTMLSelectElement).value as BackdropTheme
  sceneSpec.backdrop = theme
  sceneSpec.lighting = backdropMeta[theme].lighting
  viewport?.setBackdrop(theme, sceneSpec.lighting)
}

byId('as-tool-ground').onclick = groundSelectedItem
byId('as-act-ground').onclick = groundSelectedItem
byId('as-tool-dup').onclick = () => { if (selectedId) void duplicateItem(selectedId) }
byId('as-tool-focus').onclick = () => {
  const inst = selectedId ? instances.get(selectedId) : undefined
  if (inst) viewport?.focusObject(inst.wrapper)
}
byId('as-tool-del').onclick = () => { if (selectedId) deleteItem(selectedId) }
byId('as-act-del').onclick = () => { if (selectedId) deleteItem(selectedId) }
byId('as-act-reseed').onclick = () => { void reseedSelectedItem() }
byId('as-act-mirror').onclick = mirrorSelectedItem
byId('as-tool-undo').onclick = () => { void applyUndo() }
byId('as-tool-redo').onclick = () => { void applyRedo() }

// Selected item transform inputs
const bindTransformNumber = (id: string, apply: (item: AssemblyItem, val: number) => void) => {
  const inp = byId<HTMLInputElement>(id)
  inp.oninput = () => {
    const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
    const inst = selectedId ? instances.get(selectedId) : undefined
    const v = Number(inp.value)
    if (!item || !inst || item.locked || !Number.isFinite(v)) return
    apply(item, v)
    applyItemTransform(inst.wrapper, item)
    viewport?.refreshSelectionBox()
    viewport?.refreshShadows()
    syncSelectedTransformInputs()
  }
  inp.onchange = () => { if (selectedId) pushUndo() }
}

bindTransformNumber('as-px', (it, v) => { it.position[0] = v })
bindTransformNumber('as-py', (it, v) => { it.position[1] = v })
bindTransformNumber('as-pz', (it, v) => { it.position[2] = v })
bindTransformNumber('as-rx', (it, v) => { it.rotation[0] = v })
bindTransformNumber('as-ry', (it, v) => { it.rotation[1] = v })
bindTransformNumber('as-rz', (it, v) => { it.rotation[2] = v })
bindTransformNumber('as-sx', (it, v) => {
  const s = Math.max(0.05, Math.min(12, v))
  if (byId<HTMLInputElement>('as-scale-lock').checked) it.scale = [s, s, s]
  else it.scale[0] = s
})
bindTransformNumber('as-sy', (it, v) => {
  const s = Math.max(0.05, Math.min(12, v))
  if (byId<HTMLInputElement>('as-scale-lock').checked) it.scale = [s, s, s]
  else it.scale[1] = s
})
bindTransformNumber('as-sz', (it, v) => {
  const s = Math.max(0.05, Math.min(12, v))
  if (byId<HTMLInputElement>('as-scale-lock').checked) it.scale = [s, s, s]
  else it.scale[2] = s
})

byId<HTMLInputElement>('as-ry-range').oninput = ev => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const inst = selectedId ? instances.get(selectedId) : undefined
  if (!item || !inst || item.locked) return
  item.rotation[1] = Number((ev.target as HTMLInputElement).value)
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
}
byId<HTMLInputElement>('as-ry-range').onchange = () => { if (selectedId) pushUndo() }

byId<HTMLInputElement>('as-scale-range').oninput = ev => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const inst = selectedId ? instances.get(selectedId) : undefined
  if (!item || !inst || item.locked) return
  const s = Math.max(0.05, Number((ev.target as HTMLInputElement).value))
  item.scale = [s, s, s]
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
}
byId<HTMLInputElement>('as-scale-range').onchange = () => { if (selectedId) pushUndo() }

byId<HTMLInputElement>('as-sel-name').onchange = ev => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  if (!item) return
  const trimmed = (ev.target as HTMLInputElement).value.trim()
  if (trimmed) {
    pushUndo()
    item.name = trimmed.slice(0, 64)
    const inst = instances.get(item.id)
    if (inst) inst.wrapper.name = item.name
    renderHierarchy()
  }
}

byId('as-pos-zero').onclick = () => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const inst = selectedId ? instances.get(selectedId) : undefined
  if (!item || !inst || item.locked) return
  pushUndo()
  item.position = [0, 0, 0]
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
}
byId('as-rot-45').onclick = () => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const inst = selectedId ? instances.get(selectedId) : undefined
  if (!item || !inst || item.locked) return
  pushUndo()
  item.rotation[1] = Number((((item.rotation[1] + 45 + 180) % 360 + 360) % 360 - 180).toFixed(1))
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
}
byId('as-rot-rand').onclick = () => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const inst = selectedId ? instances.get(selectedId) : undefined
  if (!item || !inst || item.locked) return
  pushUndo()
  item.rotation[1] = Math.round(Math.random() * 360 - 180)
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
}
byId('as-rot-zero').onclick = () => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const inst = selectedId ? instances.get(selectedId) : undefined
  if (!item || !inst || item.locked) return
  pushUndo()
  item.rotation = [0, 0, 0]
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
}

async function setCrownStyle(id: string | undefined, style: 'painted' | 'default') {
  const item = sceneSpec.items.find(x => x.id === id)
  if (!item || item.kind !== 'tree' || (item.payload as TreeSpec).kind !== 'broadleaf' || item.locked || (item.crownStyle ?? 'default') === style) return
  pushUndo()
  item.crownStyle = style === 'painted' ? style : undefined
  await mountSingleItem(item)
  viewport?.refreshShadows()
  if (selectedId === item.id) selectItem(item.id)
}

byId<HTMLSelectElement>('as-crown-style').onchange = ev => setCrownStyle(selectedId, (ev.target as HTMLSelectElement).value === 'painted' ? 'painted' : 'default')

byId<HTMLSelectElement>('as-bark-style').onchange = async ev => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  if (!item || item.kind !== 'tree') return
  pushUndo()
  const style = (ev.target as HTMLSelectElement).value as AssemblyBarkStyle
  item.barkStyle = style === 'default' ? undefined : style
  await mountSingleItem(item)
  viewport?.refreshShadows()
  selectItem(item.id)
}

// Hierarchy click handling
byId('as-hier-list').addEventListener('click', ev => {
  const target = ev.target as HTMLElement
  const btn = target.closest<HTMLButtonElement>('button[data-hact]')
  if (btn) {
    ev.stopPropagation()
    const id = btn.dataset.hid!
    const act = btn.dataset.hact
    const item = sceneSpec.items.find(x => x.id === id)
    if (!item) return
    if (act === 'vis') {
      pushUndo()
      item.visible = !item.visible
      const inst = instances.get(id)
      if (inst) inst.wrapper.visible = item.visible
      if (selectedId === id && !item.visible) viewport?.attachSelection(undefined, undefined)
      else if (selectedId === id && inst) viewport?.attachSelection(id, inst.wrapper, item.locked)
      viewport?.refreshShadows()
      renderHierarchy()
    } else if (act === 'lock') {
      pushUndo()
      item.locked = !item.locked
      if (selectedId === id) {
        const inst = instances.get(id)
        viewport?.attachSelection(id, inst?.wrapper, item.locked)
        syncSelectedTransformInputs()
      }
      renderHierarchy()
    } else if (act === 'dup') {
      void duplicateItem(id)
    } else if (act === 'del') {
      deleteItem(id)
    }
    return
  }
  const row = target.closest<HTMLElement>('.as-hier-item[data-hid]')
  if (row?.dataset.hid) selectItem(row.dataset.hid)
})

// Ground controls
const updateGround = (mut: () => void, reframeShadow = true) => {
  mut()
  syncGroundInputs()
  rebuildGround(reframeShadow)
}
byId<HTMLSelectElement>('as-g-style').onchange = ev => {
  pushUndo()
  updateGround(() => { sceneSpec.ground.style = (ev.target as HTMLSelectElement).value as GroundStyle })
}
byId<HTMLSelectElement>('as-g-path').onchange = ev => {
  pushUndo()
  updateGround(() => { sceneSpec.ground.pathLayout = (ev.target as HTMLSelectElement).value as PathLayout })
}
byId<HTMLInputElement>('as-g-size').oninput = ev => {
  updateGround(() => { sceneSpec.ground.size = Number((ev.target as HTMLInputElement).value) })
}
byId<HTMLInputElement>('as-g-size').onchange = () => pushUndo()
byId<HTMLInputElement>('as-g-pwidth').oninput = ev => {
  updateGround(() => { sceneSpec.ground.pathWidth = Number((ev.target as HTMLInputElement).value) }, false)
}
byId<HTMLInputElement>('as-g-pwidth').onchange = () => pushUndo()
byId<HTMLInputElement>('as-g-grass').oninput = ev => {
  updateGround(() => { sceneSpec.ground.grassColor = (ev.target as HTMLInputElement).value }, false)
}
byId<HTMLInputElement>('as-g-hi').oninput = ev => {
  updateGround(() => { sceneSpec.ground.grassHighlight = (ev.target as HTMLInputElement).value }, false)
}
byId<HTMLInputElement>('as-g-sh').oninput = ev => {
  updateGround(() => { sceneSpec.ground.grassShadow = (ev.target as HTMLInputElement).value }, false)
}
byId<HTMLInputElement>('as-g-pcol').oninput = ev => {
  updateGround(() => { sceneSpec.ground.pathColor = (ev.target as HTMLInputElement).value }, false)
}

// Cases drawer events
byId('as-cases-btn').onclick = () => {
  if (!casesDrawer.hidden && currentCasesTab === 'builtin') closeCasesDrawer()
  else openCasesDrawer('builtin')
}
byId('as-save-btn').onclick = () => openCasesDrawer('mine', true)
byId('as-cases-close').onclick = closeCasesDrawer
for (const b of casesDrawer.querySelectorAll<HTMLButtonElement>('[data-ctab]')) {
  b.onclick = () => openCasesDrawer(b.dataset.ctab as CasesTab)
}
byId('as-cap-refresh').onclick = () => { refreshSceneCapture(false); message('已按当前视角刷新封面') }
byId('as-save-new').onclick = () => { void saveCurrentSceneAsNew().catch(e => message(e, true)) }
byId('as-save-overwrite').onclick = () => {
  if (activeSavedSceneId) void overwriteSavedScene(activeSavedSceneId, byId<HTMLInputElement>('as-cap-name').value.trim() || undefined).catch(e => message(e, true))
}

byId('as-cases-grid').addEventListener('click', async ev => {
  const target = ev.target as HTMLElement
  const btn = target.closest<HTMLButtonElement>('button[data-cact]')
  if (btn) {
    ev.stopPropagation()
    const act = btn.dataset.cact
    const cid = btn.dataset.cid!
    if (act === 'load-builtin') {
      await loadBuiltInCase(cid)
      closeCasesDrawer()
    } else if (act === 'fork-builtin') {
      await loadBuiltInCase(cid)
      await saveCurrentSceneAsNew(sceneSpec.name)
      openCasesDrawer('mine')
    } else if (act === 'load-saved') {
      const saved = sceneStore.get(cid)
      if (saved) {
        undoStack.length = 0
        redoStack.length = 0
        syncHistoryButtons()
        sceneSpec = parseAssemblyScene(cloneJson(saved.scene))
        selectedId = undefined
        activeBuiltInCaseId = undefined
        activeSavedSceneId = saved.id
        await rebuildAllItems(true)
        closeCasesDrawer()
        message(`已载入场景案例「${saved.name}」`)
      }
    } else if (act === 'overwrite-saved') {
      await overwriteSavedScene(cid)
    } else if (act === 'del-saved') {
      if (confirmDeleteSceneId !== cid) {
        confirmDeleteSceneId = cid
        if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer)
        confirmDeleteTimer = setTimeout(() => { confirmDeleteSceneId = undefined; renderCasesGrid() }, 3200)
        renderCasesGrid()
      } else {
        if (confirmDeleteTimer) { clearTimeout(confirmDeleteTimer); confirmDeleteTimer = undefined }
        confirmDeleteSceneId = undefined
        const s = sceneStore.get(cid)
        await sceneStore.remove(cid)
        if (activeSavedSceneId === cid) activeSavedSceneId = undefined
        renderCasesGrid()
        if (s) message(`已删除场景案例「${s.name}」`)
      }
    }
    return
  }
  const bCard = target.closest<HTMLElement>('[data-builtin-case]')
  if (bCard?.dataset.builtinCase) {
    await loadBuiltInCase(bCard.dataset.builtinCase)
    closeCasesDrawer()
    return
  }
  const sCard = target.closest<HTMLElement>('[data-saved-scene]')
  if (sCard?.dataset.savedScene) {
    const saved = sceneStore.get(sCard.dataset.savedScene)
    if (saved) {
      sceneSpec = parseAssemblyScene(cloneJson(saved.scene))
      selectedId = undefined
      activeBuiltInCaseId = undefined
      activeSavedSceneId = saved.id
      await rebuildAllItems(true)
      closeCasesDrawer()
      message(`已载入场景案例「${saved.name}」`)
    }
  }
})

// Clear, JSON import/export, Asset JSON import, PNG snapshot, GLB export
byId('as-clear-btn').onclick = async () => {
  if (!sceneSpec.items.length) { message('当前画布已经是空的'); return }
  pushUndo()
  sceneSpec.items = []
  selectedId = undefined
  activeBuiltInCaseId = undefined
  await rebuildAllItems(false)
  message('已清空场景中的所有资产（可按 Ctrl+Z 撤销）')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const safeFileSlug = () => (sceneSpec.name || 'assembly-scene').replace(/[^\w\u4e00-\u9fa5-]+/g, '_')

byId('as-json-btn').onclick = () => {
  const blob = new Blob([JSON.stringify(sceneSpec, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `${safeFileSlug()}.scene.json`)
  message(`已保存组装场景 JSON（${sceneSpec.items.length} 个资产）`)
}

const handleJsonFile = async (file: File) => {
  try {
    const parsed = detectImportedAssetJson(JSON.parse(await file.text()))
    if (parsed.type === 'assembly') {
      pushUndo()
      sceneSpec = parsed.scene
      selectedId = undefined
      activeBuiltInCaseId = undefined
      activeSavedSceneId = undefined
      await rebuildAllItems(true)
      message(`已导入完整组装场景「${sceneSpec.name}」（${sceneSpec.items.length} 个资产）`)
    } else {
      await addAssetItem(parsed.item)
    }
  } catch (err) {
    message(err instanceof Error ? err.message : String(err), true)
  }
}

const sceneFileInput = byId<HTMLInputElement>('as-scene-file')
const assetFileInput = byId<HTMLInputElement>('as-asset-file')
byId('as-import-btn').onclick = () => sceneFileInput.click()
byId('as-import-asset-btn').onclick = () => assetFileInput.click()
sceneFileInput.onchange = async () => {
  const f = sceneFileInput.files?.[0]
  if (f) await handleJsonFile(f)
  sceneFileInput.value = ''
}
assetFileInput.onchange = async () => {
  const f = assetFileInput.files?.[0]
  if (f) await handleJsonFile(f)
  assetFileInput.value = ''
}

async function compareReference(src: string) {
  if (!viewport) throw new Error('三维视口尚未就绪')
  return compareSceneReference(src, viewport.snapshotDataUrl('image/png'))
}
async function refreshReference() {
  const rev = ++refRevision
  const file = refFile.files?.[0]
  const builtIn = activeBuiltInCaseId && getBuiltInAssemblyCase(activeBuiltInCaseId)
  refCheck.disabled = !file && !builtIn
  byId('as-ref-images').hidden = true
  byId('as-ref-status').textContent = ''
  if (!file && !builtIn) return
  const src = file ? URL.createObjectURL(file) : `./showcases/reference-${activeBuiltInCaseId}.jpg`
  try {
    const result = await compareReference(src)
    if (rev !== refRevision) return
    const images = byId('as-ref-images').querySelectorAll('img')
    ;[result.reference, result.render, result.difference].forEach((url, i) => { images[i].src = url })
    byId('as-ref-images').hidden = false
    byId('as-ref-status').textContent = `外形重合 ${Math.round(result.silhouetteIoU * 100)}% · 粉色缺失，青色多出`
  } catch {
    if (rev === refRevision) byId('as-ref-status').textContent = '无法提取主体，请使用纯色或透明背景的单张场景图。'
  } finally {
    if (file) URL.revokeObjectURL(src)
  }
}
refFile.onchange = refreshReference
refCheck.onclick = refreshReference

byId('as-png-btn').onclick = () => {
  if (!viewport) return
  const a = document.createElement('a')
  a.href = viewport.snapshotDataUrl('image/png')
  a.download = `${safeFileSlug()}.png`
  a.click()
  message('已保存场景 3D 截图 PNG')
}

bindGlbExportPopover({
  triggerButton: byId<HTMLButtonElement>('glb'),
  getRoot: () => (sceneSpec.items.length > 0 || sceneSpec.ground.style !== 'none') ? viewport?.exportGroup : undefined,
  exportBlob: opts => exportGlb(viewport!.exportGroup, opts),
  getFilename: opts => `${safeFileSlug()}${opts.mode === 'merged' ? '-merged' : ''}.glb`,
  saveBlob: downloadBlob,
  message,
  emptyMessage: '当前组装场景为空，请先放置资产或启用地块',
})

// Activity Log Drawer
const activityLogDrawer = mountActivityLogDrawer({
  triggerButton: byId<HTMLButtonElement>('activity-log-btn'),
  badgeElement: byId('al-badge'),
  onBeforeOpen: () => closeCasesDrawer(),
  message: (text, err) => message(text, err, false),
})

// Keyboard shortcuts (W/E/R/G/F/Delete/Ctrl+D/Ctrl+Z/Ctrl+Y/Escape)
window.addEventListener('keydown', ev => {
  const tag = (ev.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  const key = ev.key.toLowerCase()
  if ((ev.ctrlKey || ev.metaKey) && key === 'z') {
    ev.preventDefault()
    if (ev.shiftKey) void applyRedo()
    else void applyUndo()
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && key === 'y') {
    ev.preventDefault()
    void applyRedo()
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && key === 'd') {
    if (selectedId) {
      ev.preventDefault()
      void duplicateItem(selectedId)
    }
    return
  }
  if (key === 'w') document.querySelector<HTMLButtonElement>('[data-gizmo="translate"]')?.click()
  else if (key === 'e') document.querySelector<HTMLButtonElement>('[data-gizmo="rotate"]')?.click()
  else if (key === 'r') document.querySelector<HTMLButtonElement>('[data-gizmo="scale"]')?.click()
  else if (key === 'g') groundSelectedItem()
  else if (key === 'f') {
    const inst = selectedId ? instances.get(selectedId) : undefined
    if (inst) viewport?.focusObject(inst.wrapper)
  } else if (key === 'delete' || key === 'backspace') {
    if (selectedId) { ev.preventDefault(); deleteItem(selectedId) }
  } else if (key === 'escape') {
    if (!casesDrawer.hidden) closeCasesDrawer()
    else selectItem(undefined)
  }
})

// Store subscriptions
presetStore.subscribe(renderPalette)
treeDefaults.subscribe(renderPalette)
rockDefaults.subscribe(renderPalette)
sceneStore.subscribe(() => { syncCasesBadge(); if (!casesDrawer.hidden) renderCasesGrid() })

void Promise.all([presetStore.ready(), treeDefaults.ready(), rockDefaults.ready(), sceneStore.ready()]).then(() => {
  renderPalette()
  syncCasesBadge()
})

// Boot with requested case (?case=boulder-trail | ?case=blank | default: birch-meadow Ref 1!)
const initialCase = new URL(location.href).searchParams.get('case')
const bootPromise = initialCase === 'blank'
  ? rebuildAllItems(true)
  : loadBuiltInCase(initialCase && getBuiltInAssemblyCase(initialCase) ? initialCase : builtInAssemblyCases[0].id)

renderPalette()
syncCasesBadge()

// Expose automation & debugging API
Object.assign(window, {
  __activityLog: {
    store: activityLog,
    open: () => activityLogDrawer.open(),
    close: () => activityLogDrawer.close(),
    entries: () => activityLog.entries(),
    counts: () => activityLog.counts(),
    exportJson: () => activityLog.exportJson(),
    exportText: () => activityLog.exportText(),
    clear: () => activityLog.clear(),
  },
  __sceneStudio: {
    get scene() { return sceneSpec },
    get selectedId() { return selectedId },
    ready: () => bootPromise.then(() => Promise.all([presetStore.ready(), sceneStore.ready()])),
    loadCase: (id: string) => loadBuiltInCase(id),
    select: (id?: string) => selectItem(id),
    setGizmo: (m: GizmoMode) => { viewport?.setGizmoMode(m) },
    groundSelected: () => groundSelectedItem(),
    duplicateSelected: () => (selectedId ? duplicateItem(selectedId) : Promise.resolve()),
    deleteSelected: () => { if (selectedId) deleteItem(selectedId) },
    addCurated: (curatedId: string, pos?: [number, number, number]) => {
      const hit = curatedAssemblyAssets.find(c => c.id === curatedId)
      return hit ? addAssetItem(hit.create(), pos) : Promise.resolve()
    },
    setItemTransform(id: string, patch: Partial<Pick<AssemblyItem, 'position' | 'rotation' | 'scale'>>) {
      const item = sceneSpec.items.find(x => x.id === id)
      const inst = instances.get(id)
      if (!item || !inst) return
      if (patch.position) item.position = [...patch.position]
      if (patch.rotation) item.rotation = [...patch.rotation]
      if (patch.scale) item.scale = [...patch.scale]
      applyItemTransform(inst.wrapper, item)
      viewport?.refreshSelectionBox()
      viewport?.refreshShadows()
      if (selectedId === id) syncSelectedTransformInputs()
    },
    setCamera: setAssemblyCamera,
    setBackdrop: (theme: BackdropTheme) => {
      sceneSpec.backdrop = theme
      sceneSpec.lighting = backdropMeta[theme].lighting
      viewport?.setBackdrop(theme, sceneSpec.lighting)
      syncGroundInputs()
    },
    setWind: (on: boolean) => { sceneSpec.wind = on; viewport?.setWind(on) },
    compareReference,
    setCrownStyle,
    snapshot: () => viewport?.snapshotDataUrl('image/png') ?? '',
    snapshotThumb: () => viewport?.snapshotDataUrl('image/jpeg', 320, 220) ?? '',
    saveScene: (name?: string) => saveCurrentSceneAsNew(name),
    savedScenes: () => sceneStore.list(),
    removeSavedScene: (id: string) => sceneStore.remove(id),
    openCases: (tab: CasesTab = 'builtin') => openCasesDrawer(tab),
    closeCases: () => closeCasesDrawer(),
    stats: () => ({
      items: sceneSpec.items.length,
      triangles: [...instances.values()].reduce((s, i) => s + i.triangles, 0),
    }),
  },
})
