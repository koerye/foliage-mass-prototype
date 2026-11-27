import '../style.css'
import '../studio/studio.css'
import '../studio/presets.css'
import './rock.css'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Sphere,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three'
import { createHiddenShowcaseStore } from '../ai/showcase-store'
import { defaultPolyCRockSpec, parsePolyCRockSpec, polyCRockPresetIds, polyCRockPresets, type PolyCRockSpec } from '../assembly/spec'
import { exportGlb } from '../export-glb'
import type { RockV2BakeDiagnostics, RockV2BrushMode } from '../rock-v2/bake'
import {
  decodePhotoCraftPbrFiles,
  loadDefaultPhotoCraftPbrLayers,
  type ExternalPbrLayers,
} from '../rock-v2/photocraft-pbr'
import { PolyCWorkerClient, type PolyCJobMeta } from '../rock-v2/poly-c-client'
import type { PolyCWorkerBakeResponse, PolyCWorkerPreviewResponse } from '../rock-v2/poly-c.worker'
import PolyCWorker from '../rock-v2/poly-c.worker?worker&inline'
import type { PolyCsgPresetId } from '../rock-v2/poly-csg'
import type { PolyBakeStats, PolyPbrMode, PolyUvAudit } from '../rock-v2/poly-pbr'
import type { RockV2WorkerBakeResponse, RockV2WorkerPreviewResponse } from '../rock-v2/rock-v2.worker'
import RockV2Worker from '../rock-v2/rock-v2.worker?worker&inline'
import type { RockV2ArchetypeId, RockV2SculptParams } from '../rock-v2/sdf'
import { RockV2WorkerClient, type RockV2JobMeta } from '../rock-v2/worker-client'
import { activityLog, initStudioLogging } from '../studio/activity-log'
import { mountActivityLogDrawer } from '../studio/activity-log-ui'
import { mountDesktopToolbarBadge, tryDesktopSaveBlob } from '../studio/desktop-bridge'
import { SnapshotHistory } from '../studio/history'
import { createDefaultOverrideStore } from '../studio/default-overrides'
import { bindGlbExportPopover } from '../studio/glb-export-ui'
import { mountPresetLibrary, type ShowcaseOption } from '../studio/preset-library'
import { captureViewportThumbnail, createPresetStore, deepClone, type SavedPreset } from '../studio/preset-store'
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
  'cel-anime-rock': '卡通',
  'boulder-chiseled': '精雕',
  'boulder-slab': '厚涂',
  'mossy-forest-rock': '青苔',
  'rock-cluster': '石堆',
  'handpainted-wedge': '手绘',
  'handpainted-twin-slab': '手绘',
  'handpainted-block-bluff': '手绘',
  'handpainted-layered-ridge': '手绘',
  'handpainted-crag-spire': '手绘',
  'handpainted-monolith': '手绘',
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
      { kind: 'range', path: 'shape.width', label: '宽度 m', min: 0.4, max: 4.0, step: 0.01 },
      { kind: 'range', path: 'shape.height', label: '高度 m', min: 0.35, max: 3.5, step: 0.01 },
      { kind: 'range', path: 'shape.depth', label: '纵深 m', min: 0.4, max: 4.0, step: 0.01 },
      { kind: 'range', path: 'shape.facetCount', label: '切面数量', min: 6, max: 26, step: 1 },
      { kind: 'range', path: 'shape.flatness', label: '平面宽阔度', min: 0, max: 1, step: 0.01 },
      { kind: 'range', path: 'shape.bevel', label: '棱边倒角', min: 0, max: 0.32, step: 0.005 },
      { kind: 'range', path: 'shape.asymmetry', label: '非对称造型', min: 0, max: 1, step: 0.01 },
      { kind: 'range', path: 'shape.taperTop', label: '顶部收窄', min: -0.35, max: 0.85, step: 0.01 },
      { kind: 'range', path: 'shape.bottomFlat', label: '底面压平', min: 0, max: 1, step: 0.01 },
      { kind: 'range', path: 'shape.slabs', label: '叠层块数', min: 1, max: 3, step: 1 },
    ],
  },
  {
    title: '雕刻与细节',
    open: true,
    fields: [
      { kind: 'subdiv', path: 'detail.subdivisions', label: '网格细分' },
      { kind: 'range', path: 'detail.chisel', label: '二次凿痕', min: 0, max: 1, step: 0.01 },
      { kind: 'range', path: 'detail.undulation', label: '表面起伏', min: 0, max: 1, step: 0.01 },
      { kind: 'range', path: 'detail.cracks', label: '裂纹层理', min: 0, max: 1, step: 0.01 },
      { kind: 'range', path: 'detail.sharpness', label: '棱面锐利度', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: '材质与棱边着色',
    open: true,
    fields: [
      { kind: 'color', path: 'shading.baseColor', label: '石体基色', live: true },
      { kind: 'color', path: 'shading.shadowColor', label: '暗部冷影', live: true },
      { kind: 'color', path: 'shading.edgeColor', label: '棱边高光色', live: true },
      { kind: 'range', path: 'shading.edgeWear', label: '棱边提亮', min: 0, max: 1, step: 0.01, live: true },
      { kind: 'range', path: 'shading.edgeBreakup', label: '高光断续感', min: 0, max: 1, step: 0.01, live: true },
      { kind: 'range', path: 'shading.cavityAO', label: '凹缝暗影', min: 0, max: 1, step: 0.01, live: true },
      { kind: 'range', path: 'shading.facetVariation', label: '切面明暗差', min: 0, max: 1, step: 0.01, live: true },
      { kind: 'range', path: 'shading.grain', label: '手绘颗粒感', min: 0, max: 1, step: 0.01, live: true },
      { kind: 'range', path: 'shading.roughness', label: '表面粗糙度', min: 0.25, max: 1, step: 0.01, live: true },
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
      { kind: 'range', path: 'top.coverage', label: '覆盖范围', min: 0, max: 1, step: 0.01, live: true },
      { kind: 'range', path: 'top.softness', label: '过渡柔和度', min: 0.05, max: 0.65, step: 0.01, live: true },
      { kind: 'range', path: 'cluster.count', label: '石块数量', min: 1, max: 5, step: 1 },
      { kind: 'range', path: 'cluster.spread', label: '石堆间距', min: 0.45, max: 1.8, step: 0.01 },
      { kind: 'range', path: 'cluster.scaleDecay', label: '副石比例', min: 0.3, max: 0.85, step: 0.01 },
      { kind: 'range', path: 'cluster.pebbles', label: '底座碎石', min: 0, max: 6, step: 1 },
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
  <div class="brand"><span class="mark rk-mark" aria-hidden="true">◈</span><div><h1>Rock Studio</h1><span>切面 · 手绘裂纹 · 赛璐璐</span></div></div>
  <nav aria-label="项目操作">
    <a class="b-link" href="./broadleaf.html" title="返回程序化树木工作台">← 树木工作台</a>
    <a class="b-link" href="./ai.html" title="前往 AI 模式空白工程">✦ AI 模式</a>
    <a class="b-link" href="./scene.html" title="场景组装工作台 · 自由摆放树木花草石头查看整体效果">❖ 场景组装</a>
    <button id="rk-quick-reseed" title="随机生成新外形">🎲 随机石形</button>
    <button id="rk-save-preset" class="pl-save-btn" title="将当前石头（支持传统岩与路线 C2 岩）带 3D 缩略图保存到预设库">★ 保存预设</button>
    <button id="rk-open-presets" title="管理石头预设库：单击预览、改名、覆盖、删除与内置预设管理">预设库<span class="pl-badge" id="rk-preset-count">0</span></button>
    <input id="file" type="file" accept=".json,application/json" hidden>
    <button id="import">导入 JSON</button>
    <button id="json">保存 JSON</button>
    <button id="png">截图 PNG</button>
    <button id="png-alpha" title="导出透明背景抠图 PNG（自动隐藏背景与阴影底板）">透明底 PNG</button>
    <button id="glb" class="primary" title="导出 GLB / 拆分 glTF+贴图 / FBX+TEX">导出 GLB/FBX</button>
    <button id="activity-log-btn" class="al-open-btn" title="查看每一步用户操作与导出诊断日志（支持一键复制/导出排查问题）">📋 日志<span class="pl-badge" id="al-badge">0</span></button>
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
      <div class="rk-preset-grid" id="rk-preset-grid" role="group" aria-label="石头预设">
        ${rockPresetIds.map(id => `<button type="button" class="rk-preset-btn" data-preset="${id}" aria-pressed="false"><span>${rockPresets[id].name}</span><span class="rk-preset-tag">${presetBadges[id]}</span></button>`).join('')}
      </div>
      <div class="rk-hidden-restore" id="rk-hidden-restore" hidden>
        <span id="rk-hidden-restore-text">已隐藏内置预设</span>
        <button type="button" id="rk-hidden-restore-btn">↺ 恢复全部</button>
      </div>
      <button type="button" id="rk-sdf-proto-btn" class="rk-sdf-btn" aria-pressed="false" title="路线 B 单偏心母体减切 SDF + Surface Nets + 512 标准 PBR Worker 实验入口">
        <span>🧪 路线 B · SDF 雕刻实验</span><span class="rk-preset-tag">方案 B · 512 PBR</span>
      </button>
      <button type="button" id="rk-polyc-proto-btn" class="rk-polyc-btn" aria-pressed="false" title="路线 C2 显式多面体布尔（Manifold WASM）+ 表面直烘 512 PBR 三预设实验入口">
        <span>💎 路线 C2 · 显式布尔实验</span><span class="rk-preset-tag">三预设 · 512 PBR</span>
      </button>
      <div id="rk-polyc-proto-box" class="rk-polyc-box" hidden>
        <div class="rk-polyc-banner" id="rk-polyc-banner">路线 C2 显式布尔实验（离线 Manifold + 折痕 UV 拆分 + 表面直烘 512 PBR · 拖拽灰模预览 / 松手 512 材质）</div>
        <div class="rk-polyc-mode-tabs" role="group" aria-label="C2 石型预设">
          <button type="button" data-polyc-preset="sandstone-ledge-c2" aria-pressed="true">低矮横展砂岩</button>
          <button type="button" data-polyc-preset="block-bluff-c2" aria-pressed="false">阶梯方巨岩</button>
          <button type="button" data-polyc-preset="terraced-moss-bluff-c2" aria-pressed="false">苔藓层叠巨岩</button>
        </div>
        <div class="rk-polyc-mode-tabs" role="group" aria-label="C2 材质模式">
          <button type="button" data-polyc-mode="photocraft-pbr" aria-pressed="false" title="使用 PhotoCraft Material Studio 制作的无接缝 1024 手绘砂岩+天鹅绒苔藓 PBR 贴图组（支持一键导入替换）">🎨 PhotoCraft</button>
          <button type="button" data-polyc-mode="shallow-detail" aria-pressed="true" title="旧版内置程序面内层理 PBR（便于前后对比）">旧程序浅细节</button>
          <button type="button" data-polyc-mode="baseline" aria-pressed="false" title="纯平坦法线诊断基线">材质基线</button>
        </div>
        <div class="rk-pc-import-box" id="rk-pc-import-box" hidden>
          <div class="rk-pc-import-head">
            <span id="rk-pc-import-label">🎨 PhotoCraft · 层叠砂岩 + 苔藓 PBR</span>
          </div>
          <div class="rk-pc-import-row">
            <input id="polyc-pc-stone-file" type="file" accept=".png,.jpg,.jpeg,.webp" multiple hidden>
            <input id="polyc-pc-moss-file" type="file" accept=".png,.jpg,.jpeg,.webp" multiple hidden>
            <button type="button" id="polyc-pc-stone-btn" title="可一次多选 PhotoCraft 导出的 base_color / normal / roughness / ao PNG 替换石体 PBR">📂 导入石体 PBR</button>
            <button type="button" id="polyc-pc-moss-btn" title="可一次多选 PhotoCraft 导出的 base_color / normal / roughness / ao PNG 替换苔藓 PBR">🌿 导入苔藓 PBR</button>
            <button type="button" id="polyc-pc-reset-btn" title="恢复内置 PhotoCraft 精绘砂岩与苔藓 PBR" hidden>↺ 恢复内置</button>
          </div>
        </div>
        <label class="s-field s-top"><span>随机种子</span><input id="polyc-seed" type="number" min="0" step="1" value="5104"><button type="button" id="polyc-reseed" title="随机路线 C2 种子">🎲</button></label>
        <label class="s-field"><span>肩台切深</span><input type="range" data-polyc-r="shoulderDepth" min="0.65" max="1.35" step="0.02" value="1.0"><input type="number" data-polyc-n="shoulderDepth" min="0.65" max="1.35" step="0.02" value="1.0"></label>
        <label class="s-field"><span>局部倒角</span><input type="range" data-polyc-r="bevelScale" min="0" max="1.4" step="0.05" value="1.0"><input type="number" data-polyc-n="bevelScale" min="0" max="1.4" step="0.05" value="1.0"></label>
        <label class="s-field"><span>V 槽深度</span><input type="range" data-polyc-r="notchDepth" min="0.5" max="1.4" step="0.02" value="1.0"><input type="number" data-polyc-n="notchDepth" min="0.5" max="1.4" step="0.02" value="1.0"></label>
        <label class="s-field" id="polyc-strata-field"><span>浅层理强度</span><input type="range" data-polyc-r="strataStrength" min="0" max="1.5" step="0.05" value="1.0"><input type="number" data-polyc-n="strataStrength" min="0" max="1.5" step="0.05" value="1.0"></label>
        <label class="s-field"><span>石体基色</span><input type="color" id="polyc-color" value="#caa57c"></label>
        <div class="rk-sdf-metrics" id="rk-polyc-metrics">等待进入路线 C2 显式布尔实验模式…</div>
      </div>
      <div id="rk-sdf-proto-box" class="rk-sdf-box" hidden>
        <div class="rk-sdf-banner" id="rk-sdf-banner">单偏心母体减切 + 后台 Worker 异步雕刻（拖拽 N=30 预览 / 松手 512 标准 PBR · 零自定义 Shader，支持直出 GLB/glTF/FBX）</div>
        <div class="rk-sdf-arch-tabs" role="group" aria-label="SDF 石型">
          <button type="button" data-sdf-arch="sandstone-ledge-b" aria-pressed="true">低矮横展砂岩</button>
          <button type="button" data-sdf-arch="block-bluff" aria-pressed="false">阶梯方巨岩</button>
          <button type="button" data-sdf-arch="twin-slab" aria-pressed="false">双叠断层岩</button>
        </div>
        <label class="s-field s-top"><span>随机种子</span><input id="sdf-seed" type="number" min="0" step="1" value="5104"><button type="button" id="sdf-reseed" title="随机 SDF 种子">🎲</button></label>
        <label class="s-field"><span>雕刻深度</span><input type="range" data-sdf-r="carveDepth" min="0.55" max="1.45" step="0.02" value="1.0"><input type="number" data-sdf-n="carveDepth" min="0.55" max="1.45" step="0.02" value="1.0"></label>
        <label class="s-field"><span>棱线锐度</span><input type="range" data-sdf-r="ridgeCrispness" min="0" max="1" step="0.02" value="0.90"><input type="number" data-sdf-n="ridgeCrispness" min="0" max="1" step="0.02" value="0.90"></label>
        <label class="s-field"><span>裂纹强度</span><input type="range" data-sdf-r="crackStrength" min="0" max="1.5" step="0.05" value="1.0"><input type="number" data-sdf-n="crackStrength" min="0" max="1.5" step="0.05" value="1.0"></label>
        <label class="s-field"><span>石体基色</span><input type="color" id="sdf-color" value="#caa57c"></label>
        <label class="s-field"><span>定向宽笔触</span><select id="sdf-brush"><option value="off">关闭（干净块面）</option><option value="subtle" selected>低强度层理宽笔触</option></select></label>
        <div class="rk-sdf-metrics" id="rk-sdf-metrics">等待进入 SDF 实验模式…</div>
      </div>
      <div id="rk-legacy-controls">
      <div class="dp-bar" id="default-preset-bar">
        <button type="button" id="save-default" class="dp-save-btn" title="将当前参数保存并替换当前默认预设（写入本地文件，刷新后永久生效）">★ 保存替换默认预设</button>
        <button type="button" id="reset-factory" class="dp-factory-btn" title="清除自定义覆盖，恢复出厂内置默认参数" hidden>恢复出厂</button>
      </div>
      <label class="s-field s-top"><span>随机种子</span><input id="seed" type="number" min="0" step="1"><button type="button" id="reseed" title="随机种子">🎲</button></label>
      <div class="rk-style-tabs" role="group" aria-label="着色风格">
        <button type="button" data-style="painterly" aria-pressed="true">厚涂风格化</button>
        <button type="button" data-style="cel" aria-pressed="false">赛璐璐简面</button>
        <button type="button" data-style="handpainted" aria-pressed="false">手绘裂纹岩</button>
      </div>
      ${sections.map(s => `<details class="s-section"${s.open ? ' open' : ''}><summary>${s.title}</summary>${s.fields.map(renderField).join('')}</details>`).join('')}
      </div>
    </div>
  </form>
</section>
<div id="toast" class="toast" role="status" hidden></div>`

function syncStudioTop() {
  const bar = document.querySelector<HTMLElement>('#app > header.bar')
  const barH = bar ? (bar.getBoundingClientRect().height || bar.offsetHeight) : 70
  document.documentElement.style.setProperty('--studio-top', `${Math.max(0, Math.ceil(barH))}px`)
}
{
  const bar = document.querySelector<HTMLElement>('#app > header.bar')
  if (typeof ResizeObserver !== 'undefined' && bar) {
    new ResizeObserver(syncStudioTop).observe(bar)
  }
  window.addEventListener('resize', syncStudioTop)
  syncStudioTop()
  requestAnimationFrame(syncStudioTop)
}

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
  slimForLocal: entry => ({ version: 2, spec: entry.spec, lighting: entry.lighting }),
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

// ---------------------------------------------------------------------------
// Single-Preset Experimental Route-B SDF Worker Pipeline (block-bluff · N=30 / 512 PBR)
// Strictly isolated from the 12 legacy presets and Scene Assembly builder.
// ---------------------------------------------------------------------------
type SdfProtoArchetype = Extract<RockV2ArchetypeId, 'sandstone-ledge-b' | 'block-bluff' | 'twin-slab'>

interface SdfProtoParams {
  archetype: SdfProtoArchetype
  seed: number
  carveDepth: number
  ridgeCrispness: number
  crackStrength: number
  baseColorHex: string
  brushMode: RockV2BrushMode
}

const SDF_ARCH_LABELS: Record<SdfProtoArchetype, string> = {
  'sandstone-ledge-b': '低矮横展砂岩 · 方案 B',
  'block-bluff': '阶梯方巨岩 · 方案 B',
  'twin-slab': '双叠断层岩 · V 槽',
}

const DEFAULT_SDF_PARAMS: SdfProtoParams = {
  archetype: 'sandstone-ledge-b',
  seed: 5104,
  carveDepth: 1.0,
  ridgeCrispness: 0.90,
  crackStrength: 1.0,
  baseColorHex: '#caa57c',
  brushMode: 'subtle',
}

let sdfProtoActive = false
let sdfParams: SdfProtoParams = { ...DEFAULT_SDF_PARAMS }
let sdfAppliedParams: SdfProtoParams | null = null
let sdfPendingReframe = false
let sdfAutoBakeAfterPreview = false
let sdfLastBakeStats: RockV2BakeDiagnostics | null = null
let sdfActiveTextures: CanvasTexture[] = []
let sdfActiveMat: MeshStandardMaterial | null = null
const sdfJobParamsMap = new Map<number, SdfProtoParams>()
const sdfMetrics = {
  previewToFirstFrameMs: [] as number[],
  releaseToMaterialVisibleMs: [] as number[],
  appliedHistory: [] as {
    jobId: number
    stage: 'preview' | 'bake'
    params: SdfProtoParams
    workerMs: number
    roundTripMs: number
    paintVisibleMs: number
  }[],
}

function makeSdfCanvasTexture(rgba: Uint8ClampedArray, size: number, srgb: boolean, name: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0)
  const tex = new CanvasTexture(c)
  tex.name = name
  tex.flipY = false
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  tex.generateMipmaps = true
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

function disposeSdfGpuResources() {
  for (const t of sdfActiveTextures) t.dispose()
  sdfActiveTextures = []
  sdfActiveMat?.dispose()
  sdfActiveMat = null
}

function applySdfViewMode() {
  if (!sdfActiveMat) return
  sdfActiveMat.wireframe = viewMode === 'wireframe'
  if (viewMode === 'clay') {
    sdfActiveMat.color.set('#d2cbc1')
    sdfActiveMat.map = null
    sdfActiveMat.aoMap = null
    sdfActiveMat.needsUpdate = true
  } else {
    const hasMaps = sdfActiveTextures.length >= 3
    sdfActiveMat.color.set(hasMaps ? '#ffffff' : sdfParams.baseColorHex)
    sdfActiveMat.map = hasMaps ? sdfActiveTextures[0] : null
    sdfActiveMat.aoMap = hasMaps ? sdfActiveTextures[2] : null
    sdfActiveMat.needsUpdate = true
  }
}

function updateSdfMetricsBanner(stageLabel: string, workerMs: number, paintMs?: number) {
  const el = document.getElementById('rk-sdf-metrics')
  if (!el) return
  const cs = sdfWorkerClient.getStats()
  const bakeStr = sdfLastBakeStats
    ? `解析命中 ${(sdfLastBakeStats.analyticalHitRate * 100).toFixed(2)}% · 缓存回退 ${(sdfLastBakeStats.cacheFallbackRate * 100).toFixed(2)}% · P95残差 ${sdfLastBakeStats.p95AnalyticalResidual}m`
    : '等待 512 PBR 烘焙…'
  el.textContent = `${stageLabel} (${workerMs.toFixed(1)}ms${paintMs !== undefined ? ` · 上屏 ${paintMs.toFixed(1)}ms` : ''}) | Worker=${cs.usingWorker ? '后台线程' : '同步回退'} | 过期丢弃=${cs.staleDropped} · 合并跳过=${cs.coalescedSkipped} | ${bakeStr}`
}

function applySdfWorkerResult(res: RockV2WorkerPreviewResponse | RockV2WorkerBakeResponse, meta: RockV2JobMeta) {
  if (!sdfProtoActive) return
  const jobParams = sdfJobParamsMap.get(res.jobId) ?? { ...sdfParams }
  sdfJobParamsMap.delete(res.jobId)
  sdfAppliedParams = { ...jobParams }

  const prev = built
  const prevTextures = sdfActiveTextures
  const prevMat = sdfActiveMat

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(res.positions, 3))
  geo.setAttribute('normal', new BufferAttribute(res.normals, 3))
  if (res.stage === 'bake') {
    geo.setAttribute('uv', new BufferAttribute(res.uvs, 2))
    geo.setAttribute('tangent', new BufferAttribute(res.tangents, 4))
  }
  geo.setIndex(new BufferAttribute(res.indices, 1))
  geo.computeBoundingBox()
  geo.computeBoundingSphere()

  let mat: MeshStandardMaterial
  let nextTextures: CanvasTexture[] = []
  let workerMs = 0

  if (res.stage === 'bake') {
    const mapTex = makeSdfCanvasTexture(res.albedo, res.size, true, 'RockV2_BaseColor')
    const normTex = makeSdfCanvasTexture(res.normal, res.size, false, 'RockV2_Normal')
    const aoTex = makeSdfCanvasTexture(res.ao, res.size, false, 'RockV2_AO')
    aoTex.channel = 0
    nextTextures = [mapTex, normTex, aoTex]
    mat = new MeshStandardMaterial({
      name: 'Mat_RockV2_BlockBluff',
      color: 0xffffff,
      map: mapTex,
      normalMap: normTex,
      normalScale: new Vector2(1, 1),
      aoMap: aoTex,
      aoMapIntensity: 0.85,
      roughness: 0.90,
      metalness: 0.0,
    })
    sdfLastBakeStats = res.bakeStats
    workerMs = res.meshTimings.totalMs + res.uvMs + res.bakeStats.timings.totalBakeMs
  } else {
    mat = new MeshStandardMaterial({
      name: 'Mat_RockV2_PreviewClay',
      color: jobParams.baseColorHex,
      roughness: 0.90,
      metalness: 0.0,
    })
    workerMs = res.timings.totalMs
  }

  sdfActiveTextures = nextTextures
  sdfActiveMat = mat
  applySdfViewMode()

  const mesh = new Mesh(geo, mat)
  mesh.name = 'RockV2_BlockBluff_LOD0'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new Group()
  group.name = 'RockV2Asset'
  group.add(mesh)

  const bounds = new Box3().setFromObject(group)
  const vCount = res.positions.length / 3
  const tCount = res.indices.length / 3
  const stats: RockBuildStats = {
    stones: 1,
    vertices: vCount,
    triangles: tCount,
    ms: Math.round(workerMs * 10) / 10,
  }
  built = {
    group,
    meshes: [mesh],
    bounds,
    stats,
    dispose: () => { geo.dispose() },
  }
  buildCount++

  const size = bounds.getSize(new Vector3())
  const span = Math.max(1.05, size.length() * 0.76)
  viewer?.showModel(group, span, false)
  if (sdfPendingReframe) {
    viewer?.frame(camera, bounds.getCenter(new Vector3()))
    sdfPendingReframe = false
  }
  viewer?.refreshShadows()

  prev?.dispose()
  for (const t of prevTextures) t.dispose()
  prevMat?.dispose()
  updateStats(stats)

  // Measure true frame-visible paint latency via requestAnimationFrame right after scene update
  requestAnimationFrame(() => {
    const paintVisibleMs = Math.round((performance.now() - meta.submittedAt) * 10) / 10
    if (res.stage === 'preview') sdfMetrics.previewToFirstFrameMs.push(paintVisibleMs)
    else sdfMetrics.releaseToMaterialVisibleMs.push(paintVisibleMs)
    sdfMetrics.appliedHistory.push({
      jobId: res.jobId,
      stage: res.stage,
      params: { ...jobParams },
      workerMs: Math.round(workerMs * 10) / 10,
      roundTripMs: meta.roundTripMs,
      paintVisibleMs,
    })
    if (sdfMetrics.appliedHistory.length > 60) sdfMetrics.appliedHistory.shift()
    updateSdfMetricsBanner(res.stage === 'bake' ? '512 PBR 就绪' : 'N=30 拖拽预览', workerMs, paintVisibleMs)
    if (res.stage === 'preview' && sdfAutoBakeAfterPreview && sdfProtoActive) {
      sdfAutoBakeAfterPreview = false
      submitSdfJob('bake', false)
    }
  })
}

const sdfWorkerClient = new RockV2WorkerClient(
  applySdfWorkerResult,
  err => message(`SDF Worker 错误：${err.message}`, true),
  {
    workerFactory: () => {
      try {
        return new RockV2Worker()
      } catch {
        return null
      }
    },
  },
)

function syncSdfPanel() {
  byId('rk-sdf-proto-btn').setAttribute('aria-pressed', String(sdfProtoActive))
  byId('rk-sdf-proto-box').hidden = !sdfProtoActive
  byId('rk-legacy-controls').hidden = sdfProtoActive || polyCProtoActive
  if (!sdfProtoActive) return
  byId('rock-title').textContent = `${SDF_ARCH_LABELS[sdfParams.archetype]} · SDF 实验 (N=30 / 512 PBR)`
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
    btn.setAttribute('aria-pressed', 'false')
  })
  document.querySelectorAll<HTMLButtonElement>('[data-sdf-arch]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.sdfArch === sdfParams.archetype))
  })
  ;(byId('sdf-seed') as HTMLInputElement).value = String(sdfParams.seed)
  ;(byId('sdf-color') as HTMLInputElement).value = sdfParams.baseColorHex
  ;(byId('sdf-brush') as HTMLSelectElement).value = sdfParams.brushMode
  for (const k of ['carveDepth', 'ridgeCrispness', 'crackStrength'] as const) {
    const r = document.querySelector<HTMLInputElement>(`[data-sdf-r="${k}"]`)
    const n = document.querySelector<HTMLInputElement>(`[data-sdf-n="${k}"]`)
    if (r) r.value = String(sdfParams[k])
    if (n) n.value = String(Number(sdfParams[k].toFixed(2)))
  }
}

function submitSdfJob(stage: 'preview' | 'bake', reframe = false) {
  if (!sdfProtoActive) return
  if (reframe) sdfPendingReframe = true
  const snapshot: SdfProtoParams = { ...sdfParams }
  const jobId = sdfWorkerClient.submit({
    stage,
    archetype: snapshot.archetype,
    resolution: 30,
    sculpt: {
      seed: snapshot.seed,
      carveDepth: snapshot.carveDepth,
      ridgeCrispness: snapshot.ridgeCrispness,
      crackStrength: snapshot.crackStrength,
    },
    bake: stage === 'bake' ? {
      size: 512,
      dilationPasses: 10,
      brushMode: snapshot.brushMode,
      baseColorHex: snapshot.baseColorHex,
    } : undefined,
  })
  sdfJobParamsMap.set(jobId, snapshot)
  if (sdfJobParamsMap.size > 40) {
    const firstKey = sdfJobParamsMap.keys().next().value
    if (firstKey !== undefined) sdfJobParamsMap.delete(firstKey)
  }
  const el = document.getElementById('rk-sdf-metrics')
  if (el) el.textContent = stage === 'bake' ? '后台 Worker 正在烘焙 512 PBR 贴图…' : '后台 Worker 正在生成 N=30 预览网格…'
}

function enterSdfProto(resetParams = false) {
  exitPolyCProto()
  if (resetParams) sdfParams = { ...DEFAULT_SDF_PARAMS }
  sdfProtoActive = true
  sdfLastBakeStats = null
  sdfAutoBakeAfterPreview = true
  syncSdfPanel()
  submitSdfJob('preview', true)
}

function exitSdfProto() {
  if (!sdfProtoActive) return
  sdfProtoActive = false
  sdfAutoBakeAfterPreview = false
  sdfWorkerClient.cancelAll()
  sdfJobParamsMap.clear()
  disposeSdfGpuResources()
  syncSdfPanel()
}

// ---------------------------------------------------------------------------
// Experimental Route-C2 Explicit Manifold Boolean Worker Pipeline
//   Supports validated archetypes: `sandstone-ledge-c2` & `block-bluff-c2`.
//   Isolated from the 12 legacy presets, Route B SDF mode, and Scene Assembly builder.
// ---------------------------------------------------------------------------
interface PolyCProtoParams {
  preset: PolyCsgPresetId
  mode: PolyPbrMode
  seed: number
  shoulderDepth: number
  bevelScale: number
  notchDepth: number
  strataStrength: number
  baseColorHex: string
}

const POLYC_PRESET_META: Record<PolyCsgPresetId, { label: string; canonicalSeed: number; meshName: string }> = {
  'sandstone-ledge-c2': { label: '低矮横展砂岩', canonicalSeed: 5104, meshName: 'RockC2_SandstoneLedge_LOD0' },
  'block-bluff-c2': { label: '阶梯方巨岩', canonicalSeed: 7342, meshName: 'RockC2_BlockBluff_LOD0' },
  'terraced-moss-bluff-c2': { label: '苔藓层叠方巨岩', canonicalSeed: 7301, meshName: 'RockC2_TerracedMossBluff_LOD0' },
}

const DEFAULT_POLYC_PARAMS: PolyCProtoParams = {
  preset: 'sandstone-ledge-c2',
  mode: 'shallow-detail',
  seed: 5104,
  shoulderDepth: 1.0,
  bevelScale: 1.0,
  notchDepth: 1.0,
  strataStrength: 1.0,
  baseColorHex: '#caa57c',
}

let polyCProtoActive = false
let polyCParams: PolyCProtoParams = { ...DEFAULT_POLYC_PARAMS }
let polyCAppliedParams: PolyCProtoParams | null = null
let polyCPendingReframe = false
let polyCAutoBakeAfterPreview = false
let polyCLastBakeStats: PolyBakeStats | null = null
let polyCLastUvAudit: PolyUvAudit | null = null
let polyCActiveTextures: CanvasTexture[] = []
let polyCCustomPbrLayers: ExternalPbrLayers | null = null
let polyCActiveMat: MeshStandardMaterial | null = null
let polyCActiveBakeMat: MeshStandardMaterial | null = null
let polyCActiveBakeGeo: BufferGeometry | null = null
let polyCPreviewMat: MeshStandardMaterial | null = null
let polyCPreviewGeo: BufferGeometry | null = null
let polyCPreviewPosCap = 0
let polyCPreviewIdxCap = 0
let polyCPreviewGroup: Group | null = null
let polyCPreviewMesh: Mesh | null = null
let polyCLastShadowRefreshAt = 0
let polyCShadowTimer: number | null = null
const polyCJobParamsMap = new Map<number, PolyCProtoParams>()
const polyCMetrics = {
  previewToFirstFrameMs: [] as number[],
  releaseToMaterialVisibleMs: [] as number[],
  appliedHistory: [] as {
    jobId: number
    stage: 'preview' | 'bake'
    params: PolyCProtoParams
    workerMs: number
    queueWaitMs: number
    ipcOverheadMs: number
    roundTripMs: number
    mainUploadMs: number
    rafWaitMs: number
    paintVisibleMs: number
    phases?: {
      booleanMs: number
      fallbackMs: number
      fallbackCount: number
      auditMs: number
      previewBufMs: number
      workerTotalMs: number
    }
  }[],
}

function disposePolyCBakeResources() {
  for (const t of polyCActiveTextures) t.dispose()
  polyCActiveTextures = []
  polyCActiveBakeMat?.dispose()
  polyCActiveBakeMat = null
  polyCActiveBakeGeo?.dispose()
  polyCActiveBakeGeo = null
}

function disposePolyCGpuResources() {
  if (polyCShadowTimer !== null) {
    clearTimeout(polyCShadowTimer)
    polyCShadowTimer = null
  }
  disposePolyCBakeResources()
  polyCPreviewMat?.dispose()
  polyCPreviewMat = null
  polyCPreviewGeo?.dispose()
  polyCPreviewGeo = null
  polyCPreviewPosCap = 0
  polyCPreviewIdxCap = 0
  polyCPreviewMesh = null
  polyCPreviewGroup = null
  polyCActiveMat = null
}

function computePolyCPreviewBounds(positions: Float32Array): { box: Box3; sphere: Sphere } {
  const box = new Box3()
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  if (!Number.isFinite(minX)) {
    box.min.set(0, 0, 0)
    box.max.set(0, 0, 0)
  } else {
    box.min.set(minX, minY, minZ)
    box.max.set(maxX, maxY, maxZ)
  }
  const sphere = new Sphere()
  box.getBoundingSphere(sphere)
  return { box, sphere }
}

function updatePolyCPreviewGeoInPlace(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
): { geo: BufferGeometry; bounds: Box3 } {
  if (!polyCPreviewGeo || positions.length > polyCPreviewPosCap || indices.length > polyCPreviewIdxCap) {
    polyCPreviewGeo?.dispose()
    polyCPreviewPosCap = Math.max(2048 * 3, positions.length * 2)
    polyCPreviewIdxCap = Math.max(4096, indices.length * 2)
    const geo = new BufferGeometry()
    const posAttr = new BufferAttribute(new Float32Array(polyCPreviewPosCap), 3)
    posAttr.setUsage(DynamicDrawUsage)
    const normAttr = new BufferAttribute(new Float32Array(polyCPreviewPosCap), 3)
    normAttr.setUsage(DynamicDrawUsage)
    const idxAttr = new BufferAttribute(new Uint32Array(polyCPreviewIdxCap), 1)
    idxAttr.setUsage(DynamicDrawUsage)
    geo.setAttribute('position', posAttr)
    geo.setAttribute('normal', normAttr)
    geo.setIndex(idxAttr)
    polyCPreviewGeo = geo
  }
  const posAttr = polyCPreviewGeo.getAttribute('position') as BufferAttribute
  const normAttr = polyCPreviewGeo.getAttribute('normal') as BufferAttribute
  const idxAttr = polyCPreviewGeo.getIndex()!
  ;(posAttr.array as Float32Array).set(positions)
  ;(normAttr.array as Float32Array).set(normals)
  ;(idxAttr.array as Uint32Array).set(indices)
  posAttr.needsUpdate = true
  normAttr.needsUpdate = true
  idxAttr.needsUpdate = true
  polyCPreviewGeo.setDrawRange(0, indices.length)
  const { box, sphere } = computePolyCPreviewBounds(positions)
  polyCPreviewGeo.boundingBox = box
  polyCPreviewGeo.boundingSphere = sphere
  return { geo: polyCPreviewGeo, bounds: box }
}

function applyPolyCViewMode() {
  if (!polyCActiveMat) return
  polyCActiveMat.wireframe = viewMode === 'wireframe'
  const prevMap = polyCActiveMat.map
  const prevAoMap = polyCActiveMat.aoMap
  if (viewMode === 'clay') {
    polyCActiveMat.color.set('#d2cbc1')
    polyCActiveMat.map = null
    polyCActiveMat.aoMap = null
  } else {
    const hasMaps = polyCActiveTextures.length >= 3 && polyCActiveMat === polyCActiveBakeMat
    polyCActiveMat.color.set(hasMaps ? '#ffffff' : polyCParams.baseColorHex)
    polyCActiveMat.map = hasMaps ? polyCActiveTextures[0] : null
    polyCActiveMat.aoMap = hasMaps ? polyCActiveTextures[2] : null
  }
  if (polyCActiveMat.map !== prevMap || polyCActiveMat.aoMap !== prevAoMap) {
    polyCActiveMat.needsUpdate = true
  }
}

function updatePolyCMetricsBanner(stageLabel: string, workerMs: number, paintMs?: number) {
  const el = document.getElementById('rk-polyc-metrics')
  if (!el) return
  const cs = polyCWorkerClient.getStats()
  const uvStr = polyCLastUvAudit
    ? `${polyCLastUvAudit.rawFaceGroups}面组→${polyCLastUvAudit.chartCount}图表 · ${polyCLastUvAudit.pxPerMeter}px/m`
    : '等待 UV 展开…'
  const bakeStr = polyCLastBakeStats
    ? `槽AO=${polyCLastBakeStats.shoulderNotchMeanAo} · 法线≤${polyCLastBakeStats.maxNormalDeviationDeg}°`
    : '等待 512 PBR 烘焙…'
  el.textContent = `${stageLabel} (${workerMs.toFixed(1)}ms${paintMs !== undefined ? ` · 上屏 ${paintMs.toFixed(1)}ms` : ''}) | Worker=${cs.usingWorker ? '后台线程' : '同步回退'} | 过期丢弃=${cs.staleDropped} · 合并跳过=${cs.coalescedSkipped} | ${uvStr} · ${bakeStr}`
}

function applyPolyCWorkerResult(res: PolyCWorkerPreviewResponse | PolyCWorkerBakeResponse, meta: PolyCJobMeta) {
  if (!polyCProtoActive) return
  const uploadStart = performance.now()
  const jobParams = polyCJobParamsMap.get(res.jobId) ?? { ...polyCParams }
  polyCJobParamsMap.delete(res.jobId)
  polyCAppliedParams = { ...jobParams }

  const prevNonPolyC = built && built.group !== polyCPreviewGroup ? built : null
  const alreadyMounted = Boolean(
    polyCPreviewGroup && polyCPreviewMesh && built?.group === polyCPreviewGroup,
  )

  let geo: BufferGeometry
  let mat: MeshStandardMaterial
  let bounds: Box3
  let workerMs = 0

  if (res.stage === 'bake') {
    if (polyCShadowTimer !== null) {
      clearTimeout(polyCShadowTimer)
      polyCShadowTimer = null
    }
    const prevBakeTextures = polyCActiveTextures
    const prevBakeMat = polyCActiveBakeMat
    const prevBakeGeo = polyCActiveBakeGeo

    geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(res.positions, 3))
    geo.setAttribute('normal', new BufferAttribute(res.normals, 3))
    geo.setAttribute('uv', new BufferAttribute(res.uvs, 2))
    geo.setAttribute('tangent', new BufferAttribute(res.tangents, 4))
    geo.setIndex(new BufferAttribute(res.indices, 1))
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    bounds = geo.boundingBox ? geo.boundingBox.clone() : new Box3()

    const mapTex = makeSdfCanvasTexture(res.albedo, res.size, true, 'RockC2_BaseColor')
    const normTex = makeSdfCanvasTexture(res.normal, res.size, false, 'RockC2_Normal')
    const aoTex = makeSdfCanvasTexture(res.ao, res.size, false, 'RockC2_AO')
    const roughTex = makeSdfCanvasTexture(res.roughness, res.size, false, 'RockC2_Roughness')
    aoTex.channel = 0
    polyCActiveTextures = [mapTex, normTex, aoTex, roughTex]
    const useRoughMap = jobParams.mode === 'photocraft-pbr'
    mat = new MeshStandardMaterial({
      name: jobParams.mode === 'baseline'
        ? 'Mat_RockC2_Baseline'
        : jobParams.mode === 'photocraft-pbr'
          ? 'Mat_RockC2_PhotoCraftPBR'
          : 'Mat_RockC2_ShallowDetail',
      color: 0xffffff,
      map: mapTex,
      normalMap: normTex,
      normalScale: new Vector2(1, 1),
      aoMap: aoTex,
      aoMapIntensity: jobParams.mode === 'photocraft-pbr' ? 0.92 : 0.85,
      roughnessMap: useRoughMap ? roughTex : null,
      roughness: useRoughMap ? 1.0 : 0.90,
      metalness: 0.0,
    })
    polyCActiveBakeMat = mat
    polyCActiveBakeGeo = geo
    polyCLastBakeStats = res.bakeStats
    polyCLastUvAudit = res.uvAudit
    workerMs = res.audit.buildMs + res.uvMs + res.bakeStats.timings.totalBakeMs

    // Dispose old bake GPU resources AFTER new ones are bound below
    if (!polyCPreviewMesh || !polyCPreviewGroup) {
      polyCPreviewMesh = new Mesh(geo, mat)
      polyCPreviewMesh.name = 'RockC2_SandstoneLedge_LOD0'
      polyCPreviewMesh.castShadow = true
      polyCPreviewMesh.receiveShadow = true
      polyCPreviewGroup = new Group()
      polyCPreviewGroup.name = 'RockC2Asset'
      polyCPreviewGroup.add(polyCPreviewMesh)
    } else {
      polyCPreviewMesh.geometry = geo
      polyCPreviewMesh.material = mat
    }
    polyCActiveMat = mat
    applyPolyCViewMode()

    for (const t of prevBakeTextures) t.dispose()
    prevBakeMat?.dispose()
    prevBakeGeo?.dispose()
  } else {
    // Interactive continuous drag clay preview:
    // Reuse persistent dynamic VBO/IBO + persistent compiled MeshStandardMaterial + persistent scene Mesh
    // so dragging triggers ZERO shader recompiles, ZERO VBO/material churn, and ZERO per-tick shadow storms.
    const updated = updatePolyCPreviewGeoInPlace(res.positions, res.normals, res.indices)
    geo = updated.geo
    bounds = updated.bounds
    if (!polyCPreviewMat) {
      polyCPreviewMat = new MeshStandardMaterial({
        name: 'Mat_RockC2_PreviewClay',
        color: jobParams.baseColorHex,
        roughness: 0.90,
        metalness: 0.0,
      })
    }
    mat = polyCPreviewMat
    mat.color.set(viewMode === 'clay' ? '#d2cbc1' : jobParams.baseColorHex)
    mat.wireframe = viewMode === 'wireframe'
    workerMs = res.previewMs

    if (!polyCPreviewMesh || !polyCPreviewGroup) {
      polyCPreviewMesh = new Mesh(geo, mat)
      polyCPreviewMesh.name = 'RockC2_SandstoneLedge_LOD0'
      polyCPreviewMesh.castShadow = true
      polyCPreviewMesh.receiveShadow = true
      polyCPreviewGroup = new Group()
      polyCPreviewGroup.name = 'RockC2Asset'
      polyCPreviewGroup.add(polyCPreviewMesh)
    } else {
      if (polyCPreviewMesh.geometry !== geo) polyCPreviewMesh.geometry = geo
      if (polyCPreviewMesh.material !== mat) polyCPreviewMesh.material = mat
    }
    polyCActiveMat = mat

    // Release any previous 512 PBR bake resources only once when transitioning bake -> preview
    if (polyCActiveBakeMat || polyCActiveBakeGeo || polyCActiveTextures.length > 0) {
      disposePolyCBakeResources()
    }
  }

  const group = polyCPreviewGroup!
  const mesh = polyCPreviewMesh!
  mesh.name = POLYC_PRESET_META[jobParams.preset].meshName
  const vCount = res.positions.length / 3
  const tCount = res.indices.length / 3
  const stats: RockBuildStats = {
    stones: 1,
    vertices: vCount,
    triangles: tCount,
    ms: Math.round(workerMs * 10) / 10,
  }
  built = {
    group,
    meshes: [mesh],
    bounds,
    stats,
    dispose: () => {
      if (!polyCProtoActive) disposePolyCGpuResources()
    },
  }
  buildCount++

  const size = bounds.getSize(new Vector3())
  const span = Math.max(1.05, size.length() * 0.76)

  if (!alreadyMounted || polyCPendingReframe || res.stage === 'bake') {
    if (!alreadyMounted) {
      viewer?.showModel(group, span, false)
    }
    if (polyCPendingReframe) {
      viewer?.frame(camera, bounds.getCenter(new Vector3()))
      polyCPendingReframe = false
    }
    viewer?.refreshShadows()
    polyCLastShadowRefreshAt = uploadStart
  } else {
    // During rapid continuous drag preview, throttle expensive 1024x1024 shadow-map re-rasterization
    // and schedule a trailing crisp shadow refresh once dragging pauses.
    if (uploadStart - polyCLastShadowRefreshAt >= 320) {
      viewer?.refreshShadows()
      polyCLastShadowRefreshAt = uploadStart
    }
    if (polyCShadowTimer !== null) clearTimeout(polyCShadowTimer)
    polyCShadowTimer = window.setTimeout(() => {
      polyCShadowTimer = null
      if (polyCProtoActive) {
        viewer?.refreshShadows()
        polyCLastShadowRefreshAt = performance.now()
      }
    }, 160)
  }

  prevNonPolyC?.dispose()
  updateStats(stats)
  const uploadEnd = performance.now()
  const mainUploadMs = Math.round((uploadEnd - uploadStart) * 10) / 10
  const ipcOverheadMs = Math.max(0, Math.round((meta.roundTripMs - meta.queueWaitMs - workerMs) * 10) / 10)
  const previewPhases = res.stage === 'preview' ? res.phaseTimings : undefined

  requestAnimationFrame(() => {
    const rafAt = performance.now()
    const rafWaitMs = Math.round((rafAt - uploadEnd) * 10) / 10
    const paintVisibleMs = Math.round((rafAt - meta.submittedAt) * 10) / 10
    if (res.stage === 'preview') polyCMetrics.previewToFirstFrameMs.push(paintVisibleMs)
    else polyCMetrics.releaseToMaterialVisibleMs.push(paintVisibleMs)
    polyCMetrics.appliedHistory.push({
      jobId: res.jobId,
      stage: res.stage,
      params: { ...jobParams },
      workerMs: Math.round(workerMs * 10) / 10,
      queueWaitMs: meta.queueWaitMs,
      ipcOverheadMs,
      roundTripMs: meta.roundTripMs,
      mainUploadMs,
      rafWaitMs,
      paintVisibleMs,
      phases: previewPhases,
    })
    if (polyCMetrics.appliedHistory.length > 140) polyCMetrics.appliedHistory.shift()
    const stageLbl = res.stage === 'bake'
      ? (jobParams.mode === 'baseline'
        ? '512 基线 PBR 就绪'
        : jobParams.mode === 'photocraft-pbr'
          ? 'PhotoCraft 512 PBR 就绪'
          : '512 旧程序浅细节就绪')
      : 'C2 灰模拖拽预览'
    updatePolyCMetricsBanner(stageLbl, workerMs, paintVisibleMs)
    if (res.stage === 'preview' && polyCAutoBakeAfterPreview && polyCProtoActive) {
      polyCAutoBakeAfterPreview = false
      submitPolyCJob('bake', false)
    }
  })
}

const polyCWorkerClient = new PolyCWorkerClient(
  applyPolyCWorkerResult,
  err => message(`路线 C2 Worker 错误：${err.message}`, true),
  {
    workerFactory: () => {
      try {
        return new PolyCWorker()
      } catch {
        return null
      }
    },
  },
)

function syncPolyCPanel() {
  byId('rk-polyc-proto-btn').setAttribute('aria-pressed', String(polyCProtoActive))
  byId('rk-polyc-proto-box').hidden = !polyCProtoActive
  byId('rk-legacy-controls').hidden = sdfProtoActive || polyCProtoActive
  if (!polyCProtoActive) return
  const presetMeta = POLYC_PRESET_META[polyCParams.preset]
  const modeTag = polyCParams.mode === 'baseline'
    ? '材质基线诊断'
    : polyCParams.mode === 'photocraft-pbr'
      ? 'PhotoCraft PBR'
      : '旧程序浅细节'
  byId('rock-title').textContent = `${presetMeta.label} · 路线 C2 实验 (${modeTag} · 512 PBR)`
  const pcBox = document.getElementById('rk-pc-import-box')
  if (pcBox) pcBox.hidden = polyCParams.mode !== 'photocraft-pbr'
  const pcResetBtn = document.getElementById('polyc-pc-reset-btn')
  if (pcResetBtn) pcResetBtn.hidden = !polyCCustomPbrLayers
  const pcLbl = document.getElementById('rk-pc-import-label')
  if (pcLbl) pcLbl.textContent = polyCCustomPbrLayers?.label ?? '🎨 PhotoCraft · 层叠砂岩 + 苔藓 PBR'
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
    btn.setAttribute('aria-pressed', 'false')
  })
  document.querySelectorAll<HTMLButtonElement>('[data-polyc-preset]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.polycPreset === polyCParams.preset))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-polyc-mode]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.polycMode === polyCParams.mode))
  })
  ;(byId('polyc-seed') as HTMLInputElement).value = String(polyCParams.seed)
  ;(byId('polyc-color') as HTMLInputElement).value = polyCParams.baseColorHex
  const strataRow = document.getElementById('polyc-strata-field')
  if (strataRow) strataRow.style.opacity = polyCParams.mode === 'baseline' ? '0.45' : '1'
  for (const k of ['shoulderDepth', 'bevelScale', 'notchDepth', 'strataStrength'] as const) {
    const r = document.querySelector<HTMLInputElement>(`[data-polyc-r="${k}"]`)
    const n = document.querySelector<HTMLInputElement>(`[data-polyc-n="${k}"]`)
    if (r) { r.value = String(polyCParams[k]); r.disabled = k === 'strataStrength' && polyCParams.mode === 'baseline' }
    if (n) { n.value = String(Number(polyCParams[k].toFixed(2))); n.disabled = k === 'strataStrength' && polyCParams.mode === 'baseline' }
  }
}

function submitPolyCJob(stage: 'preview' | 'bake', reframe = false) {
  if (!polyCProtoActive) return
  if (reframe) polyCPendingReframe = true
  const snapshot: PolyCProtoParams = { ...polyCParams }
  const jobId = polyCWorkerClient.submit({
    stage,
    preset: snapshot.preset,
    sculpt: {
      seed: snapshot.seed,
      shoulderDepth: snapshot.shoulderDepth,
      bevelScale: snapshot.bevelScale,
      notchDepth: snapshot.notchDepth,
    },
    bake: stage === 'bake' ? {
      size: 512,
      mode: snapshot.mode,
      baseColorHex: snapshot.baseColorHex,
      dilationPasses: snapshot.preset === 'terraced-moss-bluff-c2' ? 8 : 14,
      aoRays: snapshot.preset === 'terraced-moss-bluff-c2' ? 10 : 16,
      strataStrength: snapshot.strataStrength,
    } : undefined,
  })
  polyCJobParamsMap.set(jobId, snapshot)
  if (polyCJobParamsMap.size > 40) {
    const firstKey = polyCJobParamsMap.keys().next().value
    if (firstKey !== undefined) polyCJobParamsMap.delete(firstKey)
  }
  const el = document.getElementById('rk-polyc-metrics')
  if (el) el.textContent = stage === 'bake' ? '后台 Worker 正在直烘 C2 512 PBR 贴图…' : '后台 Worker 正在构建 C2 显式灰模…'
}

function enterPolyCProto(resetParams = false, nextPreset?: PolyCsgPresetId) {
  exitSdfProto()
  const activePreset = nextPreset ?? polyCParams.preset
  if (resetParams) {
    polyCParams = {
      ...DEFAULT_POLYC_PARAMS,
      preset: activePreset,
      mode: activePreset === 'terraced-moss-bluff-c2' ? 'photocraft-pbr' : DEFAULT_POLYC_PARAMS.mode,
      seed: POLYC_PRESET_META[activePreset].canonicalSeed,
      baseColorHex: activePreset === 'terraced-moss-bluff-c2' ? '#cfa87d' : DEFAULT_POLYC_PARAMS.baseColorHex,
    }
  } else if (nextPreset) {
    polyCParams.preset = nextPreset
    polyCParams.seed = POLYC_PRESET_META[nextPreset].canonicalSeed
    if (nextPreset === 'terraced-moss-bluff-c2') {
      polyCParams.mode = 'photocraft-pbr'
      polyCParams.baseColorHex = '#cfa87d'
    }
  }
  polyCProtoActive = true
  polyCLastBakeStats = null
  polyCLastUvAudit = null
  polyCAutoBakeAfterPreview = true
  syncPolyCPanel()
  submitPolyCJob('preview', true)
}

function exitPolyCProto() {
  if (!polyCProtoActive) return
  polyCProtoActive = false
  polyCAutoBakeAfterPreview = false
  polyCWorkerClient.cancelAll()
  polyCJobParamsMap.clear()
  disposePolyCGpuResources()
  syncPolyCPanel()
}

function message(value: unknown, error = false, logIt = true) {
  const toast = byId('toast')
  clearTimeout(toastTimer)
  const text = value instanceof Error ? value.message : String(value)
  toast.textContent = text
  toast.classList.toggle('is-error', error)
  toast.hidden = false
  toastTimer = setTimeout(() => { toast.hidden = true }, 3600)
  if (logIt) {
    if (error) activityLog.error('system', `提示错误：${text}`, value instanceof Error ? value : undefined)
    else activityLog.info('system', `状态提示：${text}`)
  }
}

let viewer: Viewer | undefined
try {
  viewer = new Viewer(
    byId('canvas'),
    (_, calls) => { byId('stat-calls').textContent = fmt.format(calls) },
    lost => { message(lost ? 'WebGL 渲染上下文已丢失，正在尝试恢复…' : 'WebGL 渲染上下文已恢复', lost) },
  )
  viewer.renderer.domElement.setAttribute('aria-label', '三维石头预览')
  viewer.setWind(false)
} catch (error) {
  console.warn(error)
  byId('webgl').hidden = false
}
initStudioLogging({
  page: 'rock',
  getWebGLContext: () => viewer?.renderer.getContext() ?? null,
})

const rockHistory = new SnapshotHistory<RockSpec>({ maxDepth: 30 })
const rangeBoundsByPath = new Map<string, { min: number; max: number; step: number }>()
for (const sec of sections) {
  for (const f of sec.fields) {
    if (f.kind === 'range') rangeBoundsByPath.set(f.path, { min: f.min, max: f.max, step: f.step })
  }
}
window.addEventListener('beforeunload', ev => {
  if (userDirty) {
    ev.preventDefault()
    ev.returnValue = ''
  }
})

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
    const fallback = el.dataset.r === 'shape.slabs' ? 1 : 0
    const v = getPath(spec, el.dataset.r!)
    el.value = String(v ?? fallback)
  })
  document.querySelectorAll<HTMLInputElement>('[data-n]').forEach(el => {
    const fallback = el.dataset.n === 'shape.slabs' ? 1 : 0
    const v = getPath(spec, el.dataset.n!)
    el.value = String(typeof v === 'number' ? Number(v.toFixed(3)) : v ?? fallback)
  })
  document.querySelectorAll<HTMLInputElement>('[data-c]').forEach(el => {
    const v = getPath(spec, el.dataset.c!)
    el.value = String(v ?? '#a6acb6')
  })
  document.querySelectorAll<HTMLSelectElement>('[data-s]').forEach(el => {
    const v = getPath(spec, el.dataset.s!)
    el.value = String(v ?? 'none')
  })
  // Toggle top-cap sub-fields & cel-inapplicable shading fields cleanly
  const topDisabled = spec.top.mode === 'none'
  for (const p of ['top.color', 'top.coverage', 'top.softness']) {
    const row = document.querySelector<HTMLElement>(`.s-field[data-path="${p}"]`)
    if (row) row.hidden = topDisabled
  }
  const isCel = spec.style === 'cel'
  for (const p of ['shading.cavityAO', 'shading.grain', 'shading.roughness']) {
    const row = document.querySelector<HTMLElement>(`.s-field[data-path="${p}"]`)
    if (row) row.hidden = isCel
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
  if (!final) rockHistory.beginGesture(spec)
  else rockHistory.commitGesture(spec)
  userDirty = true
  let nextVal: unknown = value
  if (typeof value === 'number') {
    const b = rangeBoundsByPath.get(path)
    if (b) {
      let clamped = Math.min(b.max, Math.max(b.min, value))
      if (b.step === 1) clamped = Math.round(clamped)
      nextVal = clamped
    }
  }
  setPath(spec, path, nextVal)
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
  const resolved: LightingPreset = validLightingKeys.has(mood) ? mood : 'neutral'
  lighting = resolved
  ;(byId('lighting') as HTMLSelectElement).value = resolved
  viewer?.setLighting(resolved)
}

function loadPreset(id: RockPresetId) {
  exitSdfProto()
  exitPolyCProto()
  presetId = id
  const state = effectivePresetState(id)
  rockHistory.clear()
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
  if (polyCProtoActive) {
    polyCParams.seed = Math.floor(100 + Math.random() * 99899)
    syncPolyCPanel()
    polyCAutoBakeAfterPreview = true
    submitPolyCJob('preview', false)
    return
  }
  if (sdfProtoActive) {
    sdfParams.seed = Math.floor(100 + Math.random() * 99899)
    syncSdfPanel()
    sdfAutoBakeAfterPreview = true
    submitSdfJob('preview', false)
    return
  }
  rockHistory.push(spec)
  userDirty = true
  spec.seed = Math.floor(100 + Math.random() * 99899)
  syncPanel()
  rebuild(false)
}

function downloadBlob(blob: Blob, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const filters = ext === 'glb'
    ? [{ name: 'glTF Binary (.glb)', extensions: ['glb'] }]
    : ext === 'zip'
      ? [{ name: 'ZIP 压缩包 (.zip)', extensions: ['zip'] }]
      : ext === 'json'
        ? [{ name: 'JSON (.json)', extensions: ['json'] }]
        : ext === 'png'
          ? [{ name: 'PNG 图像 (.png)', extensions: ['png'] }]
          : undefined
  void tryDesktopSaveBlob(blob, filename, filters).then(res => {
    if (res.handled) {
      if (!res.canceled && res.filePath) message(`已保存到 ${res.filePath}`)
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }).catch(err => {
    message(`文件保存失败：${err instanceof Error ? err.message : String(err)}`, true)
  })
}

// Bind preset chips
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => loadPreset(btn.dataset.preset as RockPresetId))
})

// Bind experimental Route-B SDF Worker preset button & panel controls
byId('rk-sdf-proto-btn').addEventListener('click', () => {
  enterSdfProto(false)
})

// Bind experimental Route-C2 Explicit Boolean Worker single-preset button & panel controls
byId('rk-polyc-proto-btn').addEventListener('click', () => {
  enterPolyCProto(false)
})

document.querySelectorAll<HTMLButtonElement>('[data-polyc-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.polycPreset as PolyCsgPresetId
    if (!next || polyCParams.preset === next) return
    polyCParams.preset = next
    polyCParams.seed = POLYC_PRESET_META[next].canonicalSeed
    if (next === 'terraced-moss-bluff-c2') {
      polyCParams.mode = 'photocraft-pbr'
      polyCParams.baseColorHex = '#cfa87d'
    }
    polyCLastBakeStats = null
    polyCLastUvAudit = null
    polyCAutoBakeAfterPreview = true
    syncPolyCPanel()
    submitPolyCJob('preview', true)
  })
})

byId('polyc-pc-stone-btn').addEventListener('click', () => byId<HTMLInputElement>('polyc-pc-stone-file').click())
byId('polyc-pc-moss-btn').addEventListener('click', () => byId<HTMLInputElement>('polyc-pc-moss-file').click())
byId('polyc-pc-reset-btn').addEventListener('click', () => {
  polyCCustomPbrLayers = null
  polyCWorkerClient.setExternalPbr(null)
  syncPolyCPanel()
  if (polyCProtoActive && polyCParams.mode === 'photocraft-pbr') submitPolyCJob('bake', false)
  message('已恢复内置 PhotoCraft 精绘砂岩 + 苔藓 PBR')
})

const handlePhotoCraftImport = async (target: 'stone' | 'moss', files: FileList | null) => {
  if (!files || files.length === 0) return
  try {
    const base = polyCCustomPbrLayers ?? await loadDefaultPhotoCraftPbrLayers()
    const fallback = target === 'moss' ? (base.moss ?? base.stone) : base.stone
    const { set, matched } = await decodePhotoCraftPbrFiles(files, fallback)
    polyCCustomPbrLayers = {
      label: `🎨 自定义 PhotoCraft (${target === 'moss' ? '苔藓' : '石体'}: ${matched.join('/')})`,
      stone: target === 'stone' ? set : base.stone,
      moss: target === 'moss' ? set : base.moss,
    }
    polyCWorkerClient.setExternalPbr(polyCCustomPbrLayers)
    polyCParams.mode = 'photocraft-pbr'
    syncPolyCPanel()
    if (polyCProtoActive) submitPolyCJob('bake', false)
    message(`已导入 PhotoCraft ${target === 'moss' ? '苔藓' : '石体'} PBR：${matched.join(' + ')}`)
  } catch (err) {
    message(err instanceof Error ? `PhotoCraft 贴图导入失败：${err.message}` : 'PhotoCraft 贴图导入失败', true)
  }
}
byId<HTMLInputElement>('polyc-pc-stone-file').addEventListener('change', ev => {
  const input = ev.target as HTMLInputElement
  void handlePhotoCraftImport('stone', input.files).finally(() => { input.value = '' })
})
byId<HTMLInputElement>('polyc-pc-moss-file').addEventListener('change', ev => {
  const input = ev.target as HTMLInputElement
  void handlePhotoCraftImport('moss', input.files).finally(() => { input.value = '' })
})

document.querySelectorAll<HTMLButtonElement>('[data-polyc-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.polycMode as PolyPbrMode
    if (!next || polyCParams.mode === next) return
    polyCParams.mode = next
    polyCAutoBakeAfterPreview = false
    syncPolyCPanel()
    submitPolyCJob('bake', false)
  })
})

const polyCBoxEl = byId('rk-polyc-proto-box')
byId('polyc-reseed').addEventListener('click', randomizeSeed)
polyCBoxEl.addEventListener('input', ev => {
  if (!polyCProtoActive) return
  const t = ev.target as HTMLInputElement
  if (t.id === 'polyc-seed') {
    polyCParams.seed = Math.max(0, Math.round(Number(t.value) || 0))
    polyCAutoBakeAfterPreview = false
    submitPolyCJob('preview', false)
    return
  }
  if (t.id === 'polyc-color') {
    polyCParams.baseColorHex = t.value
    if (polyCActiveMat && polyCActiveTextures.length === 0 && viewMode !== 'clay') {
      polyCActiveMat.color.set(t.value)
    }
    return
  }
  const key = (t.dataset.polycR || t.dataset.polycN) as 'shoulderDepth' | 'bevelScale' | 'notchDepth' | 'strataStrength' | undefined
  if (!key) return
  const raw = Number(t.value)
  if (!Number.isFinite(raw)) return
  const bounds: Record<typeof key, [number, number]> = {
    shoulderDepth: [0.65, 1.35],
    bevelScale: [0, 1.4],
    notchDepth: [0.5, 1.4],
    strataStrength: [0, 1.5],
  }
  const [lo, hi] = bounds[key]
  const v = Math.min(hi, Math.max(lo, raw))
  polyCParams[key] = v
  const rEl = polyCBoxEl.querySelector<HTMLInputElement>(`[data-polyc-r="${key}"]`)
  const nEl = polyCBoxEl.querySelector<HTMLInputElement>(`[data-polyc-n="${key}"]`)
  if (rEl && rEl !== t) rEl.value = String(v)
  if (nEl && nEl !== t) nEl.value = String(Number(v.toFixed(2)))
  polyCAutoBakeAfterPreview = false
  // Geometry sliders show live clay preview during drag; strataStrength only affects 512 PBR bake (wait for release)
  if (key !== 'strataStrength') submitPolyCJob('preview', false)
})

polyCBoxEl.addEventListener('change', () => {
  if (!polyCProtoActive) return
  polyCAutoBakeAfterPreview = false
  submitPolyCJob('bake', false)
})

document.querySelectorAll<HTMLButtonElement>('[data-sdf-arch]').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.sdfArch as SdfProtoArchetype
    if (!next || sdfParams.archetype === next) return
    sdfParams.archetype = next
    sdfLastBakeStats = null
    sdfAutoBakeAfterPreview = true
    syncSdfPanel()
    submitSdfJob('preview', true)
  })
})

const sdfBoxEl = byId('rk-sdf-proto-box')
byId('sdf-reseed').addEventListener('click', randomizeSeed)
sdfBoxEl.addEventListener('input', ev => {
  if (!sdfProtoActive) return
  const t = ev.target as HTMLInputElement | HTMLSelectElement
  if (t.id === 'sdf-seed') {
    sdfParams.seed = Math.max(0, Math.round(Number(t.value) || 0))
    sdfAutoBakeAfterPreview = false
    submitSdfJob('preview', false)
    return
  }
  if (t.id === 'sdf-color') {
    sdfParams.baseColorHex = t.value
    if (sdfActiveMat && sdfActiveTextures.length === 0 && viewMode !== 'clay') {
      sdfActiveMat.color.set(t.value)
    }
    return
  }
  if (t.id === 'sdf-brush') {
    sdfParams.brushMode = t.value === 'subtle' ? 'subtle' : 'off'
    sdfAutoBakeAfterPreview = false
    submitSdfJob('bake', false)
    return
  }
  const key = (t.dataset.sdfR || t.dataset.sdfN) as 'carveDepth' | 'ridgeCrispness' | 'crackStrength' | undefined
  if (!key) return
  const raw = Number(t.value)
  if (!Number.isFinite(raw)) return
  const bounds: Record<typeof key, [number, number]> = {
    carveDepth: [0.55, 1.45],
    ridgeCrispness: [0, 1],
    crackStrength: [0, 1.5],
  }
  const [lo, hi] = bounds[key]
  const v = Math.min(hi, Math.max(lo, raw))
  sdfParams[key] = v
  const rEl = sdfBoxEl.querySelector<HTMLInputElement>(`[data-sdf-r="${key}"]`)
  const nEl = sdfBoxEl.querySelector<HTMLInputElement>(`[data-sdf-n="${key}"]`)
  if (rEl && rEl !== t) rEl.value = String(v)
  if (nEl && nEl !== t) nEl.value = String(Number(v.toFixed(2)))
  sdfAutoBakeAfterPreview = false
  submitSdfJob('preview', false)
})

sdfBoxEl.addEventListener('change', ev => {
  if (!sdfProtoActive) return
  const t = ev.target as HTMLInputElement | HTMLSelectElement
  if (t.id === 'sdf-brush') return
  sdfAutoBakeAfterPreview = false
  submitSdfJob('bake', false)
})

// Bind shading style toggle
document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.style as RockStyle
    if (spec.style === next) return
    rockHistory.push(spec)
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
    rockHistory.push(spec)
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
    rockHistory.beginGesture(spec)
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
    if (t.value.trim() === '') return
    const raw = Number(t.value)
    if (!Number.isFinite(raw)) return
    const b = rangeBoundsByPath.get(t.dataset.n)
    const v = b ? Math.min(b.max, Math.max(b.min, raw)) : raw
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
  if (t.id === 'seed') {
    rockHistory.commitGesture()
    return
  }
  const path = t.dataset.r || t.dataset.n || t.dataset.c
  if (!path) return
  if (t.dataset.n) {
    const b = rangeBoundsByPath.get(path)
    const cur = Number(getPath(spec, path) ?? b?.min ?? 0)
    t.value = String(Number(cur.toFixed(3)))
  }
  rockHistory.commitGesture()
  if (livePaths.has(path) && vertexColorsDirty) rebuild(false)
})

window.addEventListener('keydown', ev => {
  const target = ev.target as HTMLElement | null
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(target.type)))) return
  if (!(ev.ctrlKey || ev.metaKey)) return
  const k = ev.key.toLowerCase()
  if (k === 'z' && !ev.shiftKey) {
    const prev = rockHistory.undo(spec)
    if (prev) { ev.preventDefault(); spec = prev; syncPanel(); rebuild(false); message('已撤销石头参数修改') }
  } else if (k === 'y' || (k === 'z' && ev.shiftKey)) {
    const next = rockHistory.redo(spec)
    if (next) { ev.preventDefault(); spec = next; syncPanel(); rebuild(false); message('已重做石头参数修改') }
  }
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
  if (polyCProtoActive) {
    enterPolyCProto(true, polyCParams.preset)
    message(`已恢复路线 C2 ${POLYC_PRESET_META[polyCParams.preset].label}默认参数`)
    return
  }
  if (sdfProtoActive) {
    enterSdfProto(true)
    message('已恢复 SDF 实验阶梯方巨岩默认参数')
    return
  }
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
    if (polyCProtoActive) applyPolyCViewMode()
    else if (sdfProtoActive) applySdfViewMode()
    else updateRockMaterialLive(rockMaterial, spec, viewMode)
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
  if (polyCProtoActive) {
    const c2Spec = currentPolyCSpec()
    const blob = new Blob([JSON.stringify(c2Spec, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `${c2Spec.preset}-${c2Spec.seed}.rock.json`)
    message('已导出路线 C2 石头参数 JSON')
    return
  }
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `${spec.preset}-${spec.seed}.rock.json`)
  message('已导出石头参数 JSON')
})

byId('import').addEventListener('click', () => byId<HTMLInputElement>('file').click())
byId<HTMLInputElement>('file').addEventListener('change', async ev => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const raw = JSON.parse(await file.text()) as Record<string, unknown>
    if (typeof raw?.preset === 'string' && (polyCRockPresetIds as readonly string[]).includes(raw.preset)) {
      const c2 = parsePolyCRockSpec(raw)
      applyPolyCRockSpecToStudio(c2)
      message(`已导入路线 C2 石头参数：${c2.name}`)
    } else {
      const parsed = parseRockSpec(raw)
      exitPolyCProto()
      exitSdfProto()
      rockHistory.clear()
      presetId = parsed.preset
      spec = parsed
      userDirty = false
      syncPanel()
      rebuild(true)
      message(`已导入石头参数：${parsed.name}`)
    }
  } catch (err) {
    message(err instanceof Error ? `JSON 解析失败：${err.message}` : 'JSON 解析失败', true)
  } finally {
    ;(ev.target as HTMLInputElement).value = ''
  }
})

byId('png').addEventListener('click', () => {
  if (!viewer) return
  const dataUrl = viewer.snapshot()
  const fname = polyCProtoActive
    ? `polyc-${polyCParams.preset}-${polyCParams.mode}-${polyCParams.seed}.png`
    : sdfProtoActive
      ? `sdf-${sdfParams.archetype}-${sdfParams.seed}.png`
      : `${spec.preset}-${spec.seed}.png`
  fetch(dataUrl).then(r => r.blob()).then(b => downloadBlob(b, fname)).catch(() => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = fname
    a.click()
  })
  message('已保存 3D 截图 PNG')
})

byId('png-alpha').addEventListener('click', () => {
  if (!viewer) return
  const dataUrl = viewer.snapshot({ transparent: true })
  const fname = polyCProtoActive
    ? `polyc-${polyCParams.preset}-${polyCParams.mode}-${polyCParams.seed}_transparent.png`
    : sdfProtoActive
      ? `sdf-${sdfParams.archetype}-${sdfParams.seed}_transparent.png`
      : `${spec.preset}-${spec.seed}_transparent.png`
  activityLog.exportStep(`导出透明背景 PNG：${fname}`, { filename: fname, viewMode, camera })
  fetch(dataUrl).then(r => r.blob()).then(b => downloadBlob(b, fname)).catch(() => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = fname
    a.click()
  })
  message('已保存透明底 3D 截图 PNG')
})

bindGlbExportPopover({
  triggerButton: byId<HTMLButtonElement>('glb'),
  getRoot: () => built?.group,
  onBeforeExport: () => { if (!sdfProtoActive && !polyCProtoActive && vertexColorsDirty) rebuild(false) },
  exportBlob: opts => exportGlb(built!.group, opts),
  getFilename: opts => {
    const stem = polyCProtoActive
      ? `polyc-${polyCParams.preset}-${polyCParams.mode}-${polyCParams.seed}`
      : sdfProtoActive
        ? `sdf-${sdfParams.archetype}-${sdfParams.seed}`
        : `${spec.preset}-${spec.seed}`
    return `${stem}${opts.mode === 'merged' ? '-merged' : ''}.glb`
  },
  saveBlob: downloadBlob,
  message,
})

// ---- Rock Preset Library (Save / Rename / Overwrite / Delete / Built-in Manage & Hide/Restore) ----
type RockLibraryPayload = RockSpec | PolyCRockSpec
interface RockLibrarySnapshot {
  polyCProtoActive: boolean
  sdfProtoActive: boolean
  presetId: RockPresetId
  spec: RockSpec
  polyCParams: PolyCProtoParams
  lighting: LightingPreset
}

function isPolyCRockSpec(p: RockLibraryPayload): p is PolyCRockSpec {
  return (polyCRockPresetIds as readonly string[]).includes(p.preset)
}

function currentPolyCSpec(): PolyCRockSpec {
  return {
    version: 1,
    preset: polyCParams.preset,
    name: polyCRockPresets[polyCParams.preset].name,
    mode: polyCParams.mode,
    seed: polyCParams.seed,
    shoulderDepth: polyCParams.shoulderDepth,
    bevelScale: polyCParams.bevelScale,
    notchDepth: polyCParams.notchDepth,
    strataStrength: polyCParams.strataStrength,
    baseColor: polyCParams.baseColorHex,
  }
}

function applyPolyCRockSpecToStudio(c2: PolyCRockSpec) {
  exitSdfProto()
  polyCParams = {
    preset: c2.preset,
    mode: c2.mode,
    seed: c2.seed,
    shoulderDepth: c2.shoulderDepth,
    bevelScale: c2.bevelScale,
    notchDepth: c2.notchDepth,
    strataStrength: c2.strataStrength,
    baseColorHex: c2.baseColor,
  }
  polyCProtoActive = true
  byId('rk-polyc-proto-btn').setAttribute('aria-pressed', 'true')
  byId('rk-polyc-proto-box').hidden = false
  byId('rk-legacy-controls').hidden = true
  syncPolyCPanel()
  polyCAutoBakeAfterPreview = true
  submitPolyCJob('preview', true)
}

const rockBuiltInShowcases: ShowcaseOption<RockLibraryPayload>[] = [
  ...([...polyCRockPresetIds].reverse().map((cid): ShowcaseOption<RockLibraryPayload> => ({
    id: `rock-c2:${cid}`,
    name: polyCRockPresets[cid].name,
    subtitle: polyCRockPresets[cid].subtitle,
    tag: '路线 C2',
    lighting: 'neutral',
    thumbnail: '',
    build: () => defaultPolyCRockSpec(cid),
  }))),
  ...rockPresetIds.map((rid): ShowcaseOption<RockLibraryPayload> => ({
    id: `rock:${rid}`,
    name: rockPresets[rid].name,
    subtitle: rockPresets[rid].style === 'cel' ? '赛璐璐风格切面岩' : rockPresets[rid].style === 'handpainted' ? '手绘裂纹雕塑岩' : '厚涂切面风格岩',
    tag: presetBadges[rid],
    lighting: 'neutral',
    thumbnail: '',
    build: () => effectivePresetState(rid).spec,
  })),
]

const presetStore = createPresetStore()
const hiddenRockStore = createHiddenShowcaseStore({
  validIds: rockBuiltInShowcases.map(s => s.id),
  storageKey: 'vegetation-studio:rock-hidden-presets:v1',
})

const applyRockPresetPayload = (preset: SavedPreset<RockLibraryPayload>) => {
  setLightingMood(preset.lighting)
  if (isPolyCRockSpec(preset.payload)) {
    applyPolyCRockSpecToStudio(parsePolyCRockSpec(preset.payload))
  } else {
    exitPolyCProto()
    exitSdfProto()
    rockHistory.clear()
    const parsed = parseRockSpec(preset.payload)
    presetId = parsed.preset
    spec = parsed
    userDirty = false
    syncPanel()
    rebuild(true)
  }
}

const presetLibrary = mountPresetLibrary<RockLibraryPayload, RockLibrarySnapshot>({
  scope: 'rock',
  store: presetStore,
  showcasesTabLabel: '🪨 内置预设',
  mineTabLabel: '★ 我的石头',
  showcases: rockBuiltInShowcases,
  getHiddenShowcaseIds: () => hiddenRockStore.hiddenIds(),
  deleteShowcase: async sc => { await hiddenRockStore.hide(sc.id) },
  restoreShowcases: async () => { await hiddenRockStore.restoreAll() },
  capture: () => {
    if (polyCProtoActive) {
      const c2 = currentPolyCSpec()
      const triCount = polyCPreviewMesh?.geometry.index
        ? Math.round(polyCPreviewMesh.geometry.index.count / 3)
        : (built?.stats.triangles ?? 0)
      return {
        defaultName: c2.name,
        kind: 'rock-c2',
        kindLabel: '路线 C2 · 512 PBR',
        triangles: triCount,
        lighting,
        thumbnail: captureViewportThumbnail(viewer),
        payload: c2,
      }
    }
    return {
      defaultName: spec.name,
      kind: 'rock',
      kindLabel: spec.style === 'cel' ? '赛璐璐岩' : spec.style === 'handpainted' ? '手绘裂纹' : '厚涂切面',
      triangles: built?.stats.triangles ?? 0,
      lighting,
      thumbnail: captureViewportThumbnail(viewer),
      payload: deepClone(spec),
    }
  },
  snapshotState: () => ({
    polyCProtoActive,
    sdfProtoActive,
    presetId,
    spec: deepClone(spec),
    polyCParams: { ...polyCParams },
    lighting,
  }),
  restoreState: snap => {
    setLightingMood(snap.lighting)
    if (snap.polyCProtoActive) {
      applyPolyCRockSpecToStudio({
        version: 1,
        preset: snap.polyCParams.preset,
        name: polyCRockPresets[snap.polyCParams.preset].name,
        mode: snap.polyCParams.mode,
        seed: snap.polyCParams.seed,
        shoulderDepth: snap.polyCParams.shoulderDepth,
        bevelScale: snap.polyCParams.bevelScale,
        notchDepth: snap.polyCParams.notchDepth,
        strataStrength: snap.polyCParams.strataStrength,
        baseColor: snap.polyCParams.baseColorHex,
      })
    } else {
      exitPolyCProto()
      exitSdfProto()
      presetId = snap.presetId
      spec = deepClone(snap.spec)
      syncPanel()
      rebuild(true)
    }
  },
  preview: applyRockPresetPayload,
  apply: applyRockPresetPayload,
  message: (text, err) => message(text, err),
})

const syncRockPresetBadge = () => {
  byId('rk-preset-count').textContent = String(presetStore.list('rock').length)
}
const syncHiddenBuiltInRocks = () => {
  const hidden = hiddenRockStore.hiddenIds()
  document.querySelectorAll<HTMLButtonElement>('#rk-preset-grid [data-preset]').forEach(btn => {
    btn.hidden = hidden.has(`rock:${btn.dataset.preset}`)
  })
  document.querySelectorAll<HTMLButtonElement>('[data-polyc-preset]').forEach(btn => {
    btn.hidden = hidden.has(`rock-c2:${btn.dataset.polycPreset}`)
  })
  const restoreBox = byId('rk-hidden-restore')
  const count = hidden.size
  restoreBox.hidden = count === 0
  if (count > 0) {
    byId('rk-hidden-restore-text').textContent = `已删除/隐藏 ${count} 个内置预设`
  }
  presetLibrary.refreshShowcases()
}

byId('rk-hidden-restore-btn').addEventListener('click', () => {
  void hiddenRockStore.restoreAll().then(n => {
    syncHiddenBuiltInRocks()
    message(n > 0 ? `已恢复全部 ${n} 个内置石头预设` : '内置石头预设已为完整状态')
  }).catch(err => message(err, true))
})

presetStore.subscribe(syncRockPresetBadge)
void presetStore.ready().then(syncRockPresetBadge)
syncRockPresetBadge()

hiddenRockStore.subscribe(syncHiddenBuiltInRocks)
void hiddenRockStore.ready().then(syncHiddenBuiltInRocks)
syncHiddenBuiltInRocks()

const activityLogDrawer = mountActivityLogDrawer({
  triggerButton: byId<HTMLButtonElement>('activity-log-btn'),
  badgeElement: byId('al-badge'),
  onBeforeOpen: () => presetLibrary.close(),
  message: (text, err) => message(text, err, false),
})

byId('rk-save-preset').addEventListener('click', () => {
  activityLogDrawer.close()
  presetLibrary.open(true, 'mine')
})
byId('rk-open-presets').addEventListener('click', () => {
  activityLogDrawer.close()
  presetLibrary.toggle('mine')
})

// Expose clean automation & debug handle
;(window as unknown as Record<string, unknown>).__activityLog = {
  store: activityLog,
  open: () => activityLogDrawer.open(),
  close: () => activityLogDrawer.close(),
  entries: () => activityLog.entries(),
  counts: () => activityLog.counts(),
  exportJson: () => activityLog.exportJson(),
  exportText: () => activityLog.exportText(),
  clear: () => activityLog.clear(),
}
;(window as unknown as Record<string, unknown>).__rockStudio = {
  getSpec: () => parseRockSpec(spec),
  setPreset: (id: RockPresetId | PolyCsgPresetId) => {
    if (id in POLYC_PRESET_META) {
      enterPolyCProto(true, id as PolyCsgPresetId)
      return built?.stats
    }
    loadPreset(id as RockPresetId)
    return built?.stats
  },
  setParam: (path: string, value: unknown, final = true) => { applyParam(path, value, final); syncPanel(); return built?.stats },
  setStyle: (style: RockStyle) => { spec.style = style; syncPanel(); rebuild(false); return built?.stats },
  setView: (v: RockViewMode) => {
    viewMode = v
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)))
    if (polyCProtoActive) applyPolyCViewMode()
    else if (sdfProtoActive) applySdfViewMode()
    else updateRockMaterialLive(rockMaterial, spec, viewMode)
  },
  setCamera: (c: Camera) => {
    camera = c
    document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.camera === c)))
    viewer?.frame(c, built?.bounds.getCenter(new Vector3()))
  },
  setLighting: (l: LightingPreset) => {
    setLightingMood(l)
  },
  enableSdfProto: (reset = false) => {
    enterSdfProto(reset)
  },
  exitSdfProto: () => {
    exitSdfProto()
    syncPanel()
    rebuild(true)
  },
  isSdfProtoActive: () => sdfProtoActive,
  setSdfProtoParam: (
    key: keyof SdfProtoParams,
    value: number | string,
    stage: 'preview' | 'bake' = 'preview',
  ) => {
    if (!sdfProtoActive) enterSdfProto(false)
    ;(sdfParams as unknown as Record<string, unknown>)[key] = value
    syncSdfPanel()
    sdfAutoBakeAfterPreview = false
    submitSdfJob(stage, false)
    return sdfWorkerClient.getStats().latestJobId
  },
  getSdfProtoMetrics: () => ({
    active: sdfProtoActive,
    currentParams: { ...sdfParams },
    appliedParams: sdfAppliedParams ? { ...sdfAppliedParams } : null,
    clientStats: sdfWorkerClient.getStats(),
    previewToFirstFrameMs: [...sdfMetrics.previewToFirstFrameMs],
    releaseToMaterialVisibleMs: [...sdfMetrics.releaseToMaterialVisibleMs],
    appliedHistory: [...sdfMetrics.appliedHistory],
    lastBakeStats: sdfLastBakeStats,
  }),
  enablePolyCProto: (reset = false, nextPreset?: PolyCsgPresetId) => {
    enterPolyCProto(reset, nextPreset)
  },
  exitPolyCProto: () => {
    exitPolyCProto()
    syncPanel()
    rebuild(true)
  },
  isPolyCProtoActive: () => polyCProtoActive,
  setPolyCProtoParam: (
    key: keyof PolyCProtoParams,
    value: number | string,
    stage: 'preview' | 'bake' = 'preview',
  ) => {
    if (!polyCProtoActive) enterPolyCProto(false)
    ;(polyCParams as unknown as Record<string, unknown>)[key] = value
    syncPolyCPanel()
    polyCAutoBakeAfterPreview = false
    submitPolyCJob(stage, false)
    return polyCWorkerClient.getStats().latestJobId
  },
  getPolyCProtoMetrics: () => ({
    active: polyCProtoActive,
    currentParams: { ...polyCParams },
    appliedParams: polyCAppliedParams ? { ...polyCAppliedParams } : null,
    clientStats: polyCWorkerClient.getStats(),
    previewToFirstFrameMs: [...polyCMetrics.previewToFirstFrameMs],
    releaseToMaterialVisibleMs: [...polyCMetrics.releaseToMaterialVisibleMs],
    appliedHistory: [...polyCMetrics.appliedHistory],
    lastBakeStats: polyCLastBakeStats,
    lastUvAudit: polyCLastUvAudit,
  }),
  snapshotCanvas: (opts?: { transparent?: boolean }) => viewer?.snapshot({ transparent: Boolean(opts?.transparent) }) ?? '',
  snapshotTransparentCanvas: () => viewer?.snapshot({ transparent: true }) ?? '',
  stats: () => ({ ...built?.stats, buildCount }),
  ready: () => rockDefaults.ready(),
  saveAsDefault: () => saveCurrentAsDefault(),
  resetFactory: () => resetCurrentToFactory(),
  hasDefaultOverride: (id?: RockPresetId) => rockDefaults.has(id ?? presetId),
  exportGlbSize: async () => {
    if (!built) return 0
    if (!sdfProtoActive && !polyCProtoActive && vertexColorsDirty) rebuild(false)
    const blob = await exportGlb(built.group, { mode: 'merged', excludeDecorations: false })
    return blob.size
  },
  exportGlbBase64: async () => {
    if (!built) return ''
    if (!sdfProtoActive && !polyCProtoActive && vertexColorsDirty) rebuild(false)
    const blob = await exportGlb(built.group, { mode: 'merged', excludeDecorations: false })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(bin)
  },
  presets: {
    store: presetStore,
    hiddenStore: hiddenRockStore,
    open: (focus?: boolean, tab?: 'mine' | 'showcases') => presetLibrary.open(focus, tab),
    close: () => presetLibrary.close(),
    list: () => presetStore.list<RockLibraryPayload>('rock'),
    hiddenBuiltIns: () => hiddenRockStore.listHiddenIds(),
    deleteBuiltIn: (id: string) => hiddenRockStore.hide(id),
    restoreBuiltIns: () => hiddenRockStore.restoreAll(),
  },
}

// Initial boot + disk override sync
setLightingMood(lighting)
syncPanel()
rebuild(true)
void rockDefaults.ready().then(() => {
  if (!userDirty && !sdfProtoActive && !polyCProtoActive) {
    const diskState = effectivePresetState(presetId)
    if (JSON.stringify(diskState.spec) !== JSON.stringify(spec) || diskState.lighting !== lighting) {
      spec = diskState.spec
      setLightingMood(diskState.lighting)
      rebuild(true)
    }
  }
  syncPanel()
})

mountDesktopToolbarBadge('header.bar nav', msg => message(msg))
