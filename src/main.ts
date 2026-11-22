import './style.css'
import { defaults, levels, parseConfig, rules, saveConfig, type TreeMassConfig } from './config'
import { views, type View } from './tree'
import { cameraMap, Viewer, type Camera } from './viewport'

const title: Record<View, string> = { final: '成品', silhouette: '剪影', flat: '三色块', wireframe: '线框', macro: '仅大体块' }
const cameraTitle: Record<Camera, string> = { front: '正面', angle: '45°', side: '侧面', top: '斜俯视' }
const seedSamples = [4607, 8123, 1307, 9731, 3089, 6727, 11003, 18447, 19339, 24611]
type Range = Exclude<keyof typeof rules, 'seed' | 'totalHeight' | 'crownStart'>
const parameters: [Range, string, string?][] = [
  ['tierCount', '树冠层数'], ['massesPerTier', '每层体块'], ['maxCrownRadius', '树冠宽度', 'm'], ['crownHeight', '树冠高度', 'm'],
  ['tierOverlap', '层间重叠'], ['droop', '下垂'], ['asymmetry', '不对称'], ['macroLobeWidth', '大叶束宽度'],
]
const metrics = [
  ['tiers', '树冠层'], ['macro', '大体块'], ['meso', '中体块'], ['micro', '小细节'],
  ['triangles', '三角面'], ['calls', 'Draw Calls'], ['fps', 'FPS'],
]
const layerLabels = ['Macro · 大体块', 'Meso · 中叶束', 'Micro · 小细节']
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const buttons = (selector: string) => document.querySelectorAll<HTMLButtonElement>(selector)

byId('app').innerHTML = `
<header class="bar">
  <div class="brand"><span class="mark" aria-hidden="true">▲</span><div><h1>Foliage Mass</h1><span>风格化树冠体块原型</span></div></div>
  <nav aria-label="项目操作">
    <a href="./broadleaf.html" style="color:var(--green);font-size:12px">阔叶树 Stage 4</a>
    <input id="file" type="file" accept=".json,application/json" hidden>
    <button id="import">导入 JSON</button><button id="export">保存 JSON</button><button id="snapshot" class="primary">截图 PNG</button>
  </nav>
</header>
<section class="workspace">
  <section class="viewport panel" aria-label="三维工作区">
    <header class="viewport-head"><h2>树冠预览</h2><div class="switcher" aria-label="视图">
      ${views.map(view => `<button data-view="${view}" aria-pressed="${view === 'final'}">${title[view]}</button>`).join('')}
    </div></header>
    <div id="stage" class="stage"><div id="canvas"></div>
      <div class="camera-tools switcher" aria-label="固定机位">${Object.entries(cameraTitle).map(([key, label]) =>
        `<button data-camera="${key}" aria-pressed="${key === 'angle'}">${label}</button>`).join('')}</div>
      <div class="gesture">拖动旋转 · 滚轮缩放 · 右键平移</div>
      <div class="error" id="webgl" hidden>预览需要支持 WebGL 2 的浏览器。</div>
    </div>
    <div class="stats" aria-label="模型统计">${metrics.map(([key, label]) =>
      `<div><span>${label}</span><output id="stat-${key}">—</output></div>`).join('')}</div>
  </section>
  <aside class="inspector panel" aria-label="树形参数">
    <header class="inspect-head"><h2>树形参数</h2><button id="reset">恢复默认</button></header>
    <div id="ranges" class="ranges">${parameters.map(([key, label, unit]) => {
      const rule = rules[key]
      const factor = key === 'maxCrownRadius' ? 2 : 1
      return `<div class="field"><div><label for="param-${key}">${label}</label><output for="param-${key}"></output>${unit ? `<span>${unit}</span>` : ''}</div>
        <input type="range" id="param-${key}" data-parameter="${key}" min="${rule.min * factor}" max="${rule.max * factor}" step="${rule.step * factor}"></div>`
    }).join('')}</div>
    <fieldset class="layers"><legend>可见层级</legend>
    ${levels.map((key, index) => `<label><span>${layerLabels[index]}</span><input type="checkbox" data-layer="${key}"></label>`).join('')}
    </fieldset>
  </aside>
</section>
<footer class="bar seedbar">
  <div class="seed"><label for="seed">种子</label><input type="number" id="seed" min="0" max="4294967295" step="1" inputmode="numeric">
  <select id="examples" aria-label="种子样例"><option value="">种子样例</option>${seedSamples.map(seed => `<option>${seed}</option>`).join('')}</select></div>
  <button id="regenerate" class="secondary">重新生成</button>
</footer>
<div id="toast" class="toast" role="status" hidden></div>
`

const number = new Intl.NumberFormat('en-US')
const seeds = byId<HTMLInputElement>('seed')
const examples = byId<HTMLSelectElement>('examples')
const controls = byId('ranges')
const file = byId<HTMLInputElement>('file')
let config = defaults()
let currentView: View = 'final'
let currentCamera: Camera = 'angle'
let viewer: Viewer | undefined
let pending: ReturnType<typeof setTimeout> | undefined
let toastTimer: ReturnType<typeof setTimeout>

try {
  viewer = new Viewer(byId('canvas'), (fps, calls) => {
    byId('stat-fps').textContent = String(Math.round(fps))
    byId('stat-calls').textContent = String(calls)
  })
} catch (error) {
  console.warn(error)
  byId('webgl').hidden = false
}

function message(text: string, error = false) {
  const box = byId('toast')
  clearTimeout(toastTimer)
  box.textContent = text
  box.classList.toggle('is-error', error)
  box.hidden = false
  toastTimer = setTimeout(() => { box.hidden = true }, error ? 5200 : 2200)
}

function syncFields() {
  seeds.value = String(config.seed)
  examples.value = seedSamples.includes(config.seed) ? String(config.seed) : ''
  for (const field of controls.querySelectorAll<HTMLInputElement>('input[data-parameter]')) {
    const key = field.dataset.parameter as Range
    const value = config[key] * (key === 'maxCrownRadius' ? 2 : 1)
    if (key === 'crownHeight') field.max = String(Math.min(rules.crownHeight.max, config.totalHeight - config.crownStart))
    field.value = String(value)
    field.style.setProperty('--fill', `${(value - Number(field.min)) / (Number(field.max) - Number(field.min)) * 100}%`)
    field.parentElement!.querySelector('output')!.textContent = String(Math.round(value * 100) / 100)
  }
  document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach(field => { field.checked = config[field.dataset.layer as typeof levels[number]] })
}

function stats() {
  const current = viewer?.asset?.stats()
  if (current) for (const [key, value] of Object.entries(current)) byId(`stat-${key}`).textContent = number.format(value)
}

function regenerate(fit = false) {
  clearTimeout(pending)
  pending = undefined
  viewer?.setTree(config, fit)
  viewer?.setView(currentView, config)
  stats()
}

function schedule() {
  clearTimeout(pending)
  pending = setTimeout(() => regenerate(), 85)
}

function update(input: unknown) {
  const next = parseConfig(input)
  const fit = next.totalHeight !== config.totalHeight
  config = next
  syncFields()
  regenerate(fit)
  return structuredClone(config)
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2500)
}

buttons('[data-view]').forEach(button => button.onclick = () => {
  currentView = button.dataset.view as View
  buttons('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)))
  viewer?.setView(currentView, config)
  stats()
})
buttons('[data-camera]').forEach(button => button.onclick = () => {
  currentCamera = button.dataset.camera as Camera
  buttons('[data-camera]').forEach(item => item.setAttribute('aria-pressed', String(item === button)))
  viewer?.frame(currentCamera)
})
controls.oninput = event => {
  const input = event.target as HTMLInputElement
  const key = input.dataset.parameter as Range
  if (!key) return
  config[key] = input.valueAsNumber / (key === 'maxCrownRadius' ? 2 : 1)
  syncFields()
  schedule()
}
document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach(field => field.onchange = () => {
  config[field.dataset.layer as typeof levels[number]] = field.checked
  viewer?.setView(currentView, config)
  stats()
})

function setSeed(value: number) {
  try { config = parseConfig({ ...config, seed: value }) }
  catch (error) { message(error instanceof Error ? error.message : String(error), true) }
  syncFields()
  schedule()
}

seeds.onchange = () => setSeed(seeds.valueAsNumber)
seeds.onkeydown = event => { if (event.key === 'Enter') seeds.blur() }
examples.onchange = () => { if (examples.value) setSeed(Number(examples.value)) }
byId('regenerate').onclick = () => regenerate()
byId('reset').onclick = () => {
  update(defaults())
  document.querySelector<HTMLButtonElement>('[data-view=final]')!.click()
  document.querySelector<HTMLButtonElement>('[data-camera=angle]')!.click()
}
byId('snapshot').onclick = () => {
  if (!viewer) return
  if (pending) regenerate()
  const anchor = document.createElement('a')
  anchor.href = viewer.snapshot()
  anchor.download = `conifer-${config.seed}-${currentView}-${currentCamera}.png`
  anchor.click()
  message('截图已导出')
}
byId('export').onclick = () => {
  save(new Blob([saveConfig(config)], { type: 'application/json' }), `painterly_conifer-${config.seed}.json`)
  message('配置已保存')
}
byId('import').onclick = () => file.click()
file.onchange = async () => {
  const selected = file.files?.[0]
  file.value = ''
  if (!selected) return
  try {
    if (selected.size > 1024 * 1024) throw new Error('配置文件超过 1 MB')
    update(JSON.parse(await selected.text()))
    message('配置已导入')
  } catch (error) { message(error instanceof Error ? error.message : String(error), true) }
}

const api = {
  update,
  config: () => structuredClone(config),
  stats: () => viewer?.asset?.stats(),
  masses: () => viewer?.asset?.masses,
}
declare global { interface Window { foliageMass: typeof api } }
window.foliageMass = api
syncFields()
regenerate(true)

