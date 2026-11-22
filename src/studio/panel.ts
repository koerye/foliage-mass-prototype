// Schema-driven inspector: sliders + numeric inputs bound to dotted spec paths.
import { leafFieldMeta, leafSections } from '../broadleaf/leaf-panel'
import { cardTypeLabels, cardTypes, leafRules, normalSources } from '../broadleaf/leaves'
import { CrownEnvelope, evalProfileCurve } from '../tree/envelope'
import { lodPresets } from '../tree/optimize'
import {
  defaultAccents, defaultLeafNormalEdit, defaultTrunkSculpt, isWoodSculptActive,
  woodSculptStyleIds, woodSculptStyleMeta,
  type TreeKind, type TreeSpec, type TrunkSculptSpec, type WoodSculptStyleId,
} from '../tree/spec'

export const CROWN_PROFILE_US = [0.05, 0.28, 0.52, 0.76, 0.96] as const
export const crownProfilePresets: { id: string; label: string; points?: [number, number][] }[] = [
  { id: 'default', label: '默认' },
  { id: 'vase', label: '花瓶收腰', points: [[0.05, 0.52], [0.28, 0.62], [0.52, 1.06], [0.76, 1.34], [0.96, 1.08]] },
  { id: 'pagoda', label: '宝塔层级', points: [[0.05, 1.32], [0.28, 0.76], [0.52, 1.22], [0.76, 0.72], [0.96, 0.96]] },
  { id: 'umbrella', label: '伞盖宽顶', points: [[0.05, 0.42], [0.28, 0.54], [0.52, 1.24], [0.76, 1.44], [0.96, 1.20]] },
]

function crownProfileWidgetHtml() {
  const btns = crownProfilePresets
    .map(p => `<button type="button" class="s-curve-chip" data-crown-curve="${p.id}">${p.label}</button>`)
    .join('')
  const dots = CROWN_PROFILE_US
    .map((_, i) => `<circle class="s-curve-pt" data-curve-idx="${i}" cx="132" cy="${Math.round(102 - CROWN_PROFILE_US[i] * 90)}" r="5"></circle>`)
    .join('')
  return `<div class="s-crown-curve" id="crown-curve-editor">
    <div class="s-curve-head">
      <b>竖向截面轮廓曲线</b>
      <div class="s-curve-chips">${btns}</div>
    </div>
    <svg class="s-curve-svg" id="crown-curve-svg" viewBox="0 0 180 112" aria-label="树冠竖向截面轮廓曲线">
      <line x1="90" y1="8" x2="90" y2="104" stroke="#b9c6b4" stroke-dasharray="3 3" stroke-width="1"/>
      <line x1="16" y1="56" x2="164" y2="56" stroke="#e2e8db" stroke-width="1"/>
      <line x1="132" y1="8" x2="132" y2="104" stroke="#e4eadf" stroke-dasharray="2 3" stroke-width="1"/>
      <path class="s-curve-fill" id="crown-curve-fill" d=""></path>
      <path class="s-curve-line" id="crown-curve-line" d=""></path>
      ${dots}
    </svg>
    <p class="s-note">左右拖动右侧控制点，实时塑形树冠自下而上的宽窄轮廓。</p>
  </div>`
}

export interface Field {
  path: string
  label: string | Partial<Record<TreeKind, string>>
  hint?: string
  type?: 'range' | 'color' | 'select' | 'checkbox'
  min?: number
  max?: number
  step?: number
  options?: [string, string][]
  kinds?: TreeKind[]
}
export interface Section { title: string; kinds?: TreeKind[]; open?: boolean; fields: Field[]; extra?: string }

const r = (path: string, label: Field['label'], min: number, max: number, step: number, hint = ''): Field =>
  ({ path, label, min, max, step, hint })

export const sections: Section[] = [
  { title: '面数优化 · LOD', open: true,
    extra: `<div class="opt-status" id="opt-status">当前高模，未减面</div>
      <div class="opt-presets" role="group" aria-label="面数档位">
        ${lodPresets.map(p => `<button type="button" data-lod="${p.level}" title="${p.hint}">${p.label}</button>`).join('')}
      </div>
      <div class="opt-budget">
        <label title="输入目标三角面数，自动求解最小减面强度"><span>目标面数</span>
        <input id="opt-target" type="number" min="200" max="100000" step="100" data-path="optimize.targetTriangles"></label>
        <button type="button" id="opt-solve" class="primary">自动优化</button>
      </div>`,
    fields: [
      r('optimize.level', '优化强度', 0, 1, .02, '联动调节木质细分、隐藏枝剔除、平板卡片和面积补偿减卡'),
      r('optimize.woodDetail', '木质细分', .2, 1, .02, '降低树干与枝条的环数与圆周分段'),
      { path: 'optimize.cullHiddenWood', label: '剔除隐藏枝', type: 'checkbox', hint: '移除藏在叶面内的细枝/覆盖枝（导出 GLB 同步生效）' },
      { path: 'optimize.flatCards', label: '叶片平板化', type: 'checkbox', hint: '阔叶卡片改为 2 面平板（原 8 面）、草丛改单交叉片' },
      r('optimize.cardReduction', '面积补偿减卡', 0, .75, .02, '均匀减少卡片数量并按面积等比放大剩余卡片，保持冠幅饱满'),
    ] },
  { title: '风格化光影 · 质感', open: false,
    extra: '<p class="s-note">为叶面增加次表面透光、暗部冷暖色偏与顶部暖阳色阶，消除灰暗纸片感；导出 GLB 保持标准 PBR 兼容。</p>', fields: [
      { path: 'shading.leafStyle', label: '阔叶内置叶型', type: 'select', kinds: ['broadleaf'],
        options: [['default', '默认阔叶簇'], ['oak', '手绘厚涂橡叶叠簇（支持 2×2 图集）'], ['cloud', '厚涂圆云叶（吉卜力）'], ['bush', '翠绿尖叶灌木簇'], ['sakura', '樱花柔瓣簇（缺口5瓣）'], ['maple', '枫叶五角簇'], ['willow', '垂柳细长丝'], ['flower', '通用花簇']],
        hint: '无需上传贴图即可切换内置风格化叶型；载入自定义贴图时自动切回默认槽位' },
      r('shading.translucency', '次表面透光 SSS', 0, 1, .02, '阳光穿透薄叶与花瓣的通透背光感'),
      r('shading.rimLight', '边缘轮廓光', 0, 1, .02, '受光边缘的柔和透亮轮廓，增强云团层次'),
      r('shading.shadowShift', '暗部色相偏移', 0, 1, .02, '让暗部偏冷青/柔紫而不是发灰发黑'),
      r('shading.topWarmth', '三段受光暖色', 0, 1, .02, '冠顶暖阳 → 中段正色 → 底面清冷的自然色阶'),
      { path: 'shading.softSelfShadow', label: '柔化叶卡自阴影', type: 'checkbox', hint: '开启后叶面仍向树干与地面投射阴影，但消除交叉卡片间生硬的黑色三角噪点' },
      r('shading.petals', '氛围飘落花瓣', 0, 60, 1, '在树冠轮廓外侧点缀轻盈飘落的花瓣/叶屑（0 = 关闭）'),
    ] },
  { title: '树叶自定义法线（Normal Transfer）', open: false,
    extra: '<p class="s-note">支持全局法线投射（穹顶/球心/圆柱/定向/原始）与 3D 局部笔刷塑形；点视口左上角「✎ 节点编辑 → ↗ 法线编辑」可开启 RGB 法线视图、3D 法线箭头、直接拖拽法线球心并在树冠上刷法线，导出 GLB 100% 保留。</p>',
    fields: [
      { path: 'normalEdit.mode', label: '法线投射模式', type: 'select',
        options: [
          ['auto', '默认（沿用分团/球化法线）'],
          ['dome', '半球穹顶（二次元/原神柔底面）'],
          ['radial', '自定义球心放射（可 3D 拖球心）'],
          ['cylinder', '圆柱环向放射（柱状/垂柳）'],
          ['directional', '统一自定义朝向（插画/赛璐璐）'],
          ['original', '原始叶片面法线（强片状细节）'],
        ],
        hint: '直接重写叶面顶点法线，精确掌控风格化明暗交界线与受光体积' },
      r('normalEdit.strength', '自定义法线权重', 0, 1, .02, '自定义投射法线覆盖原法线的混合强度'),
      r('normalEdit.upLift', '整体朝上提亮', -1, 1, .02, '正值让叶面法线整体朝天抬升（提亮树冠底面），负值压深阴影戏剧感'),
      r('normalEdit.flatten', '柔化底面暗部', 0, 1, .02, '压平朝下法线分量，彻底消除树冠底部生硬死黑'),
      r('normalEdit.centerOffsetX', '法线球心偏移 X', -4, 4, .05, '自定义法线投射球心的水平左右偏移（米）'),
      r('normalEdit.centerOffsetY', '法线球心偏移 Y', -4, 4, .05, '向下调负值可让下半球叶面法线自动朝上，快速提亮底冠'),
      r('normalEdit.centerOffsetZ', '法线球心偏移 Z', -4, 4, .05, '自定义法线投射球心的前后深度偏移（米）'),
      r('normalEdit.azimuth', '定向方位角°', -180, 180, 1, '「统一自定义朝向」模式下所有叶面法线指向的水平方位角'),
      r('normalEdit.elevation', '定向仰角°', -90, 90, 1, '「统一自定义朝向」模式下法线指向的俯仰角（90°=正朝天）'),
      r('normalEdit.jitter', '厚涂法线扰动', 0, 1, .02, '为每片叶子叠加上柔和的有机方向扰动，避免球化过度像塑料球'),
    ] },
  { title: '古树装饰 · 磐石 / 飘带 / 木牌 / 星芒', kinds: ['broadleaf', 'conifer'], open: false,
    extra: '<p class="s-note">支持实时微调根部青苔磐石、缠干扁折红绸飘带、挂枝木质祈愿牌与冠层四角星芒；所有参数随 JSON 与预设库保存，导出 GLB 可一键去除装饰。</p>',
    fields: [
      { path: 'shading.accent', label: '古树场景点缀', type: 'select',
        options: [['none', '关闭装饰'], ['wishing', '开启仙韵祈愿装饰']],
        hint: '开启后在当前树干与侧枝上生成青苔磐石、红绸飘带、祈愿木牌与金色星芒' },
      r('accents.rockCount', '根部磐石数量', 0, 8, 1, '环绕根部膨大处贴地生长的风格化青苔石数量'),
      r('accents.rockScale', '磐石缩放', .4, 1.8, .05, '调整青苔磐石的整体体量'),
      { path: 'accents.rockColor', label: '磐石岩体色', type: 'color', hint: '青灰岩或暖褐岩体基色，自动推导受光面与背光面色阶' },
      { path: 'accents.rockMossColor', label: '磐石苔帽色', type: 'color', hint: '磐石朝上面覆盖的绒感苔藓色' },
      r('accents.ribbonWraps', '飘带缠绕条数', 0, 4, 1, '沿树干曲线盘绕与垂挂的扁折丝绸飘带条数'),
      { path: 'accents.ribbonColor', label: '飘带与红穗色', type: 'color', hint: '丝绸飘带与木牌下方流苏的配色（可改朱红/金黄/靛青/樱粉）' },
      r('accents.plaqueCount', '祈愿木牌数量', 0, 10, 1, '主干束结与真实侧枝下垂挂的木质祈愿牌数量'),
      r('accents.plaqueScale', '木牌大小', .6, 1.8, .05, '祈愿木牌与流苏的整体缩放'),
      { path: 'accents.sparkles', label: '启用冠层星芒', type: 'checkbox', hint: '在树冠受光外缘点缀闪烁的四角星芒粒子' },
      r('accents.sparkleCount', '星芒数量', 0, 36, 1, '树冠四周飘浮的四角星芒数量'),
      { path: 'accents.sparkleColor', label: '星芒色调', type: 'color', hint: '星芒光晕配色' },
    ] },
  { title: '花朵装饰（最外层）', kinds: ['broadleaf', 'conifer', 'palm', 'grass', 'fern'], open: false,
    extra: textureRow('flower', '花朵贴图', '带 Alpha 的 PNG/WebP（建议花朵居中）；大小与分布自动跟随最外层叶面'), fields: [
      { path: 'flowers.enabled', label: '启用花朵', type: 'checkbox', hint: '在当前植物的最外层叶面装饰花朵' },
      { path: 'flowers.style', label: '内置花型', type: 'select', options: [['default', '默认花簇'], ['wildrose', '五瓣白野蔷薇']], hint: '选择内置花朵贴图形态（导入自定义花朵贴图时可覆盖）' },
      r('flowers.count', '花朵数量', 1, 350, 1, '放置在最外层叶面上的花片数量'),
      r('flowers.sizeRatio', '相对叶面大小', .15, 2, .02, '花朵尺寸 = 所在叶片尺寸 × 此比例，自动跟随叶面缩放'),
      r('flowers.sizeVariance', '大小随机', 0, .7, .01),
      r('flowers.outerShell', '最外层阈值', .3, .98, .01, '越高越严格只贴最表层叶面'),
      r('flowers.surfaceOffset', '外浮距离', 0, .8, .01, '沿叶面外法线推出距离，防止被叶片遮挡'),
      r('flowers.upBias', '向阳偏好', -.5, 1, .02, '正值让花朵更集中在受光的顶部与外侧面'),
      r('flowers.clumping', '成簇程度', 0, 1, .02, '0=均匀散开，1=在叶团表面一簇簇盛开'),
      r('flowers.clusterCount', '花簇数量', 1, 24, 1, '成簇分布时的花团中心数量'),
      { path: 'flowers.cardType', label: '花片形态', type: 'select', options: [['quad', '单片（始终朝外，推荐）'], ['cup', '碗形微弯'], ['cross', '十字立体']] },
      r('flowers.faceOutward', '球面法线朝外', 0, 1, .01, '1=完全沿树冠外法线朝外（如球面法线），0=跟随单片叶子朝向'),
      r('flowers.cameraFacing', '朝向相机', 0, 1, .01, '单片/碗形有效，十字自动关闭'),
      { path: 'flowers.tintInner', label: '花心 / 暗部色', type: 'color' },
      { path: 'flowers.tintOuter', label: '花瓣 / 亮部色', type: 'color' },
      r('flowers.tintVariance', '明度随机', 0, .4, .01),
      r('flowers.alphaCutoff', 'Alpha 裁切', .05, .95, .01),
      r('flowers.atlasCols', '图集列数', 1, 6, 1),
      r('flowers.atlasRows', '图集行数', 1, 6, 1),
      r('flowers.seed', '花朵种子', 0, 9999, 1),
    ] },
  { title: '树干', open: true, kinds: ['broadleaf', 'conifer'], fields: [
    r('trunk.height', '全树高度 m', 2.5, 18, .05),
    r('trunk.radius', '树干半径 m', .05, .9, .005),
    r('trunk.taper', '收细指数', .3, 2.5, .01, '越大越快变细'),
    r('trunk.flare', '根部膨大', 0, 1.6, .01, '树根板状隆起强度'),
    r('trunk.flareLobes', '根瓣数量', 0, 9, 1),
    r('trunk.flareHeight', '膨大高度 m', .1, 2.2, .01),
    r('trunk.barkRidges', '树皮棱数', 0, 24, 1, '竖向雕刻感的树皮棱'),
    r('trunk.barkDepth', '树皮棱深', 0, .2, .005),
    r('trunk.wobble', '弯曲扰动 m', 0, .9, .01),
    r('trunk.lean', '整体倾斜 m', 0, 2.2, .01),
    r('trunk.leanAngle', '倾斜方向°', -1, 360, 1, '-1 = 按种子随机；0 = 向右，180 = 向左'),
    r('trunk.gnarl', '苍劲关节折曲', 0, 1, .02, '模拟古树/盆景的非对称生长拐点与木节隆起'),
    r('trunk.surfaceRoots', '贴地露根数', 0, 8, 1, '从根部膨大处沿地面向外攀爬的苍劲露根数量'),
    { path: 'trunk.barkColor', label: '树皮色调', type: 'color', hint: '自定义树干与枝条的树皮基色' },
    r('trunk.forkHeight', { broadleaf: '分叉高度' }, .2, .85, .01, '主干在此高度散开为主枝'),
  ] },
  { title: '树干高质感褶皱 · 雕刻（Sculpted Bark）', kinds: ['broadleaf', 'conifer'], open: false,
    extra: `<div class="opt-presets" role="group" aria-label="树干雕刻风格">
        ${woodSculptStyleIds.map(id => `<button type="button" data-sculpt-style="${id}" title="${woodSculptStyleMeta[id].hint}">${woodSculptStyleMeta[id].label}</button>`).join('')}
      </div>
      <p class="s-note">一套参数通吃「风格化扭纹盘干」与「写实风化绞缠古木」，并自动联动顶部 LOD 档位：高模出全几何雕塑轮廓，游戏/手游档自动减面并用流场法线与沟壑 AO 保持高质感，导出 GLB 完整保留。</p>`,
    fields: [
      r('trunk.sculpt.intensity', '褶皱雕刻强度', 0, 1, .02, '0 = 经典平滑树干；越大树皮筋脉、锐谷深沟与剪影起伏越强烈'),
      r('trunk.sculpt.subdiv', '高模雕刻细分', 1, 3.5, .1, '高模档树干与主枝的几何细分倍率；切换标准游戏/手游 LOD 自动平滑降面'),
      r('trunk.sculpt.twist', '筋脉螺旋扭转', -3, 3, .05, '树皮筋脉沿树干从根部向上盘旋的圈数（正负控制左右旋向）'),
      r('trunk.sculpt.flutes', '主宽脊 / 板根数', 3, 12, 1, '锚定于树干一体展宽的主筋脉与连续板根数（4-6 宽厚手雕感，8+ 紧密老树皮）'),
      r('trunk.sculpt.sharpness', '沟壑锐利度', 0, 1, .02, '沿宽脊边缘雕刻局部深缝的清晰度'),
      r('trunk.sculpt.furrowWarp', '有机裂隙扭曲', 0, 1, .02, '低=简洁流畅的风格化宽脊；高=自然蜿蜒、带局部纵裂的风化枯木'),
      r('trunk.sculpt.bendWrinkles', '弯肘挤压褶皱', 0, 1, .02, '仅在 S 弯内侧曲率峰值处生成的局部短斜向挤压皱纹'),
      r('trunk.sculpt.strands', '独立穿绕木筋段', 0, 6, 1, '风格化推荐 0（纯一体外皮）；风化枯木可选 1-3 段贴合宿主曲面、两端埋入宽脊的穿绕短筋'),
      r('trunk.sculpt.strandThickness', '穿绕木筋粗细', .06, .34, .01, '独立穿绕短筋相对宿主半径的粗细比例'),
      r('trunk.sculpt.strandTwist', '穿绕跨脊偏移', -2.5, 2.5, .05, '独立穿绕短筋顺同向盘绕并横跨主宽脊的偏移幅度'),
      r('trunk.sculpt.strandRelief', '穿绕间隙抬升', 0, 1, .02, '独立穿绕短筋中段离体抬升与上下穿插净距（两端均先埋入宽脊再封端）'),
      r('trunk.sculpt.heightDisplace', '贴图高度置换', 0, 1, .02, '直接读取当前树皮贴图（含节点工坊 Height 通道）真实推拉 3D 树干几何'),
      r('trunk.sculpt.creviceAO', '深沟凹槽阴影', 0, 1, .02, '烘焙进顶点色的深缝暗部遮蔽强度（导出 GLB 直接保留）'),
      r('trunk.sculpt.crestWear', '棱脊风化提亮', 0, 1, .02, '凸起木棱受光面泛白/暖亮磨蚀效果（风化枯木与厚涂高光的关键）'),
      { path: 'trunk.sculpt.uvMode', label: '树皮流动 UV', type: 'select',
        options: [['triplanar', '3D 三平面（无平铺）'], ['flow', '沿扭纹流场 UV（顺弯贴合，推荐）']],
        hint: '「沿扭纹流场 UV」让树皮贴图与程序木纹严格顺着 S 弯和螺旋筋脉流淌，并支持法线贴图导出 GLB' },
      { path: 'trunk.sculpt.weldCollars', label: '一级枝口无缝焊接（单流形）', type: 'checkbox',
        hint: '在主干开孔并以三次 Hermite 过渡环与一级粗枝共享顶点缝合，灰模特写与导出均无接缝；两枝过近时自动回退为法线柔化领口' },
    ] },
  { title: '树干材质 · 程序化贴图', kinds: ['broadleaf', 'conifer', 'palm'], open: false,
    extra: textureRow('bark', '树皮贴图（三平面无平铺）', '支持导入任意 PNG/JPG/WebP 树皮图片；不走常规 UV 平铺，全程采用 3D 三平面随机防重复投影与程序化凹凸法线。默认纯 GPU 3D 程序化树皮。'),
    fields: [
      r('trunk.barkScale', '纹理密度', .25, 4, .05, '3D 程序化树皮 / 导入贴图的三平面空间投影密度（0 ms 实时更新）'),
      r('trunk.barkDetail', '凹凸与肌理强度', 0, 1.5, .02, '程序化法线凹凸起伏与裂纹对比强度'),
      r('trunk.barkTint', '树皮色融合', 0, 1, .02, '自定义树皮贴图按「树皮色调」直接感知换色的混合强度（0=保留原图色+AO，1=完全换为目标色）'),
      r('trunk.barkMoss', '3D 朝上青苔覆盖', 0, 1, .02, '按世界法线朝上度 + 根部湿润低洼 + 树皮沟壑实时生成的 3D 厚涂青苔（底面保留暖木，0 ms GPU 实时更新）'),
      { path: 'trunk.barkMossColor', label: '3D 青苔色调', type: 'color', hint: '3D 世界空间青苔的主色调，Shader 自动生成暖阳橄榄亮面与深林冷苔暗面' },
      r('trunk.barkRootAO', '根部接地阴影', 0, 1, .02, '靠近地面 y=0 处盘根底部的柔和泥土压暗与接地感（0 ms 实时更新）'),
    ] },
  { title: '树冠轮廓', open: true, kinds: ['broadleaf', 'conifer'], extra: '<p class="s-note">在视口里点「编辑树冠」，可以直接拖动控制点改轮廓。</p>' + crownProfileWidgetHtml(), fields: [
    r('crown.base', '树冠起点', .04, .8, .01, '树冠底部占全树高度的比例'),
    r('crown.top', { broadleaf: '树冠顶部' }, .6, 1, .01),
    r('crown.width', '树冠半径 m', .5, 7, .05),
    r('crown.depth', '纵深比例', .5, 1.5, .01),
    r('crown.roundness', { broadleaf: '方圆度' }, 1.3, 6, .05, '2=椭球，越大越方、越平顶'),
    r('crown.topBias', { broadleaf: '重心上移' }, .5, 2.5, .01, '>1 最宽处上移（伞形），<1 下移（钟形）'),
    r('crown.coneShape', { conifer: '锥形曲率' }, .4, 2.5, .01, '1=直锥，<1 饱满，>1 尖瘦'),
    r('crown.irregularity', '不规则度', 0, 1.5, .01),
    r('crown.canopyLift', { broadleaf: '底冠露枝负空间' }, 0, .75, .02, '掏空树冠底部内侧，清晰托出下方暗色分叉主枝'),
    r('crown.padFlatten', { broadleaf: '云片层叠扁平度' }, 0, .85, .02, '把叶团塑造成大中小错落的云片形态并收敛刺出冠外的细梢'),
  ] },
  { title: '枝条', open: true, kinds: ['broadleaf', 'conifer'], fields: [
    r('branches.count', { broadleaf: '主枝数量', conifer: '轮生层数' }, 2, 30, 1),
    r('branches.perWhorl', { conifer: '每层枝数' }, 2, 9, 1),
    r('branches.startHeight', { broadleaf: '主枝起始高度' }, .05, .92, .01, '一级主枝在树干上的最低挂点位置（0=树干底，1=分叉顶）'),
    r('branches.heightSpan', { broadleaf: '主枝分布跨度' }, .05, .95, .01, '一级主枝沿树干向上展开的分布区间'),
    r('branches.azimuthOffset', '枝条水平旋转°', -180, 180, 1, '绕树干整体旋转所有主枝的水平朝向（不改变随机形态）'),
    r('branches.angle', '底部仰角°', -60, 85, 1, '负值向下'),
    r('branches.angleTop', '顶部仰角°', -40, 88, 1),
    r('branches.reach', '伸展到包络', .4, 1.2, .01, '枝梢到达树冠轮廓的比例'),
    r('branches.lengthVariance', '长度随机', 0, .8, .01),
    r('branches.curvature', '弯曲', 0, 1.2, .01),
    r('branches.droop', '重力下垂', 0, 1.2, .01),
    r('branches.tipCurl', { conifer: '梢端上翘' }, 0, 1, .01),
    r('branches.radiusRatio', '粗细比例', .15, .9, .01),
    r('branches.childCount', '子枝数量', 0, 14, 1),
    r('branches.childStart', '子枝起始位置', .05, .85, .01, '二级子枝在主枝上的起始挂点比例（0=枝根，1=枝梢）'),
    r('branches.childAngle', '子枝夹角°', 10, 90, 1),
    r('branches.childLength', '子枝长度', .1, .8, .01),
    r('branches.childDroop', '子枝下垂', 0, 1, .01),
    r('branches.deadCount', '枯枝桩', 0, 12, 1, '树冠下方的裸露短枝'),
    r('branches.tierGradient', { conifer: '层距渐变' }, -.4, 1.5, .05, '正值：下层层距大、上层紧凑；0=均匀'),
    r('branches.offsetX', '枝群位移 X m', -3, 3, .02, '整组枝条与附属叶团沿 X 轴整体平移；单枝位移请用左上角「节点编辑 → 枝干」'),
    r('branches.offsetY', '枝群位移 Y m', -3, 3, .02, '整组枝条与附属叶团沿 Y 轴整体升降'),
    r('branches.offsetZ', '枝群位移 Z m', -3, 3, .02, '整组枝条与附属叶团沿 Z 轴整体平移'),
  ] },
  { title: '针叶', kinds: ['conifer'], open: true,
    extra: textureRow('drape', '垂片贴图', '垂片：贴图上边 = 枝条（左=枝根，右=枝梢），针叶向下垂') + textureRow('needle', '叶形面片贴图', '贴图上边 = 枝根（叶柄在正上方），下边 = 垂下的叶尖；一根枝条一张折叠面片'), fields: [
    { path: 'fronds.mode', label: '针叶方式', type: 'select', options: [['leaf', '叶形面片（每枝一张，推荐）'], ['drape', '垂片（从枝条挂下）'], ['tent', '折叠片（沿枝条）']] },
    r('fronds.cardAspect', '叶形卡宽长比', .12, .9, .01, '叶形卡：宽度 / 长度'),
    r('fronds.overhang', '伸出枝梢', 0, .8, .01, '叶形卡超出枝梢的长度比例'),
    r('fronds.arch', '卡片下弯', -.5, 1.5, .01, '叶形卡沿长度额外下弯'),
    r('fronds.cardCup', '边缘内扣', -.4, .8, .01, '叶形卡横截面两侧下扣（正）或上翘（负）'),
    r('fronds.cardsPerBranch', '每枝卡片数', 1, 3, 1, '同一枝上叠放的卡片层数'),
    r('fronds.drop', '垂片长度 m', .05, 1.6, .01, '垂片模式：针叶从枝条向下垂的深度'),
    r('fronds.drapeTilt', '垂片倾斜°', 0, 70, 1, '垂片偏离竖直的角度（左右交替）'),
    r('fronds.drapeCurl', '下缘外卷', -1, 1.5, .01, '垂片下缘向外卷'),
    r('fronds.drapeChildren', '子枝垂片', 0, 1.2, .01, '0=只在主枝挂片；>0 子枝也挂小垂片'),
    r('fronds.width', '折叠片宽度 m', .05, .9, .01),
    r('fronds.start', '起始位置', 0, .6, .01),
    r('fronds.fold', '中脉折角°', 0, 75, 1, '沿中脉向下折成 V 形（屋脊）'),
    r('fronds.cross', '竖向交叉片', 0, 1, .01, '侧面观察时的体积'),
    r('fronds.childScale', '子枝卡片比例', 0, 1.3, .01, '0=子枝不放卡片'),
    r('fronds.segments', '分段数', 3, 16, 1),
    r('fronds.tuft', '树顶簇', 0, 2, .01),
    r('fronds.twist', '随机扭转°', 0, 80, 1, '子枝针叶绕枝轴随机翻转，侧面更有体积'),
    r('fronds.spherize', '法线球化', 0, 1, .01),
    { path: 'fronds.tintInner', label: '内层色调', type: 'color' },
    { path: 'fronds.tintOuter', label: '外层色调', type: 'color' },
    r('fronds.tintVariance', '明度随机', 0, .5, .01),
    r('fronds.aoStrength', '内部遮蔽', 0, 1, .01),
    r('fronds.alphaCutoff', 'Alpha 裁切', .05, .95, .01),
  ] },
  { title: '棕榈 · 树干与叶冠', kinds: ['palm'], open: true,
    extra: textureRow('palm', '棕榈叶贴图', '带 Alpha 的 PNG/WebP：底边 = 叶柄（接树顶），顶边 = 叶尖，中线为叶轴') +
      '<p class="s-note">「编辑树冠」同样可用：拖控制点调整单侧下垂、风吹偏向或压扁顶部，裸枝区挖空缺口。</p>', fields: [
    r('trunk.height', '全树高度 m', 2, 14, .05),
    r('trunk.radius', '树干半径 m', .1, .6, .005),
    r('trunk.taper', '收细指数', .2, 1.8, .01),
    r('trunk.flare', '根部膨大', 0, 1.2, .01),
    r('palm.bend', '树干弯曲 m', 0, 4.5, .05, '棕榈树干整体外倾弯曲幅度'),
    r('palm.sCurve', 'S 形弯度', 0, 1.6, .02, '0=简洁弧线，>0.5 形成海滩大弯干'),
    r('palm.ringCount', '节环数量', 6, 40, 1, '棕榈树干的横向叶痕节数'),
    r('palm.ringStep', '节环凹凸', 0, .32, .01, '每节树皮的阶梯隆起深度'),
    r('palm.coconuts', '椰果数量', 0, 6, 1, '树冠底部的椰子簇'),
    r('palm.frondCount', '叶片数量', 6, 28, 1, '分三层排布（外层下垂、中层舒展、顶层新芽）'),
    r('palm.frondLength', '叶片长度 m', .8, 4.5, .05),
    r('palm.frondLengthVariance', '长度随机', 0, .5, .01),
    r('palm.frondWidth', '叶片半宽 m', .18, 1.2, .01),
    r('palm.frondPitch', '外层仰角°', 5, 65, 1),
    r('palm.frondArch', '下垂弯度', .2, 2.2, .02, '越大叶片越向四周垂落'),
    r('palm.frondFold', '中脉折角°', 0, 65, 1, '沿叶轴 V 形折叠'),
    r('palm.frondTwist', '随机扭转°', 0, 45, 1),
    r('palm.segments', '叶片分段', 3, 12, 1),
    r('palm.spherize', '法线球化', 0, 1, .01),
    { path: 'palm.tintInner', label: '内层色调', type: 'color' },
    { path: 'palm.tintOuter', label: '叶尖色调', type: 'color' },
    r('palm.tintVariance', '明度随机', 0, .4, .01),
    r('palm.aoStrength', '冠心遮蔽', 0, 1, .01),
    r('palm.alphaCutoff', 'Alpha 裁切', .05, .95, .01),
  ] },
  { title: '花丛模板（带杆 / 纯花）', kinds: ['flowerbed'], open: true,
    extra: textureRow('blossom', '单朵花贴图', '带 Alpha 的 PNG/WebP（单朵花居中）；取消勾选「显示植物杆」即可切换为纯花版本') +
      textureRow('stemLeaf', '茎叶贴图（Alpha）', '带 Alpha 的 PNG/WebP（叶柄朝下），用于带杆模式下的花茎叶片') +
      '<p class="s-note">「编辑树冠」同样可用：拖动控制点改变花丛高低起伏与偏向，裸枝区可挖空花丛缺口。</p>', fields: [
    { path: 'flowerbed.withStems', label: '显示植物杆', type: 'checkbox', hint: '勾选 = 有植物杆与 Alpha 茎叶；取消勾选 = 纯花版本（仅花朵面片，适合撒在草地表面）' },
    { path: 'flowerbed.layout', label: '分布形状', type: 'select', options: [
      ['dome', '球形圆丘（默认）'],
      ['square', '正方形平铺'],
      ['rect', '矩形花带 / 沿路条带'],
      ['ring', '环形花圈（中空）'],
      ['cluster', '自然多簇散落'],
      ['row', '行列花圃（整齐条垄）'],
    ], hint: '控制花丛在地面铺开的整体几何布局，带杆与纯花模式均适用' },
    r('flowerbed.count', '花朵数量', 3, 180, 1, '花丛中生成的单朵花数量'),
    r('flowerbed.spread', '花丛半径 m', .15, 2.5, .02, '整丛花在地面铺开的水平半径'),
    r('flowerbed.height', '花丛高度 m', .12, 1.8, .02, '最高处花朵距地面的高度'),
    r('flowerbed.heightVariance', '高度错落', 0, .75, .01, '花朵之间高矮起伏的随机变化'),
    r('flowerbed.lean', '外倾张开°', 0, 55, 1, '外围花茎向外自然舒展的角度'),
    r('flowerbed.bend', '花茎弯曲', 0, 1.2, .02, '花茎的弧线弯垂程度'),
    r('flowerbed.stemRadius', '花茎粗细 m', .003, .03, .001, '植物杆底部半径（带杆模式生效）'),
    r('flowerbed.stemLeaves', '每根茎叶数', 0, 6, 1, '每根花茎两侧生长的绿色茎叶数量（带杆模式生效）'),
    r('flowerbed.stemLeafSize', '茎叶大小 m', .04, .35, .005, '茎叶长度（带杆模式生效）'),
    r('flowerbed.flowerSize', '单花尺寸 m', .04, .45, .005, '单朵花面片直径'),
    r('flowerbed.flowerSizeVariance', '大小随机', 0, .6, .01),
    r('flowerbed.headTilt', '花头外倾°', 0, 70, 1, '花面相对向上的自然倾斜角'),
    { path: 'flowerbed.cardType', label: '花片形态', type: 'select', options: [['quad', '单片（低面数，推荐）'], ['cup', '微碗形（立体花瓣）'], ['cross', '十字立体']] },
    r('flowerbed.faceOutward', '球面外展度', 0, 1, .01, '控制外圈花面沿半球法线向外展开的程度'),
    { path: 'flowerbed.tintInner', label: '暗部 / 中心色', type: 'color' },
    { path: 'flowerbed.tintOuter', label: '花瓣主色', type: 'color' },
    { path: 'flowerbed.stemTint', label: '植物杆与茎叶色', type: 'color' },
    r('flowerbed.tintVariance', '明度随机', 0, .4, .01),
    r('flowerbed.alphaCutoff', 'Alpha 裁切', .05, .95, .01),
    r('flowerbed.atlasCols', '图集列数', 1, 6, 1),
    r('flowerbed.atlasRows', '图集行数', 1, 6, 1),
  ] },
  { title: '草丛 / 蕨类', kinds: ['grass', 'fern'], open: true,
    extra: '<div data-kinds="grass">' + textureRow('grass', '草叶贴图（仅贴图模式）', '实体建模草叶无需贴图；切到「贴图插片」模式时使用此贴图（底边=根部，顶边=叶尖）') + '</div><div data-kinds="fern">' + textureRow('fern', '蕨叶贴图', '底边 = 叶柄，顶边 = 叶尖，中线为叶轴') + '</div><p class="s-note">「编辑树冠」同样可用：拖控制点让整丛偏向/压低，裸枝区挖空。</p>', fields: [
    { path: 'ground.mode', label: '草叶生成模式', type: 'select', kinds: ['grass'],
      options: [['blade', '实体建模草叶（Blender 同款，推荐）'], ['card', '贴图插片（传统 Alpha 卡）']],
      hint: '实体建模草叶直接生成弯曲、带横截面拱度与尖端收束的真实 3D 网格，无需 Alpha 贴图' },
    r('ground.count', { grass: '草叶数量', fern: '蕨叶数量' }, 1, 200, 1),
    r('ground.length', '叶片高度 m', .1, 4, .01),
    r('ground.lengthVariance', '高度随机', 0, .85, .01),
    r('ground.width', '叶片宽度 m', .02, .8, .005),
    r('ground.widthVariance', { grass: '宽度随机' }, 0, .85, .01),
    r('ground.widthFullness', { grass: '宽度轮廓指数' }, .2, 3, .02, '越小越宽阔饱满（0.65 宽叶），越大越细长收尖（1.15 窄叶）'),
    r('ground.spread', '根部半径 m', 0, 3.5, .01),
    r('ground.radialBias', { grass: '根部散布指数' }, .1, 4, .05, '控制草根向中心聚集或向外缘扩散'),
    r('ground.angleJitter', { grass: '方位扰动°' }, 0, 60, 1, '黄金角放射分布上的随机方位扰动'),
    r('ground.sideSwirl', { grass: '偏转旋向°' }, -90, 90, 1, '让整丛草叶沿切向旋风式偏转'),
    r('ground.lean', '外张角度°', 0, 85, 1),
    r('ground.leanVariance', { grass: '外张随机°' }, 0, 60, 1),
    r('ground.arch', { grass: '叶尖弯曲', fern: '弯垂' }, -.6, 2, .01, '二次方弯曲强度（实体草叶可负值内收、正值外弯）'),
    r('ground.bendVariance', { grass: '弯曲随机' }, 0, 1, .01),
    r('ground.droop', { grass: '叶尖下垂' }, -.5, 1, .01, '三次方重力下垂，让叶尖自然低垂'),
    r('ground.cup', { grass: '横截面拱度' }, -1, 1, .01, '草叶中脉横截面向上/向下拱起的立体弧度'),
    r('ground.twist', '扭转角度°', 0, 180, 1),
    r('ground.across', { grass: '横向分段' }, 1, 6, 1, '实体草叶横截面分段（2 = 带中脊的 3 列网格）'),
    r('ground.planes', { grass: '交叉片数（贴图模式）' }, 1, 3, 1, '贴图插片模式下每根草叶的交叉面片数'),
    r('ground.fold', { fern: '中脉折角°' }, 0, 70, 1),
    r('ground.segments', '纵向分段', 2, 24, 1),
    { path: 'ground.colorTones', label: '三色深浅层次', type: 'checkbox', kinds: ['grass'], hint: '每片草叶随机分配亮/中/暗三档自然色阶（同 Blender 三材质效果）' },
    r('ground.spherize', '法线球化', 0, 1, .01),
    { path: 'ground.tintBase', label: '根部色调', type: 'color' },
    { path: 'ground.tintTip', label: '叶尖色调', type: 'color' },
    r('ground.tintVariance', '明度随机', 0, .5, .01),
    r('ground.aoStrength', '根部遮蔽', 0, 1, .01),
    r('ground.alphaCutoff', 'Alpha 裁切', .05, .95, .01),
  ] },
  ...leafSections.map(([title, keys], i): Section => ({
    title: '叶片 · ' + title, kinds: ['broadleaf'], open: i < 2,
    extra: i === 0 ? textureRow('leaf', '叶片贴图', '带 Alpha 的 PNG/WebP，叶柄朝下') +
      `<label class="s-field"><span>插片方式</span><select data-path="leaves.cardType">${cardTypes.map(t => `<option value="${t}">${cardTypeLabels[t]}</option>`).join('')}</select><i></i></label>` +
      `<label class="s-field"><span>法线来源</span><select data-path="leaves.normalSource">${normalSources.map(s =>
        `<option value="${s}">${s === 'clumps' ? '树冠簇（分团）' : '整体树冠'}</option>`).join('')}</select><i></i></label>` +
      `<label class="s-field"><span>内层色调</span><input type="color" data-path="leaves.tintInner"><i></i></label>` +
      `<label class="s-field"><span>外层色调</span><input type="color" data-path="leaves.tintOuter"><i></i></label>` : '',
    fields: keys.map(key => ({ path: 'leaves.' + key, label: leafFieldMeta[key].label, hint: leafFieldMeta[key].hint,
      min: leafRules[key][0], max: key === 'leafSeed' ? 9999 : leafRules[key][1], step: leafRules[key][2] })),
  })),
]

function textureRow(id: string, title: string, note: string) {
  return `<div class="s-texture"><canvas id="${id}-thumb" width="52" height="52"></canvas><div>
    <b>${title}</b><output id="${id}-name"></output>
    <div class="s-texture-buttons"><input id="${id}-file" type="file" accept="image/png,image/webp,image/jpeg" hidden>
    <button type="button" id="${id}-load">载入贴图</button><button type="button" id="${id}-edit" class="s-tex-edit-btn" title="打开 Substance 风格贴图节点编辑器">◈ 节点编辑</button><button type="button" id="${id}-lib" class="s-tex-lib-btn" title="从实时贴图库挑选或悬停预览">🎨 贴图库</button><button type="button" id="${id}-default">默认</button></div></div></div>
    <p class="s-note">${note}</p>`
}

const labelFor = (field: Field, kind: TreeKind) => typeof field.label === 'string' ? field.label : field.label[kind]
const kindsOf = (field: Field) => field.kinds ?? (typeof field.label === 'string' ? undefined : Object.keys(field.label) as TreeKind[])

export function panelHtml() {
  return sections.map(section => `<details class="s-section" ${section.open ? 'open' : ''} ${section.kinds ? `data-kinds="${section.kinds}"` : ''}>
    <summary>${section.title}</summary>${section.extra ?? ''}${section.fields.map(field => {
      const kinds = kindsOf(field)
      const attrs = `data-path="${field.path}" ${kinds ? `data-kinds="${kinds}"` : ''}`
      if (field.type === 'select') return `<label class="s-field" ${attrs} title="${field.hint ?? ''}"><span></span><select data-path="${field.path}">${(field.options ?? []).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><i></i></label>`
      if (field.type === 'checkbox') return `<label class="s-field s-check" ${attrs} title="${field.hint ?? ''}"><span></span><input type="checkbox" data-path="${field.path}"><i></i></label>`
      if (field.type === 'color') return `<label class="s-field" ${attrs} title="${field.hint ?? ''}"><span></span><input type="color" data-path="${field.path}"><i></i></label>`
      return `<label class="s-field" ${attrs} title="${field.hint ?? ''}"><span></span>
        <input type="range" data-path="${field.path}" min="${field.min}" max="${field.max}" step="${field.step}">
        <input type="number" data-path="${field.path}" data-number min="${field.min}" max="${field.max}" step="${field.step}"></label>`
    }).join('')}</details>`).join('')
}

export function getPath(spec: TreeSpec, path: string): unknown {
  const parts = path.split('.')
  if (parts[0] === 'accents' && !spec.accents) {
    return (defaultAccents as unknown as Record<string, unknown>)[parts[1]]
  }
  if (parts[0] === 'normalEdit' && !spec.normalEdit) {
    return (defaultLeafNormalEdit() as unknown as Record<string, unknown>)[parts[1]]
  }
  if (parts[0] === 'trunk' && parts[1] === 'sculpt') {
    const sc = spec.trunk.sculpt ?? defaultTrunkSculpt()
    return parts.length === 2 ? sc : (sc as unknown as Record<string, unknown>)[parts[2]]
  }
  return parts.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], spec)
}
export function setPath(spec: TreeSpec, path: string, value: unknown): TreeSpec {
  const parts = path.split('.')
  if (parts[0] === 'trunk' && parts[1] === 'sculpt') {
    const nextSculpt = parts.length === 2
      ? { ...defaultTrunkSculpt(), ...(value as Partial<TrunkSculptSpec>) }
      : { ...defaultTrunkSculpt(), ...(spec.trunk.sculpt ?? {}), [parts[2]]: value }
    return { ...spec, trunk: { ...spec.trunk, sculpt: nextSculpt } }
  }
  const [group, key] = parts as [keyof TreeSpec, string]
  const base = group === 'accents'
    ? { ...defaultAccents, ...(spec.accents ?? {}) }
    : group === 'normalEdit'
      ? { ...defaultLeafNormalEdit(), ...(spec.normalEdit ?? {}) }
      : (spec[group] as object)
  return { ...spec, [group]: { ...base, [key]: value } }
}

export function bindPanel(root: HTMLElement, get: () => TreeSpec, set: (path: string, value: unknown, final: boolean) => void) {
  const fieldByPath = new Map(sections.flatMap(s => s.fields).map(f => [f.path, f]))
  const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]:is(input, select)')]
  const peersByPath = new Map<string, (HTMLInputElement | HTMLSelectElement)[]>()
  for (const input of inputs) {
    const p = input.dataset.path!
    const list = peersByPath.get(p) ?? []
    list.push(input)
    peersByPath.set(p, list)
  }
  for (const input of inputs) {
    const path = input.dataset.path!
    const emit = (final: boolean) => {
      if (input instanceof HTMLSelectElement || input.type === 'color') {
        set(path, input.value, final)
        return
      }
      if (input.type === 'checkbox') {
        set(path, input.checked, true)
        return
      }
      const field = fieldByPath.get(path)
      let v = (input as HTMLInputElement).valueAsNumber
      if (!Number.isFinite(v)) return
      if (field?.min !== undefined) v = Math.min(field.max!, Math.max(field.min, v))
      if (field?.step === 1) v = Math.round(v)
      for (const peer of peersByPath.get(path) ?? []) {
        if (peer !== input && document.activeElement !== peer) peer.value = String(v)
      }
      set(path, v, final)
      if (path.startsWith('crown.')) syncCrownCurve(get())
    }
    if (input instanceof HTMLSelectElement || (input instanceof HTMLInputElement && (input.dataset.number !== undefined || input.type === 'checkbox'))) {
      input.onchange = () => emit(true)
    } else {
      input.oninput = () => emit(false)
      input.onchange = () => emit(true)
    }
  }
  const sculptStyleBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-sculpt-style]')]
  for (const btn of sculptStyleBtns) {
    btn.onclick = () => {
      const id = btn.dataset.sculptStyle as WoodSculptStyleId
      const preset = woodSculptStyleMeta[id]
      if (!preset) return
      set('trunk.sculpt', { ...preset.spec }, true)
    }
  }

  // Interactive CrownEnvelope vertical profile curve editor (preset chips + draggable SVG control points)
  const curveSvg = root.querySelector<SVGSVGElement>('#crown-curve-svg')
  const curveFill = root.querySelector<SVGPathElement>('#crown-curve-fill')
  const curveLine = root.querySelector<SVGPathElement>('#crown-curve-line')
  const curveDots = [...root.querySelectorAll<SVGCircleElement>('[data-curve-idx]')]
  const curveChips = [...root.querySelectorAll<HTMLButtonElement>('[data-crown-curve]')]
  const readCurvePoints = (spec: TreeSpec): [number, number][] =>
    CROWN_PROFILE_US.map(u => [u, Number(evalProfileCurve(spec.crown.profileCurve, u).toFixed(3))] as [number, number])
  const scaleToSvgX = (scale: number) => 90 + Math.min(78, Math.max(8, scale * 44))
  const svgXToScale = (sx: number) => Math.min(1.75, Math.max(0.20, Math.abs(sx - 90) / 44))
  const uToSvgY = (u: number) => 102 - u * 90

  for (const chip of curveChips) {
    chip.onclick = () => {
      const p = crownProfilePresets.find(x => x.id === chip.dataset.crownCurve)
      if (!p) return
      set('crown.profileCurve', p.points ? p.points.map(pt => [...pt] as [number, number]) : undefined, true)
      syncCrownCurve(get())
    }
  }

  if (curveSvg) {
    let activeDragIdx = -1
    let dragPoints: [number, number][] | undefined
    const clientToSvg = (e: PointerEvent) => {
      const rect = curveSvg.getBoundingClientRect()
      return {
        x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * 180,
        y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * 112,
      }
    }
    curveSvg.addEventListener('pointerdown', e => {
      const pt = clientToSvg(e)
      const target = e.target as Element | null
      const idxAttr = target?.getAttribute('data-curve-idx')
      let idx = idxAttr !== null && idxAttr !== undefined ? Number(idxAttr) : -1
      if (idx < 0) {
        let best = 0, bestD = Infinity
        for (let i = 0; i < CROWN_PROFILE_US.length; i++) {
          const d = Math.abs(pt.y - uToSvgY(CROWN_PROFILE_US[i]))
          if (d < bestD) { bestD = d; best = i }
        }
        idx = best
      }
      activeDragIdx = idx
      dragPoints = readCurvePoints(get())
      dragPoints[idx] = [CROWN_PROFILE_US[idx], Number(svgXToScale(pt.x).toFixed(3))]
      curveSvg.setPointerCapture(e.pointerId)
      set('crown.profileCurve', dragPoints.map(p => [...p] as [number, number]), false)
      syncCrownCurve(get())
    })
    curveSvg.addEventListener('pointermove', e => {
      if (activeDragIdx < 0 || !dragPoints) return
      const pt = clientToSvg(e)
      dragPoints[activeDragIdx] = [CROWN_PROFILE_US[activeDragIdx], Number(svgXToScale(pt.x).toFixed(3))]
      set('crown.profileCurve', dragPoints.map(p => [...p] as [number, number]), false)
      syncCrownCurve(get())
    })
    const finishDrag = (e: PointerEvent) => {
      if (activeDragIdx < 0 || !dragPoints) return
      const finalPts = dragPoints.map(p => [...p] as [number, number])
      activeDragIdx = -1
      dragPoints = undefined
      if (curveSvg.hasPointerCapture(e.pointerId)) curveSvg.releasePointerCapture(e.pointerId)
      set('crown.profileCurve', finalPts, true)
      syncCrownCurve(get())
    }
    curveSvg.addEventListener('pointerup', finishDrag)
    curveSvg.addEventListener('pointercancel', finishDrag)
  }

  const syncCrownCurve = (spec: TreeSpec) => {
    if (!curveFill || !curveLine) return
    const env = new CrownEnvelope(spec)
    const steps = 28
    const rightPts: [number, number][] = []
    const leftPts: [number, number][] = []
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      const rNorm = Math.min(1.8, Math.max(0, env.profile(u)))
      const y = uToSvgY(u)
      const dx = rNorm * 44
      rightPts.push([90 + dx, y])
      leftPts.push([90 - dx, y])
    }
    const rPath = rightPts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    const lPath = [...leftPts].reverse().map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    curveFill.setAttribute('d', `${rPath} ${lPath} Z`)

    // Draw editable multiplier curve stroke on the right side
    const multPts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      const s = evalProfileCurve(spec.crown.profileCurve, u)
      multPts.push(`${i === 0 ? 'M' : 'L'} ${scaleToSvgX(s).toFixed(1)} ${uToSvgY(u).toFixed(1)}`)
    }
    curveLine.setAttribute('d', multPts.join(' '))

    const curPts = readCurvePoints(spec)
    for (let i = 0; i < curveDots.length; i++) {
      const [u, s] = curPts[i]
      curveDots[i].setAttribute('cx', scaleToSvgX(s).toFixed(1))
      curveDots[i].setAttribute('cy', uToSvgY(u).toFixed(1))
    }

    const activeCurve = spec.crown.profileCurve
    for (const chip of curveChips) {
      const p = crownProfilePresets.find(x => x.id === chip.dataset.crownCurve)
      let match = false
      if (p?.id === 'default') {
        match = !activeCurve || curPts.every(([, s]) => Math.abs(s - 1) < 0.04)
      } else if (p?.points && activeCurve) {
        match = p.points.every(([u, s]) => Math.abs(evalProfileCurve(activeCurve, u) - s) < 0.08)
      }
      chip.setAttribute('aria-pressed', String(match))
    }
  }

  const sync = () => {
    const spec = get()
    for (const el of root.querySelectorAll<HTMLElement>('[data-kinds]')) el.hidden = !el.dataset.kinds!.split(',').includes(spec.kind)
    for (const label of root.querySelectorAll<HTMLElement>('label.s-field[data-path]')) {
      const field = fieldByPath.get(label.dataset.path!)
      if (field) label.querySelector('span')!.textContent = labelFor(field, spec.kind) ?? ''
    }
    for (const input of inputs) {
      if (document.activeElement === input && input.type === 'number') continue
      const val = getPath(spec, input.dataset.path!)
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(val)
      else input.value = String(val)
    }
    syncCrownCurve(spec)
    const sc = spec.trunk.sculpt ?? defaultTrunkSculpt()
    const scActive = isWoodSculptActive(sc)
    for (const btn of sculptStyleBtns) {
      const id = btn.dataset.sculptStyle as WoodSculptStyleId
      let match = false
      if (id === 'off') {
        match = !scActive
      } else if (scActive) {
        const ps = woodSculptStyleMeta[id].spec
        match = Math.abs(sc.intensity - ps.intensity) < 0.08
          && Math.abs(sc.furrowWarp - ps.furrowWarp) < 0.10
          && Math.abs(sc.strands - ps.strands) <= 1
      }
      btn.setAttribute('aria-pressed', String(match))
    }
  }
  sync()
  return { sync }
}
