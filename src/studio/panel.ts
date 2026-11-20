// Schema-driven inspector: sliders + numeric inputs bound to dotted spec paths.
import { leafFieldMeta, leafSections } from '../broadleaf/leaf-panel'
import { cardTypeLabels, cardTypes, leafRules, normalSources } from '../broadleaf/leaves'
import { lodPresets } from '../tree/optimize'
import type { TreeKind, TreeSpec } from '../tree/spec'

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
        options: [['default', '默认阔叶簇'], ['cloud', '厚涂圆云叶（吉卜力）'], ['bush', '翠绿尖叶灌木簇'], ['sakura', '樱花柔瓣簇（缺口5瓣）'], ['maple', '枫叶五角簇'], ['willow', '垂柳细长丝'], ['flower', '通用花簇']],
        hint: '无需上传贴图即可切换内置风格化叶型；载入自定义贴图时自动切回默认槽位' },
      r('shading.translucency', '次表面透光 SSS', 0, 1, .02, '阳光穿透薄叶与花瓣的通透背光感'),
      r('shading.rimLight', '边缘轮廓光', 0, 1, .02, '受光边缘的柔和透亮轮廓，增强云团层次'),
      r('shading.shadowShift', '暗部色相偏移', 0, 1, .02, '让暗部偏冷青/柔紫而不是发灰发黑'),
      r('shading.topWarmth', '三段受光暖色', 0, 1, .02, '冠顶暖阳 → 中段正色 → 底面清冷的自然色阶'),
      { path: 'shading.softSelfShadow', label: '柔化叶卡自阴影', type: 'checkbox', hint: '开启后叶面仍向树干与地面投射阴影，但消除交叉卡片间生硬的黑色三角噪点' },
      r('shading.petals', '氛围飘落花瓣', 0, 60, 1, '在树冠轮廓外侧点缀轻盈飘落的花瓣/叶屑（0 = 关闭）'),
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
  { title: '树干材质 · 程序化贴图', kinds: ['broadleaf', 'conifer', 'palm'], open: false,
    extra: textureRow('bark', '树皮贴图（三平面无平铺）', '支持导入任意 PNG/JPG/WebP 树皮图片；不走常规 UV 平铺，全程采用 3D 三平面随机防重复投影与程序化凹凸法线。默认纯 GPU 3D 程序化树皮。'),
    fields: [
      r('trunk.barkScale', '纹理密度', .25, 4, .05, '3D 程序化树皮 / 导入贴图的三平面空间投影密度（0 ms 实时更新）'),
      r('trunk.barkDetail', '凹凸与肌理强度', 0, 1.5, .02, '程序化法线凹凸起伏与裂纹对比强度'),
      r('trunk.barkTint', '树皮色融合', 0, 1, .02, '导入自定义树皮贴图时与「树皮色调」的融合比例（0=保留原图色+AO）'),
    ] },
  { title: '树冠轮廓', open: true, kinds: ['broadleaf', 'conifer'], extra: '<p class="s-note">在视口里点「编辑树冠」，可以直接拖动控制点改轮廓。</p>', fields: [
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
    r('branches.angle', '底部仰角°', -60, 85, 1, '负值向下'),
    r('branches.angleTop', '顶部仰角°', -40, 88, 1),
    r('branches.reach', '伸展到包络', .4, 1.2, .01, '枝梢到达树冠轮廓的比例'),
    r('branches.lengthVariance', '长度随机', 0, .8, .01),
    r('branches.curvature', '弯曲', 0, 1.2, .01),
    r('branches.droop', '重力下垂', 0, 1.2, .01),
    r('branches.tipCurl', { conifer: '梢端上翘' }, 0, 1, .01),
    r('branches.radiusRatio', '粗细比例', .15, .9, .01),
    r('branches.childCount', '子枝数量', 0, 14, 1),
    r('branches.childAngle', '子枝夹角°', 10, 90, 1),
    r('branches.childLength', '子枝长度', .1, .8, .01),
    r('branches.childDroop', '子枝下垂', 0, 1, .01),
    r('branches.deadCount', '枯枝桩', 0, 12, 1, '树冠下方的裸露短枝'),
    r('branches.tierGradient', { conifer: '层距渐变' }, -.4, 1.5, .05, '正值：下层层距大、上层紧凑；0=均匀'),
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
    extra: textureRow('blossom', '单朵花贴图', '带 Alpha 的 PNG/WebP（单朵花居中）；取消勾选「显示植物杆与茎叶」即可切换为纯花版本') +
      '<p class="s-note">「编辑树冠」同样可用：拖动控制点改变花丛高低起伏与偏向，裸枝区可挖空花丛缺口。</p>', fields: [
    { path: 'flowerbed.withStems', label: '显示植物杆', type: 'checkbox', hint: '勾选 = 有植物杆与绿色茎叶；取消勾选 = 纯花版本（仅花朵面片，适合撒在草地表面）' },
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
    <button type="button" id="${id}-load">载入贴图</button><button type="button" id="${id}-default">默认</button></div></div></div>
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
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], spec)
}
export function setPath(spec: TreeSpec, path: string, value: unknown): TreeSpec {
  const [group, key] = path.split('.') as [keyof TreeSpec, string]
  return { ...spec, [group]: { ...(spec[group] as object), [key]: value } }
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
    }
    if (input instanceof HTMLSelectElement || (input instanceof HTMLInputElement && (input.dataset.number !== undefined || input.type === 'checkbox'))) {
      input.onchange = () => emit(true)
    } else {
      input.oninput = () => emit(false)
      input.onchange = () => emit(true)
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
  }
  sync()
  return { sync }
}
