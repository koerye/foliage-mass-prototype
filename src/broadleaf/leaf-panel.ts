// Leaf card inspector panel: SpeedTree-style distribution controls.
import { leafRules, normalSources, type LeafParams } from './leaves'

type LeafNumeric = keyof typeof leafRules
interface FieldMeta { label: string; hint: string }

export const leafFieldMeta: Record<LeafNumeric, FieldMeta> = {
  twigFrequency: { label: '细枝频率 /m', hint: '每米枝条长出的细枝数量（SpeedTree Frequency）' },
  twigStart: { label: '细枝起点', hint: '细枝在父枝上的起始位置，0=枝根 1=枝梢' },
  twigEnd: { label: '细枝终点', hint: '细枝在父枝上的结束位置' },
  twigLength: { label: '细枝长度 m', hint: '细枝基础长度' },
  twigLengthVariance: { label: '长度随机', hint: '细枝长度随机幅度' },
  twigTaper: { label: '梢部缩短', hint: '越靠近父枝梢部，细枝越短' },
  twigAngle: { label: '细枝夹角°', hint: '细枝与父枝的分叉角' },
  twigUpBias: { label: '向光上扬', hint: '正值向上生长，负值向下' },
  twigGravity: { label: '重力下垂', hint: '负值细枝末端下垂，正值上翘' },
  leavesPerTwig: { label: '每细枝叶片', hint: '每根细枝上的叶片卡数量' },
  leafStart: { label: '叶片起点', hint: '叶片在细枝上的起始位置' },
  tipLeaves: { label: '梢端叶片', hint: '每根细枝末端额外的顶叶数量' },
  limbLeafFrequency: { label: '枝上叶频率 /m', hint: '直接长在主枝/次枝上的叶片频率，用于填补枝间空洞' },
  leafSize: { label: '叶片尺寸 m', hint: '叶片卡高度（世界单位）' },
  leafSizeVariance: { label: '尺寸随机', hint: '叶片尺寸随机幅度' },
  leafTipScale: { label: '梢端缩放', hint: '载体末端叶片相对根部的尺寸比例' },
  leafAspect: { label: '宽高比', hint: '叶片卡宽度 / 高度，与贴图比例一致即可' },
  leafPivot: { label: '枝点位置', hint: '贴图中叶柄所在高度：0=贴图底边，0.5=中心' },
  leafAngle: { label: '叶片夹角°', hint: '叶片相对载体轴向的张开角' },
  leafOffset: { label: '外推距离', hint: '沿树冠外法线推移叶片，正值让冠面更饱满' },
  leafJitter: { label: '位置抖动', hint: '叶片锚点随机偏移' },
  faceOutward: { label: '朝外对齐', hint: '叶片法线向树冠外侧对齐的强度（SpeedTree Face Out）' },
  upAlign: { label: '朝上对齐', hint: '叶片法线向世界上方对齐的强度' },
  randomRoll: { label: '随机自旋°', hint: '叶片绕自身法线的随机旋转' },
  randomTilt: { label: '随机倾斜°', hint: '叶片法线的随机偏摆' },
  leafFold: { label: '中脉折叠', hint: '叶片沿中线 V 形折叠' },
  leafCurl: { label: '纵向卷曲', hint: '叶片沿长度方向弯曲' },
  pruneOuter: { label: '外包络裁剪', hint: '超出树冠包络倍数的叶片被裁掉（越小越圆整）' },
  pruneInner: { label: '内部剔除', hint: '剔除树冠深处看不见的叶片，节省面数' },
  normalSpherize: { label: '法线球化', hint: '叶片法线向树冠/簇法线混合，0=真实卡片法线 1=完全体积法线（风格化关键）' },
  clumpScale: { label: '簇法线半径', hint: '簇法线场的影响半径，越大越整体' },
  tintVariance: { label: '明度随机', hint: '每片叶子的明度随机' },
  aoStrength: { label: '内部遮蔽', hint: '树冠内部与底部压暗强度' },
  alphaCutoff: { label: 'Alpha 裁切', hint: '贴图透明裁切阈值' },
  atlasCols: { label: '图集列数', hint: '贴图图集的列数，每张卡随机取一格' },
  atlasRows: { label: '图集行数', hint: '贴图图集的行数' },
  leafSeed: { label: '叶片种子', hint: '只改变叶片分布的随机种子' },
  fanCount: { label: '扇形片数', hint: '插片方式为「扇形簇」时，每个锚点的叶片卡数量' },
  fanSpread: { label: '扇形张角°', hint: '扇形簇的展开角度' },
  clumpFill: { label: '簇面填充 /m²', hint: '在树冠簇表面额外铺叶片，保证冠面饱满无洞（类似 SpeedTree 网格约束叶）' },
  clumpFillScale: { label: '簇体膨胀', hint: '填充用树冠簇的放大倍数，越大团块越圆润、越连成一体' },
  clumpFillDepth: { label: '填充厚度', hint: '填充叶片向簇内部随机下沉的深度，0=只铺表面' },
  cameraFacing: { label: '朝向相机', hint: '叶片卡向相机旋转的程度（SpeedTree Facing Leaves），消除侧面看到的薄片；十字/三向插片时自动关闭；导出 GLB 时为几何朝向' },
}

export const leafSections: [string, LeafNumeric[]][] = [
  ['细枝生成', ['twigFrequency', 'twigStart', 'twigEnd', 'twigLength', 'twigLengthVariance', 'twigTaper', 'twigAngle', 'twigUpBias', 'twigGravity']],
  ['叶片分布', ['leavesPerTwig', 'leafStart', 'tipLeaves', 'limbLeafFrequency', 'leafJitter', 'leafOffset', 'leafSeed']],
  ['叶片尺寸与形状', ['leafSize', 'leafSizeVariance', 'leafTipScale', 'leafAspect', 'leafPivot', 'leafFold', 'leafCurl', 'fanCount', 'fanSpread']],
  ['叶片朝向', ['leafAngle', 'faceOutward', 'upAlign', 'randomRoll', 'randomTilt', 'cameraFacing']],
  ['树冠簇填充', ['clumpFill', 'clumpFillScale', 'clumpFillDepth']],
  ['树冠包络与法线', ['pruneOuter', 'pruneInner', 'normalSpherize', 'clumpScale']],
  ['颜色与贴图', ['tintVariance', 'aoStrength', 'alphaCutoff', 'atlasCols', 'atlasRows']],
]

const sliderMax: Partial<Record<LeafNumeric, number>> = { leafSeed: 9999 }

function row(key: LeafNumeric) {
  const [min, rawMax, step] = leafRules[key]
  const max = sliderMax[key] ?? rawMax
  const meta = leafFieldMeta[key]
  return `<label class="l-field" title="${meta.hint}"><span>${meta.label}</span>
    <input type="range" data-leaf="${key}" min="${min}" max="${max}" step="${step}">
    <input type="number" data-leaf-number="${key}" min="${min}" max="${rawMax}" step="${step}"></label>`
}

export function leafPanelHtml() {
  return `<section class="l-panel" id="leaf-panel">
  <h3>叶片系统 <small>SpeedTree 式卡片分布</small></h3>
  <label class="b-field"><span>叶片模式</span><select id="leaf-mode">
    <option value="cards">卡片分布（贴图）</option><option value="sheets">旧版薄片（对照）</option></select></label>
  <div id="leaf-card-controls">
  <div class="l-texture">
    <canvas id="leaf-thumb" width="56" height="56" aria-label="叶片贴图预览"></canvas>
    <div><output id="leaf-texture-name">默认程序贴图</output>
      <div class="l-texture-buttons"><input id="leaf-file" type="file" accept="image/png,image/webp,image/jpeg,image/tga" hidden>
      <button type="button" id="leaf-load">载入贴图</button><button type="button" id="leaf-default">默认贴图</button></div></div>
  </div>
  <p class="l-note">贴图要求：带 Alpha 的 PNG/WebP，叶柄朝下。底边对应「枝点位置」=0。</p>
  <label class="b-field"><span>法线来源</span><select id="leaf-normal-source">
    ${normalSources.map(s => `<option value="${s}">${s === 'clumps' ? '树冠簇（分团感）' : '整体树冠（球形）'}</option>`).join('')}</select></label>
  <label class="b-field"><span>内层色调</span><input type="color" id="leaf-tint-inner"></label>
  <label class="b-field"><span>外层色调</span><input type="color" id="leaf-tint-outer"></label>
  ${leafSections.map(([title, keys], i) => `<details ${i < 2 ? 'open' : ''}><summary>${title}</summary>${keys.map(row).join('')}</details>`).join('')}
  <div class="l-actions"><button type="button" id="leaf-reset">重置叶片参数</button></div>
  </div>
</section>`
}

export function bindLeafPanel(root: HTMLElement, get: () => LeafParams, onChange: (next: LeafParams) => void) {
  const ranges = [...root.querySelectorAll<HTMLInputElement>('[data-leaf]')]
  const numbers = [...root.querySelectorAll<HTMLInputElement>('[data-leaf-number]')]
  const source = root.querySelector<HTMLSelectElement>('#leaf-normal-source')!
  const inner = root.querySelector<HTMLInputElement>('#leaf-tint-inner')!
  const outer = root.querySelector<HTMLInputElement>('#leaf-tint-outer')!
  const sync = () => {
    const p = get()
    for (const input of ranges) input.value = String(p[input.dataset.leaf as LeafNumeric])
    for (const input of numbers) input.value = String(p[input.dataset.leafNumber as LeafNumeric])
    source.value = p.normalSource
    inner.value = p.tintInner
    outer.value = p.tintOuter
  }
  const commit = (key: LeafNumeric, value: number) => {
    const [min, max, step] = leafRules[key]
    if (!Number.isFinite(value)) return
    let v = Math.min(max, Math.max(min, value))
    if (step === 1) v = Math.round(v)
    const next = { ...get(), [key]: v }
    if (key === 'twigStart' && next.twigEnd < v) next.twigEnd = v
    if (key === 'twigEnd' && next.twigStart > v) next.twigStart = v
    onChange(next)
    sync()
  }
  for (const input of ranges) input.oninput = () => commit(input.dataset.leaf as LeafNumeric, input.valueAsNumber)
  for (const input of numbers) input.onchange = () => commit(input.dataset.leafNumber as LeafNumeric, input.valueAsNumber)
  source.onchange = () => onChange({ ...get(), normalSource: source.value as LeafParams['normalSource'] })
  inner.oninput = () => onChange({ ...get(), tintInner: inner.value })
  outer.oninput = () => onChange({ ...get(), tintOuter: outer.value })
  sync()
  return { sync }
}
