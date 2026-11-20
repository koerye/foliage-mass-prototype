import '../style.css'
import './studio.css'
import { Viewer, type Camera } from '../viewport'
import { pineProfiles, showPine, type PineProfile } from '../pine-preview'
import { assembleBroadleaf, views, type LeafMode, type LeafSetup, type View } from './asset'
import { crownShapes, defaults, parseBroadleafConfig, rules, seeds, speciesList, type BroadleafTreeConfig, type Species } from './config'
import { loadLeafTexture, makePlaceholderLeafTexture } from './leaf-material'
import { bindLeafPanel, leafPanelHtml } from './leaf-panel'
import { defaultLeafParams, parseLeafParams, type LeafParams } from './leaves'
import type { Texture } from 'three'

const cameras: Record<Camera, string> = { front: '正面', angle: '45°', side: '侧面', top: '斜俯视' }
const viewLabel: Record<View, string> = { final: '成品', skeleton: '枝干骨架', crown: '大型树冠' }
const speciesLabel: Record<Species, string> = { round: '圆冠阔叶树', open: '自然分枝阔叶树' }
const pineLabel: Record<PineProfile, string> = { standard: '标准型', dense: '茂密型', ancient: '古老型' }
const pinePreset = (profile: PineProfile) => `pine-${profile}` as const
const pineProfile = (preset: string | null) => pineProfiles.find(profile => pinePreset(profile) === preset)
const shapeLabel = { round: '圆冠', wide: '宽冠', irregular: '不规则' } as const
type Field = Exclude<keyof typeof rules, 'seed'>
const labels: Record<Field, string> = {
  treeHeight: '全树高度', trunkHeight: '分叉起始高度', trunkRadius: '树干半径', trunkCurvature: '树干弯曲',
  primaryBranchCount: '主枝数量', primaryBranchAngle: '主枝外展角', branchSpread: '分枝伸展', branchCurvature: '分枝弯曲',
  crownWidth: '树冠宽度', crownHeight: '树冠高度', crownDepth: '树冠纵深', crownClusterCount: '树冠簇数量',
  crownClusterSize: '树冠簇大小', crownIrregularity: '树冠不规则度', foliageDensity: '叶束密度', foliageScale: '叶束尺寸',
}
const sections: [string, Field[]][] = [
  ['树干与分枝', ['treeHeight', 'trunkHeight', 'trunkRadius', 'trunkCurvature', 'primaryBranchCount', 'primaryBranchAngle', 'branchSpread', 'branchCurvature']],
  ['树冠与叶束', ['crownWidth', 'crownHeight', 'crownDepth', 'crownClusterCount', 'crownClusterSize', 'crownIrregularity', 'foliageDensity', 'foliageScale']],
]
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const number = new Intl.NumberFormat('zh-CN')
const numericField = (key: Field) => {
  const [min, max, step] = rules[key]
  return `<label class="b-field"><span>${labels[key]}</span><input type="number" name="${key}" min="${min}" max="${max}" step="${step === 1 ? 1 : 'any'}" required></label>`
}
byId('app').classList.add('b-studio')
byId('app').innerHTML = `
<header class="bar">
  <div class="brand"><span class="mark" aria-hidden="true">♧</span><div><h1>Vegetation Studio</h1><span>风格化树木工作台</span></div></div>
  <nav aria-label="项目操作">
    <a class="b-link" href="./">旧版体块原型</a>
    <input id="file" type="file" accept=".json,application/json" hidden>
    <button id="import">导入 JSON</button><button id="json">保存 JSON</button>
    <button id="png">截图 PNG</button><button id="glb" class="primary">导出 GLB</button>
  </nav>
</header>
<section class="workspace">
  <section class="viewport panel" aria-label="三维工作区">
    <header class="viewport-head"><h2 id="tree-title">树冠预览</h2><div class="switcher" role="group" aria-label="显示模式">
      ${views.map(view => `<button data-view="${view}" aria-pressed="${view === 'final'}">${viewLabel[view]}</button>`).join('')}
    </div></header>
    <div class="stage"><div id="canvas"></div>
      <div class="camera-tools switcher" role="group" aria-label="固定机位">
        ${Object.entries(cameras).map(([key, label]) => `<button data-camera="${key}" aria-pressed="${key === 'angle'}">${label}</button>`).join('')}
      </div><div class="gesture">拖动旋转 · 滚轮缩放 · 右键平移</div>
      <div class="error" id="webgl" hidden>预览需要支持 WebGL 2 的浏览器。</div>
    </div>
    <div class="stats b-stats">
      ${Object.entries({branches:'枝条',twigs:'细枝',leaves:'叶片卡',triangles:'三角面',calls:'预览 Draw Calls'}).map(([key, label]) =>
        `<div><span id="label-${key}">${label}</span><output id="stat-${key}">—</output></div>`).join('')}
    </div>
  </section>
  <form class="inspector panel b-inspector" id="form" aria-label="树形参数">
    <header class="inspect-head"><h2>树形参数</h2><button id="reset" type="button">恢复预设</button></header>
    <div class="ranges b-ranges">
      <label class="b-field"><span>树型预设</span><select name="species">
        <optgroup label="松树 · B 薄片">${pineProfiles.map(profile => `<option value="${pinePreset(profile)}">松树 · ${pineLabel[profile]}</option>`).join('')}</optgroup>
        <optgroup label="阔叶树">${speciesList.map(species => `<option value="${species}">${speciesLabel[species]}</option>`).join('')}</optgroup>
      </select></label>
      <fieldset id="broadleaf-fields" class="b-fields">
      <label class="b-field"><span>Seed 样例</span><select name="example" aria-label="Seed 样例"></select></label>
      <label class="b-field"><span>随机种子</span><input name="seed" type="number" min="0" max="4294967295" step="1" required></label>
      <label class="b-field"><span>树冠包络</span><select name="crownShape">${crownShapes.map(shape => `<option value="${shape}">${shapeLabel[shape]}</option>`).join('')}</select></label>
      ${sections.map(([title, fields]) => `<details open><summary>${title}</summary>${fields.map(numericField).join('')}</details>`).join('')}
      <footer class="b-actions b-inline-actions" id="broadleaf-actions"><button type="submit" class="primary">应用树形参数</button></footer>
      ${leafPanelHtml()}
      </fieldset>
      <p id="pine-note" class="b-preset-note" hidden>松树使用已定型的 B 薄片预设。可切换标准、茂密与古老三种树形。</p>
    </div>
  </form>
</section>
<div id="toast" class="toast" role="status" hidden></div>`

const form = byId<HTMLFormElement>('form')
const input = (key: keyof typeof rules) => form.elements.namedItem(key) as HTMLInputElement
const select = (key: 'species' | 'example' | 'crownShape') => form.elements.namedItem(key) as HTMLSelectElement
let config = defaults('round')
let activePine: PineProfile | undefined
let asset: ReturnType<typeof assembleBroadleaf> | ReturnType<typeof showPine> | undefined
let view: View = 'final'
let camera: Camera = 'angle'
let viewer: Viewer | undefined
let toastTimer: ReturnType<typeof setTimeout>
let leafMode: LeafMode = 'cards'
let leafParams: LeafParams = { ...defaultLeafParams }
const placeholderTexture = makePlaceholderLeafTexture()
let leafTexture: Texture = placeholderTexture
const leafSetup = (): LeafSetup => ({ mode: leafMode, params: leafParams, texture: leafTexture })
const isBroadleaf = (value: typeof asset): value is ReturnType<typeof assembleBroadleaf> =>
  Boolean(value && 'setLeaves' in value)

function showStats(stats: Record<string, number>) {
  for (const key of ['branches', 'twigs', 'leaves', 'triangles']) byId('stat-' + key).textContent = '—'
  for (const [key, value] of Object.entries(stats)) {
    const target = document.getElementById('stat-' + (key === 'clusters' ? 'leaves' : key))
    if (target) target.textContent = number.format(value)
  }
}

function message(value: unknown, error = false) {
  const toast = byId('toast')
  clearTimeout(toastTimer)
  toast.textContent = value instanceof Error ? value.message : String(value)
  toast.classList.toggle('is-error', error)
  toast.hidden = false
  toastTimer = setTimeout(() => { toast.hidden = true }, 4500)
}

function preview(replacement: NonNullable<typeof asset>, height: number, span: number) {
  if (viewer) {
    replacement.display(view)
    const aspect = viewer.host.clientWidth / viewer.host.clientHeight
    const frameHeight = Math.max(height * 1.05, (span + height * .12) / Math.max(.56, aspect) / 1.16)
    viewer.showModel(replacement.group, frameHeight, false)
    viewer.frame(camera)
    asset?.dispose()
    asset = replacement
    showStats(asset.stats)
  }
}

function syncPreset() {
  const preset = activePine ? pinePreset(activePine) : config.species
  const fields = byId<HTMLFieldSetElement>('broadleaf-fields')
  fields.hidden = fields.disabled = Boolean(activePine)
  byId('broadleaf-actions').hidden = Boolean(activePine)
  byId('pine-note').hidden = !activePine
  byId('reset').hidden = Boolean(activePine)
  byId('label-leaves').textContent = activePine ? '树冠层' : leafMode === 'cards' ? '叶片卡' : '树冠簇'
  byId('tree-title').textContent = activePine ? '松树 · ' + pineLabel[activePine] : speciesLabel[config.species]
  select('species').value = preset
  const url = new URL(location.href)
  if (preset === 'round') url.searchParams.delete('preset')
  else url.searchParams.set('preset', preset)
  history.replaceState(null, '', url)
}

function render(next: BroadleafTreeConfig) {
  if (viewer) preview(assembleBroadleaf(next, leafSetup()), next.treeHeight, Math.max(next.crownWidth, next.crownDepth))
  config = next
  activePine = undefined
  syncPreset()
  select('crownShape').value = config.crownShape
  select('example').innerHTML = '<option value="">自定义</option>' + seeds[config.species].map(seed => `<option>${seed}</option>`).join('')
  select('example').value = seeds[config.species].includes(config.seed) ? String(config.seed) : ''
  for (const key of Object.keys(rules) as (keyof typeof rules)[]) input(key).value = String(config[key])
}

function renderPine(profile: PineProfile) {
  if (viewer) {
    const replacement = showPine(profile)
    preview(replacement, replacement.height, replacement.span)
  }
  activePine = profile
  syncPreset()
}

function choosePreset(preset: string | null) {
  const profile = pineProfile(preset)
  if (profile) renderPine(profile)
  else {
    const species = preset === 'open' ? 'open' : 'round'
    render(config.species === species ? config : defaults(species))
  }
}

function update(next: unknown) {
  try { render(parseBroadleafConfig(next)) }
  catch (error) { message(error, true) }
}

try {
  viewer = new Viewer(byId('canvas'), (_, calls) => {
    byId('stat-calls').textContent = number.format(calls)
  })
} catch (error) {
  console.warn(error)
  byId('webgl').hidden = false
}
choosePreset(new URL(location.href).searchParams.get('preset'))

form.onsubmit = event => {
  event.preventDefault()
  if (activePine) return
  const numbers = Object.fromEntries((Object.keys(rules) as (keyof typeof rules)[]).map(key => [key, input(key).valueAsNumber]))
  update({ ...config, ...numbers, crownShape: select('crownShape').value })
}
select('species').onchange = () => choosePreset(select('species').value)
select('example').onchange = () => {
  if (select('example').value) update({ ...config, seed: Number(select('example').value) })
}
byId('reset').onclick = () => render(defaults(config.species))

// ---- leaf card system -------------------------------------------------------
let leafFrame = 0
function refreshLeaves() {
  cancelAnimationFrame(leafFrame)
  leafFrame = requestAnimationFrame(() => {
    if (!isBroadleaf(asset)) return
    try {
      asset.setLeaves(leafSetup())
      showStats(asset.stats)
      viewer?.refreshShadows()
    } catch (error) { message(error, true) }
  })
}
const leafPanel = bindLeafPanel(byId('leaf-panel'), () => leafParams, next => {
  leafParams = next
  refreshLeaves()
})
const modeSelect = byId<HTMLSelectElement>('leaf-mode')
function syncLeafMode() {
  modeSelect.value = leafMode
  byId('leaf-card-controls').hidden = leafMode !== 'cards'
  byId('label-leaves').textContent = activePine ? '树冠层' : leafMode === 'cards' ? '叶片卡' : '树冠簇'
}
modeSelect.onchange = () => {
  leafMode = modeSelect.value as LeafMode
  syncLeafMode()
  refreshLeaves()
}
function drawThumb() {
  const canvas = byId<HTMLCanvasElement>('leaf-thumb')
  const g = canvas.getContext('2d')!
  g.clearRect(0, 0, canvas.width, canvas.height)
  const image = leafTexture.image as CanvasImageSource | undefined
  if (image) g.drawImage(image, 0, 0, canvas.width, canvas.height)
  byId('leaf-texture-name').textContent = leafTexture === placeholderTexture ? '默认程序贴图' : leafTexture.name || '自定义贴图'
}
function useTexture(texture: Texture) {
  if (leafTexture !== placeholderTexture && leafTexture !== texture) leafTexture.dispose()
  leafTexture = texture
  drawThumb()
  refreshLeaves()
}
const leafFile = byId<HTMLInputElement>('leaf-file')
byId('leaf-load').onclick = () => leafFile.click()
leafFile.onchange = async () => {
  const selected = leafFile.files?.[0]
  if (!selected) return
  try {
    useTexture(await loadLeafTexture(selected))
    message('已载入贴图 ' + selected.name)
  } catch (error) { message('贴图载入失败：' + (error instanceof Error ? error.message : String(error)), true) }
  finally { leafFile.value = '' }
}
byId('leaf-default').onclick = () => useTexture(placeholderTexture)
byId('leaf-reset').onclick = () => {
  leafParams = { ...defaultLeafParams }
  leafPanel.sync()
  refreshLeaves()
}
syncLeafMode()
drawThumb()
// expose for automated browser checks
Object.assign(window, { __leafStudio: {
  get params() { return leafParams },
  set: (next: Partial<LeafParams>) => { leafParams = parseLeafParams({ ...leafParams, ...next }); leafPanel.sync(); refreshLeaves() },
  get stats() { return isBroadleaf(asset) ? { ...asset.stats } : undefined },
  textureDataUrl: () => (placeholderTexture.image as HTMLCanvasElement).toDataURL('image/png'),
} })
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.onclick = () => {
  view = button.dataset.view as View
  asset?.display(view)
  viewer?.refreshShadows()
  document.querySelectorAll('[data-view]').forEach(other => other.setAttribute('aria-pressed', String(other === button)))
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) button.onclick = () => {
  camera = button.dataset.camera as Camera
  viewer?.frame(camera)
  document.querySelectorAll('[data-camera]').forEach(other => other.setAttribute('aria-pressed', String(other === button)))
}

const file = byId<HTMLInputElement>('file')
byId('import').onclick = () => file.click()
file.onchange = async () => {
  const selected = file.files?.[0]
  if (!selected) return
  try {
    const data = JSON.parse(await selected.text())
    if (data?.species === 'pine') {
      const profile = pineProfiles.find(item => item === data.profile)
      if (data.schemaVersion !== 1 || !profile) throw new Error('未知的松树预设配置')
      renderPine(profile)
    } else {
      if (data && typeof data === 'object' && 'leaves' in data) {
        const { mode, ...rest } = (data.leaves ?? {}) as { mode?: LeafMode }
        leafParams = parseLeafParams(rest)
        if (mode === 'cards' || mode === 'sheets') leafMode = mode
        leafPanel.sync()
        syncLeafMode()
        delete data.leaves
      }
      update(data)
    }
  }
  catch (error) { message(error, true) }
  finally { file.value = '' }
}

function download(url: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
}
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  download(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
const name = () => activePine ? pinePreset(activePine) : `broadleaf-${config.species}-${config.seed}`
byId('json').onclick = () => {
  const current = activePine ? { schemaVersion: 1, species: 'pine', profile: activePine } :
    { ...config, leaves: { mode: leafMode, ...leafParams } }
  save(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }), name() + '.json')
}
byId('png').onclick = () => {
  if (viewer) download(viewer.snapshot(), name() + '-' + view + '-' + camera + '.png')
}
const exportButton = byId<HTMLButtonElement>('glb')
exportButton.onclick = async () => {
  if (!asset) return
  const filename = name() + '.glb'
  exportButton.disabled = true
  try {
    save(await asset.exportGlb(), filename)
    message('已导出 ' + filename)
  } catch (error) { message(error, true) }
  finally { exportButton.disabled = false }
}

