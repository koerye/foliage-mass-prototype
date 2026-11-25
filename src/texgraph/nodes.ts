// Node catalog definitions, defaults, v1/v2 contract validation, and graph helpers.
import { editableTextureSlots, type EditableTextureSlot } from '../studio/texture-slots'
import {
  CURRENT_GRAPH_SCHEMA_VERSION,
  type AtlasRegion, type CurvePoint, type GradientStop, type GraphEdge, type GraphNode,
  type NodeDefinition, type NodeType, type PortType, type TextureCategory,
  type TextureGraph, type VectorLeafInstance, type VectorStem,
} from './types'

const validSlots = new Set<string>(editableTextureSlots)
const validCategories = new Set<TextureCategory>(['leaf', 'bark', 'needle', 'flower', 'grass', 'other'])

export const defaultBarkGradient: GradientStop[] = [
  { pos: 0.0, color: '#241b16' },
  { pos: 0.35, color: '#4c3a2e' },
  { pos: 0.72, color: '#755c4a' },
  { pos: 1.0, color: '#a38973' },
]

export const defaultLeafProfile: CurvePoint[] = [
  [0.0, 0.05],
  [0.18, 0.42],
  [0.42, 0.56],
  [0.68, 0.44],
  [0.88, 0.20],
  [1.0, 0.0],
]

export const defaultCurvePoints: CurvePoint[] = [
  [0.0, 0.0],
  [0.33, 0.33],
  [0.67, 0.67],
  [1.0, 1.0],
]

export const defaultVinePalette: string[] = [
  '#3e6b35',
  '#52863e',
  '#6ea342',
  '#8fc14a',
  '#2f5932',
]

export const defaultBarkPalette: string[] = [
  '#3c2a21',
  '#684a36',
  '#9c7959',
  '#ccb08b',
  '#e4d1b1',
]

export const defaultAsymmetricAtlasRegions: AtlasRegion[] = [
  // 4 Big Canopy Clusters (top 76% of atlas, bound to Big Cluster slots A=0 & B=1 with generous mip gutters)
  { id: 'reg-big-1', x: 0.015, y: 0.015, w: 0.470, h: 0.360, padding: 0.014, slot: 0, anchorX: 0.5, anchorY: 0.82, weight: 1.0, role: 'canopy' },
  { id: 'reg-big-2', x: 0.515, y: 0.015, w: 0.470, h: 0.360, padding: 0.014, slot: 1, anchorX: 0.5, anchorY: 0.82, weight: 1.0, role: 'canopy' },
  { id: 'reg-big-3', x: 0.015, y: 0.395, w: 0.470, h: 0.360, padding: 0.014, slot: 0, anchorX: 0.5, anchorY: 0.82, weight: 1.0, role: 'canopy' },
  { id: 'reg-big-4', x: 0.515, y: 0.395, w: 0.470, h: 0.360, padding: 0.014, slot: 1, anchorX: 0.5, anchorY: 0.82, weight: 1.0, role: 'canopy' },
  // 4 Small Accent Sprigs (bottom 22% strip, bound to Small Accent slots C=2 & D=3 for outer/twig detail)
  { id: 'reg-small-1', x: 0.015, y: 0.775, w: 0.228, h: 0.210, padding: 0.010, slot: 2, anchorX: 0.5, anchorY: 0.88, weight: 0.45, role: 'accent' },
  { id: 'reg-small-2', x: 0.262, y: 0.775, w: 0.228, h: 0.210, padding: 0.010, slot: 3, anchorX: 0.5, anchorY: 0.88, weight: 0.45, role: 'accent' },
  { id: 'reg-small-3', x: 0.510, y: 0.775, w: 0.228, h: 0.210, padding: 0.010, slot: 2, anchorX: 0.5, anchorY: 0.88, weight: 0.45, role: 'accent' },
  { id: 'reg-small-4', x: 0.757, y: 0.775, w: 0.228, h: 0.210, padding: 0.010, slot: 3, anchorX: 0.5, anchorY: 0.88, weight: 0.45, role: 'accent' },
]

export const nodeDefinitions: Record<NodeType, NodeDefinition> = {
  // ---------------- Bark & Noise Generators ----------------
  perlin_noise: {
    type: 'perlin_noise',
    label: '柏林分形噪声',
    shortLabel: 'Perlin fBM',
    category: 'bark',
    description: '可无缝平铺的多层分形噪声（支持纵横各向异性缩放，用于树皮底纹、苔藓斑块或扭曲场）',
    inputs: [],
    outputs: [{ id: 'out', label: '灰度', type: 'gray' }],
    params: [
      { key: 'scaleX', label: '横向频率', kind: 'int', min: 1, max: 48, step: 1, default: 6 },
      { key: 'scaleY', label: '纵向频率', kind: 'int', min: 1, max: 48, step: 1, default: 6 },
      { key: 'octaves', label: '倍频层数', kind: 'int', min: 1, max: 6, step: 1, default: 4 },
      { key: 'persistence', label: '细节粗糙度', kind: 'range', min: 0.2, max: 0.85, step: 0.02, default: 0.52 },
      { key: 'ridged', label: '脊状裂纹化', kind: 'bool', default: false },
      { key: 'seed', label: '随机种子', kind: 'int', min: 0, max: 9999, step: 1, default: 101 },
    ],
  },
  bark_fibers: {
    type: 'bark_fibers',
    label: '树皮纤维沟壑',
    shortLabel: 'Bark Fibers',
    category: 'bark',
    description: '程序化无缝树皮竖向棱脊与裂沟，内置域扭曲模拟树皮自然盘曲纹理',
    inputs: [],
    outputs: [{ id: 'out', label: '高度', type: 'gray' }],
    params: [
      { key: 'scaleX', label: '棱脊密度', kind: 'int', min: 2, max: 40, step: 1, default: 10 },
      { key: 'scaleY', label: '纵向分段', kind: 'int', min: 1, max: 16, step: 1, default: 3 },
      { key: 'warp', label: '盘曲扭动', kind: 'range', min: 0, max: 1.8, step: 0.02, default: 0.55 },
      { key: 'fissure', label: '裂沟锐度', kind: 'range', min: 0.2, max: 2.5, step: 0.05, default: 1.25 },
      { key: 'fineGrain', label: '细木纹叠加', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.35 },
      { key: 'octaves', label: '细节层级', kind: 'int', min: 2, max: 6, step: 1, default: 4 },
      { key: 'seed', label: '随机种子', kind: 'int', min: 0, max: 9999, step: 1, default: 207 },
    ],
  },
  painterly_bark: {
    type: 'painterly_bark',
    label: '厚涂手绘宽纹树皮',
    shortLabel: 'Painterly Bark',
    category: 'bark',
    description: '吉卜力/原神风格宽笔触雕刻木皮：暖米褐块面木纹、手绘凹缝笔触与沿沟壑生长的苔藓遮罩（无缝平铺）',
    inputs: [],
    outputs: [
      { id: 'rgba', label: '树皮 RGBA', type: 'rgba' },
      { id: 'height', label: '块面高度', type: 'gray' },
      { id: 'moss', label: '沟壑苔藓遮罩', type: 'gray' },
    ],
    params: [
      { key: 'scaleX', label: '宽条密度', kind: 'int', min: 3, max: 18, step: 1, default: 7 },
      { key: 'scaleY', label: '纵向段数', kind: 'int', min: 1, max: 8, step: 1, default: 2 },
      { key: 'flowWarp', label: '流线盘曲', kind: 'range', min: 0, max: 1.5, step: 0.02, default: 0.62 },
      { key: 'brushSteps', label: '笔触色阶数', kind: 'int', min: 3, max: 12, step: 1, default: 6 },
      { key: 'creviceDepth', label: '暗缝刻蚀', kind: 'range', min: 0.1, max: 1.4, step: 0.02, default: 0.78 },
      { key: 'mossCoverage', label: '沟壑苔藓量', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.42 },
      { key: 'coolAccent', label: '冷灰青暗影', kind: 'range', min: 0, max: 0.6, step: 0.02, default: 0.16 },
      { key: 'highlightColor', label: '暖木亮面色', kind: 'color', default: '#d7c29f' },
      { key: 'midColor', label: '暖木中调色', kind: 'color', default: '#a98a67' },
      { key: 'creviceColor', label: '凹缝暖褐影', kind: 'color', default: '#583d30' },
      { key: 'seed', label: '随机种子', kind: 'int', min: 0, max: 9999, step: 1, default: 724 },
    ],
  },
  cells_voronoi: {
    type: 'cells_voronoi',
    label: 'Voronoi 龟裂板块',
    shortLabel: 'Cells / Cracks',
    category: 'bark',
    description: '可平铺泰森多边形胞元（适合松树/橡树龟裂树皮板块与缝隙遮罩）',
    inputs: [],
    outputs: [{ id: 'out', label: '高度', type: 'gray' }],
    params: [
      { key: 'scaleX', label: '横向胞元', kind: 'int', min: 2, max: 32, step: 1, default: 8 },
      { key: 'scaleY', label: '纵向胞元', kind: 'int', min: 2, max: 32, step: 1, default: 4 },
      { key: 'jitter', label: '不规则抖动', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.85 },
      { key: 'mode', label: '胞元模式', kind: 'select', options: [['edge', '裂纹脊线 (F2-F1)'], ['plate', '隆起鳞片 (1-F1)'], ['cell', '随机板块明度']], default: 'edge' },
      { key: 'edgeWidth', label: '裂纹宽度', kind: 'range', min: 0.05, max: 1.2, step: 0.02, default: 0.32 },
      { key: 'seed', label: '随机种子', kind: 'int', min: 0, max: 9999, step: 1, default: 309 },
    ],
  },
  lenticels: {
    type: 'lenticels',
    label: '树皮横向皮孔',
    shortLabel: 'Lenticels',
    category: 'bark',
    description: '生成桦木 / 樱木 / 桃木特有的横向皮孔斑纹与横裂细纹（无缝平铺）',
    inputs: [],
    outputs: [{ id: 'out', label: '遮罩', type: 'gray' }],
    params: [
      { key: 'count', label: '皮孔数量', kind: 'int', min: 8, max: 220, step: 2, default: 76 },
      { key: 'width', label: '横纹长度', kind: 'range', min: 0.03, max: 0.35, step: 0.01, default: 0.14 },
      { key: 'thickness', label: '横纹粗细', kind: 'range', min: 0.004, max: 0.04, step: 0.002, default: 0.012 },
      { key: 'roughness', label: '边缘毛刺', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.4 },
      { key: 'seed', label: '随机种子', kind: 'int', min: 0, max: 9999, step: 1, default: 412 },
    ],
  },
  gradient_linear: {
    type: 'gradient_linear',
    label: '线性 / 径向渐变',
    shortLabel: 'Gradient',
    category: 'bark',
    description: '生成线性、镜像或径向渐变遮罩，用于混合苔藓、色带或中心压暗',
    inputs: [],
    outputs: [{ id: 'out', label: '灰度', type: 'gray' }],
    params: [
      { key: 'mode', label: '渐变类型', kind: 'select', options: [['linear', '线性渐变'], ['mirror', '双向镜像'], ['radial', '径向渐变']], default: 'linear' },
      { key: 'angle', label: '方向角度°', kind: 'range', min: 0, max: 360, step: 1, default: 0 },
      { key: 'start', label: '起点位置', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.0 },
      { key: 'end', label: '终点位置', kind: 'range', min: 0, max: 1, step: 0.02, default: 1.0 },
      { key: 'invert', label: '反转', kind: 'bool', default: false },
    ],
  },

  // ---------------- Foliage & Leaf Generators ----------------
  leaf_shape: {
    type: 'leaf_shape',
    label: '参数化叶片生成',
    shortLabel: 'Leaf Shape',
    category: 'foliage',
    description: '程序化单片树叶（轮廓、叶缘锯齿、弯曲、主脉/侧脉浮雕与渐变配色）',
    inputs: [],
    outputs: [
      { id: 'rgba', label: '叶片 RGBA', type: 'rgba' },
      { id: 'height', label: '叶脉高度', type: 'gray' },
    ],
    params: [
      {
        key: 'shape', label: '叶片形态', kind: 'select',
        options: [
          ['ovate', '卵形阔叶'],
          ['oak', '波浪圆裂橡树叶（厚涂）'],
          ['elliptic', '圆润云叶（吉卜力）'],
          ['lance', '纤长柳叶 / 竹叶'],
          ['maple', '五裂红枫叶'],
          ['sakura', '缺口樱花瓣'],
          ['ginkgo', '扇形银杏叶'],
          ['heart', '心形藤叶'],
          ['needle', '针形松针叶'],
        ],
        default: 'ovate',
      },
      { key: 'length', label: '叶片长度', kind: 'range', min: 0.3, max: 0.96, step: 0.01, default: 0.82 },
      { key: 'width', label: '叶片宽度', kind: 'range', min: 0.12, max: 0.96, step: 0.01, default: 0.56 },
      { key: 'tipSharp', label: '叶尖锐度', kind: 'range', min: 0.2, max: 2.5, step: 0.05, default: 1.0 },
      { key: 'serration', label: '叶缘锯齿', kind: 'range', min: 0, max: 0.28, step: 0.01, default: 0.04 },
      { key: 'serrationFreq', label: '锯齿密度', kind: 'int', min: 3, max: 24, step: 1, default: 10 },
      { key: 'bend', label: '中脉弯曲', kind: 'range', min: -0.45, max: 0.45, step: 0.02, default: 0.05 },
      { key: 'veinStrength', label: '叶脉清晰度', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.55 },
      { key: 'veinCount', label: '侧脉对数', kind: 'int', min: 2, max: 12, step: 1, default: 6 },
      { key: 'baseColor', label: '叶基颜色', kind: 'color', default: '#2f5f2c' },
      { key: 'tipColor', label: '叶尖颜色', kind: 'color', default: '#8bd152' },
      { key: 'veinColor', label: '叶脉颜色', kind: 'color', default: '#c7ec8c' },
    ],
  },
  custom_leaf: {
    type: 'custom_leaf',
    label: '自由轮廓叶片 (Custom Leaf)',
    shortLabel: 'Custom Leaf',
    category: 'foliage',
    sinceVersion: 2,
    description: 'v2 自由可控叶片原语：多点轮廓曲线 + 非对称 S 弯叶尖 + 可选裂瓣/虫咬缺口 + 折面左右明暗与叶脉高度（无硬烘描边，可配 Ink Outline）',
    inputs: [],
    outputs: [
      { id: 'rgba', label: '叶片 RGBA', type: 'rgba' },
      { id: 'height', label: '叶脉高度', type: 'gray' },
      { id: 'mask', label: '透明遮罩', type: 'gray' },
    ],
    params: [
      { key: 'profile', label: '轮廓半宽曲线', kind: 'curve', default: defaultLeafProfile, hint: '横轴=叶根(0)到叶尖(1)，纵轴=叶片半宽(0..1)' },
      { key: 'length', label: '叶片长度', kind: 'range', min: 0.3, max: 0.96, step: 0.01, default: 0.84 },
      { key: 'width', label: '叶片宽度', kind: 'range', min: 0.14, max: 0.96, step: 0.01, default: 0.54 },
      { key: 'bend', label: '中脉弯曲', kind: 'range', min: -0.45, max: 0.45, step: 0.01, default: 0.04 },
      { key: 'tipCurl', label: '叶尖甩尾', kind: 'range', min: -0.35, max: 0.35, step: 0.01, default: 0.0 },
      { key: 'asymmetry', label: '左右不对称', kind: 'range', min: -0.35, max: 0.35, step: 0.01, default: 0.0 },
      { key: 'lobeCount', label: '圆裂 / 锯齿数', kind: 'int', min: 0, max: 18, step: 1, default: 0 },
      { key: 'lobeDepth', label: '裂瓣深度', kind: 'range', min: 0, max: 0.32, step: 0.01, default: 0.0 },
      { key: 'notchPos', label: '缺口位置', kind: 'range', min: 0.15, max: 0.85, step: 0.02, default: 0.62 },
      { key: 'notchDepth', label: '咬口 / 缺口深', kind: 'range', min: 0, max: 0.35, step: 0.01, default: 0.0 },
      { key: 'foldShade', label: '折面左右明暗', kind: 'range', min: -0.45, max: 0.45, step: 0.02, default: 0.12 },
      { key: 'veinStrength', label: '叶脉浮雕', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.22 },
      { key: 'veinCount', label: '侧脉对数', kind: 'int', min: 0, max: 10, step: 1, default: 4 },
      { key: 'stemLen', label: '短叶柄长', kind: 'range', min: 0, max: 0.18, step: 0.01, default: 0.04 },
      { key: 'baseColor', label: '叶基颜色', kind: 'color', default: '#3e6e35' },
      { key: 'tipColor', label: '叶尖颜色', kind: 'color', default: '#69a644' },
      { key: 'veinColor', label: '叶脉颜色', kind: 'color', default: '#98cb62' },
      { key: 'stemColor', label: '叶柄颜色', kind: 'color', default: '#6b5336' },
    ],
  },
  branch_scatter: {
    type: 'branch_scatter',
    label: '枝簇叶片排布',
    shortLabel: 'Branch Scatter',
    category: 'foliage',
    description: '将输入叶片沿多根枝条按扇形枝簇 / 红枫团 / 松针羽片 / 垂柳丝 / 花环排布并生成木质细枝',
    inputs: [
      { id: 'leaf', label: '叶片 RGBA', type: 'rgba', optional: true },
      { id: 'height', label: '叶片高度', type: 'gray', optional: true },
    ],
    outputs: [
      { id: 'rgba', label: '枝簇 RGBA', type: 'rgba' },
      { id: 'height', label: '枝簇高度', type: 'gray' },
    ],
    params: [
      {
        key: 'layout', label: '排布结构', kind: 'select',
        options: [
          ['sprig', '阔叶分叉枝簇（底柄上展）'],
          ['oak_rosette', '手绘厚涂叠层叶簇（多层花簇）'],
          ['cluster', '饱满云团叶簇（无明显枝）'],
          ['pine', '松针羽片（上柄下垂收尖）'],
          ['willow', '垂柳细丝（顶拱下垂柳帘）'],
          ['rosette', '放射花环 / 灌木蓬簇'],
          ['tile', '无缝平铺散布（Tile Sampler）'],
        ],
        default: 'sprig',
      },
      { key: 'atlasCols', label: '图集列数 (N)', kind: 'int', min: 1, max: 4, step: 1, default: 1 },
      { key: 'atlasRows', label: '图集行数 (M)', kind: 'int', min: 1, max: 4, step: 1, default: 1 },
      { key: 'budGlint', label: '簇心嫩芽高光', kind: 'range', min: 0, max: 1, step: 0.05, default: 0.45 },
      { key: 'stemCount', label: '分枝数量', kind: 'int', min: 1, max: 9, step: 1, default: 5 },
      { key: 'leavesPerStem', label: '每枝叶片数', kind: 'int', min: 2, max: 18, step: 1, default: 7 },
      { key: 'leafScale', label: '叶片尺寸', kind: 'range', min: 0.12, max: 0.72, step: 0.01, default: 0.28 },
      { key: 'scaleFalloff', label: '梢端缩放渐变', kind: 'range', min: -0.5, max: 0.7, step: 0.02, default: 0.22 },
      { key: 'spread', label: '枝叶张开幅度', kind: 'range', min: 0.2, max: 1.4, step: 0.02, default: 0.88 },
      { key: 'arch', label: '枝条弧度弯曲', kind: 'range', min: -0.6, max: 0.8, step: 0.02, default: 0.22 },
      { key: 'rotJitter', label: '随机旋转抖动', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.25 },
      { key: 'colorVar', label: '单片明度差异', kind: 'range', min: 0, max: 0.5, step: 0.02, default: 0.18 },
      { key: 'depthShade', label: '前后景深压暗', kind: 'range', min: 0, max: 0.7, step: 0.02, default: 0.34 },
      { key: 'stemWidth', label: '细枝粗细', kind: 'range', min: 0, max: 0.028, step: 0.001, default: 0.008 },
      { key: 'stemColor', label: '细枝颜色', kind: 'color', default: '#5c4632' },
      { key: 'seed', label: '随机种子', kind: 'int', min: 0, max: 9999, step: 1, default: 518 },
    ],
  },
  vector_layout: {
    type: 'vector_layout',
    label: '矢量枝叶编排 (Vector Layout)',
    shortLabel: 'Vector Layout',
    category: 'foliage',
    sinceVersion: 2,
    description: 'v2 自由构图核心：可直接在画布拖拽的多条贝塞尔细枝与叶片实例（稳定 ID），支持 4 路异形叶、离散色板、全局定向受光、层间软投影与精确整数实例标签',
    inputs: [
      { id: 'leafA', label: '叶片 A', type: 'rgba', optional: true },
      { id: 'heightA', label: '高度 A', type: 'gray', optional: true },
      { id: 'leafB', label: '叶片 B', type: 'rgba', optional: true },
      { id: 'heightB', label: '高度 B', type: 'gray', optional: true },
      { id: 'leafC', label: '叶片 C', type: 'rgba', optional: true },
      { id: 'leafD', label: '叶片 D', type: 'rgba', optional: true },
    ],
    outputs: [
      { id: 'rgba', label: '合成 RGBA', type: 'rgba' },
      { id: 'height', label: '层次高度', type: 'gray' },
      { id: 'label', label: '实例标签 ID', type: 'label' },
    ],
    params: [
      { key: 'palette', label: '叶片离散色板', kind: 'palette', default: defaultVinePalette, hint: '各实例通过 colorIdx 绑定对应色块，可吸取参考图色卡' },
      { key: 'paletteStrength', label: '色板映射强度', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.78 },
      { key: 'lightAngle', label: '全局主光角°', kind: 'range', min: -180, max: 180, step: 1, default: -45 },
      { key: 'lightStrength', label: '全局受光渐变', kind: 'range', min: 0, max: 0.8, step: 0.02, default: 0.14 },
      { key: 'depthShade', label: '前后层深压暗', kind: 'range', min: 0, max: 0.7, step: 0.02, default: 0.12 },
      { key: 'layerShadow', label: '叶间软投影', kind: 'range', min: 0, max: 0.75, step: 0.02, default: 0.08 },
      { key: 'stemColor', label: '默认枝干色', kind: 'color', default: '#6e5237' },
      { key: 'stemHighlight', label: '枝干受光棱', kind: 'range', min: 0, max: 0.5, step: 0.02, default: 0.16 },
      { key: 'stems', label: '矢量枝条数组', kind: 'json', default: [] as VectorStem[] },
      { key: 'instances', label: '叶片实例数组', kind: 'json', default: [] as VectorLeafInstance[] },
    ],
  },
  atlas_compose: {
    type: 'atlas_compose',
    label: '非对称图集拼版 (Atlas Compose)',
    shortLabel: 'Atlas Compose',
    category: 'foliage',
    sinceVersion: 2,
    description: 'v2 非均匀自由图集拼版：支持「4大簇 + 4小簇」等非对称分区、统一 mip 安全留边防跨区溢色、稳定区域 ID/锚点元数据直通 3D 卡片 UV 消费',
    inputs: [
      { id: 'slotA', label: '大簇/输入 A', type: 'rgba', optional: true },
      { id: 'heightA', label: '高度 A', type: 'gray', optional: true },
      { id: 'slotB', label: '大簇/输入 B', type: 'rgba', optional: true },
      { id: 'heightB', label: '高度 B', type: 'gray', optional: true },
      { id: 'slotC', label: '小簇/输入 C', type: 'rgba', optional: true },
      { id: 'heightC', label: '高度 C', type: 'gray', optional: true },
      { id: 'slotD', label: '小簇/输入 D', type: 'rgba', optional: true },
      { id: 'heightD', label: '高度 D', type: 'gray', optional: true },
    ],
    outputs: [
      { id: 'rgba', label: '拼版 RGBA', type: 'rgba' },
      { id: 'height', label: '拼版高度', type: 'gray' },
      { id: 'label', label: '分区标签 ID', type: 'label' },
    ],
    params: [
      {
        key: 'layout', label: '拼版方案', kind: 'select',
        options: [
          ['asymmetric_4big_4small', '4 大簇 + 4 小簇（非对称橡叶推荐）'],
          ['grid_2x2', '规则 2×2 四分区'],
          ['grid_3x2', '规则 3×2 六分区'],
          ['custom', '自定义区域数组 (regions)'],
        ],
        default: 'asymmetric_4big_4small',
      },
      { key: 'paddingPx', label: '区域 Mip 留边 px', kind: 'int', min: 2, max: 20, step: 1, default: 8, hint: '每区内部四周独立隔离留边，杜绝远景 Mip 跨区串色' },
      { key: 'colorVar', label: '分区色差变化', kind: 'range', min: 0, max: 0.35, step: 0.02, default: 0.12 },
      { key: 'seed', label: '随机种子', kind: 'int', min: 0, max: 9999, step: 1, default: 708 },
      { key: 'regions', label: '区域矩形元数据', kind: 'json', default: defaultAsymmetricAtlasRegions },
    ],
  },
  flower_bloom: {
    type: 'flower_bloom',
    label: '参数化花朵生成',
    shortLabel: 'Flower Bloom',
    category: 'foliage',
    description: '生成樱花缺口五瓣、野蔷薇、雏菊等花朵 RGBA 与立体花冠高度图',
    inputs: [],
    outputs: [
      { id: 'rgba', label: '花朵 RGBA', type: 'rgba' },
      { id: 'height', label: '花朵高度', type: 'gray' },
    ],
    params: [
      { key: 'petalCount', label: '花瓣数', kind: 'int', min: 3, max: 14, step: 1, default: 5 },
      { key: 'notchDepth', label: '花瓣顶缺口', kind: 'range', min: 0, max: 0.45, step: 0.02, default: 0.26 },
      { key: 'petalWidth', label: '花瓣饱满度', kind: 'range', min: 0.25, max: 1.0, step: 0.02, default: 0.78 },
      { key: 'radius', label: '花冠半径', kind: 'range', min: 0.25, max: 0.48, step: 0.01, default: 0.43 },
      { key: 'centerSize', label: '花心大小', kind: 'range', min: 0.04, max: 0.32, step: 0.01, default: 0.12 },
      { key: 'petalColor', label: '花瓣外缘色', kind: 'color', default: '#ffd9e8' },
      { key: 'innerColor', label: '花瓣根部色', kind: 'color', default: '#e0648f' },
      { key: 'centerColor', label: '花蕊颜色', kind: 'color', default: '#f7c948' },
      { key: 'seed', label: '随机种子', kind: 'int', min: 0, max: 9999, step: 1, default: 620 },
    ],
  },

  // ---------------- Filters & Warp ----------------
  warp: {
    type: 'warp',
    label: '域扭曲 (Warp)',
    shortLabel: 'Warp',
    category: 'filter',
    description: '使用噪声或灰度图驱动像素位移扭曲，赋予树皮裂纹或手绘树叶自然笔触感',
    inputs: [
      { id: 'input', label: '输入', type: 'rgba' },
      { id: 'warp', label: '扭曲场', type: 'gray' },
    ],
    outputs: [{ id: 'out', label: '输出', type: 'rgba' }],
    params: [
      { key: 'intensity', label: '扭曲强度', kind: 'range', min: 0, max: 0.35, step: 0.005, default: 0.06 },
      { key: 'angle', label: '偏向角度°', kind: 'range', min: 0, max: 360, step: 1, default: 0 },
      { key: 'directional', label: '定向扭曲', kind: 'bool', default: false },
    ],
  },
  stylize_paint: {
    type: 'stylize_paint',
    label: '厚涂笔触滤镜 (Stylize)',
    shortLabel: 'Stylize Paint',
    category: 'filter',
    description: '将输入图像转为定向平头画笔色块与柔和色阶，消除程序噪点，呈现吉卜力/原神手绘厚涂质感',
    inputs: [{ id: 'input', label: '色彩输入', type: 'rgba' }],
    outputs: [{ id: 'out', label: '厚涂输出', type: 'rgba' }],
    params: [
      { key: 'brushLength', label: '笔触长度', kind: 'range', min: 1, max: 12, step: 0.5, default: 5 },
      { key: 'angle', label: '笔触方向°', kind: 'range', min: -90, max: 90, step: 1, default: 90 },
      { key: 'levels', label: '色阶归纳', kind: 'int', min: 3, max: 16, step: 1, default: 7 },
      { key: 'softness', label: '色阶柔度', kind: 'range', min: 0, max: 1, step: 0.05, default: 0.45 },
      { key: 'crispEdges', label: '块面锐度', kind: 'range', min: 0, max: 1, step: 0.05, default: 0.35 },
    ],
  },
  slope_blur: {
    type: 'slope_blur',
    label: '斜率模糊 (Slope Blur)',
    shortLabel: 'Slope Blur',
    category: 'filter',
    description: 'Substance 招牌节点：沿斜率图梯度侵蚀或扩展，制作树皮崩裂边缘与厚涂油画质感',
    inputs: [
      { id: 'input', label: '输入', type: 'gray' },
      { id: 'slope', label: '斜率图', type: 'gray' },
    ],
    outputs: [{ id: 'out', label: '输出', type: 'gray' }],
    params: [
      { key: 'intensity', label: '侵蚀强度', kind: 'range', min: 0, max: 0.16, step: 0.004, default: 0.036 },
      { key: 'samples', label: '采样步数', kind: 'int', min: 2, max: 12, step: 1, default: 6 },
      { key: 'mode', label: '混合模式', kind: 'select', options: [['min', '最小值（刻蚀裂口）'], ['max', '最大值（厚涂膨胀）'], ['blur', '平滑斜率模糊']], default: 'min' },
    ],
  },
  ink_outline: {
    type: 'ink_outline',
    label: '手绘线稿描边 (Ink Outline)',
    shortLabel: 'Ink Outline',
    category: 'filter',
    sinceVersion: 2,
    description: '基于精确欧氏距离场 (EDT) 的外轮廓描边与基于整数实例标签的叶间内轮廓线，绝不把内部叶脉误染为黑线',
    inputs: [
      { id: 'input', label: '输入 RGBA', type: 'rgba' },
      { id: 'label', label: '实例标签', type: 'label', optional: true },
    ],
    outputs: [
      { id: 'rgba', label: '描边输出', type: 'rgba' },
      { id: 'mask', label: '线稿遮罩', type: 'gray' },
    ],
    params: [
      { key: 'outerWidth', label: '外描边线宽 px', kind: 'range', min: 0, max: 14, step: 0.25, default: 2.5 },
      { key: 'position', label: '描边位置', kind: 'select', options: [['outside', '外扩描边'], ['center', '居中描边'], ['inside', '内缩描边']], default: 'center' },
      { key: 'outerColor', label: '外描边颜色', kind: 'color', default: '#1f421f' },
      { key: 'outerOpacity', label: '外描边透明度', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.92 },
      { key: 'innerWidth', label: '叶间内线宽 px', kind: 'range', min: 0, max: 10, step: 0.25, default: 1.5, hint: '需要接入实例标签 ID；设为 0 可关闭内线稿' },
      { key: 'innerColor', label: '内线稿颜色', kind: 'color', default: '#224a23' },
      { key: 'innerOpacity', label: '内线稿透明度', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.78 },
      { key: 'softness', label: '抗锯齿柔度', kind: 'range', min: 0.3, max: 2.5, step: 0.1, default: 1.0 },
    ],
  },
  curvature_ao: {
    type: 'curvature_ao',
    label: '曲率与沟槽遮蔽 (Curvature/AO)',
    shortLabel: 'Curvature / AO',
    category: 'adjust',
    sinceVersion: 2,
    description: '从高度图独立派生深缝 AO、凸脊磨损遮罩 (Convex) 与凹槽积苔遮罩 (Concave)，自由驱动树皮分层着色与青苔生长',
    inputs: [
      { id: 'height', label: '高度 Height', type: 'gray' },
      { id: 'mask', label: '有效区 Alpha', type: 'gray', optional: true },
    ],
    outputs: [
      { id: 'ao', label: '环境遮蔽 AO', type: 'gray' },
      { id: 'convex', label: '凸脊磨损', type: 'gray' },
      { id: 'concave', label: '凹槽积苔', type: 'gray' },
    ],
    params: [
      { key: 'radius', label: '曲率采样半径', kind: 'range', min: 1, max: 24, step: 0.5, default: 5.5 },
      { key: 'intensity', label: '凹凸对比强度', kind: 'range', min: 0.2, max: 4.0, step: 0.05, default: 1.85 },
      { key: 'aoRadius', label: 'AO 扩散半径', kind: 'range', min: 2, max: 32, step: 1, default: 12 },
      { key: 'aoStrength', label: 'AO 压暗深度', kind: 'range', min: 0, max: 1.5, step: 0.02, default: 0.85 },
      { key: 'aoMode', label: 'AO 算法', kind: 'select', options: [['fast', '快速多尺度（推荐，O(N)）'], ['horizon', '8 向地平线 Horizon AO']], default: 'fast' },
      { key: 'bias', label: '凹/凸偏置', kind: 'range', min: -0.4, max: 0.4, step: 0.02, default: 0.0 },
    ],
  },
  blur: {
    type: 'blur',
    label: '高斯模糊 (Blur)',
    shortLabel: 'Blur',
    category: 'filter',
    description: '快速可分离平滑模糊（自动适配无缝边界）',
    inputs: [{ id: 'input', label: '输入', type: 'rgba' }],
    outputs: [{ id: 'out', label: '输出', type: 'rgba' }],
    params: [
      { key: 'radius', label: '模糊半径', kind: 'range', min: 0, max: 18, step: 0.5, default: 2.5 },
    ],
  },
  transform_2d: {
    type: 'transform_2d',
    label: '二维变换 (Transform 2D)',
    shortLabel: 'Transform 2D',
    category: 'filter',
    description: '平移、缩放、旋转与平铺重复',
    inputs: [{ id: 'input', label: '输入', type: 'rgba' }],
    outputs: [{ id: 'out', label: '输出', type: 'rgba' }],
    params: [
      { key: 'offsetX', label: '水平偏移', kind: 'range', min: -1, max: 1, step: 0.02, default: 0 },
      { key: 'offsetY', label: '垂直偏移', kind: 'range', min: -1, max: 1, step: 0.02, default: 0 },
      { key: 'scaleX', label: '水平缩放', kind: 'range', min: 0.25, max: 4, step: 0.05, default: 1 },
      { key: 'scaleY', label: '垂直缩放', kind: 'range', min: 0.25, max: 4, step: 0.05, default: 1 },
      { key: 'rotate', label: '旋转角度°', kind: 'range', min: -180, max: 180, step: 1, default: 0 },
      { key: 'tile', label: '无缝平铺', kind: 'bool', default: true },
    ],
  },

  // ---------------- Adjustments ----------------
  levels: {
    type: 'levels',
    label: '色阶调整 (Levels)',
    shortLabel: 'Levels',
    category: 'adjust',
    description: '调节黑白场、伽马对比度与反转，精确塑形高度图和遮罩',
    inputs: [{ id: 'input', label: '灰度输入', type: 'gray' }],
    outputs: [{ id: 'out', label: '灰度输出', type: 'gray' }],
    params: [
      { key: 'inLow', label: '输入黑场', kind: 'range', min: 0, max: 0.98, step: 0.01, default: 0.08 },
      { key: 'inHigh', label: '输入白场', kind: 'range', min: 0.02, max: 1, step: 0.01, default: 0.92 },
      { key: 'gamma', label: '中间调 Gamma', kind: 'range', min: 0.2, max: 3.5, step: 0.05, default: 1.0 },
      { key: 'outLow', label: '输出黑场', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.0 },
      { key: 'outHigh', label: '输出白场', kind: 'range', min: 0, max: 1, step: 0.01, default: 1.0 },
      { key: 'invert', label: '反相', kind: 'bool', default: false },
    ],
  },
  curves_lut: {
    type: 'curves_lut',
    label: '样条曲线调色 (Curves)',
    shortLabel: 'Curves',
    category: 'adjust',
    sinceVersion: 2,
    description: '多点保单调三次 Hermite 曲线映射（支持 RGB / 亮度 / 单通道 / 灰度），精准拉出厚涂明暗对比且不产生过冲反相',
    inputs: [{ id: 'input', label: '输入', type: 'rgba' }],
    outputs: [{ id: 'out', label: '输出', type: 'rgba' }],
    params: [
      { key: 'channel', label: '作用通道', kind: 'select', options: [['rgb', 'RGB 全通道'], ['luma', '仅亮度 Luma'], ['r', '红通道 R'], ['g', '绿通道 G'], ['b', '蓝通道 B'], ['alpha', '透明 Alpha']], default: 'rgb' },
      { key: 'points', label: '曲线控制点', kind: 'curve', default: defaultCurvePoints },
      { key: 'monotone', label: '保单调防过冲', kind: 'bool', default: true },
    ],
  },
  gradient_map: {
    type: 'gradient_map',
    label: '渐变映射 (Gradient Map)',
    shortLabel: 'Gradient Map',
    category: 'adjust',
    description: 'Substance 核心着色节点：将灰度高度图映射为多色阶自然配色（树皮/苔藓/秋叶）',
    inputs: [{ id: 'input', label: '灰度输入', type: 'gray' }],
    outputs: [{ id: 'out', label: '色彩 RGBA', type: 'rgba' }],
    params: [
      { key: 'stops', label: '色阶渐变', kind: 'gradient', default: defaultBarkGradient },
    ],
  },
  palette_map: {
    type: 'palette_map',
    label: '感知色板映射 (Palette Map)',
    shortLabel: 'Palette Map',
    category: 'adjust',
    sinceVersion: 2,
    description: '在 CIELAB 感知空间将图像色彩归拢到自定义 2–12 色离散色卡（支持硬边赛璐璐色块或保留叶脉明暗的柔滑厚涂融合）',
    inputs: [{ id: 'input', label: '色彩输入', type: 'rgba' }],
    outputs: [{ id: 'out', label: '色板输出', type: 'rgba' }],
    params: [
      { key: 'palette', label: '目标色板', kind: 'palette', default: defaultBarkPalette },
      { key: 'strength', label: '映射强度', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.85 },
      { key: 'softness', label: '色阶过渡柔度', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.25 },
      { key: 'preserveLuma', label: '保留局部明暗', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.35 },
    ],
  },
  hsl_adjust: {
    type: 'hsl_adjust',
    label: '色相 / 饱和度 / 明度',
    shortLabel: 'HSL Adjust',
    category: 'adjust',
    description: '实时调节色彩倾向、饱和度、亮度与对比度，保留原始 Alpha 通道',
    inputs: [{ id: 'input', label: '色彩输入', type: 'rgba' }],
    outputs: [{ id: 'out', label: '色彩输出', type: 'rgba' }],
    params: [
      { key: 'hue', label: '色相偏移°', kind: 'range', min: -180, max: 180, step: 1, default: 0 },
      { key: 'saturation', label: '饱和度', kind: 'range', min: 0, max: 2, step: 0.02, default: 1.0 },
      { key: 'lightness', label: '亮度偏移', kind: 'range', min: -0.5, max: 0.5, step: 0.01, default: 0.0 },
      { key: 'contrast', label: '对比度', kind: 'range', min: 0.4, max: 2.0, step: 0.02, default: 1.0 },
    ],
  },
  edge_mask: {
    type: 'edge_mask',
    label: '叶缘高光 / 轮廓修边',
    shortLabel: 'Edge & Rim',
    category: 'adjust',
    description: '提取或染色叶片透明轮廓边缘（用于手绘亮边、枯黄叶缘或柔和羽化）',
    inputs: [{ id: 'input', label: '叶片 RGBA', type: 'rgba' }],
    outputs: [
      { id: 'rgba', label: '染色 RGBA', type: 'rgba' },
      { id: 'mask', label: '边缘遮罩', type: 'gray' },
    ],
    params: [
      { key: 'width', label: '边缘宽度', kind: 'range', min: 1, max: 12, step: 0.5, default: 3 },
      { key: 'tintStrength', label: '边缘着色强度', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.32 },
      { key: 'edgeColor', label: '边缘颜色', kind: 'color', default: '#f6ffaa' },
      { key: 'alphaClip', label: '轮廓收紧', kind: 'range', min: 0, max: 0.6, step: 0.02, default: 0.0 },
    ],
  },

  // ---------------- Blend & Output ----------------
  blend: {
    type: 'blend',
    label: '图层混合 (Blend)',
    shortLabel: 'Blend',
    category: 'blend',
    description: '按混合模式与可选遮罩叠加前景与背景（支持 Alpha Over / 叠加 / 正片叠底 / 滤色 / 最大值）',
    inputs: [
      { id: 'base', label: '底层 Base', type: 'rgba' },
      { id: 'overlay', label: '顶层 Over', type: 'rgba' },
      { id: 'mask', label: '遮罩 Mask', type: 'gray', optional: true },
    ],
    outputs: [{ id: 'out', label: '混合输出', type: 'rgba' }],
    params: [
      {
        key: 'mode', label: '混合模式', kind: 'select',
        options: [
          ['normal', '正常覆盖 (Copy/Alpha)'],
          ['multiply', '正片叠底 (Multiply)'],
          ['screen', '滤色提亮 (Screen)'],
          ['overlay', '叠加对比 (Overlay)'],
          ['add', '线性相加 (Add)'],
          ['subtract', '相减刻蚀 (Subtract)'],
          ['max', '取最大值 (Max)'],
          ['min', '取最小值 (Min)'],
        ],
        default: 'normal',
      },
      { key: 'opacity', label: '不透明度', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.75 },
    ],
  },
  output_material: {
    type: 'output_material',
    label: '材质输出 (Output)',
    shortLabel: 'Material Output',
    category: 'output',
    description: '最终材质输出节点：汇总 BaseColor / Alpha / Height / Normal / Roughness 并实时同步到 3D 树木',
    inputs: [
      { id: 'baseColor', label: '基础色 RGBA', type: 'rgba' },
      { id: 'opacity', label: '透明遮罩', type: 'gray', optional: true },
      { id: 'height', label: '高度 Height', type: 'gray', optional: true },
      { id: 'roughness', label: '粗糙度', type: 'gray', optional: true },
    ],
    outputs: [],
    params: [
      { key: 'normalStrength', label: '法线凹凸强度', kind: 'range', min: 0, max: 6, step: 0.1, default: 2.2 },
      { key: 'roughnessBase', label: '基础粗糙度', kind: 'range', min: 0.1, max: 1, step: 0.02, default: 0.78 },
      { key: 'roughnessContrast', label: '高度驱动粗糙度', kind: 'range', min: -0.5, max: 0.5, step: 0.02, default: 0.16 },
      { key: 'dilateAlpha', label: '自动 Alpha 扩边去白边', kind: 'bool', default: true },
    ],
  },
}

export const allNodeTypes = Object.keys(nodeDefinitions) as NodeType[]

export function defaultParamsFor(type: NodeType): Record<string, unknown> {
  const def = nodeDefinitions[type]
  const out: Record<string, unknown> = {}
  for (const p of def.params) {
    out[p.key] = Array.isArray(p.default)
      ? JSON.parse(JSON.stringify(p.default))
      : p.default
  }
  return out
}

function mergeNodeParams(type: NodeType, userParams?: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...defaultParamsFor(type), ...(userParams ?? {}) }
  // Seamlessly migrate legacy `atlas2x2: true` saved graphs to N x M `atlasCols / atlasRows`
  if (type === 'branch_scatter' && userParams?.atlas2x2 === true) {
    if (userParams.atlasCols === undefined) merged.atlasCols = 2
    if (userParams.atlasRows === undefined) merged.atlasRows = 2
  }
  return merged
}

export function createNode(type: NodeType, x: number, y: number, id?: string, paramOverrides?: Record<string, unknown>): GraphNode {
  return {
    id: id ?? `n-${type}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    x: Math.round(x),
    y: Math.round(y),
    params: mergeNodeParams(type, paramOverrides),
  }
}

export function cloneGraph(graph: TextureGraph): TextureGraph {
  return JSON.parse(JSON.stringify(graph)) as TextureGraph
}

/** Checks if adding an edge fromNode -> toNode would form a cycle in the DAG. */
export function wouldCreateCycle(nodes: GraphNode[], edges: GraphEdge[], fromNode: string, toNode: string): boolean {
  if (fromNode === toNode) return true
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    const list = adj.get(e.fromNode)
    if (list) list.push(e.toNode)
  }
  // Check if fromNode is reachable starting from toNode
  const stack = [toNode]
  const visited = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === fromNode) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    for (const next of adj.get(cur) ?? []) stack.push(next)
  }
  return false
}

export function arePortsCompatible(fromType: PortType, toType: PortType): boolean {
  // Exact integer `label` maps are NEVER implicitly coerced to/from interpolated gray/rgba!
  if (fromType === 'label' || toType === 'label') return fromType === toType
  return true
}

export function isV2Graph(graph: Pick<TextureGraph, 'nodes'>): boolean {
  return graph.nodes.some(n => Boolean(n.bypass) || nodeDefinitions[n.type]?.sinceVersion === 2)
}

export function normalizeGraphSchemaVersion(graph: TextureGraph): TextureGraph {
  const ver: 1 | 2 = isV2Graph(graph) || graph.schemaVersion === 2 ? 2 : 1
  return graph.schemaVersion === ver ? graph : { ...graph, schemaVersion: ver }
}

function sanitizeCurvePoints(raw: unknown, fallback: CurvePoint[]): CurvePoint[] {
  if (!Array.isArray(raw) || raw.length < 2) return fallback.map(pt => [pt[0], pt[1]])
  const pts: CurvePoint[] = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    const x = Number(entry[0]), y = Number(entry[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    pts.push([Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))])
  }
  if (pts.length < 2) return fallback.map(pt => [pt[0], pt[1]])
  pts.sort((a, b) => a[0] - b[0])
  pts[0][0] = 0
  pts[pts.length - 1][0] = 1
  return pts
}

function sanitizePalette(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw) || raw.length < 2) return [...fallback]
  const hexRe = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
  const out = raw.filter((c): c is string => typeof c === 'string' && hexRe.test(c.trim())).map(c => c.trim()).slice(0, 12)
  return out.length >= 2 ? out : [...fallback]
}

function sanitizeStems(raw: unknown): VectorStem[] {
  if (!Array.isArray(raw)) return []
  const out: VectorStem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `stem-${i + 1}`
    if (seen.has(id)) continue
    const rawPts = Array.isArray(o.points) ? o.points : []
    const points: [number, number][] = []
    for (const pt of rawPts) {
      if (!Array.isArray(pt) || pt.length < 2) continue
      const x = Number(pt[0]), y = Number(pt[1])
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([Math.max(-0.2, Math.min(1.2, x)), Math.max(-0.2, Math.min(1.2, y))])
    }
    if (points.length < 2) continue
    seen.add(id)
    out.push({
      id,
      points: points.slice(0, 8),
      widthStart: typeof o.widthStart === 'number' && Number.isFinite(o.widthStart) ? Math.max(0.001, Math.min(0.06, o.widthStart)) : 0.012,
      widthEnd: typeof o.widthEnd === 'number' && Number.isFinite(o.widthEnd) ? Math.max(0.001, Math.min(0.05, o.widthEnd)) : 0.005,
      ...(typeof o.color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(o.color) ? { color: o.color } : {}),
      z: typeof o.z === 'number' && Number.isFinite(o.z) ? o.z : 0,
    })
  }
  return out
}

function sanitizeInstances(raw: unknown): VectorLeafInstance[] {
  if (!Array.isArray(raw)) return []
  const out: VectorLeafInstance[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const inst = raw[i]
    if (!inst || typeof inst !== 'object') continue
    const o = inst as Record<string, unknown>
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `leaf-${i + 1}`
    if (seen.has(id)) continue
    const x = Number(o.x), y = Number(o.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    seen.add(id)
    out.push({
      id,
      x: Math.max(-0.2, Math.min(1.2, x)),
      y: Math.max(-0.2, Math.min(1.2, y)),
      rot: typeof o.rot === 'number' && Number.isFinite(o.rot) ? o.rot : 0,
      scaleX: typeof o.scaleX === 'number' && Number.isFinite(o.scaleX) ? Math.max(0.02, Math.min(0.8, o.scaleX)) : 0.14,
      scaleY: typeof o.scaleY === 'number' && Number.isFinite(o.scaleY) ? Math.max(0.02, Math.min(0.8, o.scaleY)) : 0.16,
      ...(o.flip === true ? { flip: true } : {}),
      variant: typeof o.variant === 'number' && Number.isFinite(o.variant) ? Math.max(0, Math.min(3, Math.round(o.variant))) : 0,
      colorIdx: typeof o.colorIdx === 'number' && Number.isFinite(o.colorIdx) ? Math.max(0, Math.min(11, Math.round(o.colorIdx))) : 0,
      z: typeof o.z === 'number' && Number.isFinite(o.z) ? o.z : i * 0.01,
      ...(typeof o.bend === 'number' && Number.isFinite(o.bend) ? { bend: Math.max(-0.35, Math.min(0.35, o.bend)) } : {}),
      ...(typeof o.stemId === 'string' && o.stemId.trim() ? { stemId: o.stemId.trim() } : {}),
      ...(o.locked === true ? { locked: true } : {}),
    })
  }
  return out
}

export interface GraphValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** Strict structural & contract validator for v1/v2 TextureGraph documents. */
export function validateTextureGraph(graph: TextureGraph): GraphValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (graph.schemaVersion !== 1 && graph.schemaVersion !== 2) {
    errors.push(`不支持的 schemaVersion: ${String(graph.schemaVersion)}（仅支持 1 或 2）`)
  }
  if (!validSlots.has(graph.targetSlot)) errors.push(`无效贴图槽位: ${String(graph.targetSlot)}`)
  if (graph.resolution !== 256 && graph.resolution !== 512 && graph.resolution !== 1024) {
    errors.push(`无效分辨率: ${String(graph.resolution)}`)
  }

  const nodeById = new Map<string, GraphNode>()
  let outputCount = 0
  for (const n of graph.nodes) {
    if (!n.id || typeof n.id !== 'string') { errors.push('存在空节点 ID'); continue }
    if (nodeById.has(n.id)) errors.push(`重复节点 ID: ${n.id}`)
    if (!(n.type in nodeDefinitions)) { errors.push(`未知节点类型: ${String(n.type)} (节点 ${n.id})`); continue }
    nodeById.set(n.id, n)
    if (n.type === 'output_material') outputCount++
    if (n.type === 'output_material' && n.bypass) errors.push('output_material 节点不可开启 Bypass')

    // Validate param bounds & unique vector IDs
    const def = nodeDefinitions[n.type]
    for (const pSpec of def.params) {
      const val = n.params[pSpec.key]
      if (val === undefined) continue
      if (pSpec.kind === 'range' || pSpec.kind === 'int') {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          errors.push(`节点 ${n.id}.${pSpec.key} 必须是有效数值`)
        } else if ((pSpec.min !== undefined && val < pSpec.min - 1e-6) || (pSpec.max !== undefined && val > pSpec.max + 1e-6)) {
          errors.push(`节点 ${n.id}.${pSpec.key}=${val} 超出范围 [${pSpec.min}, ${pSpec.max}]`)
        }
      } else if (pSpec.kind === 'select' && pSpec.options) {
        if (!pSpec.options.some(([optVal]) => optVal === String(val))) {
          errors.push(`节点 ${n.id}.${pSpec.key} 选项无效: ${String(val)}`)
        }
      }
    }
    if (n.type === 'vector_layout') {
      const stems = Array.isArray(n.params.stems) ? n.params.stems as VectorStem[] : []
      const stemIds = new Set<string>()
      for (const s of stems) {
        if (!s?.id || typeof s.id !== 'string') errors.push(`节点 ${n.id} 存在无 ID 枝条`)
        else if (stemIds.has(s.id)) errors.push(`节点 ${n.id} 存在重复枝条 ID: ${s.id}`)
        else stemIds.add(s.id)
        if (!Array.isArray(s?.points) || s.points.length < 2) errors.push(`节点 ${n.id} 枝条 ${s?.id} 至少需要 2 个控制点`)
      }
      const insts = Array.isArray(n.params.instances) ? n.params.instances as VectorLeafInstance[] : []
      const instIds = new Set<string>()
      for (const inst of insts) {
        if (!inst?.id || typeof inst.id !== 'string') errors.push(`节点 ${n.id} 存在无 ID 叶片实例`)
        else if (instIds.has(inst.id)) errors.push(`节点 ${n.id} 存在重复叶片实例 ID: ${inst.id}`)
        else instIds.add(inst.id)
      }
    }
  }
  if (outputCount === 0) errors.push('缺少 output_material 输出节点')
  if (outputCount > 1) errors.push(`存在多个 output_material 输出节点（${outputCount} 个）`)

  const seenInputs = new Set<string>()
  const accEdges: GraphEdge[] = []
  for (const e of graph.edges) {
    const fn = nodeById.get(e.fromNode)
    const tn = nodeById.get(e.toNode)
    if (!fn) { errors.push(`连线源节点不存在: ${e.fromNode}`); continue }
    if (!tn) { errors.push(`连线目标节点不存在: ${e.toNode}`); continue }
    const fromPort = nodeDefinitions[fn.type].outputs.find(p => p.id === e.fromPort)
    const toPort = nodeDefinitions[tn.type].inputs.find(p => p.id === e.toPort)
    if (!fromPort) { errors.push(`源端口不存在: ${e.fromNode}.${e.fromPort}`); continue }
    if (!toPort) { errors.push(`目标端口不存在: ${e.toNode}.${e.toPort}`); continue }
    if (!arePortsCompatible(fromPort.type, toPort.type)) {
      errors.push(`端口类型不兼容: ${e.fromNode}.${e.fromPort}(${fromPort.type}) -> ${e.toNode}.${e.toPort}(${toPort.type})`)
      continue
    }
    const inKey = `${e.toNode}:${e.toPort}`
    if (seenInputs.has(inKey)) {
      errors.push(`目标端口重复连线: ${inKey}`)
      continue
    }
    if (wouldCreateCycle(graph.nodes, accEdges, e.fromNode, e.toNode)) {
      errors.push(`连线形成环路: ${e.fromNode} -> ${e.toNode}`)
      continue
    }
    seenInputs.add(inKey)
    accEdges.push(e)
  }

  if (graph.schemaVersion === 1 && isV2Graph(graph)) {
    warnings.push('图包含 v2 节点或 Bypass，建议升级为 schemaVersion: 2')
  }

  return { ok: errors.length === 0, errors, warnings }
}

export interface ParseTextureGraphOptions {
  /** Strict v2 contract check: rejects unknown nodes, bad wires, cycles, duplicate IDs, and multiple outputs instead of dropping them. */
  strict?: boolean
}

export function parseTextureGraph(raw: unknown, options: ParseTextureGraphOptions = {}): TextureGraph {
  if (!raw || typeof raw !== 'object') throw new Error('无效的贴图节点图数据')
  const o = raw as Record<string, unknown>

  // Never silently strip future schema versions!
  const rawVer = o.schemaVersion
  if (rawVer !== undefined && (typeof rawVer !== 'number' || !Number.isInteger(rawVer) || rawVer < 1 || rawVer > CURRENT_GRAPH_SCHEMA_VERSION)) {
    throw new Error(`不支持的贴图节点图版本 schemaVersion=${String(rawVer)}（当前仅支持 v1 / v${CURRENT_GRAPH_SCHEMA_VERSION}），已保留原始数据未改写`)
  }
  const strict = Boolean(options.strict)
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : '未命名贴图'
  const targetSlot: EditableTextureSlot = typeof o.targetSlot === 'string' && validSlots.has(o.targetSlot)
    ? o.targetSlot as EditableTextureSlot
    : 'leaf'
  const category: TextureCategory = typeof o.category === 'string' && validCategories.has(o.category as TextureCategory)
    ? o.category as TextureCategory
    : (targetSlot === 'bark' ? 'bark' : 'leaf')
  const resolution: 256 | 512 | 1024 = o.resolution === 256 || o.resolution === 1024 ? o.resolution : 512
  const seamless = typeof o.seamless === 'boolean' ? o.seamless : targetSlot === 'bark'

  const rawNodes = Array.isArray(o.nodes) ? o.nodes : []
  const nodes: GraphNode[] = []
  const nodeIds = new Set<string>()
  let outputCount = 0
  for (const entry of rawNodes) {
    if (!entry || typeof entry !== 'object') {
      if (strict) throw new Error('节点列表中包含无效项')
      continue
    }
    const n = entry as Record<string, unknown>
    if (typeof n.id !== 'string' || !n.id) {
      if (strict) throw new Error('存在缺少有效 id 的节点')
      continue
    }
    if (nodeIds.has(n.id)) {
      if (strict) throw new Error(`存在重复节点 ID: ${n.id}`)
      continue
    }
    if (typeof n.type !== 'string' || !(n.type in nodeDefinitions)) {
      if (strict || rawVer === 2) throw new Error(`存在未知或不受支持的节点类型: ${String(n.type)} (节点 ${n.id})`)
      continue
    }
    const type = n.type as NodeType
    if (type === 'output_material') {
      outputCount++
      if (strict && outputCount > 1) throw new Error('节点图只允许存在一个 output_material 输出节点')
    }
    const userParams = n.params && typeof n.params === 'object' ? n.params as Record<string, unknown> : {}
    const merged = mergeNodeParams(type, userParams)
    // Normalize structured v2 params safely
    const def = nodeDefinitions[type]
    for (const ps of def.params) {
      if (ps.kind === 'curve') merged[ps.key] = sanitizeCurvePoints(merged[ps.key], ps.default as CurvePoint[])
      else if (ps.kind === 'palette') merged[ps.key] = sanitizePalette(merged[ps.key], ps.default as string[])
      else if (type === 'vector_layout' && ps.key === 'stems') merged[ps.key] = sanitizeStems(merged[ps.key])
      else if (type === 'vector_layout' && ps.key === 'instances') merged[ps.key] = sanitizeInstances(merged[ps.key])
    }
    nodeIds.add(n.id)
    nodes.push({
      id: n.id,
      type,
      x: typeof n.x === 'number' && Number.isFinite(n.x) ? n.x : 120,
      y: typeof n.y === 'number' && Number.isFinite(n.y) ? n.y : 120,
      ...(typeof n.label === 'string' && n.label.trim() ? { label: n.label.trim().slice(0, 40) } : {}),
      ...(n.bypass === true && type !== 'output_material' ? { bypass: true } : {}),
      params: merged,
    })
  }
  if (!nodes.some(n => n.type === 'output_material')) {
    if (strict) throw new Error('节点图缺少 output_material 输出节点')
    nodes.push(createNode('output_material', 760, 180, 'out'))
    nodeIds.add('out')
  }

  const rawEdges = Array.isArray(o.edges) ? o.edges : []
  const edges: GraphEdge[] = []
  const seenInputs = new Set<string>()
  for (const entry of rawEdges) {
    if (!entry || typeof entry !== 'object') {
      if (strict) throw new Error('连线列表中包含无效项')
      continue
    }
    const e = entry as Record<string, unknown>
    if (typeof e.fromNode !== 'string' || typeof e.toNode !== 'string' || typeof e.fromPort !== 'string' || typeof e.toPort !== 'string') {
      if (strict) throw new Error('存在字段不完整的连线')
      continue
    }
    const fn = nodes.find(n => n.id === e.fromNode)
    const tn = nodes.find(n => n.id === e.toNode)
    if (!fn || !tn) {
      if (strict) throw new Error(`连线引用了不存在的节点: ${e.fromNode} -> ${e.toNode}`)
      continue
    }
    const fromPort = nodeDefinitions[fn.type].outputs.find(p => p.id === e.fromPort)
    const toPort = nodeDefinitions[tn.type].inputs.find(p => p.id === e.toPort)
    if (!fromPort || !toPort) {
      if (strict) throw new Error(`连线引用了不存在的端口: ${e.fromNode}.${e.fromPort} -> ${e.toNode}.${e.toPort}`)
      continue
    }
    if (!arePortsCompatible(fromPort.type, toPort.type)) {
      if (strict) throw new Error(`端口类型不兼容: ${e.fromNode}.${e.fromPort}(${fromPort.type}) -> ${e.toNode}.${e.toPort}(${toPort.type})`)
      continue
    }
    const inKey = `${e.toNode}:${e.toPort}`
    if (seenInputs.has(inKey)) {
      if (strict) throw new Error(`目标端口重复连线: ${inKey}`)
      continue
    }
    if (wouldCreateCycle(nodes, edges, e.fromNode, e.toNode)) {
      if (strict) throw new Error(`连线形成环路: ${e.fromNode} -> ${e.toNode}`)
      continue
    }
    seenInputs.add(inKey)
    edges.push({
      id: typeof e.id === 'string' && e.id ? e.id : `e-${e.fromNode}-${e.fromPort}-${e.toNode}-${e.toPort}`,
      fromNode: e.fromNode,
      fromPort: e.fromPort,
      toNode: e.toNode,
      toPort: e.toPort,
    })
  }

  const schemaVersion: 1 | 2 = (rawVer === 2 || isV2Graph({ nodes })) ? 2 : 1
  const result: TextureGraph = {
    schemaVersion,
    name,
    category,
    targetSlot,
    resolution,
    seamless,
    nodes,
    edges,
  }
  if (strict) {
    const check = validateTextureGraph(result)
    if (!check.ok) throw new Error(`节点图校验失败: ${check.errors.join('；')}`)
  }
  return result
}
