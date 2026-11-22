// Curated Substance Designer-style procedural starter templates for Bark & Foliage.
import { Texture } from 'three'
import type { EditableTextureSlot } from '../studio/texture-slots'
import { evaluateTextureGraph, materialOutputToThreeTexture } from './engine'
import { cloneGraph, createNode, defaultAsymmetricAtlasRegions } from './nodes'
import { evalStemPoint, resolveAtlasRegions } from './nodes-v2'
import type {
  AtlasRegion, GraphEdge, TextureCategory, TextureGraph, VectorLeafInstance, VectorStem,
} from './types'

export interface TextureTemplate {
  id: string
  name: string
  subtitle: string
  category: TextureCategory
  targetSlot: EditableTextureSlot
  build: () => TextureGraph
}

const edge = (fromNode: string, fromPort: string, toNode: string, toPort: string): GraphEdge => ({
  id: `e-${fromNode}-${fromPort}-${toNode}-${toPort}`,
  fromNode,
  fromPort,
  toNode,
  toPort,
})

/** Generates clean intertwined vine stems + opposite-paired leaves with stable deterministic IDs. */
function buildIntertwinedVineData(): { stems: VectorStem[]; instances: VectorLeafInstance[] } {
  const stems: VectorStem[] = [
    { id: 'stem-top-mid', points: [[0.47, 0.36], [0.41, 0.25], [0.38, 0.14], [0.39, 0.08]], widthStart: 0.0085, widthEnd: 0.0042, z: 0.20 },
    { id: 'stem-top-right', points: [[0.38, 0.38], [0.54, 0.33], [0.64, 0.22], [0.85, 0.38]], widthStart: 0.0095, widthEnd: 0.0045, z: 0.35 },
    { id: 'stem-left-up', points: [[0.34, 0.41], [0.24, 0.32], [0.19, 0.20]], widthStart: 0.0082, widthEnd: 0.004, z: 0.15 },
    { id: 'stem-left-low', points: [[0.36, 0.51], [0.24, 0.56], [0.11, 0.52]], widthStart: 0.008, widthEnd: 0.004, z: 0.30 },
    { id: 'stem-center-down', points: [[0.29, 0.41], [0.43, 0.47], [0.47, 0.66], [0.56, 0.85]], widthStart: 0.009, widthEnd: 0.0045, z: 0.45 },
    { id: 'stem-right-loop', points: [[0.52, 0.42], [0.62, 0.50], [0.68, 0.68], [0.78, 0.82]], widthStart: 0.0082, widthEnd: 0.0042, z: 0.25 },
    { id: 'stem-bottom-left', points: [[0.26, 0.66], [0.31, 0.77], [0.28, 0.90]], widthStart: 0.008, widthEnd: 0.004, z: 0.40 },
  ]

  const instances: VectorLeafInstance[] = []
  let leafIdx = 1
  const colorSeq = [0, 3, 1, 2, 0, 4, 3, 1, 2, 0, 1, 3]

  const pushPair = (stem: VectorStem, t: number, side: -1 | 1 | 0, scaleMul = 1, zOff = 0) => {
    const [px, py] = evalStemPoint(stem.points, t)
    const [pA, pB] = [evalStemPoint(stem.points, Math.max(0, t - 0.03)), evalStemPoint(stem.points, Math.min(1, t + 0.03))]
    const tx = pB[0] - pA[0], ty = pB[1] - pA[1]
    const len = Math.hypot(tx, ty) || 1
    const ux = tx / len, uy = ty / len
    // In canvas coords (+X right, +Y down), leaf rot = 0 points straight UP (0, -1).
    // For target direction (dx, dy), rot = atan2(dx, -dy).
    const baseAngle = Math.atan2(ux, -uy)
    const spreadRad = side === 0 ? 0 : side * 0.92
    const rot = baseAngle + spreadRad
    const dirX = Math.sin(rot), dirY = -Math.cos(rot)
    const sx = 0.095 * scaleMul
    const sy = 0.118 * scaleMul
    const offset = sy * 0.42
    const id = `leaf-${String(leafIdx).padStart(2, '0')}`
    instances.push({
      id,
      x: Math.max(0.05, Math.min(0.95, px + dirX * offset)),
      y: Math.max(0.05, Math.min(0.95, py + dirY * offset)),
      rot,
      scaleX: sx,
      scaleY: sy,
      flip: side < 0,
      variant: 0,
      colorIdx: colorSeq[(leafIdx - 1) % colorSeq.length],
      z: stem.z + 0.05 + zOff + leafIdx * 0.002,
      stemId: stem.id,
    })
    leafIdx++
  }

  const pairPlan: { stem: VectorStem; ts: number[]; tip?: boolean }[] = [
    { stem: stems[0], ts: [0.22, 0.46, 0.70, 0.90], tip: true },
    { stem: stems[1], ts: [0.20, 0.42, 0.65, 0.86], tip: true },
    { stem: stems[2], ts: [0.26, 0.56, 0.84], tip: true },
    { stem: stems[3], ts: [0.24, 0.55, 0.84], tip: true },
    { stem: stems[4], ts: [0.22, 0.45, 0.68, 0.88], tip: true },
    { stem: stems[5], ts: [0.25, 0.55, 0.82], tip: true },
    { stem: stems[6], ts: [0.28, 0.62, 0.88], tip: true },
  ]

  for (const plan of pairPlan) {
    for (const t of plan.ts) {
      const sc = 0.92 + 0.14 * Math.sin(Math.PI * t)
      pushPair(plan.stem, t, -1, sc, 0.01)
      pushPair(plan.stem, t, 1, sc * 0.96, 0.02)
    }
    if (plan.tip) pushPair(plan.stem, 0.99, 0, 0.98, 0.03)
  }

  return { stems, instances }
}

export const textureTemplates: TextureTemplate[] = [
  {
    id: 'leaf-vine-intertwined',
    name: '交织绿叶藤蔓 · v2 矢量可编排',
    subtitle: '自由轮廓叶片 + 可直接拖拽贝塞尔藤枝/对生叶实例 + 可选 EDT 描边（默认平涂无描边）',
    category: 'leaf',
    targetSlot: 'leaf',
    build: () => {
      const { stems, instances } = buildIntertwinedVineData()
      return {
        schemaVersion: 2,
        name: '交织绿叶藤蔓 · v2 矢量可编排',
        category: 'leaf',
        targetSlot: 'leaf',
        resolution: 512,
        seamless: false,
        nodes: [
          createNode('custom_leaf', 30, 90, 'vine_leaf', {
            profile: [[0, 0.04], [0.16, 0.36], [0.42, 0.52], [0.70, 0.38], [0.90, 0.14], [1, 0]],
            length: 0.86, width: 0.58, bend: 0.03, tipCurl: 0.02, asymmetry: 0.0,
            lobeCount: 0, lobeDepth: 0, notchPos: 0.62, notchDepth: 0,
            foldShade: 0.06, veinStrength: 0.08, veinCount: 3, stemLen: 0.04,
            baseColor: '#4c803a', tipColor: '#669d42', veinColor: '#82b655', stemColor: '#765638',
          }),
          createNode('vector_layout', 280, 90, 'vine_layout', {
            palette: ['#487c39', '#5a9040', '#6da344', '#92bf49', '#3b6a35'],
            paletteStrength: 0.88,
            lightAngle: -45, lightStrength: 0.08, depthShade: 0.06, layerShadow: 0.0,
            stemColor: '#7b5838', stemHighlight: 0.12,
            stems,
            instances,
          }),
          createNode('ink_outline', 540, 80, 'vine_outline', {
            outerWidth: 0, position: 'center', outerColor: '#1f421f', outerOpacity: 0.92,
            innerWidth: 0, innerColor: '#224a23', innerOpacity: 0.78, softness: 1.0,
          }),
          createNode('output_material', 800, 100, 'out', {
            normalStrength: 1.4, roughnessBase: 0.78, roughnessContrast: 0.10, dilateAlpha: true,
          }),
        ],
        edges: [
          edge('vine_leaf', 'rgba', 'vine_layout', 'leafA'),
          edge('vine_leaf', 'height', 'vine_layout', 'heightA'),
          edge('vine_layout', 'rgba', 'vine_outline', 'input'),
          edge('vine_layout', 'label', 'vine_outline', 'label'),
          edge('vine_outline', 'rgba', 'out', 'baseColor'),
          edge('vine_layout', 'height', 'out', 'height'),
        ],
      }
    },
  },
  {
    id: 'bark-moss-v2',
    name: '曲率色板苔藓古木皮 · v2',
    subtitle: '独立可调 Curvature/AO 凹凸积苔遮罩 + 保单调曲线 + CIELAB 色板锁定 + 全 PBR 导出',
    category: 'bark',
    targetSlot: 'bark',
    build: () => ({
      schemaVersion: 2,
      name: '曲率色板苔藓古木皮 · v2',
      category: 'bark',
      targetSlot: 'bark',
      resolution: 512,
      seamless: true,
      nodes: [
        createNode('bark_fibers', 20, 40, 'fibers', {
          scaleX: 7, scaleY: 2, warp: 0.68, fissure: 1.32, fineGrain: 0.24, octaves: 4, seed: 731,
        }),
        createNode('cells_voronoi', 20, 240, 'plates', {
          scaleX: 5, scaleY: 2, jitter: 0.82, mode: 'edge', edgeWidth: 0.34, seed: 419,
        }),
        createNode('blend', 240, 80, 'base_h', { mode: 'multiply', opacity: 0.52 }),
        createNode('curves_lut', 440, 40, 'h_curve', {
          channel: 'rgb',
          points: [[0, 0.04], [0.28, 0.20], [0.65, 0.76], [1, 0.98]],
          monotone: true,
        }),
        createNode('curvature_ao', 440, 230, 'curv', {
          radius: 13.0, intensity: 2.8, aoRadius: 16, aoStrength: 0.92, aoMode: 'fast', bias: -0.14,
        }),
        createNode('gradient_map', 650, 30, 'wood_grad', {
          stops: [
            { pos: 0.0, color: '#3b281e' },
            { pos: 0.34, color: '#78573d' },
            { pos: 0.70, color: '#b5946e' },
            { pos: 1.0, color: '#e4d0ad' },
          ],
        }),
        createNode('palette_map', 860, 30, 'wood_pal', {
          palette: ['#402c22', '#705139', '#a68561', '#ccb08a', '#e6d3b1'],
          strength: 0.72, softness: 0.32, preserveLuma: 0.42,
        }),
        createNode('blend', 1070, 50, 'wood_ao', { mode: 'multiply', opacity: 0.68 }),
        createNode('perlin_noise', 650, 340, 'moss_n', {
          scaleX: 3, scaleY: 3, octaves: 4, persistence: 0.56, ridged: false, seed: 842,
        }),
        createNode('blend', 860, 240, 'moss_mask', { mode: 'multiply', opacity: 1.0 }),
        createNode('levels', 1070, 240, 'moss_thresh', {
          inLow: 0.14, inHigh: 0.34, gamma: 0.85, outLow: 0.0, outHigh: 1.0, invert: false,
        }),
        createNode('gradient_map', 860, 410, 'moss_col', {
          stops: [
            { pos: 0.0, color: '#27481c' },
            { pos: 0.45, color: '#4f7f29' },
            { pos: 0.82, color: '#82b23b' },
            { pos: 1.0, color: '#b0d45c' },
          ],
        }),
        createNode('blend', 1290, 120, 'final_mix', { mode: 'normal', opacity: 0.96 }),
        createNode('output_material', 1500, 130, 'out', {
          normalStrength: 3.1, roughnessBase: 0.84, roughnessContrast: 0.16, dilateAlpha: false,
        }),
      ],
      edges: [
        edge('fibers', 'out', 'base_h', 'base'),
        edge('plates', 'out', 'base_h', 'overlay'),
        edge('base_h', 'out', 'h_curve', 'input'),
        edge('h_curve', 'out', 'curv', 'height'),
        edge('h_curve', 'out', 'wood_grad', 'input'),
        edge('wood_grad', 'out', 'wood_pal', 'input'),
        edge('wood_pal', 'out', 'wood_ao', 'base'),
        edge('curv', 'ao', 'wood_ao', 'overlay'),
        edge('curv', 'concave', 'moss_mask', 'base'),
        edge('moss_n', 'out', 'moss_mask', 'overlay'),
        edge('moss_mask', 'out', 'moss_thresh', 'input'),
        edge('moss_n', 'out', 'moss_col', 'input'),
        edge('wood_ao', 'out', 'final_mix', 'base'),
        edge('moss_col', 'out', 'final_mix', 'overlay'),
        edge('moss_thresh', 'out', 'final_mix', 'mask'),
        edge('final_mix', 'out', 'out', 'baseColor'),
        edge('h_curve', 'out', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'leaf-oak-asymmetric-atlas',
    name: '厚涂橡叶非对称图集 · 4大+4小 (v2)',
    subtitle: 'atlas_compose 非均匀拼版（4 冠层大簇 + 4 梢端小枝），统一 mip 安全留边与 3D 区域 UV 锚点消费',
    category: 'leaf',
    targetSlot: 'leaf',
    build: () => ({
      schemaVersion: 2,
      name: '厚涂橡叶非对称图集 · 4大+4小 (v2)',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 20, 40, 'oak_big_leaf', {
          shape: 'oak', length: 0.88, width: 0.72, lobes: 7, serration: 0.04,
          veinStrength: 0.16, veinCount: 5, stemLen: 0.05,
          baseColor: '#255820', tipColor: '#69b834', veinColor: '#9be05a', stemColor: '#56412d',
        }),
        createNode('branch_scatter', 250, 30, 'oak_big_clump', {
          layout: 'oak_rosette', atlasCols: 1, atlasRows: 1, budGlint: 0.50,
          stemCount: 4, leavesPerStem: 9, leafScale: 0.46, scaleFalloff: 0.18,
          spread: 1.05, arch: 0.18, rotJitter: 0.24, colorVar: 0.18,
          depthShade: 0.44, stemWidth: 0, stemColor: '#52402c', seed: 618,
        }),
        createNode('leaf_shape', 20, 270, 'oak_small_leaf', {
          shape: 'oak', length: 0.84, width: 0.62, lobes: 5, serration: 0.03,
          veinStrength: 0.14, veinCount: 4, stemLen: 0.06,
          baseColor: '#2e6a26', tipColor: '#7fd03f', veinColor: '#b4ec72', stemColor: '#5c4632',
        }),
        createNode('branch_scatter', 250, 260, 'oak_small_sprig', {
          layout: 'sprig', atlasCols: 1, atlasRows: 1, budGlint: 0.35,
          stemCount: 3, leavesPerStem: 5, leafScale: 0.36, scaleFalloff: 0.22,
          spread: 0.84, arch: 0.16, rotJitter: 0.18, colorVar: 0.16,
          depthShade: 0.30, stemWidth: 0.008, stemColor: '#5c4632', seed: 941,
        }),
        createNode('atlas_compose', 510, 120, 'oak_atlas', {
          layout: 'asymmetric_4big_4small',
          paddingPx: 8,
          colorVar: 0.12,
          seed: 708,
          regions: defaultAsymmetricAtlasRegions,
        }),
        createNode('output_material', 770, 130, 'out', {
          normalStrength: 1.6, roughnessBase: 0.70, roughnessContrast: 0.14, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('oak_big_leaf', 'rgba', 'oak_big_clump', 'leaf'),
        edge('oak_big_leaf', 'height', 'oak_big_clump', 'height'),
        edge('oak_small_leaf', 'rgba', 'oak_small_sprig', 'leaf'),
        edge('oak_small_leaf', 'height', 'oak_small_sprig', 'height'),
        edge('oak_big_clump', 'rgba', 'oak_atlas', 'slotA'),
        edge('oak_big_clump', 'height', 'oak_atlas', 'heightA'),
        edge('oak_small_sprig', 'rgba', 'oak_atlas', 'slotC'),
        edge('oak_small_sprig', 'height', 'oak_atlas', 'heightC'),
        edge('oak_atlas', 'rgba', 'out', 'baseColor'),
        edge('oak_atlas', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'leaf-oak-painterly',
    name: '手绘厚涂橡叶叠簇',
    subtitle: '波浪圆裂橡树叶 + 多层放射叶簇 + 簇心嫩芽高光 + 厚涂笔触',
    category: 'leaf',
    targetSlot: 'leaf',
    build: () => ({
      schemaVersion: 1,
      name: '手绘厚涂橡叶叠簇',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 30, 110, 'oak_leaf', {
          shape: 'oak', length: 0.90, width: 0.66, tipSharp: 0.9, serration: 0.04, serrationFreq: 10,
          bend: 0.04, veinStrength: 0.38, veinCount: 5,
          baseColor: '#0e4720', tipColor: '#69cc2f', veinColor: '#c9f685',
        }),
        createNode('branch_scatter', 270, 100, 'rosettes', {
          layout: 'oak_rosette', atlasCols: 1, atlasRows: 1, budGlint: 0.42,
          stemCount: 6, leavesPerStem: 6, leafScale: 0.29, scaleFalloff: 0.16,
          spread: 0.96, arch: 0.15, rotJitter: 0.35, colorVar: 0.18, depthShade: 0.62,
          stemWidth: 0, stemColor: '#3a4a24', seed: 718,
        }),
        createNode('stylize_paint', 510, 75, 'paint', {
          brushLength: 3.0, angle: 75, levels: 9, softness: 0.58, crispEdges: 0.4,
        }),
        createNode('hsl_adjust', 730, 75, 'hsl', {
          hue: 2, saturation: 1.08, lightness: 0.02, contrast: 1.06,
        }),
        createNode('output_material', 960, 120, 'out', {
          normalStrength: 2.2, roughnessBase: 0.72, roughnessContrast: 0.16, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('oak_leaf', 'rgba', 'rosettes', 'leaf'),
        edge('oak_leaf', 'height', 'rosettes', 'height'),
        edge('rosettes', 'rgba', 'paint', 'input'),
        edge('paint', 'out', 'hsl', 'input'),
        edge('hsl', 'out', 'out', 'baseColor'),
        edge('rosettes', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'leaf-oak-atlas',
    name: '手绘厚涂橡叶 2×2 图集',
    subtitle: '四变体波浪橡叶花簇图集（亮春绿 / 深墨绿 / 暖嫩绿 / 均衡林绿）',
    category: 'leaf',
    targetSlot: 'leaf',
    build: () => ({
      schemaVersion: 1,
      name: '手绘厚涂橡叶 2×2 图集',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 30, 110, 'oak_leaf', {
          shape: 'oak', length: 0.90, width: 0.66, tipSharp: 0.9, serration: 0.04, serrationFreq: 10,
          bend: 0.04, veinStrength: 0.38, veinCount: 5,
          baseColor: '#0e4720', tipColor: '#69cc2f', veinColor: '#c9f685',
        }),
        createNode('branch_scatter', 280, 100, 'rosettes', {
          layout: 'oak_rosette', atlasCols: 2, atlasRows: 2, budGlint: 0.45,
          stemCount: 6, leavesPerStem: 6, leafScale: 0.30, scaleFalloff: 0.16,
          spread: 0.96, arch: 0.15, rotJitter: 0.35, colorVar: 0.2, depthShade: 0.62,
          stemWidth: 0, stemColor: '#3a4a24', seed: 722,
        }),
        createNode('stylize_paint', 520, 80, 'paint', {
          brushLength: 3, angle: 75, levels: 9, softness: 0.55, crispEdges: 0.4,
        }),
        createNode('output_material', 770, 120, 'out', {
          normalStrength: 2.0, roughnessBase: 0.74, roughnessContrast: 0.14, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('oak_leaf', 'rgba', 'rosettes', 'leaf'),
        edge('oak_leaf', 'height', 'rosettes', 'height'),
        edge('rosettes', 'rgba', 'paint', 'input'),
        edge('paint', 'out', 'out', 'baseColor'),
        edge('rosettes', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'bark-painterly-moss',
    name: '厚涂宽纹苔藓古木皮',
    subtitle: '原神/吉卜力宽笔触暖米木纹 + 厚涂色阶 + 沟壑青苔自然生长',
    category: 'bark',
    targetSlot: 'bark',
    build: () => ({
      schemaVersion: 1,
      name: '厚涂宽纹苔藓古木皮',
      category: 'bark',
      targetSlot: 'bark',
      resolution: 512,
      seamless: true,
      nodes: [
        createNode('painterly_bark', 30, 50, 'pbark', {
          scaleX: 6, scaleY: 2, flowWarp: 0.72, brushSteps: 6, creviceDepth: 0.84,
          mossCoverage: 0.44, coolAccent: 0.26,
          highlightColor: '#e2cda8', midColor: '#a8845e', creviceColor: '#4f3527', seed: 731,
        }),
        createNode('stylize_paint', 270, 30, 'wood_paint', {
          brushLength: 3.2, angle: 88, levels: 7, softness: 0.36, crispEdges: 0.56,
        }),
        createNode('perlin_noise', 270, 260, 'moss_tex', {
          scaleX: 9, scaleY: 9, octaves: 4, persistence: 0.56, ridged: false, seed: 842,
        }),
        createNode('gradient_map', 510, 240, 'moss_col', {
          stops: [
            { pos: 0.0, color: '#2b4d1d' },
            { pos: 0.42, color: '#4f7f29' },
            { pos: 0.78, color: '#7cad38' },
            { pos: 1.0, color: '#a8cf56' },
          ],
        }),
        createNode('stylize_paint', 730, 240, 'moss_paint', {
          brushLength: 2.5, angle: 74, levels: 6, softness: 0.38, crispEdges: 0.48,
        }),
        createNode('blend', 740, 55, 'mix_moss', {
          mode: 'normal', opacity: 0.94,
        }),
        createNode('output_material', 980, 110, 'out', {
          normalStrength: 3.0, roughnessBase: 0.82, roughnessContrast: 0.16, dilateAlpha: false,
        }),
      ],
      edges: [
        edge('pbark', 'rgba', 'wood_paint', 'input'),
        edge('moss_tex', 'out', 'moss_col', 'input'),
        edge('moss_col', 'out', 'moss_paint', 'input'),
        edge('wood_paint', 'out', 'mix_moss', 'base'),
        edge('moss_paint', 'out', 'mix_moss', 'overlay'),
        edge('pbark', 'moss', 'mix_moss', 'mask'),
        edge('mix_moss', 'out', 'out', 'baseColor'),
        edge('pbark', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'leaf-stylized',
    name: '风格化阔叶绿簇',
    subtitle: '卵形叶脉 + 五叉枝簇 + 暖阳叶缘高光',
    category: 'leaf',
    targetSlot: 'leaf',
    build: () => ({
      schemaVersion: 1,
      name: '风格化阔叶绿簇',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 40, 120, 'leaf', {
          shape: 'ovate', length: 0.84, width: 0.58, tipSharp: 1.05, serration: 0.04, serrationFreq: 10,
          bend: 0.05, veinStrength: 0.56, veinCount: 6,
          baseColor: '#28572c', tipColor: '#8ad451', veinColor: '#cff596',
        }),
        createNode('branch_scatter', 280, 110, 'scatter', {
          layout: 'sprig', stemCount: 5, leavesPerStem: 7, leafScale: 0.27, scaleFalloff: 0.2,
          spread: 0.92, arch: 0.2, rotJitter: 0.26, colorVar: 0.16, depthShade: 0.34,
          stemWidth: 0.008, stemColor: '#5c4632', seed: 518,
        }),
        createNode('edge_mask', 520, 70, 'rim', {
          width: 3, tintStrength: 0.22, edgeColor: '#eefc99', alphaClip: 0,
        }),
        createNode('hsl_adjust', 740, 70, 'hsl', {
          hue: 0, saturation: 1.06, lightness: 0.02, contrast: 1.05,
        }),
        createNode('output_material', 970, 130, 'out', {
          normalStrength: 2.0, roughnessBase: 0.72, roughnessContrast: 0.15, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('leaf', 'rgba', 'scatter', 'leaf'),
        edge('leaf', 'height', 'scatter', 'height'),
        edge('scatter', 'rgba', 'rim', 'input'),
        edge('rim', 'rgba', 'hsl', 'input'),
        edge('hsl', 'out', 'out', 'baseColor'),
        edge('scatter', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'bark-oak',
    name: '苍古橡木裂纹树皮',
    subtitle: '树皮纤维 + Voronoi 板块 + 斜率崩裂 + 渐变映射',
    category: 'bark',
    targetSlot: 'bark',
    resolution: 512,
    build: () => ({
      schemaVersion: 1,
      name: '苍古橡木裂纹树皮',
      category: 'bark',
      targetSlot: 'bark',
      resolution: 512,
      seamless: true,
      nodes: [
        createNode('bark_fibers', 30, 40, 'fibers', {
          scaleX: 11, scaleY: 3, warp: 0.65, fissure: 1.35, fineGrain: 0.38, octaves: 4, seed: 207,
        }),
        createNode('cells_voronoi', 30, 240, 'cells', {
          scaleX: 7, scaleY: 3, jitter: 0.88, mode: 'edge', edgeWidth: 0.38, seed: 309,
        }),
        createNode('perlin_noise', 260, 290, 'slope_n', {
          scaleX: 14, scaleY: 8, octaves: 3, persistence: 0.55, ridged: false, seed: 88,
        }),
        createNode('blend', 260, 70, 'mix_h', { mode: 'multiply', opacity: 0.68 }),
        createNode('slope_blur', 480, 110, 'sblur', { intensity: 0.032, samples: 5, mode: 'min' }),
        createNode('levels', 690, 110, 'lvl', { inLow: 0.12, inHigh: 0.88, gamma: 1.05, outLow: 0, outHigh: 1, invert: false }),
        createNode('gradient_map', 900, 60, 'gmap', {
          stops: [
            { pos: 0.0, color: '#1e1612' },
            { pos: 0.34, color: '#47362b' },
            { pos: 0.72, color: '#745c4b' },
            { pos: 1.0, color: '#a58c76' },
          ],
        }),
        createNode('output_material', 1130, 120, 'out', {
          normalStrength: 3.4, roughnessBase: 0.88, roughnessContrast: 0.18, dilateAlpha: false,
        }),
      ],
      edges: [
        edge('fibers', 'out', 'mix_h', 'base'),
        edge('cells', 'out', 'mix_h', 'overlay'),
        edge('mix_h', 'out', 'sblur', 'input'),
        edge('slope_n', 'out', 'sblur', 'slope'),
        edge('sblur', 'out', 'lvl', 'input'),
        edge('lvl', 'out', 'gmap', 'input'),
        edge('gmap', 'out', 'out', 'baseColor'),
        edge('lvl', 'out', 'out', 'height'),
      ],
    }),
  } as TextureTemplate,
  {
    id: 'bark-cherry',
    name: '樱木横纹皮孔树皮',
    subtitle: '紫褐绸感纤维 + 横向皮孔 + 柔和色阶',
    category: 'bark',
    targetSlot: 'bark',
    build: () => ({
      schemaVersion: 1,
      name: '樱木横纹皮孔树皮',
      category: 'bark',
      targetSlot: 'bark',
      resolution: 512,
      seamless: true,
      nodes: [
        createNode('bark_fibers', 40, 50, 'fibers', {
          scaleX: 8, scaleY: 2, warp: 0.38, fissure: 0.75, fineGrain: 0.45, octaves: 4, seed: 418,
        }),
        createNode('lenticels', 40, 250, 'lent', {
          count: 92, width: 0.16, thickness: 0.013, roughness: 0.45, seed: 412,
        }),
        createNode('blend', 290, 110, 'mix_l', { mode: 'subtract', opacity: 0.46 }),
        createNode('levels', 520, 110, 'lvl', { inLow: 0.06, inHigh: 0.94, gamma: 0.95, outLow: 0, outHigh: 1, invert: false }),
        createNode('gradient_map', 740, 60, 'gmap', {
          stops: [
            { pos: 0.0, color: '#24181e' },
            { pos: 0.38, color: '#4c343d' },
            { pos: 0.74, color: '#785760' },
            { pos: 1.0, color: '#ab8a90' },
          ],
        }),
        createNode('output_material', 970, 120, 'out', {
          normalStrength: 2.5, roughnessBase: 0.76, roughnessContrast: 0.22, dilateAlpha: false,
        }),
      ],
      edges: [
        edge('fibers', 'out', 'mix_l', 'base'),
        edge('lent', 'out', 'mix_l', 'overlay'),
        edge('mix_l', 'out', 'lvl', 'input'),
        edge('lvl', 'out', 'gmap', 'input'),
        edge('gmap', 'out', 'out', 'baseColor'),
        edge('lvl', 'out', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'bark-mossy-pine',
    name: '苔藓古松粗棱树皮',
    subtitle: '红杉深棱树皮 + 噪声苔藓斑块双色混合',
    category: 'bark',
    targetSlot: 'bark',
    build: () => ({
      schemaVersion: 1,
      name: '苔藓古松粗棱树皮',
      category: 'bark',
      targetSlot: 'bark',
      resolution: 512,
      seamless: true,
      nodes: [
        createNode('bark_fibers', 30, 40, 'fibers', {
          scaleX: 13, scaleY: 2, warp: 0.52, fissure: 1.55, fineGrain: 0.3, octaves: 4, seed: 702,
        }),
        createNode('gradient_map', 270, 40, 'bark_col', {
          stops: [
            { pos: 0.0, color: '#211410' },
            { pos: 0.36, color: '#543225' },
            { pos: 0.74, color: '#83543d' },
            { pos: 1.0, color: '#b07b5d' },
          ],
        }),
        createNode('perlin_noise', 30, 250, 'moss_n', {
          scaleX: 5, scaleY: 5, octaves: 4, persistence: 0.58, ridged: false, seed: 915,
        }),
        createNode('levels', 270, 250, 'moss_mask', {
          inLow: 0.48, inHigh: 0.72, gamma: 0.85, outLow: 0, outHigh: 1, invert: false,
        }),
        createNode('gradient_map', 500, 250, 'moss_col', {
          stops: [
            { pos: 0.0, color: '#25421f' },
            { pos: 0.5, color: '#4b7832' },
            { pos: 0.85, color: '#79a846' },
            { pos: 1.0, color: '#a5cc62' },
          ],
        }),
        createNode('blend', 740, 100, 'final_mix', { mode: 'normal', opacity: 0.88 }),
        createNode('output_material', 970, 120, 'out', {
          normalStrength: 3.8, roughnessBase: 0.9, roughnessContrast: 0.16, dilateAlpha: false,
        }),
      ],
      edges: [
        edge('fibers', 'out', 'bark_col', 'input'),
        edge('moss_n', 'out', 'moss_mask', 'input'),
        edge('moss_n', 'out', 'moss_col', 'input'),
        edge('bark_col', 'out', 'final_mix', 'base'),
        edge('moss_col', 'out', 'final_mix', 'overlay'),
        edge('moss_mask', 'out', 'final_mix', 'mask'),
        edge('final_mix', 'out', 'out', 'baseColor'),
        edge('fibers', 'out', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'leaf-maple',
    name: '日式五角绯秋红枫',
    subtitle: '五裂掌状红枫叶 + 枝簇排布 + 暖橙边光',
    category: 'leaf',
    targetSlot: 'leaf',
    build: () => ({
      schemaVersion: 1,
      name: '日式五角绯秋红枫',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 40, 110, 'maple', {
          shape: 'maple', length: 0.86, width: 0.84, tipSharp: 1.1, serration: 0.08, serrationFreq: 12,
          bend: 0.03, veinStrength: 0.62, veinCount: 5,
          baseColor: '#8d1919', tipColor: '#ff7b29', veinColor: '#ffd470',
        }),
        createNode('branch_scatter', 290, 110, 'scatter', {
          layout: 'sprig', stemCount: 5, leavesPerStem: 6, leafScale: 0.38, scaleFalloff: 0.16,
          spread: 0.95, arch: 0.18, rotJitter: 0.38, colorVar: 0.22, depthShade: 0.36,
          stemWidth: 0.007, stemColor: '#57362b', seed: 821,
        }),
        createNode('edge_mask', 540, 80, 'rim', {
          width: 2.5, tintStrength: 0.26, edgeColor: '#ffcf66', alphaClip: 0,
        }),
        createNode('output_material', 790, 120, 'out', {
          normalStrength: 2.1, roughnessBase: 0.7, roughnessContrast: 0.14, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('maple', 'rgba', 'scatter', 'leaf'),
        edge('maple', 'height', 'scatter', 'height'),
        edge('scatter', 'rgba', 'rim', 'input'),
        edge('rim', 'rgba', 'out', 'baseColor'),
        edge('scatter', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'leaf-ginkgo',
    name: '金秋扇形银杏叶簇',
    subtitle: '中裂扇形银杏叶 + 错落云团簇 + 金黄提亮',
    category: 'leaf',
    targetSlot: 'leaf',
    build: () => ({
      schemaVersion: 1,
      name: '金秋扇形银杏叶簇',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 40, 110, 'ginkgo', {
          shape: 'ginkgo', length: 0.78, width: 0.76, tipSharp: 1.0, serration: 0.02, serrationFreq: 8,
          bend: 0.02, veinStrength: 0.58, veinCount: 7,
          baseColor: '#b88318', tipColor: '#ffe45c', veinColor: '#fff5ad',
        }),
        createNode('branch_scatter', 290, 110, 'scatter', {
          layout: 'sprig', stemCount: 5, leavesPerStem: 6, leafScale: 0.29, scaleFalloff: 0.16,
          spread: 0.92, arch: 0.16, rotJitter: 0.32, colorVar: 0.18, depthShade: 0.32,
          stemWidth: 0.007, stemColor: '#6b5336', seed: 944,
        }),
        createNode('hsl_adjust', 540, 90, 'hsl', {
          hue: 2, saturation: 1.08, lightness: 0.03, contrast: 1.04,
        }),
        createNode('output_material', 780, 120, 'out', {
          normalStrength: 1.8, roughnessBase: 0.68, roughnessContrast: 0.14, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('ginkgo', 'rgba', 'scatter', 'leaf'),
        edge('ginkgo', 'height', 'scatter', 'height'),
        edge('scatter', 'rgba', 'hsl', 'input'),
        edge('hsl', 'out', 'out', 'baseColor'),
        edge('scatter', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'flower-sakura',
    name: '缺口五瓣樱花花簇',
    subtitle: '参数化缺口樱花 + 柔粉云团散布（树叶/花朵通用）',
    category: 'flower',
    targetSlot: 'flower',
    build: () => ({
      schemaVersion: 1,
      name: '缺口五瓣樱花花簇',
      category: 'flower',
      targetSlot: 'flower',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('flower_bloom', 40, 110, 'bloom', {
          petalCount: 5, notchDepth: 0.28, petalWidth: 0.82, radius: 0.44, centerSize: 0.11,
          petalColor: '#ffe3ee', innerColor: '#df608b', centerColor: '#f8cb4c', seed: 620,
        }),
        createNode('branch_scatter', 290, 110, 'scatter', {
          layout: 'cluster', stemCount: 4, leavesPerStem: 5, leafScale: 0.32, scaleFalloff: 0.24,
          spread: 0.9, arch: 0.1, rotJitter: 0.85, colorVar: 0.14, depthShade: 0.24,
          stemWidth: 0, stemColor: '#66484e', seed: 622,
        }),
        createNode('hsl_adjust', 540, 90, 'hsl', {
          hue: 0, saturation: 1.04, lightness: 0.02, contrast: 1.02,
        }),
        createNode('output_material', 780, 120, 'out', {
          normalStrength: 1.6, roughnessBase: 0.62, roughnessContrast: 0.12, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('bloom', 'rgba', 'scatter', 'leaf'),
        edge('bloom', 'height', 'scatter', 'height'),
        edge('scatter', 'rgba', 'hsl', 'input'),
        edge('hsl', 'out', 'out', 'baseColor'),
        edge('scatter', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'needle-pine',
    name: '松针羽片垂簇',
    subtitle: '针形松针叶 + 上柄下垂羽片排布（适配松树叶形卡）',
    category: 'needle',
    targetSlot: 'needle',
    build: () => ({
      schemaVersion: 1,
      name: '松针羽片垂簇',
      category: 'needle',
      targetSlot: 'needle',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 40, 110, 'needle', {
          shape: 'needle', length: 0.88, width: 0.42, tipSharp: 1.5, serration: 0, serrationFreq: 6,
          bend: 0.04, veinStrength: 0.35, veinCount: 3,
          baseColor: '#1f4a30', tipColor: '#6bb84d', veinColor: '#99d973',
        }),
        createNode('branch_scatter', 290, 110, 'scatter', {
          layout: 'pine', stemCount: 1, leavesPerStem: 11, leafScale: 0.34, scaleFalloff: 0.26,
          spread: 1.0, arch: 0.08, rotJitter: 0.2, colorVar: 0.16, depthShade: 0.36,
          stemWidth: 0.011, stemColor: '#6e4c32', seed: 911,
        }),
        createNode('output_material', 560, 120, 'out', {
          normalStrength: 2.2, roughnessBase: 0.78, roughnessContrast: 0.15, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('needle', 'rgba', 'scatter', 'leaf'),
        edge('needle', 'height', 'scatter', 'height'),
        edge('scatter', 'rgba', 'out', 'baseColor'),
        edge('scatter', 'height', 'out', 'height'),
      ],
    }),
  },
  {
    id: 'leaf-willow',
    name: '垂柳细长柳丝',
    subtitle: '纤长柳叶 + 顶部拱肩垂直柳帘（适配垂帘插片）',
    category: 'leaf',
    targetSlot: 'leaf',
    build: () => ({
      schemaVersion: 1,
      name: '垂柳细长柳丝',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: 512,
      seamless: false,
      nodes: [
        createNode('leaf_shape', 40, 110, 'willow_leaf', {
          shape: 'lance', length: 0.9, width: 0.32, tipSharp: 1.35, serration: 0, serrationFreq: 6,
          bend: 0.12, veinStrength: 0.4, veinCount: 5,
          baseColor: '#3b6e2e', tipColor: '#b7e665', veinColor: '#dcfa9b',
        }),
        createNode('branch_scatter', 290, 110, 'scatter', {
          layout: 'willow', stemCount: 5, leavesPerStem: 12, leafScale: 0.22, scaleFalloff: 0.28,
          spread: 0.92, arch: 0.14, rotJitter: 0.22, colorVar: 0.15, depthShade: 0.28,
          stemWidth: 0.006, stemColor: '#5c6e38', seed: 331,
        }),
        createNode('output_material', 560, 120, 'out', {
          normalStrength: 1.6, roughnessBase: 0.72, roughnessContrast: 0.12, dilateAlpha: true,
        }),
      ],
      edges: [
        edge('willow_leaf', 'rgba', 'scatter', 'leaf'),
        edge('willow_leaf', 'height', 'scatter', 'height'),
        edge('scatter', 'rgba', 'out', 'baseColor'),
        edge('scatter', 'height', 'out', 'height'),
      ],
    }),
  },
]

export function getTextureTemplate(id: string): TextureTemplate | undefined {
  return textureTemplates.find(t => t.id === id)
}

export function defaultTemplateForSlot(slot: EditableTextureSlot): TextureGraph {
  const match =
    slot === 'bark' ? getTextureTemplate('bark-painterly-moss')
      : slot === 'needle' || slot === 'drape' ? getTextureTemplate('needle-pine')
        : slot === 'flower' || slot === 'blossom' ? getTextureTemplate('flower-sakura')
          : getTextureTemplate('leaf-oak-painterly')
  const graph = cloneGraph((match ?? textureTemplates[0]).build())
  graph.targetSlot = slot
  graph.seamless = slot === 'bark'
  return graph
}

/** Detects the N x M atlas grid baked by a procedural foliage texture graph (supports 1x1..4x4 & legacy atlas2x2). */
export function detectGraphAtlasGrid(graph: TextureGraph | undefined): { cols: number; rows: number } | undefined {
  if (!graph || graph.targetSlot === 'bark') return undefined
  if (graph.nodes.some(n => n.type === 'atlas_compose')) return { cols: 1, rows: 1 }
  const scatter = graph.nodes.find(n => n.type === 'branch_scatter')
  if (!scatter) return undefined
  if (scatter.params.layout === 'tile') return { cols: 1, rows: 1 }
  const legacy = scatter.params.atlas2x2 === true
  const rawCols = scatter.params.atlasCols !== undefined ? Number(scatter.params.atlasCols) : (legacy ? 2 : 1)
  const rawRows = scatter.params.atlasRows !== undefined ? Number(scatter.params.atlasRows) : (legacy ? 2 : 1)
  const cols = Number.isFinite(rawCols) ? Math.max(1, Math.min(4, Math.round(rawCols))) : 1
  const rows = Number.isFinite(rawRows) ? Math.max(1, Math.min(4, Math.round(rawRows))) : 1
  return { cols, rows }
}

/** Extracts non-uniform `AtlasRegion[]` metadata from a graph containing `atlas_compose` for 3D region UV consumption. */
export function detectGraphAtlasRegions(graph: TextureGraph | undefined): AtlasRegion[] | undefined {
  if (!graph || graph.targetSlot === 'bark') return undefined
  const comp = graph.nodes.find(n => n.type === 'atlas_compose')
  if (!comp) return undefined
  return resolveAtlasRegions(comp.params, graph.resolution)
}

/** Synthesizes a high-key tint-ready Painterly Oak Rosette leaf texture (Target 1 silhouette)
 *  so vertex tints (from deep spring emerald to luminous celestial lemon-gold) multiply cleanly. */
export function makeOakLeafCardTexture(resolution = 512): Texture {
  if (typeof document === 'undefined') {
    const t = new Texture()
    t.name = 'oak_painterly_cluster'
    return t
  }
  const graph = getTextureTemplate('leaf-oak-painterly')!.build()
  const leafNode = graph.nodes.find(n => n.id === 'oak_leaf')
  if (leafNode) {
    // High-key smooth sunlit-ready values: clean scalloped oak leaf silhouette + gentle depth
    // so 3D spherized crown shading & topWarmth sculpt seamless golden-to-jade cloud billows!
    leafNode.params.baseColor = '#7da684'
    leafNode.params.tipColor = '#f4fae0'
    leafNode.params.veinColor = '#fffff2'
    leafNode.params.veinStrength = 0.24
  }
  const scatter = graph.nodes.find(n => n.id === 'rosettes')
  if (scatter) {
    scatter.params.depthShade = 0.24
    scatter.params.colorVar = 0.10
    scatter.params.budGlint = 0
  }
  const ev = evaluateTextureGraph(graph, resolution)
  return materialOutputToThreeTexture(ev.output, 'leaf', 'oak_painterly_cluster')
}

/** Synthesizes a high-key tint-ready 2x2 Painterly Oak Rosette Atlas (4 distinct oak clump silhouettes
 *  that pair with broadleaf 2x2 atlas sampling + random U-flip -> 8 non-repeating crown card variants!). */
export function makeOakLeafAtlasTexture(resolution = 512): Texture {
  if (typeof document === 'undefined') {
    const t = new Texture()
    t.name = 'oak_painterly_atlas2x2'
    return t
  }
  const graph = getTextureTemplate('leaf-oak-atlas')!.build()
  const leafNode = graph.nodes.find(n => n.id === 'oak_leaf')
  if (leafNode) {
    leafNode.params.baseColor = '#7ea886'
    leafNode.params.tipColor = '#f4fae0'
    leafNode.params.veinColor = '#fffff2'
    leafNode.params.veinStrength = 0.22
  }
  const scatter = graph.nodes.find(n => n.id === 'rosettes')
  if (scatter) {
    scatter.params.depthShade = 0.26
    scatter.params.colorVar = 0.12
    scatter.params.budGlint = 0
  }
  const ev = evaluateTextureGraph(graph, resolution)
  return materialOutputToThreeTexture(ev.output, 'leaf', 'oak_painterly_atlas2x2')
}

/** Synthesizes the stylized Genshin/Ghibli broad-brushstroke mossy bark texture (Target 2 standalone). */
export function makePainterlyMossBarkTexture(resolution = 512): Texture {
  if (typeof document === 'undefined') {
    const t = new Texture()
    t.name = 'painterly_moss_bark'
    return t
  }
  const graph = getTextureTemplate('bark-painterly-moss')!.build()
  const ev = evaluateTextureGraph(graph, resolution)
  return materialOutputToThreeTexture(ev.output, 'bark', 'painterly_moss_bark')
}

/** Synthesizes clean sculpted warm Genshin/Ghibli driftwood bark (subtle crevice moss only)
 *  designed to pair with 3D world-space upward moss (`trunk.barkMoss`) so undersides stay crisp carved wood! */
export function makePainterlyDriftwoodBarkTexture(resolution = 512): Texture {
  if (typeof document === 'undefined') {
    const t = new Texture()
    t.name = 'painterly_driftwood_bark'
    return t
  }
  const graph = getTextureTemplate('bark-painterly-moss')!.build()
  const pbark = graph.nodes.find(n => n.id === 'pbark')
  if (pbark) {
    // Keep sculpted warm caramel/creamy driftwood wood clean so 3D worldNormal.y drives lush directional moss
    pbark.params.mossCoverage = 0.12
  }
  const ev = evaluateTextureGraph(graph, resolution)
  return materialOutputToThreeTexture(ev.output, 'bark', 'painterly_driftwood_bark')
}
