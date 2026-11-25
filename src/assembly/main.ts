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
import { blobToBase64, mountDesktopToolbarBadge, tryDesktopSaveBlob } from '../studio/desktop-bridge'
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
  defaultGrassBrushOptions, GRASS_SPECIES_LIST, PaintedGrassLayer, syncGrassRvtUniforms,
  type GrassBrushOptions,
} from './grass-brush'
import { createRefCompareController, type RefCompareController } from './ref-compare-ui'
import {
  builtInAssemblyCases, curatedAssemblyAssets, getBuiltInAssemblyCase,
} from './showcases'
import {
  backdropMeta, blankAssemblyScene, categoryIcons, categoryLabels, cloneJson,
  createAiItem, createRockItem, createTreeItem, defaultGrassRvtSpec, detectImportedAssetJson,
  inferCategoryFromTree, makeItemId, parseAssemblyScene,
  type AssemblyBarkStyle, type AssemblyCameraPreset, type AssemblyItem,
  type AssemblyReferenceSpec, type AssemblySceneSpec, type BackdropTheme,
  type GrassRvtMode, type GrassRvtSpec, type GrassSpeciesId, type GroundStyle,
  type PathLayout, type RefCompareMode,
} from './spec'
import { createAssemblySceneStore } from './store'
import {
  clearSceneEditSession, createSceneEditSessionAsync, loadSceneEditSessionAsync,
  subscribeSceneEditUpdates,
} from './studio-bridge'
import {
  defaultTerrainBrushOptions, TERRAIN_MATERIALS,
  type TerrainBrushOptions, type TerrainMaterialId,
} from './terrain-brush'
import { compareSceneReference } from './reference'
import { AssemblyViewport, type GizmoMode } from './viewport'

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const fmt = new Intl.NumberFormat('zh-CN')
const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

type PaletteTab = 'mine' | 'featured' | 'trees' | 'plants' | 'rocks'
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
    <button id="as-tree-lib-btn" class="pl-open-btn" title="同步并查看树木工作台资产库（我的预设 + 已改默认预设）">🌳 树木资产库<span class="pl-badge" id="as-tree-lib-badge">0</span></button>
    <button id="as-cases-btn" class="pl-showcase-btn" title="打开参考案例与我保存的组装场景">✿ 场景案例<span class="pl-badge" id="as-cases-badge">${builtInAssemblyCases.length}</span></button>
    <button id="as-save-btn" class="pl-save-btn" title="带 3D 封面保存当前组装场景为案例">★ 保存场景</button>
    <button id="as-clear-btn" title="清空所有已摆放资产">清空画布</button>
    <input id="as-scene-file" type="file" accept=".json,application/json" hidden>
    <button id="as-import-btn" title="导入组装场景或单个树木/花草/石头 JSON">导入 JSON</button>
    <button id="as-json-btn" title="导出当前组装场景 JSON 工程文件">保存 JSON</button>
    <button id="as-png-btn" title="截取当前 3D 画面 PNG">截图 PNG</button>
    <button id="as-png-alpha-btn" title="导出透明背景抠图 PNG（自动隐藏背景、阴影底板与辅助线）">透明底 PNG</button>
    <button id="glb" class="primary" title="导出 GLB / 拆分 glTF+贴图 / FBX+TEX">导出 GLB/FBX</button>
    <button id="activity-log-btn" class="al-open-btn" title="查看每一步操作与导出诊断日志">📋 日志<span class="pl-badge" id="al-badge">0</span></button>
  </nav>
</header>

<section class="as-workspace">
  <!-- Left Asset Palette -->
  <aside class="panel as-panel" aria-label="资产摆放库">
    <header class="as-panel-head">
      <h2>资产摆放库</h2>
      <button type="button" id="as-sync-lib-btn" class="as-sync-btn" title="立即从树木/石头工作台同步最新保存的预设与贴图">↻ 同步树库</button>
    </header>
    <div class="as-palette-tabs" role="tablist">
      <button type="button" data-ptab="mine" aria-pressed="true" title="树木工作台与 AI 模式保存的「我的预设库」及已改默认预设">★ 我的库</button>
      <button type="button" data-ptab="featured" aria-pressed="false">✿ 精选</button>
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
        <button type="button" id="as-brush-toggle" class="as-head-toggle" aria-pressed="false" title="UE 风格植被刷草笔刷（开启时锁定所有模型防止误移 · 快捷键 B）">🌿 刷草笔刷 B</button>
        <button type="button" id="as-terrain-toggle" class="as-head-toggle" aria-pressed="false" title="UE 风格地形材质笔刷（绘制草地/沙土/苔藓/碎岩并实时驱动 RVT 草色 · 快捷键 T）">🎨 地形笔刷 T</button>
        <button type="button" id="as-ref-toggle" class="as-head-toggle" aria-pressed="false" title="打开参考图对比工具（支持上传/拖放/粘贴，浮窗/卷帘/叠图/并排）">🖼 参考图对比</button>
        <button type="button" id="as-wind-btn" class="as-head-toggle" aria-pressed="true" title="开关微风动画（树木、灌木、花朵与刷草同步摇曳）">🍃 微风</button>
        <button type="button" id="as-distant-lod-btn" class="as-head-toggle" aria-pressed="false" title="开启远景自动 LOD（0m原精 / 18m标准 / 36m轻量，共享材质；导出 GLB 始终为完整 LOD0）">⚡ 远景 LOD</button>
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
      <div class="as-brush-hud" id="as-brush-hud" hidden></div>
      <div class="as-load-progress" id="as-load-progress" role="status" aria-live="polite" hidden>
        <span id="as-load-progress-text">加载场景 0/0…</span>
        <div class="as-load-progress-track"><div class="as-load-progress-fill" id="as-load-progress-fill"></div></div>
      </div>
      <div class="gesture" id="as-gesture-hint">单击选中资产 · W移动 E旋转 R缩放 G贴地 B刷草 · 左键旋转视角 · 滚轮缩放 · 右键平移</div>
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
          <button type="button" id="as-act-edit-tree" class="as-edit-tree-btn" hidden title="跳转至树木工作台精修该植物，编辑完成后一键返回并实时更新到本场景">✎ 在树木工作台编辑（完成后实时更新）</button>
          <button type="button" id="as-act-save-preset" class="as-save-lib-btn" hidden title="将当前选中的植物连同自定义贴图保存到树木工作台共享预设库">★ 存回树木工作台预设库</button>
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

      <!-- UE-Style Grass Paint Brush Card -->
      <section class="as-card as-brush-card" id="as-brush-card">
        <details class="as-ground-details" id="as-brush-details">
          <summary>🌿 刷草笔刷（UE 植被笔刷） <span id="as-brush-badge" class="pl-badge" style="margin-left:4px">0 簇</span></summary>
          <div class="as-brush-top-row">
            <button type="button" id="as-brush-power" class="as-brush-power" aria-pressed="false">▶ 开启刷草笔刷 (快捷键 B)</button>
          </div>
          <div class="as-brush-modes" role="group" aria-label="刷草笔刷模式">
            <button type="button" data-bmode="paint" aria-pressed="true">🖌 绘制草丛</button>
            <button type="button" data-bmode="erase" aria-pressed="false">🧹 擦除 (按住 Shift)</button>
          </div>
          <div class="as-species-grid" id="as-brush-species">
            ${GRASS_SPECIES_LIST.map(sp => `
              <label class="as-species-chip" title="${esc(sp.subtitle)}">
                <input type="checkbox" value="${sp.id}" ${sp.id === 'broad' || sp.id === 'narrow' || sp.id === 'dense' ? 'checked' : ''}>
                <span class="as-species-dot" style="background:${sp.swatch}"></span>
                <span>${esc(sp.label)}</span>
              </label>
            `).join('')}
          </div>
          <div class="as-range-row">
            <span>笔刷半径</span>
            <input type="range" id="as-b-radius" min="0.25" max="3.5" step="0.05" value="1.05">
            <output id="as-b-radius-out">1.05m</output>
          </div>
          <div class="as-range-row">
            <span>绘制密度</span>
            <input type="range" id="as-b-density" min="2" max="120" step="2" value="24">
            <output id="as-b-density-out">24</output>
          </div>
          <div class="as-range-row">
            <span>最小间距</span>
            <input type="range" id="as-b-spacing" min="0.04" max="0.75" step="0.01" value="0.18">
            <output id="as-b-spacing-out">0.18m</output>
          </div>
          <div class="as-range-row">
            <span>最小缩放</span>
            <input type="range" id="as-b-smin" min="0.30" max="1.60" step="0.02" value="0.72">
            <output id="as-b-smin-out">0.72×</output>
          </div>
          <div class="as-range-row">
            <span>最大缩放</span>
            <input type="range" id="as-b-smax" min="0.50" max="2.50" step="0.02" value="1.32">
            <output id="as-b-smax-out">1.32×</output>
          </div>
          <div class="as-range-row">
            <span>随机倾角</span>
            <input type="range" id="as-b-tilt" min="0" max="30" step="1" value="10">
            <output id="as-b-tilt-out">10°</output>
          </div>
          <div class="as-select-row">
            <span>草叶色调</span>
            <input type="color" id="as-b-tint" value="#eef8e2" title="整体染色（浅白绿保留各草种本色）">
          </div>
          <div class="as-range-row">
            <span>自然色差</span>
            <input type="range" id="as-b-tvar" min="0" max="0.45" step="0.01" value="0.16">
            <output id="as-b-tvar-out">16%</output>
          </div>
          <label class="as-brush-check">
            <input type="checkbox" id="as-b-avoid-path" checked>
            <span>避开沙土小径（自动沿路缘生长）</span>
          </label>
          <div class="as-brush-acts">
            <button type="button" id="as-brush-fill" title="按当前参数一键均匀铺满整个草坪区">✨ 一键铺满草地</button>
            <button type="button" id="as-brush-clear" class="is-danger" title="清空全部笔刷刷出的草丛">🗑 清空刷草</button>
          </div>
          <div class="as-brush-meta">
            <span id="as-brush-stats">0 簇 · 0 Draw Calls</span>
            <span>[ / ] 或 Shift+滚轮 调半径</span>
          </div>
          <div class="as-rvt-box">
            <div class="as-rvt-head">
              <span>🎨 RVT 地表融合算法</span>
              <span class="as-rvt-tag" id="as-rvt-tag">UE RVT 已开启</span>
            </div>
            <div class="as-select-row">
              <span>融合算法</span>
              <select id="as-rvt-mode" title="Runtime Virtual Texture 地表采样融合模式，让草叶根部与地形纹理无缝过渡">
                <option value="root-blend">根部融合 (UE RVT)</option>
                <option value="full-tint">全株跟随地表 (油画草海)</option>
                <option value="normal-only">仅法线无缝融合</option>
                <option value="off">关闭 (保持草种原色)</option>
              </select>
            </div>
            <div class="as-rvt-params" id="as-rvt-params">
              <div class="as-range-row">
                <span>融合强度</span>
                <input type="range" id="as-rvt-strength" min="0" max="1" step="0.02" value="0.9">
                <output id="as-rvt-strength-out">90%</output>
              </div>
              <div class="as-range-row">
                <span>过渡高度</span>
                <input type="range" id="as-rvt-height" min="0.05" max="0.65" step="0.01" value="0.26">
                <output id="as-rvt-height-out">0.26m</output>
              </div>
              <div class="as-range-row">
                <span>法线贴地</span>
                <input type="range" id="as-rvt-normal" min="0" max="1" step="0.02" value="0.82">
                <output id="as-rvt-normal-out">82%</output>
              </div>
              <label class="as-brush-check">
                <input type="checkbox" id="as-rvt-placed" checked>
                <span>同步融合已摆放草丛资产</span>
              </label>
            </div>
          </div>
        </details>
      </section>

      <!-- UE Landscape-Style Terrain Material Paint Brush Card -->
      <section class="as-card as-terrain-card" id="as-terrain-card">
        <details class="as-ground-details" id="as-terrain-details">
          <summary>🎨 地形材质笔刷（地表手绘） <span id="as-terrain-badge" class="pl-badge" style="margin-left:4px">未手绘</span></summary>
          <div class="as-brush-top-row">
            <button type="button" id="as-terrain-power" class="as-terrain-power" aria-pressed="false">▶ 开启地形材质笔刷 (快捷键 T)</button>
          </div>
          <div class="as-brush-modes" role="group" aria-label="地形笔刷模式">
            <button type="button" data-tmode="paint" aria-pressed="true">🖌 绘制材质</button>
            <button type="button" data-tmode="erase" aria-pressed="false">🧽 还原基底 (按住 Shift)</button>
          </div>
          <div class="as-terrain-mats" id="as-terrain-mats">
            ${TERRAIN_MATERIALS.map(m => `
              <button type="button" class="as-tmat-btn" data-tmat="${m.id}" aria-pressed="${m.id === 'dirt'}" title="${esc(m.subtitle)}">
                <span class="as-species-dot" style="background:${m.swatch}"></span>
                <span>${esc(m.label)}</span>
              </button>
            `).join('')}
          </div>
          <div class="as-select-row" id="as-t-custom-row" hidden>
            <span>自定义地表色</span>
            <input type="color" id="as-t-custom-col" value="#78b058">
          </div>
          <div class="as-range-row">
            <span>笔刷半径</span>
            <input type="range" id="as-t-radius" min="0.20" max="3.50" step="0.05" value="0.95">
            <output id="as-t-radius-out">0.95m</output>
          </div>
          <div class="as-range-row">
            <span>绘制强度</span>
            <input type="range" id="as-t-strength" min="0.10" max="1.00" step="0.02" value="0.72">
            <output id="as-t-strength-out">72%</output>
          </div>
          <div class="as-range-row">
            <span>边缘硬度</span>
            <input type="range" id="as-t-hardness" min="0.05" max="0.95" step="0.02" value="0.45">
            <output id="as-t-hardness-out">45%</output>
          </div>
          <label class="as-brush-check">
            <input type="checkbox" id="as-t-clear-grass" checked>
            <span>绘制沙土/碎岩时自动清理重叠草丛</span>
          </label>
          <div class="as-brush-acts" style="grid-template-columns:1fr">
            <button type="button" id="as-terrain-clear" class="is-danger" title="清除全部手绘地形材质，恢复程序基底">↺ 清除地形手绘层（恢复基底）</button>
          </div>
          <div class="as-terrain-tip">✨ 与 RVT 实时联动：绘制地表材质时，上方草丛颜色会同帧自动融合变色（笔刷开启时其他模型自动锁定）。</div>
        </details>
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
          <label class="as-brush-check" title="开启后会在白桦弧形地块上附带一层预设程序草绒；默认关闭，推荐用上方刷草笔刷自由控制">
            <input type="checkbox" id="as-g-turf">
            <span>地块附带预设草绒（默认关闭）</span>
          </label>
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
  lighting?: unknown
  wind?: boolean
}
const treeDefaults = createDefaultOverrideStore<PresetId, TreeOverrideLite>({
  scope: 'tree',
  validIds: presetIds,
  readOnly: true,
  parse(raw, id) {
    const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if ('spec' in rec && rec.spec && typeof rec.spec === 'object') {
      return {
        spec: { ...parseTreeSpec(rec.spec), name: presets[id].name },
        textures: parseSavedTextureMap(rec.textures),
        ...(rec.lighting !== undefined ? { lighting: rec.lighting } : {}),
        ...(typeof rec.wind === 'boolean' ? { wind: rec.wind } : {}),
      }
    }
    return { spec: { ...parseTreeSpec(raw), name: presets[id].name } }
  },
})

interface RockOverrideLite {
  version?: number
  spec: RockSpec
  lighting?: unknown
}
const rockDefaults = createDefaultOverrideStore<RockPresetId, RockOverrideLite>({
  scope: 'rock',
  validIds: rockPresetIds,
  readOnly: true,
  parse(raw, id) {
    const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const src = ('spec' in rec && rec.spec && typeof rec.spec === 'object') ? rec.spec : raw
    return {
      ...(typeof rec.version === 'number' ? { version: rec.version } : {}),
      spec: { ...parseRockSpec(src), preset: id, name: rockPresets[id].name },
      ...(rec.lighting !== undefined ? { lighting: rec.lighting } : {}),
    }
  },
})

// ---- State -----------------------------------------------------------------
let sceneSpec: AssemblySceneSpec = blankAssemblyScene()
let selectedId: string | undefined
let activeBuiltInCaseId: string | undefined
let activeSavedSceneId: string | undefined
let currentPaletteTab: PaletteTab = 'mine'
let currentCasesTab: CasesTab = 'builtin'
let confirmDeleteSceneId: string | undefined
let confirmDeleteTimer: ReturnType<typeof setTimeout> | undefined
let builtGround: BuiltGround | undefined
const instances = new Map<string, BuiltAssemblyInstance>()
const refFile = byId<HTMLInputElement>('as-ref-file')
const refCheck = byId<HTMLButtonElement>('as-ref-check')
let refRevision = 0
let buildSeq = 0
let groundBuildSeq = 0
let distantLodEnabled = false
let distantLodUserTouched = false
const mountRevisions = new WeakMap<AssemblyItem, number>()

// UE-style Instanced Grass Paint Brush & Landscape Terrain Material Brush state
type ActiveBrushTool = 'none' | 'grass' | 'terrain'
let activeBrushTool: ActiveBrushTool = 'none'
const paintedGrass = new PaintedGrassLayer()
const brushOpts: GrassBrushOptions = defaultGrassBrushOptions()
const terrainOpts: TerrainBrushOptions = defaultTerrainBrushOptions()
let brushStrokeSnapshotPushed = false
let brushStrokeMutated = false
let lastBrushStampPos: { x: number; z: number } | undefined
let refCompare: RefCompareController | undefined

// Undo / Redo history (stores deep-cloned PRE-change snapshots of sceneSpec + selectedId)
interface HistorySnap { scene: AssemblySceneSpec; selectedId?: string }
const undoStack: HistorySnap[] = []
const redoStack: HistorySnap[] = []
const MAX_HISTORY = 40
let pendingGestureUndo: HistorySnap | undefined
let userDirty = false
let intentionalNavigation = false
const ownedBridgeSessionIds = new Set<string>()
let lastBridgeUndoSessionId: string | undefined

function pushUndo(explicitBefore?: HistorySnap) {
  undoStack.push(explicitBefore ?? { scene: cloneJson(sceneSpec), selectedId })
  if (undoStack.length > MAX_HISTORY) undoStack.shift()
  redoStack.length = 0
  pendingGestureUndo = undefined
  userDirty = true
  syncHistoryButtons()
}

function beginGestureUndo() {
  if (!pendingGestureUndo) {
    pendingGestureUndo = { scene: cloneJson(sceneSpec), selectedId }
  }
}

function commitGestureUndo() {
  if (!pendingGestureUndo) return
  const snap = pendingGestureUndo
  pendingGestureUndo = undefined
  pushUndo(snap)
}

function clearHistory() {
  undoStack.length = 0
  redoStack.length = 0
  pendingGestureUndo = undefined
  syncHistoryButtons()
}

function syncHistoryButtons() {
  byId<HTMLButtonElement>('as-tool-undo').disabled = undoStack.length === 0
  byId<HTMLButtonElement>('as-tool-redo').disabled = redoStack.length === 0
}

window.addEventListener('beforeunload', ev => {
  if (userDirty && !intentionalNavigation) {
    ev.preventDefault()
    ev.returnValue = ''
  }
})

// ---- Viewport Setup --------------------------------------------------------
let viewport: AssemblyViewport | undefined
try {
  viewport = new AssemblyViewport(byId('canvas'), {
    onSelect: id => selectItem(id),
    onTransformStart: () => {
      beginGestureUndo()
    },
    onTransformChange: (id, pos, rotDeg, scale) => {
      const item = sceneSpec.items.find(x => x.id === id)
      if (!item || item.locked) return
      beginGestureUndo()
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
      commitGestureUndo()
    },
    onContextLost: lost => {
      message(lost ? 'WebGL 渲染上下文已丢失，正在尝试恢复…' : 'WebGL 渲染上下文已恢复', lost)
    },
    onStats: (_, calls) => {
      byId('stat-calls').textContent = fmt.format(calls)
      if (distantLodEnabled) updateStatsUi()
    },
    onBrushHover: (hit, shiftKey) => {
      if (activeBrushTool === 'terrain') {
        const erase = terrainOpts.mode === 'erase' || shiftKey
        if (!hit) {
          viewport?.brushCursor.setPose(0, 0, 0, terrainOpts.radius, erase, false)
          return
        }
        const matPreset = TERRAIN_MATERIALS.find(m => m.id === terrainOpts.material)
        const ringHex = terrainOpts.material === 'custom' ? terrainOpts.customColor : (matPreset?.swatch ?? '#f59e0b')
        viewport?.brushCursor.setPose(hit.x, 0, hit.z, terrainOpts.radius, erase, true, ringHex)
        return
      }
      const erase = brushOpts.mode === 'erase' || shiftKey
      if (!hit) {
        viewport?.brushCursor.setPose(0, 0, 0, brushOpts.radius, erase, false)
        return
      }
      viewport?.brushCursor.setPose(hit.x, 0, hit.z, brushOpts.radius, erase, true, '#22c55e')
    },
    onBrushStrokeStart: (hit, shiftKey) => {
      brushStrokeSnapshotPushed = false
      brushStrokeMutated = false
      lastBrushStampPos = undefined
      if (activeBrushTool === 'terrain') applyTerrainBrushStamp(hit.x, hit.z, shiftKey, true)
      else if (activeBrushTool === 'grass') applyGrassBrushStamp(hit.x, hit.z, shiftKey, true)
    },
    onBrushStrokeMove: (hit, shiftKey) => {
      if (activeBrushTool === 'terrain') applyTerrainBrushStamp(hit.x, hit.z, shiftKey, false)
      else if (activeBrushTool === 'grass') applyGrassBrushStamp(hit.x, hit.z, shiftKey, false)
    },
    onBrushStrokeEnd: () => {
      if (brushStrokeMutated) {
        if (activeBrushTool === 'terrain') {
          sceneSpec.groundPaint = builtGround?.terrainPaint?.exportDataUrl()
          updateBrushUi()
          activityLog.action(
            `地形材质笔刷更新地表（材质：${terrainOpts.material}）`,
            { material: terrainOpts.material, mode: terrainOpts.mode, hasPaint: Boolean(sceneSpec.groundPaint) },
            'scene',
          )
        } else {
          const gs = paintedGrass.stats()
          activityLog.action(
            `刷草笔刷更新草丛（当前 ${gs.clusters} 簇 · ${gs.drawCalls} Draw Calls）`,
            { clusters: gs.clusters, drawCalls: gs.drawCalls, mode: brushOpts.mode },
            'scene',
          )
        }
      }
      brushStrokeSnapshotPushed = false
      brushStrokeMutated = false
      lastBrushStampPos = undefined
    },
  })
  viewport.grassRoot.add(paintedGrass.group)
} catch (error) {
  console.warn(error)
  byId('webgl').hidden = false
}

initStudioLogging({
  page: 'scene',
  getWebGLContext: () => viewport?.renderer.getContext() ?? null,
})

// ---- Ground & RVT Sync -----------------------------------------------------
function getActiveRvt(): GrassRvtSpec {
  if (!sceneSpec.rvt) sceneSpec.rvt = defaultGrassRvtSpec()
  return sceneSpec.rvt
}

const RVT_TAG_LABELS: Record<GrassRvtMode, string> = {
  'root-blend': 'UE RVT 根部融合',
  'full-tint': '油画草海融合',
  'normal-only': '法线无缝融合',
  off: '已关闭',
}

function syncRvtUiAndShader() {
  const rvt = getActiveRvt()
  syncGrassRvtUniforms(builtGround, rvt)
  ;(byId('as-rvt-mode') as HTMLSelectElement).value = rvt.mode
  byId('as-rvt-tag').textContent = RVT_TAG_LABELS[rvt.mode] ?? 'UE RVT'
  byId('as-rvt-params').hidden = rvt.mode === 'off'
  ;(byId('as-rvt-strength') as HTMLInputElement).value = String(rvt.strength)
  byId('as-rvt-strength-out').textContent = `${Math.round(rvt.strength * 100)}%`
  ;(byId('as-rvt-height') as HTMLInputElement).value = String(rvt.fadeHeight)
  byId('as-rvt-height-out').textContent = `${rvt.fadeHeight.toFixed(2)}m`
  ;(byId('as-rvt-normal') as HTMLInputElement).value = String(rvt.normalBlend)
  byId('as-rvt-normal-out').textContent = `${Math.round(rvt.normalBlend * 100)}%`
  ;(byId('as-rvt-placed') as HTMLInputElement).checked = rvt.affectPlacedGrass
}

let brushHudTimer: ReturnType<typeof setTimeout> | undefined
function flashBrushHud(text: string) {
  const el = byId('as-brush-hud')
  el.textContent = text
  el.hidden = false
  if (brushHudTimer) clearTimeout(brushHudTimer)
  brushHudTimer = setTimeout(() => { el.hidden = true }, 950)
}

function rebuildGround(refitShadow = true): Promise<void> {
  const seq = ++groundBuildSeq
  if (!viewport) return Promise.resolve()
  if (builtGround) {
    viewport.groundRoot.remove(builtGround.group)
    builtGround.dispose()
    builtGround = undefined
  }
  const targetGround = buildAssemblyGround(sceneSpec.ground)
  builtGround = targetGround
  viewport.groundRoot.add(targetGround.group)
  syncRvtUiAndShader()
  updateBrushUi()
  if (refitShadow) viewport.updateShadowFrustum(Math.max(5.5, sceneSpec.ground.size * 0.78))
  else viewport.refreshShadows()

  const paintUrl = sceneSpec.groundPaint
  if (paintUrl && targetGround.terrainPaint) {
    return targetGround.terrainPaint.importDataUrl(paintUrl)
      .then(() => {
        if (seq !== groundBuildSeq || builtGround !== targetGround) return
        syncRvtUiAndShader()
        updateBrushUi()
        viewport?.refreshShadows()
      })
      .catch(() => { /* ignore malformed paint overlay */ })
  }
  return Promise.resolve()
}

function updateBrushUi() {
  const gs = paintedGrass.stats()
  const grassActive = activeBrushTool === 'grass'
  const terrainActive = activeBrushTool === 'terrain'
  const hasTerrainPaint = Boolean(builtGround?.terrainPaint?.hasPaint() || sceneSpec.groundPaint)

  byId('as-brush-toggle').setAttribute('aria-pressed', String(grassActive))
  const powerBtn = byId<HTMLButtonElement>('as-brush-power')
  powerBtn.setAttribute('aria-pressed', String(grassActive))
  powerBtn.textContent = grassActive ? '⏹ 退出刷草笔刷 (快捷键 B)' : '▶ 开启刷草笔刷 (快捷键 B)'
  byId('as-brush-card').classList.toggle('is-active', grassActive)
  byId('as-brush-badge').textContent = `${fmt.format(gs.clusters)} 簇`
  byId('as-brush-stats').textContent = `${fmt.format(gs.clusters)} 簇 · ${gs.drawCalls} Draw Calls`
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-bmode]')) {
    b.setAttribute('aria-pressed', String(b.dataset.bmode === brushOpts.mode))
  }

  byId('as-terrain-toggle').setAttribute('aria-pressed', String(terrainActive))
  const tPowerBtn = byId<HTMLButtonElement>('as-terrain-power')
  tPowerBtn.setAttribute('aria-pressed', String(terrainActive))
  tPowerBtn.textContent = terrainActive ? '⏹ 退出地形材质笔刷 (快捷键 T)' : '▶ 开启地形材质笔刷 (快捷键 T)'
  byId('as-terrain-card').classList.toggle('is-active', terrainActive)
  byId('as-terrain-badge').textContent = hasTerrainPaint ? '已手绘' : '未手绘'
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tmode]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tmode === terrainOpts.mode))
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tmat]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tmat === terrainOpts.material))
  }
  byId('as-t-custom-row').hidden = terrainOpts.material !== 'custom'

  byId('as-gesture-hint').textContent = grassActive
    ? '🌿 刷草笔刷已开启（其他模型已锁定）· 左键拖拽绘制 · Shift+左键擦除 · 右键旋转 · [ / ] 或 Shift+滚轮 调半径 · B 退出'
    : terrainActive
      ? '🎨 地形材质笔刷已开启（其他模型已锁定）· 左键拖拽绘制 · Shift+左键还原基底 · 右键旋转 · [ / ] 或 Shift+滚轮 调半径 · T 退出'
      : '单击选中资产 · W移动 E旋转 R缩放 G贴地 B刷草 T地形笔刷 · 左键旋转视角 · 滚轮缩放 · 右键平移'
}

function setActiveBrushTool(tool: ActiveBrushTool) {
  if (!viewport) return
  // Flush/commit any in-flight brush stroke or gizmo drag BEFORE changing activeBrushTool
  // so onBrushStrokeEnd() still persists sceneSpec.groundPaint for the outgoing tool.
  viewport.cancelActiveDrag()
  activeBrushTool = tool
  viewport.setBrushMode(tool !== 'none')
  if (tool === 'grass') {
    ;(byId('as-brush-details') as HTMLDetailsElement).open = true
  } else if (tool === 'terrain') {
    ;(byId('as-terrain-details') as HTMLDetailsElement).open = true
  }
  if (tool !== 'none') viewport.refreshBrushHover(false)
  updateBrushUi()
}

function setBrushModeEnabled(on: boolean) {
  setActiveBrushTool(on ? 'grass' : 'none')
}

function applyTerrainBrushStamp(x: number, z: number, shiftKey: boolean, force: boolean) {
  const layer = builtGround?.terrainPaint
  if (!layer) {
    if (force) message('当前地块模式（无地面/极简画室）不支持手绘地形材质，请先切换为草地地块', true)
    return
  }
  const erase = terrainOpts.mode === 'erase' || shiftKey
  const minStep = Math.max(0.06, terrainOpts.radius * 0.16)
  if (!force && lastBrushStampPos) {
    const d = Math.hypot(x - lastBrushStampPos.x, z - lastBrushStampPos.z)
    if (d < minStep) return
  }
  lastBrushStampPos = { x, z }
  if (!brushStrokeSnapshotPushed) {
    if (!erase || layer.hasPaint()) {
      sceneSpec.groundPaint = layer.exportDataUrl()
      pushUndo()
      brushStrokeSnapshotPushed = true
    }
  }
  const painted = layer.paintAt(x, z, terrainOpts, erase)
  if (painted) {
    brushStrokeMutated = true
    // Optionally carve overlapping brush grass when painting dirt path / stone pad
    const matDef = TERRAIN_MATERIALS.find(m => m.id === terrainOpts.material)
    if (!erase && terrainOpts.clearGrassOnHardSurface && matDef?.isHardSurface && sceneSpec.grassPaint?.length) {
      const removed = paintedGrass.eraseAt(sceneSpec.grassPaint, x, z, terrainOpts.radius * 0.85)
      if (removed > 0) {
        if (sceneSpec.grassPaint.length === 0) sceneSpec.grassPaint = undefined
        updateStatsUi()
      }
    }
  }
}

function applyGrassBrushStamp(x: number, z: number, shiftKey: boolean, force: boolean) {
  const erase = brushOpts.mode === 'erase' || shiftKey
  const minStep = Math.max(0.10, brushOpts.radius * 0.24)
  if (!force && lastBrushStampPos) {
    const d = Math.hypot(x - lastBrushStampPos.x, z - lastBrushStampPos.z)
    if (d < minStep) return
  }
  lastBrushStampPos = { x, z }
  if (!brushStrokeSnapshotPushed) {
    // Capture undo snapshot lazily before first modification in this stroke
    if (!erase || (sceneSpec.grassPaint?.length ?? 0) > 0) {
      pushUndo()
      brushStrokeSnapshotPushed = true
    }
  }
  if (erase) {
    if (!sceneSpec.grassPaint || sceneSpec.grassPaint.length === 0) return
    const removed = paintedGrass.eraseAt(sceneSpec.grassPaint, x, z, brushOpts.radius)
    if (removed > 0) {
      if (sceneSpec.grassPaint.length === 0) sceneSpec.grassPaint = undefined
      brushStrokeMutated = true
      updateStatsUi()
      updateBrushUi()
    }
    return
  }
  if (!sceneSpec.grassPaint) sceneSpec.grassPaint = []
  const added = paintedGrass.paintAt(sceneSpec.grassPaint, x, z, brushOpts, sceneSpec.ground)
  if (added > 0) {
    brushStrokeMutated = true
    updateStatsUi()
    updateBrushUi()
  }
}

function syncPaintedGrassFromSpec() {
  paintedGrass.sync(sceneSpec.grassPaint)
  updateBrushUi()
}

function syncDistantLodButton() {
  const btn = byId<HTMLButtonElement>('as-distant-lod-btn')
  btn.setAttribute('aria-pressed', String(distantLodEnabled))
  const treeCount = sceneSpec.items.filter(x => x.kind === 'tree').length
  const recommend = !distantLodEnabled && !distantLodUserTouched && sceneSpec.items.length >= 8 && treeCount > 0
  btn.classList.toggle('is-recommended', recommend)
  btn.textContent = distantLodEnabled ? '⚡ 远景 LOD 开' : (recommend ? '⚡ 远景 LOD (建议)' : '⚡ 远景 LOD')
  btn.title = distantLodEnabled
    ? '远景自动 LOD 已开启（0m 原精 / 18m 标准游戏 / 36m 手游轻量，共享材质；导出 GLB 始终为完整 LOD0）'
    : recommend
      ? `当前场景已有 ${sceneSpec.items.length} 个资产，建议点击开启远景自动 LOD 提升流畅度`
      : '开启远景自动 LOD（0m 原精 / 18m 标准游戏 / 36m 手游轻量，共享材质；导出 GLB 始终为完整 LOD0）'
}

function showSceneProgress(loaded: number, total: number) {
  const wrap = byId('as-load-progress')
  const textEl = byId('as-load-progress-text')
  const fillEl = byId('as-load-progress-fill')
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 100
  textEl.textContent = `加载场景 ${loaded}/${total}…`
  fillEl.style.width = `${pct}%`
  wrap.hidden = false
}

function hideSceneProgress() {
  byId('as-load-progress').hidden = true
}

function updateStatsUi() {
  let plantCount = 0
  let rockCount = 0
  let totalTris = 0
  for (const item of sceneSpec.items) {
    if (item.kind === 'rock') rockCount++
    else plantCount++
    const inst = instances.get(item.id)
    if (inst && item.visible) totalTris += inst.activeTriangles()
  }
  const gs = paintedGrass.stats()
  totalTris += gs.triangles
  byId('stat-items').textContent = fmt.format(sceneSpec.items.length)
  byId('stat-plants').textContent = gs.clusters > 0
    ? `${fmt.format(plantCount)} (+${fmt.format(gs.clusters)}草)`
    : fmt.format(plantCount)
  byId('stat-rocks').textContent = fmt.format(rockCount)
  byId('stat-triangles').textContent = fmt.format(totalTris)
  byId('as-hier-count').textContent = String(sceneSpec.items.length)
  syncDistantLodButton()
}

function syncCasePills() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-quick-scene]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.quickScene === activeBuiltInCaseId))
  }
  refCheck.disabled = !refFile.files?.length && !sceneSpec.reference?.src && !activeBuiltInCaseId
  byId('as-scene-title').textContent = sceneSpec.name || '未命名场景'
  byId('as-ref-toggle').setAttribute('aria-pressed', String(Boolean(sceneSpec.reference?.src && sceneSpec.reference.mode && sceneSpec.reference.mode !== 'off')))
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
  ;(byId('as-g-turf') as HTMLInputElement).checked = Boolean(g.builtInTurf)
  ;(byId('as-backdrop') as HTMLSelectElement).value = sceneSpec.backdrop
  const windBtn = byId('as-wind-btn')
  windBtn.setAttribute('aria-pressed', String(sceneSpec.wind))
  windBtn.textContent = sceneSpec.wind ? '🍃 微风 开' : '🍃 微风 关'
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

  const editTreeBtn = byId<HTMLButtonElement>('as-act-edit-tree')
  editTreeBtn.hidden = item.kind !== 'tree'
  editTreeBtn.disabled = item.locked
  const savePresetBtn = byId<HTMLButtonElement>('as-act-save-preset')
  savePresetBtn.hidden = item.kind !== 'tree'
  savePresetBtn.disabled = item.locked
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
        ${item.kind === 'tree' ? `<button type="button" data-hact="edit-tree" data-hid="${esc(item.id)}" title="在树木工作台编辑并返回实时更新">✎</button>` : ''}
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

async function mountSingleItem(item: AssemblyItem, expectedBuildSeq?: number): Promise<BuiltAssemblyInstance | undefined> {
  if (!viewport) return undefined
  const revision = (mountRevisions.get(item) ?? 0) + 1
  mountRevisions.set(item, revision)
  const inst = await buildAssemblyItem(item, sharedTextures, { distantLod: distantLodEnabled })
  if (
    mountRevisions.get(item) !== revision
    || !sceneSpec.items.includes(item)
    || (expectedBuildSeq !== undefined && expectedBuildSeq !== buildSeq)
  ) {
    inst.dispose()
    return undefined
  }
  const existing = instances.get(item.id)
  if (existing) {
    viewport.itemsRoot.remove(existing.wrapper)
    existing.dispose()
    instances.delete(item.id)
  }
  instances.set(item.id, inst)
  viewport.itemsRoot.add(inst.wrapper)
  if (inst.lod) viewport.updateLods()
  return inst
}

async function rebuildAllItems(reframe = false) {
  const token = ++buildSeq
  clearAllInstances()
  if (!viewport) return
  try {
    viewport.setBackdrop(sceneSpec.backdrop, sceneSpec.lighting)
    viewport.setWind(sceneSpec.wind)
    await rebuildGround(false)
    if (token !== buildSeq) return
    syncPaintedGrassFromSpec()
    refCompare?.sync(sceneSpec.reference)
    syncDistantLodButton()

    const total = sceneSpec.items.length
    const FRAME_BUDGET_MS = 12
    const yieldFrame = () => (
      typeof requestAnimationFrame === 'function'
        ? new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        : Promise.resolve()
    )
    let mountedCount = 0
    let sliceStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
    let progressShown = false

    for (const item of sceneSpec.items) {
      if (token !== buildSeq) return
      await mountSingleItem(item, token)
      if (token !== buildSeq) return
      mountedCount++
      if (mountedCount === 1 && reframe) setAssemblyCamera(sceneSpec.cameraPreset ?? 'iso')
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      if (mountedCount < total && now - sliceStart > FRAME_BUDGET_MS) {
        showSceneProgress(mountedCount, total)
        progressShown = true
        await yieldFrame()
        if (token !== buildSeq) return
        sliceStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
      } else if (progressShown) {
        showSceneProgress(mountedCount, total)
      }
    }
    if (token !== buildSeq) return
    if (progressShown) showSceneProgress(total, total)
    viewport.updateLods()
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
      distantLod: distantLodEnabled,
    })
  } finally {
    if (token === buildSeq) hideSceneProgress()
  }
}

async function setDistantLodEnabled(enabled: boolean, announce = true) {
  distantLodUserTouched = true
  const next = Boolean(enabled)
  if (distantLodEnabled === next) {
    syncDistantLodButton()
    return
  }
  distantLodEnabled = next
  syncDistantLodButton()

  const token = ++buildSeq
  const treeItems = sceneSpec.items.filter(item => item.kind === 'tree')
  if (treeItems.length > 0 && viewport) {
    const FRAME_BUDGET_MS = 12
    const yieldFrame = () => (
      typeof requestAnimationFrame === 'function'
        ? new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        : Promise.resolve()
    )
    let done = 0
    let sliceStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
    let progressShown = false
    try {
      for (const item of treeItems) {
        if (token !== buildSeq) return
        await mountSingleItem(item, token)
        if (token !== buildSeq) return
        done++
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        if (done < treeItems.length && now - sliceStart > FRAME_BUDGET_MS) {
          showSceneProgress(done, treeItems.length)
          progressShown = true
          await yieldFrame()
          if (token !== buildSeq) return
          sliceStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
        } else if (progressShown) {
          showSceneProgress(done, treeItems.length)
        }
      }
      if (token !== buildSeq) return
      viewport.updateLods()
      viewport.refreshShadows()
      selectItem(selectedId && instances.has(selectedId) ? selectedId : undefined)
      updateStatsUi()
    } finally {
      if (token === buildSeq) hideSceneProgress()
    }
  }
  activityLog.action(next ? '开启远景自动 LOD（0m/18m/36m）' : '关闭远景自动 LOD', {
    enabled: next,
    treeCount: treeItems.length,
  }, 'scene')
  if (announce) {
    message(next
      ? '⚡ 远景自动 LOD 已开启（0m 原精 / 18m 标准 / 36m 轻量 · 导出 GLB 仍为完整 LOD0）'
      : '已关闭远景自动 LOD（全部植物保持原始精度）')
  }
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
  return item.id
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
  viewport?.cancelActiveDrag()
  if (pendingGestureUndo) commitGestureUndo()
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
  viewport?.cancelActiveDrag()
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

function savedPresetToEntry(p: SavedPreset, group: string): PaletteEntry {
  const hasTex = Boolean(p.textures && Object.keys(p.textures).length > 0)
  const isTreeScope = p.scope === 'tree'
  const treeSpec = isTreeScope ? (p as SavedPreset<TreeSpec>).payload : undefined
  const inferredCat = treeSpec
    ? (treeSpec.kind === 'flowerbed' || treeSpec.kind === 'lotus'
        ? 'flower'
        : treeSpec.kind === 'grass' || treeSpec.kind === 'fern'
          ? 'grass'
          : treeSpec.kind === 'broadleaf' && treeSpec.trunk.height < 2.1
            ? 'shrub'
            : 'tree')
    : 'tree'
  return {
    key: `saved:${p.id}`,
    group,
    name: p.name,
    subtitle: `${p.kindLabel} · ${fmt.format(p.triangles)} 面${hasTex ? ' · 含自定义贴图' : ''}`,
    icon: p.scope === 'ai' ? '✦' : (treeSpec?.kind === 'bamboo' ? '🎋' : treeSpec?.kind === 'lotus' ? '🪷' : '🌳'),
    thumb: p.thumbnail || undefined,
    create: () => p.scope === 'ai'
      ? createAiItem((p as SavedPreset<AiSceneSpec>).payload, { name: p.name })
      : createTreeItem(treeSpec!, {
          name: p.name,
          category: inferredCat,
          ...(p.textures ? { customTextures: p.textures } : {}),
        }),
  }
}

function isLowPlantKind(kind: SavedPreset['kind'], payload?: TreeSpec): boolean {
  if (kind === 'grass' || kind === 'fern' || kind === 'flowerbed' || kind === 'lotus') return true
  if (kind === 'broadleaf' && payload && payload.trunk.height < 2.1 && payload.trunk.radius < 0.09) return true
  return false
}

function buildPaletteEntries(tab: PaletteTab): PaletteEntry[] {
  const entries: PaletteEntry[] = []
  const savedPresets = presetStore.list()

  if (tab === 'mine') {
    for (const p of savedPresets) {
      entries.push(savedPresetToEntry(p, `★ 树木/AI 预设库（${savedPresets.length}）`))
    }
    const overriddenTreeIds = treeDefaults.listIds()
    for (const id of overriddenTreeIds) {
      const over = treeDefaults.get(id)
      if (!over) continue
      const base = over.spec
      const isLow = id.startsWith('shrub-') || id === 'conifer-shrub' || base.kind === 'grass' || base.kind === 'fern' || base.kind === 'flowerbed' || base.kind === 'lotus'
      const cat = base.kind === 'flowerbed' || base.kind === 'lotus' ? 'flower' : base.kind === 'grass' || base.kind === 'fern' ? 'grass' : isLow ? 'shrub' : 'tree'
      const hasTex = Boolean(over.textures && Object.keys(over.textures).length > 0)
      entries.push({
        key: `override-tree:${id}`,
        group: `✎ 树木工作台 · 已改默认预设（${overriddenTreeIds.length}）`,
        name: presets[id].name,
        subtitle: `${base.kind === 'bamboo' ? '竹子' : base.kind === 'lotus' ? '荷花' : base.kind === 'conifer' ? '针叶树' : base.kind === 'palm' ? '棕榈' : categoryLabels[cat]} · 已同步修改${hasTex ? ' · 含贴图' : ''}`,
        icon: base.kind === 'bamboo' ? '🎋' : base.kind === 'lotus' ? '🪷' : categoryIcons[cat],
        create: () => createTreeItem(over.spec, {
          name: presets[id].name,
          category: cat,
          ...(over.textures ? { customTextures: over.textures } : {}),
        }),
      })
    }
    const overriddenRockIds = rockDefaults.listIds()
    for (const id of overriddenRockIds) {
      const over = rockDefaults.get(id)
      if (!over) continue
      entries.push({
        key: `override-rock:${id}`,
        group: `🪨 石头工作台 · 已改默认预设（${overriddenRockIds.length}）`,
        name: rockPresets[id].name,
        subtitle: '石头工作台已改默认',
        icon: '🪨',
        create: () => createRockItem(over.spec, { name: rockPresets[id].name }),
      })
    }
    return entries
  }

  if (tab === 'featured') {
    for (const p of savedPresets) {
      entries.push(savedPresetToEntry(p, `★ 我的预设库（${savedPresets.length}）`))
    }
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
    const savedTrees = savedPresets.filter(p => p.scope === 'ai' || !isLowPlantKind(p.kind, p.scope === 'tree' ? (p as SavedPreset<TreeSpec>).payload : undefined))
    for (const p of savedTrees) {
      entries.push(savedPresetToEntry(p, `★ 我的树木预设（${savedTrees.length}）`))
    }
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
      return (k === 'broadleaf' || k === 'conifer' || k === 'palm' || k === 'bamboo') && !id.startsWith('shrub-') && id !== 'conifer-shrub'
    })
    for (const id of treeIds) {
      const over = treeDefaults.get(id)
      const base = over?.spec ?? presetSpec(id)
      entries.push({
        key: `tree:${id}`,
        group: '内置树木预设（自动同步已改默认）',
        name: over ? `${presets[id].name} · 已改` : presets[id].name,
        subtitle: base.kind === 'conifer' ? '针叶树' : base.kind === 'palm' ? '棕榈树' : base.kind === 'bamboo' ? '竹子' : '阔叶/观花树',
        icon: base.kind === 'bamboo' ? '🎋' : '🌳',
        create: () => createTreeItem(over?.spec ?? presetSpec(id), {
          name: presets[id].name,
          customTextures: over?.textures,
        }),
      })
    }
    return entries
  }

  if (tab === 'plants') {
    const savedPlants = savedPresets.filter(p => p.scope === 'tree' && isLowPlantKind(p.kind, (p as SavedPreset<TreeSpec>).payload))
    for (const p of savedPlants) {
      entries.push(savedPresetToEntry(p, `★ 我的灌花草预设（${savedPlants.length}）`))
    }
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
      id.startsWith('shrub-') || id === 'conifer-shrub' || presets[id].kind === 'grass' || presets[id].kind === 'fern' || presets[id].kind === 'flowerbed' || presets[id].kind === 'lotus',
    )
    for (const id of lowIds) {
      const over = treeDefaults.get(id)
      const base = over?.spec ?? presetSpec(id)
      const cat = base.kind === 'flowerbed' || base.kind === 'lotus' ? 'flower' : base.kind === 'grass' || base.kind === 'fern' ? 'grass' : 'shrub'
      entries.push({
        key: `plant:${id}`,
        group: '内置灌木 / 草丛 / 花丛 / 荷花模板',
        name: over ? `${presets[id].name} · 已改` : presets[id].name,
        subtitle: base.kind === 'lotus' ? '荷花水生' : categoryLabels[cat],
        icon: base.kind === 'lotus' ? '🪷' : categoryIcons[cat],
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

function syncTreeLibBadge() {
  const total = presetStore.list().length + treeDefaults.listIds().length + rockDefaults.listIds().length
  const badge = document.getElementById('as-tree-lib-badge')
  if (badge) badge.textContent = String(total)
}

function setPaletteTab(tab: PaletteTab) {
  currentPaletteTab = tab
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ptab]')) {
    b.setAttribute('aria-pressed', String(b.dataset.ptab === currentPaletteTab))
  }
  renderPalette()
}

function renderPalette() {
  syncTreeLibBadge()
  const kw = byId<HTMLInputElement>('as-palette-search').value.trim().toLowerCase()
  const raw = buildPaletteEntries(currentPaletteTab)
  activePaletteEntries = kw
    ? raw.filter(e => e.name.toLowerCase().includes(kw) || e.subtitle.toLowerCase().includes(kw) || e.group.toLowerCase().includes(kw))
    : raw
  const listEl = byId('as-palette-list')
  if (!activePaletteEntries.length) {
    listEl.innerHTML = currentPaletteTab === 'mine' && !kw
      ? '<div class="as-empty-sel">树木工作台暂未保存自定义预设。<br>在树木工作台点「★ 保存预设」或「保存替换默认预设」后，将自动实时同步到这里。<br><a class="as-empty-cta" href="./broadleaf.html">→ 去树木工作台制作预设</a></div>'
      : '<div class="as-empty-sel">没有匹配的资产，试试清空搜索词或切换分类。</div>'
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
  btn.onclick = () => setPaletteTab(btn.dataset.ptab as PaletteTab)
}
byId<HTMLInputElement>('as-palette-search').oninput = renderPalette

async function syncExternalAssetLibraries(announce = false) {
  await Promise.all([presetStore.reload(), treeDefaults.reload(), rockDefaults.reload()])
  renderPalette()
  if (announce) {
    message(`已同步树木/石头资产库：我的预设 ${presetStore.list().length} 项 · 已改默认 ${treeDefaults.listIds().length + rockDefaults.listIds().length} 项`)
  }
}

byId('as-sync-lib-btn').onclick = () => {
  setPaletteTab('mine')
  void syncExternalAssetLibraries(true)
}
byId('as-tree-lib-btn').onclick = () => {
  setPaletteTab('mine')
  void syncExternalAssetLibraries(true)
  byId<HTMLInputElement>('as-palette-search').focus()
}

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
  let totalTris = paintedGrass.stats().triangles
  for (const inst of instances.values()) totalTris += inst.triangles
  const grassCount = paintedGrass.stats().clusters
  capMeta.textContent = grassCount > 0
    ? `${sceneSpec.items.length} 个资产 · ${fmt.format(grassCount)} 簇草 · ${fmt.format(totalTris)} 面`
    : `${sceneSpec.items.length} 个资产 · ${fmt.format(totalTris)} 面`
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
  clearHistory()
  userDirty = false
  ownedBridgeSessionIds.clear()
  lastBridgeUndoSessionId = undefined
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
  userDirty = false
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
  userDirty = false
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
    setBrushModeEnabled(false)
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
  const windBtn = byId('as-wind-btn')
  windBtn.setAttribute('aria-pressed', String(sceneSpec.wind))
  windBtn.textContent = sceneSpec.wind ? '🍃 微风 开' : '🍃 微风 关'
  viewport?.setWind(sceneSpec.wind)
  message(sceneSpec.wind ? '🍃 微风已开启：树冠、灌木与草地随风摇曳' : '🍃 微风已关闭')
}

byId('as-distant-lod-btn').onclick = () => {
  void setDistantLodEnabled(!distantLodEnabled, true)
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

// Selected item transform inputs (captures pre-gesture snapshot on first oninput so Ctrl+Z truly reverts!)
const bindTransformNumber = (id: string, apply: (item: AssemblyItem, val: number) => void) => {
  const inp = byId<HTMLInputElement>(id)
  inp.oninput = () => {
    const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
    const inst = selectedId ? instances.get(selectedId) : undefined
    const v = Number(inp.value)
    if (!item || !inst || item.locked || !Number.isFinite(v)) return
    beginGestureUndo()
    apply(item, v)
    applyItemTransform(inst.wrapper, item)
    viewport?.refreshSelectionBox()
    viewport?.refreshShadows()
    syncSelectedTransformInputs()
  }
  inp.onchange = () => { if (selectedId) commitGestureUndo() }
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
  beginGestureUndo()
  item.rotation[1] = Number((ev.target as HTMLInputElement).value)
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
}
byId<HTMLInputElement>('as-ry-range').onchange = () => { if (selectedId) commitGestureUndo() }

byId<HTMLInputElement>('as-scale-range').oninput = ev => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  const inst = selectedId ? instances.get(selectedId) : undefined
  if (!item || !inst || item.locked) return
  beginGestureUndo()
  const s = Math.max(0.05, Number((ev.target as HTMLInputElement).value))
  item.scale = [s, s, s]
  applyItemTransform(inst.wrapper, item)
  viewport?.refreshSelectionBox()
  viewport?.refreshShadows()
  syncSelectedTransformInputs()
}
byId<HTMLInputElement>('as-scale-range').onchange = () => { if (selectedId) commitGestureUndo() }

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

async function setCrownStyle(_id: string | undefined, _style: 'painted' | 'default') {
  // Deprecated: all broadleaf trees & shrubs now use pure game-ready Alpha Leaf Cards.
}

byId<HTMLSelectElement>('as-bark-style').onchange = async ev => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  if (!item || item.kind !== 'tree') return
  pushUndo()
  const style = (ev.target as HTMLSelectElement).value as AssemblyBarkStyle
  item.barkStyle = style === 'default' ? undefined : style
  const payload = item.payload as TreeSpec
  if (style === 'default') delete payload.trunk.barkStyle
  else payload.trunk.barkStyle = style
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
    if (act === 'edit-tree') {
      void openItemInTreeStudio(id)
    } else if (act === 'vis') {
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
  void rebuildGround(reframeShadow)
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
  beginGestureUndo()
  updateGround(() => { sceneSpec.ground.size = Number((ev.target as HTMLInputElement).value) })
}
byId<HTMLInputElement>('as-g-size').onchange = () => commitGestureUndo()
byId<HTMLInputElement>('as-g-pwidth').oninput = ev => {
  beginGestureUndo()
  updateGround(() => { sceneSpec.ground.pathWidth = Number((ev.target as HTMLInputElement).value) }, false)
}
byId<HTMLInputElement>('as-g-pwidth').onchange = () => commitGestureUndo()
const bindGroundColor = (id: string, apply: (color: string) => void) => {
  const inp = byId<HTMLInputElement>(id)
  inp.oninput = () => {
    beginGestureUndo()
    updateGround(() => { apply(inp.value) }, false)
  }
  inp.onchange = () => {
    if (pendingGestureUndo) {
      commitGestureUndo()
    } else {
      pushUndo()
      updateGround(() => { apply(inp.value) }, false)
    }
  }
}
bindGroundColor('as-g-grass', v => { sceneSpec.ground.grassColor = v })
bindGroundColor('as-g-hi', v => { sceneSpec.ground.grassHighlight = v })
bindGroundColor('as-g-sh', v => { sceneSpec.ground.grassShadow = v })
bindGroundColor('as-g-pcol', v => { sceneSpec.ground.pathColor = v })
byId<HTMLInputElement>('as-g-turf').onchange = ev => {
  pushUndo()
  updateGround(() => { sceneSpec.ground.builtInTurf = (ev.target as HTMLInputElement).checked }, false)
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
  try {
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
          clearHistory()
          userDirty = false
          ownedBridgeSessionIds.clear()
          lastBridgeUndoSessionId = undefined
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
        clearHistory()
        userDirty = false
        ownedBridgeSessionIds.clear()
        lastBridgeUndoSessionId = undefined
        sceneSpec = parseAssemblyScene(cloneJson(saved.scene))
        selectedId = undefined
        activeBuiltInCaseId = undefined
        activeSavedSceneId = saved.id
        await rebuildAllItems(true)
        closeCasesDrawer()
        message(`已载入场景案例「${saved.name}」`)
      }
    }
  } catch (err) {
    renderCasesGrid()
    message(err instanceof Error ? err.message : String(err), true)
  }
})

// Clear, JSON import/export, Asset JSON import, PNG snapshot, GLB export
byId('as-clear-btn').onclick = async () => {
  if (!sceneSpec.items.length && !(sceneSpec.grassPaint?.length) && !sceneSpec.groundPaint && !sceneSpec.ground.builtInTurf) {
    message('当前画布已经是空的')
    return
  }
  pushUndo()
  sceneSpec.items = []
  sceneSpec.grassPaint = undefined
  sceneSpec.groundPaint = undefined
  sceneSpec.ground.builtInTurf = false
  selectedId = undefined
  activeBuiltInCaseId = undefined
  await rebuildAllItems(false)
  message('已清空场景中的所有资产、刷草与手绘地形（可按 Ctrl+Z 撤销）')
}

function downloadBlob(blob: Blob, filename: string, browserMessage?: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const filters = ext === 'glb'
    ? [{ name: 'glTF Binary (.glb)', extensions: ['glb'] }]
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
    if (browserMessage) message(browserMessage)
  }).catch(err => {
    message(`文件保存失败：${err instanceof Error ? err.message : String(err)}`, true)
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const header = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const mimeMatch = header.match(/data:([^;]+)/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/png'
  const raw = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return new Blob([bytes], { type: mime })
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
      ownedBridgeSessionIds.clear()
      lastBridgeUndoSessionId = undefined
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

// ---- Plant Round-Trip Editing (Scene Studio <-> Tree Studio) ---------------
async function openItemInTreeStudio(id?: string): Promise<boolean> {
  const targetId = id ?? selectedId
  const item = targetId ? sceneSpec.items.find(x => x.id === targetId) : undefined
  if (!item || item.kind !== 'tree') {
    message('请先选中一个植物（树木/灌木/花草）资产再进入树木工作台编辑', true)
    return false
  }
  if (item.locked) {
    message('该资产已锁定，请先在层级列表中解锁后再进入树木工作台编辑', true)
    return false
  }
  const treeSpec = cloneJson(item.payload as TreeSpec)
  if (!treeSpec.name || treeSpec.name === '阔叶树') treeSpec.name = item.name
  const { session, stored } = await createSceneEditSessionAsync({
    itemId: item.id,
    itemName: item.name,
    sceneName: sceneSpec.name,
    returnUrl: './scene.html',
    treeSpec,
    customTextures: item.customTextures,
    barkStyle: item.barkStyle,
    crownStyle: item.crownStyle,
    treeForm: item.treeForm,
    leafTexture: item.leafTexture,
    category: item.category,
    lighting: sceneSpec.lighting,
    sceneDraft: sceneSpec,
    activeBuiltInCaseId,
    activeSavedSceneId,
    selectedId: item.id,
  })
  if (!stored) {
    message('当前场景草稿体积过大且浏览器存储不可用，已中止跳转以防丢失未保存场景，请先保存场景或导出 JSON。', true)
    return false
  }
  ownedBridgeSessionIds.add(session.sessionId)
  intentionalNavigation = true
  activityLog.action(`前往树木工作台编辑「${item.name}」`, { itemId: item.id, sessionId: session.sessionId }, 'scene')
  location.href = `./broadleaf.html?sceneEdit=${encodeURIComponent(session.sessionId)}`
  return true
}

async function applyBridgeEditToScene(update: {
  sessionId?: string
  itemId: string
  treeSpec: TreeSpec
  customTextures?: SavedTextureMap
  itemName?: string
  barkStyle?: AssemblyBarkStyle
  crownStyle?: 'painted'
  treeForm?: 'meadow-birch'
  leafTexture?: AssemblyItem['leafTexture']
}, announce: boolean): Promise<boolean> {
  const item = sceneSpec.items.find(x => x.id === update.itemId && x.kind === 'tree')
  if (!item) return false
  const nextSpec = parseTreeSpec(update.treeSpec)
  // Coalesce high-frequency 180ms live sync edits into ONE undo step per bridge session
  if (!update.sessionId || lastBridgeUndoSessionId !== update.sessionId) {
    pushUndo()
    if (update.sessionId) lastBridgeUndoSessionId = update.sessionId
  }
  item.payload = nextSpec
  if (update.itemName && update.itemName.trim()) {
    item.name = update.itemName.trim().slice(0, 64)
  }
  if (update.customTextures && Object.keys(update.customTextures).length > 0) {
    item.customTextures = cloneJson(update.customTextures)
  } else {
    delete item.customTextures
  }
  // Preserve exact 1:1 appearance recipe from Tree Studio so both views always match pixel-for-pixel
  if (update.barkStyle && update.barkStyle !== 'default') item.barkStyle = update.barkStyle
  else delete item.barkStyle
  if (update.crownStyle === 'painted') item.crownStyle = 'painted'
  else delete item.crownStyle
  if (update.treeForm === 'meadow-birch' && nextSpec.kind === 'broadleaf') item.treeForm = 'meadow-birch'
  else delete item.treeForm
  if (update.leafTexture && update.leafTexture !== 'auto') item.leafTexture = update.leafTexture
  else delete item.leafTexture

  item.category = inferCategoryFromTree(nextSpec)
  await mountSingleItem(item)
  viewport?.refreshShadows()
  selectItem(item.id)
  if (announce) {
    activityLog.action(`树木工作台编辑已实时同步到「${item.name}」`, { itemId: item.id, seed: nextSpec.seed }, 'scene')
    message(`✓ 已实时更新「${item.name}」（来自树木工作台）`)
  }
  return true
}

byId('as-act-edit-tree').onclick = () => { void openItemInTreeStudio(selectedId) }
byId('as-act-save-preset').onclick = async () => {
  const item = selectedId ? sceneSpec.items.find(x => x.id === selectedId) : undefined
  if (!item || item.kind !== 'tree') return
  const treePayload = item.payload as TreeSpec
  const inst = instances.get(item.id)
  const kindLabelMap: Record<TreeSpec['kind'], string> = {
    broadleaf: '阔叶树', conifer: '针叶树', palm: '棕榈树', bamboo: '竹子',
    lotus: '荷花', grass: '草丛', fern: '蕨类', flowerbed: '花丛',
  }
  try {
    const thumb = viewport ? viewport.snapshotDataUrl('image/jpeg', 320, 220) : ''
    const saved = await presetStore.saveNew<TreeSpec>({
      scope: 'tree',
      name: item.name || treePayload.name || '场景树木资产',
      kind: treePayload.kind,
      kindLabel: kindLabelMap[treePayload.kind] ?? treePayload.kind,
      triangles: inst?.triangles ?? 0,
      lighting: 'ghibli',
      thumbnail: thumb,
      payload: cloneJson(treePayload),
      ...(item.customTextures ? { textures: item.customTextures } : {}),
    })
    renderPalette()
    message(`已保存到树木工作台共享预设库：「${saved.name}」`)
  } catch (err) {
    message(err instanceof Error ? err.message : '保存到预设库失败', true)
  }
}

// Multi-tab real-time sync from Vegetation Studio (strictly isolated to sessions owned by this tab)
subscribeSceneEditUpdates(msg => {
  if (!msg.sessionId || !ownedBridgeSessionIds.has(msg.sessionId)) return
  void applyBridgeEditToScene({
    sessionId: msg.sessionId,
    itemId: msg.itemId,
    treeSpec: msg.treeSpec,
    customTextures: msg.customTextures,
    itemName: msg.itemName,
    barkStyle: msg.barkStyle,
    crownStyle: msg.crownStyle,
    treeForm: msg.treeForm,
    leafTexture: msg.leafTexture,
  }, msg.type === 'scene-edit-commit')
})

// ---- Reference Image Comparator (Upload / Drag-Drop / Paste / Agent Inject) -
async function compareReference(src: string) {
  if (!viewport) throw new Error('三维视口尚未就绪')
  return compareSceneReference(src, viewport.snapshotDataUrl('image/png'))
}

async function runReferenceIou(explicitSrc?: string) {
  const rev = ++refRevision
  const builtIn = activeBuiltInCaseId && getBuiltInAssemblyCase(activeBuiltInCaseId)
  const activeSrc = explicitSrc || sceneSpec.reference?.src || ''
  const file = activeSrc ? undefined : refFile.files?.[0]
  const fallbackSrc = activeSrc || (builtIn ? `./showcases/reference-${activeBuiltInCaseId}.jpg` : '')
  refCheck.disabled = !file && !fallbackSrc
  byId('as-ref-images').hidden = true
  byId('as-ref-status').textContent = ''
  if (!file && !fallbackSrc) return
  const src = file ? URL.createObjectURL(file) : fallbackSrc
  try {
    const result = await compareReference(src)
    if (rev !== refRevision) return
    const images = byId('as-ref-images').querySelectorAll('img')
    ;[result.reference, result.render, result.difference].forEach((url, i) => { images[i].src = url })
    byId('as-ref-images').hidden = false
    const summary = `外形重合 ${Math.round(result.silhouetteIoU * 100)}% · 粉色缺失，青色多出`
    byId('as-ref-status').textContent = summary
    const details = document.querySelector<HTMLDetailsElement>('.as-reference')
    if (details) details.open = true
    if (explicitSrc) message(`轮廓比对完成：${summary}`)
  } catch {
    if (rev === refRevision) byId('as-ref-status').textContent = '无法提取主体，请使用纯色或透明背景的单张场景图。'
  } finally {
    if (file) URL.revokeObjectURL(src)
  }
}

refCompare = createRefCompareController({
  stageEl: document.querySelector<HTMLElement>('.as-stage')!,
  onChange: next => {
    sceneSpec.reference = next
    syncCasePills()
  },
  onRequestResize: () => viewport?.triggerResize(),
  onRequestIou: src => { void runReferenceIou(src) },
  onNotify: text => message(text),
})

byId('as-ref-toggle').onclick = () => {
  refCompare?.togglePanel()
  syncCasePills()
}

refFile.onchange = async () => {
  const file = refFile.files?.[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        refCompare?.setImage(reader.result, file.name, { mode: 'wipe' })
      }
    }
    reader.readAsDataURL(file)
  }
  await runReferenceIou()
}
refCheck.onclick = () => { void runReferenceIou() }

// ---- UE-Style Grass Paint Brush Controls -----------------------------------
byId('as-brush-toggle').onclick = () => setActiveBrushTool(activeBrushTool === 'grass' ? 'none' : 'grass')
byId('as-brush-power').onclick = () => setActiveBrushTool(activeBrushTool === 'grass' ? 'none' : 'grass')

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-bmode]')) {
  b.onclick = () => {
    brushOpts.mode = b.dataset.bmode === 'erase' ? 'erase' : 'paint'
    if (activeBrushTool !== 'grass') setActiveBrushTool('grass')
    else { viewport?.refreshBrushHover(false); updateBrushUi() }
  }
}

// ---- UE Landscape-Style Terrain Material Paint Brush Controls --------------
byId('as-terrain-toggle').onclick = () => setActiveBrushTool(activeBrushTool === 'terrain' ? 'none' : 'terrain')
byId('as-terrain-power').onclick = () => setActiveBrushTool(activeBrushTool === 'terrain' ? 'none' : 'terrain')

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tmode]')) {
  b.onclick = () => {
    terrainOpts.mode = b.dataset.tmode === 'erase' ? 'erase' : 'paint'
    if (activeBrushTool !== 'terrain') setActiveBrushTool('terrain')
    else { viewport?.refreshBrushHover(false); updateBrushUi() }
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tmat]')) {
  b.onclick = () => {
    terrainOpts.material = b.dataset.tmat as TerrainMaterialId
    terrainOpts.mode = 'paint'
    if (activeBrushTool !== 'terrain') setActiveBrushTool('terrain')
    else { viewport?.refreshBrushHover(false); updateBrushUi() }
  }
}
const syncTerrainSliderOutputs = () => {
  ;(byId('as-t-radius') as HTMLInputElement).value = String(terrainOpts.radius)
  byId('as-t-radius-out').textContent = `${terrainOpts.radius.toFixed(2)}m`
  ;(byId('as-t-strength') as HTMLInputElement).value = String(terrainOpts.strength)
  byId('as-t-strength-out').textContent = `${Math.round(terrainOpts.strength * 100)}%`
  ;(byId('as-t-hardness') as HTMLInputElement).value = String(terrainOpts.hardness)
  byId('as-t-hardness-out').textContent = `${Math.round(terrainOpts.hardness * 100)}%`
  ;(byId('as-t-custom-col') as HTMLInputElement).value = terrainOpts.customColor
  ;(byId('as-t-clear-grass') as HTMLInputElement).checked = terrainOpts.clearGrassOnHardSurface
}
byId<HTMLInputElement>('as-t-custom-col').oninput = ev => {
  terrainOpts.customColor = (ev.target as HTMLInputElement).value
  if (activeBrushTool === 'terrain') viewport?.refreshBrushHover(false)
}
byId<HTMLInputElement>('as-t-radius').oninput = ev => {
  terrainOpts.radius = Number((ev.target as HTMLInputElement).value)
  syncTerrainSliderOutputs()
  if (activeBrushTool === 'terrain') viewport?.refreshBrushHover(false)
}
byId<HTMLInputElement>('as-t-strength').oninput = ev => {
  terrainOpts.strength = Number((ev.target as HTMLInputElement).value)
  syncTerrainSliderOutputs()
}
byId<HTMLInputElement>('as-t-hardness').oninput = ev => {
  terrainOpts.hardness = Number((ev.target as HTMLInputElement).value)
  syncTerrainSliderOutputs()
}
byId<HTMLInputElement>('as-t-clear-grass').onchange = ev => {
  terrainOpts.clearGrassOnHardSurface = (ev.target as HTMLInputElement).checked
}
byId('as-terrain-clear').onclick = () => {
  if (!builtGround?.terrainPaint?.hasPaint() && !sceneSpec.groundPaint) {
    message('当前地形没有手绘材质层')
    return
  }
  pushUndo()
  builtGround?.terrainPaint?.clear()
  sceneSpec.groundPaint = undefined
  updateBrushUi()
  activityLog.action('清除地形材质手绘层', {}, 'scene')
  message('已清除手绘地形材质并恢复程序基底（可按 Ctrl+Z 撤销）')
}
syncTerrainSliderOutputs()

byId('as-brush-species').addEventListener('change', () => {
  const checked = Array.from(byId('as-brush-species').querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
    .map(el => el.value as GrassSpeciesId)
  brushOpts.species = checked.length > 0 ? checked : ['broad']
})

const syncBrushSliderOutputs = () => {
  ;(byId('as-b-radius') as HTMLInputElement).value = String(brushOpts.radius)
  byId('as-b-radius-out').textContent = `${brushOpts.radius.toFixed(2)}m`
  ;(byId('as-b-density') as HTMLInputElement).value = String(brushOpts.density)
  byId('as-b-density-out').textContent = String(brushOpts.density)
  ;(byId('as-b-spacing') as HTMLInputElement).value = String(brushOpts.minSpacing)
  byId('as-b-spacing-out').textContent = `${brushOpts.minSpacing.toFixed(2)}m`
  ;(byId('as-b-smin') as HTMLInputElement).value = String(brushOpts.scaleMin)
  byId('as-b-smin-out').textContent = `${brushOpts.scaleMin.toFixed(2)}×`
  ;(byId('as-b-smax') as HTMLInputElement).value = String(brushOpts.scaleMax)
  byId('as-b-smax-out').textContent = `${brushOpts.scaleMax.toFixed(2)}×`
  ;(byId('as-b-tilt') as HTMLInputElement).value = String(brushOpts.tiltMaxDeg)
  byId('as-b-tilt-out').textContent = `${brushOpts.tiltMaxDeg}°`
  ;(byId('as-b-tint') as HTMLInputElement).value = brushOpts.tintColor
  ;(byId('as-b-tvar') as HTMLInputElement).value = String(brushOpts.tintVariance)
  byId('as-b-tvar-out').textContent = `${Math.round(brushOpts.tintVariance * 100)}%`
  ;(byId('as-b-avoid-path') as HTMLInputElement).checked = brushOpts.avoidPath
}

byId<HTMLInputElement>('as-b-radius').oninput = ev => {
  brushOpts.radius = Number((ev.target as HTMLInputElement).value)
  syncBrushSliderOutputs()
  viewport?.refreshBrushHover(false)
}
byId<HTMLInputElement>('as-b-density').oninput = ev => {
  brushOpts.density = Number((ev.target as HTMLInputElement).value)
  syncBrushSliderOutputs()
}
byId<HTMLInputElement>('as-b-spacing').oninput = ev => {
  brushOpts.minSpacing = Number((ev.target as HTMLInputElement).value)
  syncBrushSliderOutputs()
}
byId<HTMLInputElement>('as-b-smin').oninput = ev => {
  brushOpts.scaleMin = Number((ev.target as HTMLInputElement).value)
  if (brushOpts.scaleMax < brushOpts.scaleMin) brushOpts.scaleMax = brushOpts.scaleMin
  syncBrushSliderOutputs()
}
byId<HTMLInputElement>('as-b-smax').oninput = ev => {
  brushOpts.scaleMax = Number((ev.target as HTMLInputElement).value)
  if (brushOpts.scaleMin > brushOpts.scaleMax) brushOpts.scaleMin = brushOpts.scaleMax
  syncBrushSliderOutputs()
}
byId<HTMLInputElement>('as-b-tilt').oninput = ev => {
  brushOpts.tiltMaxDeg = Number((ev.target as HTMLInputElement).value)
  syncBrushSliderOutputs()
}
byId<HTMLInputElement>('as-b-tint').oninput = ev => {
  brushOpts.tintColor = (ev.target as HTMLInputElement).value
}
byId<HTMLInputElement>('as-b-tvar').oninput = ev => {
  brushOpts.tintVariance = Number((ev.target as HTMLInputElement).value)
  syncBrushSliderOutputs()
}
byId<HTMLInputElement>('as-b-avoid-path').onchange = ev => {
  brushOpts.avoidPath = (ev.target as HTMLInputElement).checked
}

byId('as-brush-fill').onclick = () => {
  pushUndo()
  if (!sceneSpec.grassPaint) sceneSpec.grassPaint = []
  // Scale fill volume with current density & slab area (up to 4,800+ clumps at max density 120!)
  const areaScale = (sceneSpec.ground.size / 7.2) ** 1.35
  const targetAdd = Math.round(Math.min(5400, Math.max(360, brushOpts.density * 32 * areaScale)))
  const added = paintedGrass.fillMeadow(sceneSpec.grassPaint, brushOpts, sceneSpec.ground, targetAdd)
  if (sceneSpec.grassPaint.length === 0) sceneSpec.grassPaint = undefined
  updateStatsUi()
  updateBrushUi()
  const gs = paintedGrass.stats()
  activityLog.action(`一键铺满草地：新增 ${added} 簇（共 ${gs.clusters} 簇）`, { added, total: gs.clusters }, 'scene')
  message(`已铺满草地：新增 ${fmt.format(added)} 簇草丛（共 ${fmt.format(gs.clusters)} 簇 · 仅 ${gs.drawCalls} Draw Calls）`)
}

byId('as-brush-clear').onclick = () => {
  if (!sceneSpec.grassPaint || sceneSpec.grassPaint.length === 0) {
    message('当前没有笔刷绘制的草丛')
    return
  }
  pushUndo()
  sceneSpec.grassPaint = undefined
  syncPaintedGrassFromSpec()
  updateStatsUi()
  activityLog.action('清空刷草笔刷层', {}, 'scene')
  message('已清空全部刷草（可按 Ctrl+Z 撤销）')
}

// ---- UE RVT Grass-to-Ground Blending Controls ------------------------------
byId<HTMLSelectElement>('as-rvt-mode').onchange = ev => {
  pushUndo()
  const rvt = getActiveRvt()
  rvt.mode = (ev.target as HTMLSelectElement).value as GrassRvtMode
  syncRvtUiAndShader()
  activityLog.action(`切换草地 RVT 融合算法 → ${RVT_TAG_LABELS[rvt.mode]}`, { rvt }, 'scene')
}
byId<HTMLInputElement>('as-rvt-strength').oninput = ev => {
  beginGestureUndo()
  getActiveRvt().strength = Number((ev.target as HTMLInputElement).value)
  syncRvtUiAndShader()
}
byId<HTMLInputElement>('as-rvt-strength').onchange = () => commitGestureUndo()
byId<HTMLInputElement>('as-rvt-height').oninput = ev => {
  beginGestureUndo()
  getActiveRvt().fadeHeight = Number((ev.target as HTMLInputElement).value)
  syncRvtUiAndShader()
}
byId<HTMLInputElement>('as-rvt-height').onchange = () => commitGestureUndo()
byId<HTMLInputElement>('as-rvt-normal').oninput = ev => {
  beginGestureUndo()
  getActiveRvt().normalBlend = Number((ev.target as HTMLInputElement).value)
  syncRvtUiAndShader()
}
byId<HTMLInputElement>('as-rvt-normal').onchange = () => commitGestureUndo()
byId<HTMLInputElement>('as-rvt-placed').onchange = ev => {
  pushUndo()
  getActiveRvt().affectPlacedGrass = (ev.target as HTMLInputElement).checked
  syncRvtUiAndShader()
}

// Shift + MouseWheel adjusts active brush radius smoothly (works for BOTH grass & terrain brush)
byId('canvas').addEventListener('wheel', ev => {
  if (activeBrushTool === 'none' || !ev.shiftKey) return
  ev.preventDefault()
  ev.stopPropagation()
  const step = ev.deltaY < 0 ? 0.12 : -0.12
  if (activeBrushTool === 'terrain') {
    terrainOpts.radius = Number(Math.max(0.20, Math.min(3.5, terrainOpts.radius + step)).toFixed(2))
    syncTerrainSliderOutputs()
    viewport?.refreshBrushHover(ev.shiftKey)
    flashBrushHud(`🎨 地形笔刷半径 ${terrainOpts.radius.toFixed(2)}m`)
  } else {
    brushOpts.radius = Number(Math.max(0.25, Math.min(3.5, brushOpts.radius + step)).toFixed(2))
    syncBrushSliderOutputs()
    viewport?.refreshBrushHover(ev.shiftKey)
    flashBrushHud(`🌿 刷草笔刷半径 ${brushOpts.radius.toFixed(2)}m`)
  }
}, { passive: false, capture: true })

syncBrushSliderOutputs()
syncRvtUiAndShader()

const exportScenePng = (transparent: boolean) => {
  if (!viewport) return
  const dataUrl = viewport.snapshot({ transparent })
  if (!dataUrl) {
    message('当前视口无法生成截图 PNG', true)
    return
  }
  const filename = `${safeFileSlug()}${transparent ? '_transparent' : ''}.png`
  activityLog.action(transparent ? '导出场景透明底 PNG' : '导出场景截图 PNG', { filename, transparent }, 'scene')
  downloadBlob(
    dataUrlToBlob(dataUrl),
    filename,
    transparent ? '已导出透明背景抠图 PNG' : '已保存场景 3D 截图 PNG',
  )
}
byId('as-png-btn').onclick = () => exportScenePng(false)
byId('as-png-alpha-btn').onclick = () => exportScenePng(true)

bindGlbExportPopover({
  triggerButton: byId<HTMLButtonElement>('glb'),
  getRoot: () => (sceneSpec.items.length > 0 || (sceneSpec.grassPaint?.length ?? 0) > 0 || sceneSpec.ground.style !== 'none')
    ? viewport?.getLod0ExportRoot()
    : undefined,
  exportBlob: opts => exportGlb(viewport!.getLod0ExportRoot(), opts),
  getFilename: opts => `${safeFileSlug()}${opts.mode === 'merged' ? '-merged' : ''}.glb`,
  saveBlob: downloadBlob,
  message,
  emptyMessage: '当前组装场景为空，请先放置资产、刷草或启用地块',
})

// Activity Log Drawer
const activityLogDrawer = mountActivityLogDrawer({
  triggerButton: byId<HTMLButtonElement>('activity-log-btn'),
  badgeElement: byId('al-badge'),
  onBeforeOpen: () => closeCasesDrawer(),
  message: (text, err) => message(text, err, false),
})

function isTextEditingControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target instanceof HTMLInputElement) {
    return !['range', 'checkbox', 'radio', 'button', 'color', 'file'].includes(target.type)
  }
  return false
}

// Instant IME-proof keyboard shortcuts (uses ev.code so Chinese IME never delays B / [ / ] / W / E / R / G!)
window.addEventListener('keydown', ev => {
  if (isTextEditingControl(ev.target)) return
  const code = ev.code
  const key = ev.key.toLowerCase()

  // Instant Shift paint <-> erase cursor color flip with zero mouse movement
  if (code === 'ShiftLeft' || code === 'ShiftRight' || key === 'shift') {
    if (viewport?.isBrushMode() && !ev.repeat) viewport.refreshBrushHover(true)
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && (code === 'KeyZ' || key === 'z')) {
    ev.preventDefault()
    if (ev.shiftKey) void applyRedo()
    else void applyUndo()
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && (code === 'KeyY' || key === 'y')) {
    ev.preventDefault()
    void applyRedo()
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && (code === 'KeyD' || key === 'd')) {
    if (selectedId && !viewport?.isBrushMode()) {
      ev.preventDefault()
      void duplicateItem(selectedId)
    }
    return
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return

  if (code === 'KeyB' || key === 'b') {
    if (ev.repeat) return
    ev.preventDefault()
    const next: ActiveBrushTool = activeBrushTool === 'grass' ? 'none' : 'grass'
    setActiveBrushTool(next)
    flashBrushHud(next === 'grass' ? `🌿 刷草笔刷已开启（其他模型已锁定）· 半径 ${brushOpts.radius.toFixed(2)}m` : '已退出刷草笔刷')
    return
  }
  if (code === 'KeyT' || key === 't') {
    if (ev.repeat) return
    ev.preventDefault()
    const next: ActiveBrushTool = activeBrushTool === 'terrain' ? 'none' : 'terrain'
    setActiveBrushTool(next)
    flashBrushHud(next === 'terrain' ? `🎨 地形材质笔刷已开启（其他模型已锁定）· 半径 ${terrainOpts.radius.toFixed(2)}m` : '已退出地形材质笔刷')
    return
  }
  if (activeBrushTool !== 'none' && (code === 'BracketLeft' || code === 'BracketRight' || key === '[' || key === ']' || key === '【' || key === '】')) {
    ev.preventDefault()
    const shrink = code === 'BracketLeft' || key === '[' || key === '【'
    const step = shrink ? -0.15 : 0.15
    if (activeBrushTool === 'terrain') {
      terrainOpts.radius = Number(Math.max(0.20, Math.min(3.5, terrainOpts.radius + step)).toFixed(2))
      syncTerrainSliderOutputs()
      viewport?.refreshBrushHover(ev.shiftKey)
      flashBrushHud(`🎨 地形笔刷半径 ${terrainOpts.radius.toFixed(2)}m`)
    } else {
      brushOpts.radius = Number(Math.max(0.25, Math.min(3.5, brushOpts.radius + step)).toFixed(2))
      syncBrushSliderOutputs()
      viewport?.refreshBrushHover(ev.shiftKey)
      flashBrushHud(`🌿 刷草笔刷半径 ${brushOpts.radius.toFixed(2)}m`)
    }
    return
  }
  if (code === 'KeyW' || key === 'w') { setBrushModeEnabled(false); document.querySelector<HTMLButtonElement>('[data-gizmo="translate"]')?.click() }
  else if (code === 'KeyE' || key === 'e') { setBrushModeEnabled(false); document.querySelector<HTMLButtonElement>('[data-gizmo="rotate"]')?.click() }
  else if (code === 'KeyR' || key === 'r') { setBrushModeEnabled(false); document.querySelector<HTMLButtonElement>('[data-gizmo="scale"]')?.click() }
  else if (code === 'KeyG' || key === 'g') { if (!viewport?.isBrushMode()) groundSelectedItem() }
  else if (code === 'KeyF' || key === 'f') {
    const inst = selectedId ? instances.get(selectedId) : undefined
    if (inst) viewport?.focusObject(inst.wrapper)
  } else if (code === 'Delete' || code === 'Backspace' || key === 'delete' || key === 'backspace') {
    if (selectedId && !viewport?.isBrushMode()) { ev.preventDefault(); deleteItem(selectedId) }
  } else if (code === 'Escape' || key === 'escape') {
    if (viewport?.isBrushMode()) {
      const wasTerrain = activeBrushTool === 'terrain'
      setBrushModeEnabled(false)
      flashBrushHud(wasTerrain ? '已退出地形材质笔刷' : '已退出刷草笔刷')
    }
    else if (!casesDrawer.hidden) closeCasesDrawer()
    else selectItem(undefined)
  }
})

window.addEventListener('keyup', ev => {
  if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight' || ev.key === 'Shift') {
    if (viewport?.isBrushMode()) viewport.refreshBrushHover(false)
  }
})

// Store subscriptions + automatic cross-workbench focus/visibility reload
presetStore.subscribe(renderPalette)
treeDefaults.subscribe(renderPalette)
rockDefaults.subscribe(renderPalette)
sceneStore.subscribe(() => { syncCasesBadge(); if (!casesDrawer.hidden) renderCasesGrid() })

let lastAutoSyncAt = 0
const triggerSilentLibSync = () => {
  const now = Date.now()
  if (now - lastAutoSyncAt < 1500) return
  lastAutoSyncAt = now
  void syncExternalAssetLibraries(false)
}
window.addEventListener('focus', triggerSilentLibSync)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') triggerSilentLibSync()
})

void Promise.all([presetStore.ready(), treeDefaults.ready(), rockDefaults.ready(), sceneStore.ready()]).then(() => {
  renderPalette()
  syncCasesBadge()
})

// Boot sequence:
// 1. If returning from Tree Studio (?applyEdit=<id> or ?resumeEdit=<id>), restore exact working scene draft & apply edited plant!
// 2. Otherwise load requested case (?case=boulder-trail | ?case=blank | default: birch-meadow Ref 1)
// 3. If ?ref=<url> is supplied (e.g. Agent direct reference injection), auto-load into the comparator!
const urlParams = new URL(location.href).searchParams
const applyEditId = urlParams.get('applyEdit')
const resumeEditId = urlParams.get('resumeEdit')
const initialRefUrl = urlParams.get('ref')
const initialRefMode = urlParams.get('refMode') as RefCompareMode | null
const initialCase = urlParams.get('case')

async function bootSceneStudio() {
  // Yield one paint frame so the Scene Studio shell renders immediately on workbench switch
  if (typeof requestAnimationFrame === 'function') {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
  }
  const editSessionId = applyEditId || resumeEditId
  const session = editSessionId ? await loadSceneEditSessionAsync(editSessionId) : undefined
  if (session) {
    ownedBridgeSessionIds.add(session.sessionId)
    sceneSpec = parseAssemblyScene(cloneJson(session.sceneDraft))
    activeBuiltInCaseId = session.activeBuiltInCaseId
    activeSavedSceneId = session.activeSavedSceneId
    selectedId = session.selectedId ?? session.itemId
    await rebuildAllItems(true)
    if (applyEditId && session.committed) {
      await applyBridgeEditToScene({
        sessionId: session.sessionId,
        itemId: session.itemId,
        treeSpec: session.treeSpec,
        customTextures: session.customTextures,
        itemName: session.itemName,
        barkStyle: session.barkStyle,
        crownStyle: session.crownStyle,
        treeForm: session.treeForm,
        leafTexture: session.leafTexture,
      }, true)
    } else if (resumeEditId) {
      selectItem(selectedId)
      message('已返回组装工作台（保留原资产未修改）')
    }
    clearSceneEditSession(session.sessionId)
    // Clean transient edit query parameters without reloading
    try {
      const clean = new URL(location.href)
      clean.searchParams.delete('applyEdit')
      clean.searchParams.delete('resumeEdit')
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash)
    } catch { /* ignore */ }
  } else if (initialCase === 'blank') {
    await rebuildAllItems(true)
  } else {
    await loadBuiltInCase(initialCase && getBuiltInAssemblyCase(initialCase) ? initialCase : builtInAssemblyCases[0].id)
  }

  if (initialRefUrl) {
    refCompare?.setImage(initialRefUrl, urlParams.get('refName') || 'Agent 注入参考图', {
      mode: initialRefMode && ['pip', 'wipe', 'overlay', 'split', 'off'].includes(initialRefMode) ? initialRefMode : 'wipe',
    })
  }
}

const bootPromise = bootSceneStudio()

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
    openInTreeStudio: (id?: string) => openItemInTreeStudio(id),
    setGizmo: (m: GizmoMode) => { setBrushModeEnabled(false); viewport?.setGizmoMode(m) },
    groundSelected: () => groundSelectedItem(),
    duplicateSelected: () => (selectedId ? duplicateItem(selectedId) : Promise.resolve()),
    deleteSelected: () => { if (selectedId) deleteItem(selectedId) },
    addCurated: (curatedId: string, pos?: [number, number, number]) => {
      const hit = curatedAssemblyAssets.find(c => c.id === curatedId)
      return hit ? addAssetItem(hit.create(), pos) : Promise.resolve()
    },
    syncAssetLibraries: () => syncExternalAssetLibraries(false),
    listUserPresets: () => presetStore.list().map(p => ({ id: p.id, scope: p.scope, name: p.name, kind: p.kind, hasTextures: Boolean(p.textures && Object.keys(p.textures).length) })),
    addPreset: async (id: string, pos?: [number, number, number]) => {
      const savedId = id.startsWith('saved:') ? id.slice(6) : id
      const saved = presetStore.get(savedId) ?? presetStore.list().find(p => p.name === id)
      if (saved) {
        return await addAssetItem(savedPresetToEntry(saved, '').create(), pos)
      }
      if ((presetIds as readonly string[]).includes(id)) {
        const pid = id as PresetId
        const over = treeDefaults.get(pid)
        const item = createTreeItem(over?.spec ?? presetSpec(pid), {
          name: presets[pid].name,
          customTextures: over?.textures,
        })
        return await addAssetItem(item, pos)
      }
      if (id in rockPresets) {
        const rid = id as RockPresetId
        const over = rockDefaults.get(rid)
        const item = createRockItem(over?.spec ?? rockPresetSpec(rid), { name: rockPresets[rid].name })
        return await addAssetItem(item, pos)
      }
      const curatedHit = curatedAssemblyAssets.find(c => c.id === id)
      if (curatedHit) {
        const item = curatedHit.create()
        return await addAssetItem(item, pos)
      }
      return undefined
    },
    clearScene: async () => {
      byId('as-clear-btn').click()
      await new Promise(r => setTimeout(r, 80))
    },
    exportGlbBase64: async (opts?: Parameters<typeof exportGlb>[1]) => {
      if (!viewport) throw new Error('场景视口尚未初始化')
      const blob = await exportGlb(viewport.getLod0ExportRoot(), opts)
      const base64 = await blobToBase64(blob)
      return {
        base64,
        bytes: blob.size,
        filename: `${safeFileSlug()}${opts?.mode === 'merged' ? '-merged' : ''}.glb`,
      }
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
      viewport?.updateLods()
      viewport?.refreshShadows()
      if (selectedId === id) syncSelectedTransformInputs()
    },
    setCamera: setAssemblyCamera,
    setCameraDistance: (distance: number) => viewport?.setCameraDistance(distance),
    setDistantLod: (enabled: boolean) => setDistantLodEnabled(enabled, false),
    getDistantLod: () => distantLodEnabled,
    setBackdrop: (theme: BackdropTheme) => {
      sceneSpec.backdrop = theme
      sceneSpec.lighting = backdropMeta[theme].lighting
      viewport?.setBackdrop(theme, sceneSpec.lighting)
      syncGroundInputs()
    },
    setWind: (on: boolean) => {
      sceneSpec.wind = on
      const btn = byId('as-wind-btn')
      btn.setAttribute('aria-pressed', String(on))
      btn.textContent = on ? '🍃 微风 开' : '🍃 微风 关'
      viewport?.setWind(on)
    },
    compareReference,
    setReferenceImage: (src: string, name?: string, opts?: Partial<Omit<AssemblyReferenceSpec, 'src' | 'name'>>) =>
      refCompare?.setImage(src, name, opts),
    setReferenceMode: (mode: RefCompareMode) => refCompare?.setMode(mode),
    clearReferenceImage: () => refCompare?.clear(),
    getReference: () => refCompare?.getCurrent(),
    grassBrush: {
      setEnabled: (on: boolean) => setBrushModeEnabled(on),
      isEnabled: () => Boolean(viewport?.isBrushMode()),
      getOptions: () => ({ ...brushOpts, species: [...brushOpts.species] }),
      setOptions: (patch: Partial<GrassBrushOptions>) => {
        Object.assign(brushOpts, patch)
        syncBrushSliderOutputs()
        updateBrushUi()
      },
      paintAt: (x: number, z: number, seed?: number) => {
        pushUndo()
        if (!sceneSpec.grassPaint) sceneSpec.grassPaint = []
        const added = paintedGrass.paintAt(sceneSpec.grassPaint, x, z, brushOpts, sceneSpec.ground, seed)
        updateStatsUi()
        updateBrushUi()
        return added
      },
      eraseAt: (x: number, z: number, radius?: number) => {
        if (!sceneSpec.grassPaint || sceneSpec.grassPaint.length === 0) return 0
        pushUndo()
        const removed = paintedGrass.eraseAt(sceneSpec.grassPaint, x, z, radius ?? brushOpts.radius)
        if (sceneSpec.grassPaint.length === 0) sceneSpec.grassPaint = undefined
        updateStatsUi()
        updateBrushUi()
        return removed
      },
      fillMeadow: (count = 420) => {
        pushUndo()
        if (!sceneSpec.grassPaint) sceneSpec.grassPaint = []
        const added = paintedGrass.fillMeadow(sceneSpec.grassPaint, brushOpts, sceneSpec.ground, count)
        if (sceneSpec.grassPaint.length === 0) sceneSpec.grassPaint = undefined
        updateStatsUi()
        updateBrushUi()
        return added
      },
      clear: () => {
        if (!sceneSpec.grassPaint?.length) return
        pushUndo()
        sceneSpec.grassPaint = undefined
        syncPaintedGrassFromSpec()
        updateStatsUi()
      },
      stats: () => paintedGrass.stats(),
    },
    terrainBrush: {
      setEnabled: (on: boolean) => setActiveBrushTool(on ? 'terrain' : 'none'),
      isEnabled: () => activeBrushTool === 'terrain',
      getOptions: () => ({ ...terrainOpts }),
      setOptions: (patch: Partial<TerrainBrushOptions>) => {
        Object.assign(terrainOpts, patch)
        syncTerrainSliderOutputs()
        updateBrushUi()
      },
      paintAt: (x: number, z: number, erase = false) => {
        const layer = builtGround?.terrainPaint
        if (!layer) return false
        sceneSpec.groundPaint = layer.exportDataUrl()
        pushUndo()
        const ok = layer.paintAt(x, z, terrainOpts, erase)
        if (ok) {
          sceneSpec.groundPaint = layer.exportDataUrl()
          updateBrushUi()
        }
        return ok
      },
      clear: () => {
        if (!builtGround?.terrainPaint?.hasPaint() && !sceneSpec.groundPaint) return
        pushUndo()
        builtGround?.terrainPaint?.clear()
        sceneSpec.groundPaint = undefined
        updateBrushUi()
      },
      hasPaint: () => Boolean(builtGround?.terrainPaint?.hasPaint() || sceneSpec.groundPaint),
    },
    rvt: {
      get: () => ({ ...getActiveRvt() }),
      set: (patch: Partial<GrassRvtSpec>) => {
        Object.assign(getActiveRvt(), patch)
        syncRvtUiAndShader()
        return { ...getActiveRvt() }
      },
    },
    setCrownStyle,
    snapshot: (opts?: { transparent?: boolean }) => viewport?.snapshot(opts) ?? '',
    snapshotCanvas: (opts?: { transparent?: boolean }) => viewport?.snapshot(opts) ?? '',
    snapshotTransparentCanvas: () => viewport?.snapshot({ transparent: true }) ?? '',
    snapshotThumb: () => viewport?.snapshotDataUrl('image/jpeg', 320, 220) ?? '',
    saveScene: (name?: string) => saveCurrentSceneAsNew(name),
    savedScenes: () => sceneStore.list(),
    removeSavedScene: (id: string) => sceneStore.remove(id),
    openCases: (tab: CasesTab = 'builtin') => openCasesDrawer(tab),
    closeCases: () => closeCasesDrawer(),
    stats: () => {
      viewport?.updateLods()
      let lod0Triangles = paintedGrass.stats().triangles
      let activeTriangles = paintedGrass.stats().triangles
      for (const item of sceneSpec.items) {
        const inst = instances.get(item.id)
        if (!inst || !item.visible) continue
        lod0Triangles += inst.triangles
        activeTriangles += inst.activeTriangles()
      }
      return {
        items: sceneSpec.items.length,
        paintedGrass: paintedGrass.stats().clusters,
        grassDrawCalls: paintedGrass.stats().drawCalls,
        triangles: activeTriangles,
        lod0Triangles,
        renderedTriangles: viewport?.renderer.info.render.triangles ?? activeTriangles,
        distantLod: distantLodEnabled,
      }
    },
  },
})

mountDesktopToolbarBadge('header.bar nav', msg => message(msg))
