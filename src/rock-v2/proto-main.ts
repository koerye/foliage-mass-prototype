import {
  ACESFilmicToneMapping,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LinearMipmapLinearFilter,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { exportFbxBundle, exportGlb, exportSplitGltfBundle } from '../export-glb'
import { buildRockGroup } from '../rock/geometry'
import { rockPresetSpec } from '../rock/spec'
import { bakeRockV2Textures } from './bake'
import {
  buildBlockBluffRouteC,
  buildSandstoneLedgeRouteC,
  sliceMeshByPlane,
  type PolyCsgPresetId,
  type SectionSegment2D,
} from './poly-csg'
import { bakePolyCsgPbr, unwrapPolyCsgUvCharts } from './poly-pbr'
import { renderPhase2BenchmarkBundle, renderPhase3All16PlantsSheet } from './phase2-benchmark'
import { createRockV2Field, vNorm, type RockV2ArchetypeId, type Vec3 } from './sdf'
import { extractSurfaceNets, type SurfaceNetsResult } from './surface-nets'
import { unwrapRockUvCharts } from './uv-charts'

type Gate1View = 'front' | 'angle' | 'sideBack' | 'low' | 'gameScale'

const STAGE_W = 640
const STAGE_H = 520

const stage = document.getElementById('stage')!
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
renderer.setSize(STAGE_W, STAGE_H)
renderer.setPixelRatio(1)
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 1.04
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFShadowMap
stage.appendChild(renderer.domElement)

const scene = new Scene()
scene.background = new Color('#f3f1ec')

const camera = new OrthographicCamera(-2, 2, 2, -2, 0.05, 60)

// Sculptural 3/4 upper-left cross light so clay form, shoulder ledges & V-clefts read honestly
const keyLight = new DirectionalLight('#fff7eb', 2.45)
keyLight.position.set(-4.2, 5.4, 3.6)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(1024, 1024)
keyLight.shadow.camera.near = 0.5
keyLight.shadow.camera.far = 20
keyLight.shadow.camera.left = -3
keyLight.shadow.camera.right = 3
keyLight.shadow.camera.top = 3
keyLight.shadow.camera.bottom = -3
keyLight.shadow.bias = -0.0005
scene.add(keyLight)

const fillLight = new DirectionalLight('#d6e2f5', 0.62)
fillLight.position.set(4.5, 2.2, -3.5)
scene.add(fillLight)

const hemiLight = new HemisphereLight('#f6f8fc', '#bfb4a8', 0.92)
scene.add(hemiLight)

const floor = new Mesh(
  new PlaneGeometry(20, 20),
  new ShadowMaterial({ color: '#3b332d', opacity: 0.22 }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

const clayMat = new MeshStandardMaterial({
  color: '#c9bfb3',
  roughness: 0.90,
  metalness: 0.0,
})

const wireMat = new MeshBasicMaterial({
  color: '#2d3a34',
  wireframe: true,
  transparent: true,
  opacity: 0.55,
})

const rootGroup = new Group()
scene.add(rootGroup)

function clearRoot() {
  while (rootGroup.children.length > 0) {
    const child = rootGroup.children[0]
    rootGroup.remove(child)
    child.traverse(obj => {
      if (obj instanceof Mesh) obj.geometry.dispose()
    })
  }
}

function frameView(bounds: Box3, view: Gate1View) {
  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const span = Math.max(size.x, size.y, size.z, 1.0)
  const aspect = STAGE_W / STAGE_H

  // Camera directions: front, 45° hero angle, side-back (verifies 360°), low-angle (verifies ground skirt!), game-scale
  const dirs: Record<Gate1View, [number, number, number, number]> = {
    front: [0, 0.16, 1.0, 0.72],
    angle: [0.68, 0.30, 0.74, 0.74],
    sideBack: [-0.88, 0.28, -0.58, 0.74],
    low: [0.46, 0.02, 0.89, 0.66],
    gameScale: [0.68, 0.42, 0.74, 1.95],
  }
  const [dx, dy, dz, zoomScale] = dirs[view]
  const dir = new Vector3(dx, dy, dz).normalize()
  const target = view === 'low' ? new Vector3(center.x, size.y * 0.28, center.z) : center.clone()
  camera.position.copy(target).addScaledVector(dir, 8)
  camera.lookAt(target)

  const halfH = span * zoomScale
  camera.top = halfH
  camera.bottom = -halfH
  camera.left = -halfH * aspect
  camera.right = halfH * aspect
  camera.updateProjectionMatrix()
}

function captureClay(view: Gate1View, bounds: Box3): string {
  frameView(bounds, view)
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}

async function loadImg(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  await new Promise<void>((ok, bad) => {
    img.onload = () => ok()
    img.onerror = bad
    img.src = url
  })
  return img
}

async function renderGate1Sheet(archetype: RockV2ArchetypeId): Promise<{
  dataUrl: string
  oldTris: number
  low: SurfaceNetsResult['audit'] & { timings: SurfaceNetsResult['timings'] }
  high: SurfaceNetsResult['audit'] & { timings: SurfaceNetsResult['timings'] }
}> {
  const field = createRockV2Field(archetype)
  const lowRes = extractSurfaceNets(field, { resolution: 30, projectToSurface: true })
  const highRes = extractSurfaceNets(field, { resolution: 64, projectToSurface: true })

  const oldPresetId = archetype === 'block-bluff' ? 'handpainted-block-bluff' : 'handpainted-twin-slab'
  const oldSpec = rockPresetSpec(oldPresetId)
  // Keep main rock only (no pebbles) so old vs new clay geometry comparison is apples-to-apples
  oldSpec.cluster.pebbles = 0

  const views: { view: Gate1View; label: string; wireframe?: boolean }[] = [
    { view: 'front', label: '正面 Front' },
    { view: 'angle', label: '斜前 45°' },
    { view: 'sideBack', label: '侧后 Side-Back' },
    { view: 'low', label: '低机位底脚 Low' },
    { view: 'gameScale', label: '游戏视距 Game' },
  ]

  const rows: { title: string; cells: { label: string; img: HTMLImageElement }[] }[] = []

  // Row 1: Old rock clay
  clearRoot()
  const oldBuilt = buildRockGroup(oldSpec, clayMat)
  rootGroup.add(oldBuilt.group)
  const oldBounds = new Box3().setFromObject(rootGroup)
  const oldCells: { label: string; img: HTMLImageElement }[] = []
  for (const v of views) {
    oldCells.push({ label: v.label, img: await loadImg(captureClay(v.view, oldBounds)) })
  }
  rows.push({ title: `旧版半空间切割 (${oldBuilt.stats.triangles} tris)`, cells: oldCells })
  const oldTris = oldBuilt.stats.triangles
  oldBuilt.dispose()

  // Row 2: New SDF HIGH (N=64) clay
  clearRoot()
  const highGeo = highRes.toBufferGeometry()
  const highMesh = new Mesh(highGeo, clayMat)
  highMesh.castShadow = true
  highMesh.receiveShadow = true
  rootGroup.add(highMesh)
  const highBounds = new Box3().setFromObject(rootGroup)
  const highCells: { label: string; img: HTMLImageElement }[] = []
  for (const v of views) {
    highCells.push({ label: v.label, img: await loadImg(captureClay(v.view, highBounds)) })
  }
  rows.push({
    title: `新版 SDF 精雕 N=64 (${highRes.audit.triangles} tris, ${highRes.timings.totalMs}ms, 错边=${highRes.audit.openEdges}/${highRes.audit.nonManifoldEdges}, 自交=${highRes.audit.selfIntersections})`,
    cells: highCells,
  })

  // Row 3: New SDF LOW (N=30, LOD0) clay + Wireframe in last slot
  clearRoot()
  const lowGeo = lowRes.toBufferGeometry()
  const lowMesh = new Mesh(lowGeo, clayMat)
  lowMesh.castShadow = true
  lowMesh.receiveShadow = true
  rootGroup.add(lowMesh)
  const lowBounds = new Box3().setFromObject(rootGroup)
  const lowCells: { label: string; img: HTMLImageElement }[] = []
  for (let i = 0; i < 4; i++) {
    lowCells.push({ label: views[i].label, img: await loadImg(captureClay(views[i].view, lowBounds)) })
  }
  // 5th slot: 45° clay + wireframe overlay to inspect Surface Nets topology cleanly
  const wireOverlay = new Mesh(lowGeo.clone(), wireMat)
  wireOverlay.scale.setScalar(1.002)
  rootGroup.add(wireOverlay)
  lowCells.push({ label: '低模线框 Wireframe', img: await loadImg(captureClay('angle', lowBounds)) })
  rows.push({
    title: `新版 SDF 低模 N=30 (${lowRes.audit.triangles} tris, ${lowRes.timings.totalMs}ms, 壳=${lowRes.audit.connectedComponents}, 错边=${lowRes.audit.openEdges}/${lowRes.audit.nonManifoldEdges}, 自交=${lowRes.audit.selfIntersections})`,
    cells: lowCells,
  })

  // Composite crisp 3x5 comparison sheet
  const cellW = 360
  const cellH = 290
  const rowHeadH = 34
  const pad = 8
  const canvas = document.createElement('canvas')
  canvas.width = cellW * 5
  canvas.height = (rowHeadH + cellH) * rows.length
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let r = 0; r < rows.length; r++) {
    const y0 = r * (rowHeadH + cellH)
    ctx.fillStyle = r === 0 ? '#efe7de' : '#e4eee7'
    ctx.fillRect(0, y0, canvas.width, rowHeadH)
    ctx.fillStyle = '#253129'
    ctx.font = '700 15px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`${field.name} — ${rows[r].title}`, 14, y0 + 22)

    for (let c = 0; c < rows[r].cells.length; c++) {
      const x0 = c * cellW
      const cy0 = y0 + rowHeadH
      ctx.drawImage(rows[r].cells[c].img, x0 + pad, cy0 + pad, cellW - pad * 2, cellH - 28)
      ctx.strokeStyle = '#e5e2dc'
      ctx.lineWidth = 1
      ctx.strokeRect(x0, cy0, cellW, cellH)
      ctx.fillStyle = '#534c45'
      ctx.font = '600 12.5px "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(rows[r].cells[c].label, x0 + cellW * 0.5, cy0 + cellH - 7)
    }
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    oldTris,
    low: { ...lowRes.audit, timings: lowRes.timings },
    high: { ...highRes.audit, timings: highRes.timings },
  }
}

function rgbaToCanvas(data: Uint8ClampedArray, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const img = new ImageData(new Uint8ClampedArray(data), size, size)
  ctx.putImageData(img, 0, 0)
  return c
}

function makeTextureFromRgba(data: Uint8ClampedArray, size: number, srgb: boolean, name: string): CanvasTexture {
  const canvas = rgbaToCanvas(data, size)
  const tex = new CanvasTexture(canvas)
  tex.name = name
  // Native glTF 2.0 UV convention (v = 0 top, v = 1 bottom) so live Three.js & reloaded GLB match bit-for-bit!
  tex.flipY = false
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  tex.generateMipmaps = true
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

async function renderGate2Bundle(): Promise<{
  sheets: Record<string, string>
  report: Record<string, unknown>
}> {
  const field = createRockV2Field('block-bluff')
  const lowMesh = extractSurfaceNets(field, { resolution: 30, projectToSurface: true })
  const unwrapped = unwrapRockUvCharts(lowMesh, 512, 12)
  const baked = bakeRockV2Textures(field, unwrapped, 512, 10)

  const tTex0 = performance.now()
  const mapTex = makeTextureFromRgba(baked.albedo, baked.size, true, 'RockV2_BaseColor')
  const normTex = makeTextureFromRgba(baked.normal, baked.size, false, 'RockV2_Normal')
  const aoTex = makeTextureFromRgba(baked.ao, baked.size, false, 'RockV2_AO')
  aoTex.channel = 0 // standard glTF occlusionTexture on TEXCOORD_0
  const texUploadMs = Math.round((performance.now() - tTex0) * 10) / 10

  // 100% pure standard PBR MeshStandardMaterial (fixed metalness=0, constant roughness=0.90, ZERO custom shaders!)
  const pbrMat = new MeshStandardMaterial({
    name: 'Mat_RockV2_PBR',
    color: 0xffffff,
    map: mapTex,
    normalMap: normTex,
    normalScale: new Vector2(1, 1),
    aoMap: aoTex,
    aoMapIntensity: 0.85,
    roughness: 0.90,
    metalness: 0.0,
  })

  // 1. Build 4-panel baked texture & diagnostic sheet (512x512 each)
  const mapsCanvas = document.createElement('canvas')
  mapsCanvas.width = 512 * 2 + 24
  mapsCanvas.height = (512 + 30) * 2 + 12
  const mctx = mapsCanvas.getContext('2d')!
  mctx.fillStyle = '#ffffff'
  mctx.fillRect(0, 0, mapsCanvas.width, mapsCanvas.height)
  const panels: { label: string; data: Uint8ClampedArray; col: number; row: number }[] = [
    { label: 'BaseColor (512 sRGB · 弱处理固有色，无假方向阴影)', data: baked.albedo, col: 0, row: 0 },
    { label: 'Tangent-Space Normal (512 · 锁定 MikkTSpace 切线基)', data: baked.normal, col: 1, row: 0 },
    { label: 'Ambient Occlusion (512 · 短距 SDF 半球遮蔽 + 缝芯)', data: baked.ao, col: 0, row: 1 },
    {
      label: `投影诊断 (绿=解析 ${(baked.stats.analyticalHitRate * 100).toFixed(1)}% · 橙=缓存 ${(baked.stats.cacheFallbackRate * 100).toFixed(2)}% · 紫=跨壁 ${(baked.stats.crossWallRate * 100).toFixed(2)}% · 红=漏投 ${(baked.stats.missRate * 100).toFixed(2)}%)`,
      data: baked.diagnostic,
      col: 1,
      row: 1,
    },
  ]
  for (const p of panels) {
    const x = 8 + p.col * (512 + 8)
    const y = 8 + p.row * (512 + 30)
    mctx.fillStyle = '#e8ede9'
    mctx.fillRect(x, y, 512, 24)
    mctx.fillStyle = '#253129'
    mctx.font = '700 12.5px "Microsoft YaHei", sans-serif'
    mctx.textAlign = 'left'
    mctx.fillText(p.label, x + 8, y + 16)
    mctx.drawImage(rgbaToCanvas(p.data, 512), x, y + 24)
    mctx.strokeStyle = '#d8d4cc'
    mctx.strokeRect(x, y, 512, 512 + 24)
  }

  // 2. Render live PBR rock under 4 rotating directional lights + close-up + mip/game-scale
  clearRoot()
  const rockGeo = unwrapped.toBufferGeometry()
  const rockMesh = new Mesh(rockGeo, pbrMat)
  rockMesh.name = 'RockV2_BlockBluff_LOD0'
  rockMesh.castShadow = true
  rockMesh.receiveShadow = true
  const liveGroup = new Group()
  liveGroup.name = 'RockV2Asset'
  liveGroup.add(rockMesh)
  rootGroup.add(liveGroup)
  const bounds = new Box3().setFromObject(rootGroup)

  const setKeyAzimuth = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    const r = 5.6
    keyLight.position.set(Math.cos(rad) * r, 5.2, Math.sin(rad) * r)
    keyLight.updateMatrixWorld()
  }

  const row1Shots: { label: string; img: HTMLImageElement }[] = []
  // 4 rotating light azimuths on Front-45° view to prove dynamic lighting & sunlit crack lip response!
  for (const [deg, lbl] of [
    [138, '旋转光 1 · 左上顺侧光 (138°)'],
    [42, '旋转光 2 · 右上侧光 (42°)'],
    [-45, '旋转光 3 · 右后逆侧光 (-45°)'],
    [-135, '旋转光 4 · 左后轮廓光 (-135°)'],
  ] as [number, string][]) {
    setKeyAzimuth(deg)
    row1Shots.push({ label: lbl, img: await loadImg(captureClay('angle', bounds)) })
  }

  // Restore hero upper-left sculptural light for Row 2 comparisons
  keyLight.position.set(-4.2, 5.4, 3.6)
  const row2Shots: { label: string; img: HTMLImageElement }[] = []
  // Close-up on front hero plane + shoulder step + structural crack
  const center = bounds.getCenter(new Vector3())
  const aspect = STAGE_W / STAGE_H
  camera.position.set(center.x - 0.15, center.y + 0.55, center.z + 7.5)
  camera.lookAt(center.x - 0.05, center.y + 0.12, center.z)
  const zoomClose = 0.62
  camera.top = zoomClose; camera.bottom = -zoomClose
  camera.left = -zoomClose * aspect; camera.right = zoomClose * aspect
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  row2Shots.push({ label: '近景 · 肩台与立体裂纹 (Live PBR)', img: await loadImg(renderer.domElement.toDataURL('image/png')) })

  row2Shots.push({ label: '低机位底脚 (Live PBR)', img: await loadImg(captureClay('low', bounds)) })
  row2Shots.push({ label: '缩远 Mip / 游戏视距 (Live PBR)', img: await loadImg(captureClay('gameScale', bounds)) })

  // 3. Real GLB export via project's ACTUAL `exportGlb()` + reload in clean standard `GLTFLoader`!
  const tGlb0 = performance.now()
  const glbBlob = await exportGlb(liveGroup, { mode: 'merged', excludeDecorations: false })
  const glbExportMs = Math.round((performance.now() - tGlb0) * 10) / 10
  const glbBuf = await glbBlob.arrayBuffer()

  const loader = new GLTFLoader()
  const gltf = await new Promise<{ scene: Group }>((ok, bad) => {
    loader.parse(glbBuf, '', g => ok(g as unknown as { scene: Group }), bad)
  })

  // Audit reloaded GLB mesh attributes & PBR textures!
  const reloadedCheck = {
    meshCount: 0,
    triangles: 0,
    hasPosition: false,
    hasNormal: false,
    hasUv: false,
    hasTangent: false,
    tangentItemSize: 0,
    hasMap: false,
    hasNormalMap: false,
    hasAoMap: false,
    aoChannel: -1,
    aoIntensity: 0,
    metalness: -1,
    roughness: -1,
    materialName: '',
  }
  gltf.scene.traverse(obj => {
    if (obj instanceof Mesh) {
      reloadedCheck.meshCount++
      obj.castShadow = true
      obj.receiveShadow = true
      const g = obj.geometry
      reloadedCheck.hasPosition = Boolean(g.getAttribute('position'))
      reloadedCheck.hasNormal = Boolean(g.getAttribute('normal'))
      reloadedCheck.hasUv = Boolean(g.getAttribute('uv'))
      const tAttr = g.getAttribute('tangent')
      reloadedCheck.hasTangent = Boolean(tAttr)
      reloadedCheck.tangentItemSize = tAttr ? tAttr.itemSize : 0
      reloadedCheck.triangles += g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material
      if (mat instanceof MeshStandardMaterial) {
        reloadedCheck.materialName = mat.name
        reloadedCheck.hasMap = Boolean(mat.map)
        reloadedCheck.hasNormalMap = Boolean(mat.normalMap)
        reloadedCheck.hasAoMap = Boolean(mat.aoMap)
        reloadedCheck.aoChannel = mat.aoMap ? mat.aoMap.channel : -1
        reloadedCheck.aoIntensity = mat.aoMapIntensity
        reloadedCheck.metalness = mat.metalness
        reloadedCheck.roughness = mat.roughness
      }
    }
  })

  // Render reloaded GLB in the exact same standard PBR scene at 45° angle!
  clearRoot()
  rootGroup.add(gltf.scene)
  const glbBounds = new Box3().setFromObject(rootGroup)
  row2Shots.push({ label: '独立 GLTFLoader 重载 GLB (45° 对比)', img: await loadImg(captureClay('angle', glbBounds)) })

  // Also capture Live PBR 45° & Reloaded GLB Close-up side by side for visual parity!
  camera.position.set(center.x - 0.15, center.y + 0.55, center.z + 7.5)
  camera.lookAt(center.x - 0.05, center.y + 0.12, center.z)
  camera.top = zoomClose; camera.bottom = -zoomClose
  camera.left = -zoomClose * aspect; camera.right = zoomClose * aspect
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  const glbCloseImg = await loadImg(renderer.domElement.toDataURL('image/png'))

  // Composite Gate 2 Lighting & GLB Parity Sheet (2 rows x 4 cols + close-up parity)
  const cellW = 400, cellH = 325, headH = 34
  const pbrCanvas = document.createElement('canvas')
  pbrCanvas.width = cellW * 4
  pbrCanvas.height = (headH + cellH) * 2
  const pctx = pbrCanvas.getContext('2d')!
  pctx.fillStyle = '#ffffff'
  pctx.fillRect(0, 0, pbrCanvas.width, pbrCanvas.height)

  const drawRow = (rowIdx: number, title: string, items: { label: string; img: HTMLImageElement }[]) => {
    const y0 = rowIdx * (headH + cellH)
    pctx.fillStyle = rowIdx === 0 ? '#e4eee7' : '#e8ebf2'
    pctx.fillRect(0, y0, pbrCanvas.width, headH)
    pctx.fillStyle = '#253129'
    pctx.font = '700 14.5px "Microsoft YaHei", sans-serif'
    pctx.textAlign = 'left'
    pctx.fillText(title, 14, y0 + 22)
    for (let c = 0; c < items.length; c++) {
      const x0 = c * cellW, cy0 = y0 + headH
      pctx.drawImage(items[c].img, x0 + 8, cy0 + 8, cellW - 16, cellH - 30)
      pctx.strokeStyle = '#e2dfd8'
      pctx.strokeRect(x0, cy0, cellW, cellH)
      pctx.fillStyle = '#4a433d'
      pctx.font = '600 12.5px "Microsoft YaHei", sans-serif'
      pctx.textAlign = 'center'
      pctx.fillText(items[c].label, x0 + cellW * 0.5, cy0 + cellH - 8)
    }
  }

  drawRow(0, `Gate 2 · 纯标准 MeshStandardMaterial（零自定义 Shader）旋转动态光照验证 (${unwrapped.audit.triangles} tris)`, row1Shots)
  drawRow(1, `Gate 2 · 近景裂纹 / 低机位 / Mip 缩远 / 独立 GLTFLoader 重载 GLB 对比 (${(glbBlob.size / 1024).toFixed(1)} KB)`, row2Shots)

  // Also save close-up Live PBR vs Reloaded GLB 1:1 parity card
  const parityCanvas = document.createElement('canvas')
  parityCanvas.width = 640 * 2 + 24
  parityCanvas.height = 520 + 44
  const cctx = parityCanvas.getContext('2d')!
  cctx.fillStyle = '#ffffff'
  cctx.fillRect(0, 0, parityCanvas.width, parityCanvas.height)
  cctx.drawImage(row2Shots[0].img, 8, 36)
  cctx.drawImage(glbCloseImg, 656, 36)
  cctx.fillStyle = '#253129'
  cctx.font = '700 15px "Microsoft YaHei", sans-serif'
  cctx.fillText('Live Three.js 标准 MeshStandardMaterial (近景)', 16, 24)
  cctx.fillText('exportGlb() → GLTFLoader 独立重载 (近景 · 校验法线/切线/AO语义)', 664, 24)

  // Clean up GPU resources
  mapTex.dispose(); normTex.dispose(); aoTex.dispose(); pbrMat.dispose()

  return {
    sheets: {
      maps: mapsCanvas.toDataURL('image/png'),
      pbr_and_glb: pbrCanvas.toDataURL('image/png'),
      glb_parity: parityCanvas.toDataURL('image/png'),
    },
    report: {
      geometry: {
        ...lowMesh.audit,
        timings: lowMesh.timings,
      },
      uv: {
        ...unwrapped.audit,
        uvMs: unwrapped.uvMs,
      },
      bake: baked.stats,
      uploadAndExport: {
        texUploadMs,
        glbExportMs,
        glbBytes: glbBlob.size,
      },
      reloadedCheck,
    },
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function build4PanelMapSheet(
  titlePrefix: string,
  baked: ReturnType<typeof bakeRockV2Textures>,
): string {
  const mapsCanvas = document.createElement('canvas')
  mapsCanvas.width = 512 * 2 + 24
  mapsCanvas.height = (512 + 30) * 2 + 12
  const mctx = mapsCanvas.getContext('2d')!
  mctx.fillStyle = '#ffffff'
  mctx.fillRect(0, 0, mapsCanvas.width, mapsCanvas.height)
  const panels: { label: string; data: Uint8ClampedArray; col: number; row: number }[] = [
    { label: `${titlePrefix} · BaseColor (512 sRGB)`, data: baked.albedo, col: 0, row: 0 },
    { label: `${titlePrefix} · Normal (OpenGL +Y · 锁定切线基)`, data: baked.normal, col: 1, row: 0 },
    { label: `${titlePrefix} · AO (短距 SDF 半球遮蔽 + 缝芯)`, data: baked.ao, col: 0, row: 1 },
    {
      label: `解析=${(baked.stats.analyticalHitRate * 100).toFixed(1)}% 橙缓存=${(baked.stats.cacheFallbackRate * 100).toFixed(2)}% 紫跨壁=${(baked.stats.crossWallRate * 100).toFixed(2)}% P95残差=${baked.stats.p95AnalyticalResidual}m`,
      data: baked.diagnostic,
      col: 1,
      row: 1,
    },
  ]
  for (const p of panels) {
    const x = 8 + p.col * (512 + 8)
    const y = 8 + p.row * (512 + 30)
    mctx.fillStyle = '#e8ede9'
    mctx.fillRect(x, y, 512, 24)
    mctx.fillStyle = '#253129'
    mctx.font = '700 12px "Microsoft YaHei", sans-serif'
    mctx.textAlign = 'left'
    mctx.fillText(p.label, x + 8, y + 16)
    mctx.drawImage(rgbaToCanvas(p.data, 512), x, y + 24)
    mctx.strokeStyle = '#d8d4cc'
    mctx.strokeRect(x, y, 512, 512 + 24)
  }
  return mapsCanvas.toDataURL('image/png')
}

async function renderRound2Bundle(): Promise<{
  sheets: Record<string, string>
  exportsB64: {
    glbNonUniform: string
    splitGltfZip: string
    fbxZip: string
  }
  report: Record<string, unknown>
}> {
  // -------------------------------------------------------------------------
  // 1. Updated block-bluff sculpt clay check (sharpened shoulder & broken base foot)
  // -------------------------------------------------------------------------
  const bluffClay = await renderGate1Sheet('block-bluff')

  // -------------------------------------------------------------------------
  // 2. twin-slab 512 honest analytical vs cache-fallback bake & narrow V-cleft PBR check
  // -------------------------------------------------------------------------
  const twinField = createRockV2Field('twin-slab')
  const twinLow = extractSurfaceNets(twinField, { resolution: 30, projectToSurface: true })
  const twinUv = unwrapRockUvCharts(twinLow, 512, 12)
  const twinBaked = bakeRockV2Textures(twinField, twinUv, { size: 512, dilationPasses: 10, brushMode: 'off' })
  const twinMapSheet = build4PanelMapSheet('双叠断层岩 twin-slab', twinBaked)

  const twinMapTex = makeTextureFromRgba(twinBaked.albedo, 512, true, 'TwinSlab_BaseColor')
  const twinNormTex = makeTextureFromRgba(twinBaked.normal, 512, false, 'TwinSlab_Normal')
  const twinAoTex = makeTextureFromRgba(twinBaked.ao, 512, false, 'TwinSlab_AO')
  twinAoTex.channel = 0
  const twinMat = new MeshStandardMaterial({
    name: 'Mat_TwinSlab_PBR',
    color: 0xffffff,
    map: twinMapTex,
    normalMap: twinNormTex,
    normalScale: new Vector2(1, 1),
    aoMap: twinAoTex,
    aoMapIntensity: 0.85,
    roughness: 0.90,
    metalness: 0.0,
  })
  clearRoot()
  const twinMesh = new Mesh(twinUv.toBufferGeometry(), twinMat)
  twinMesh.castShadow = true
  twinMesh.receiveShadow = true
  rootGroup.add(twinMesh)
  const twinBounds = new Box3().setFromObject(rootGroup)
  keyLight.position.set(-4.2, 5.4, 3.6)
  const twinShots: { label: string; img: HTMLImageElement }[] = [
    { label: '正面 Front (V 槽 + 暗影)', img: await loadImg(captureClay('front', twinBounds)) },
    { label: '斜前 45° (双叠体量)', img: await loadImg(captureClay('angle', twinBounds)) },
    { label: '侧后 Side-Back', img: await loadImg(captureClay('sideBack', twinBounds)) },
    { label: '游戏视距 Game-Scale', img: await loadImg(captureClay('gameScale', twinBounds)) },
  ]
  const twinPbrCanvas = document.createElement('canvas')
  twinPbrCanvas.width = 400 * 4
  twinPbrCanvas.height = 36 + 325
  const tctx = twinPbrCanvas.getContext('2d')!
  tctx.fillStyle = '#ffffff'
  tctx.fillRect(0, 0, twinPbrCanvas.width, twinPbrCanvas.height)
  tctx.fillStyle = '#e4eee7'
  tctx.fillRect(0, 0, twinPbrCanvas.width, 36)
  tctx.fillStyle = '#253129'
  tctx.font = '700 14px "Microsoft YaHei", sans-serif'
  tctx.fillText(
    `双叠断层岩 twin-slab 512 PBR (${twinUv.audit.triangles} tris · 解析=${(twinBaked.stats.analyticalHitRate * 100).toFixed(2)}% · 缓存回退=${(twinBaked.stats.cacheFallbackRate * 100).toFixed(2)}% · P95残差=${twinBaked.stats.p95AnalyticalResidual}m)`,
    14, 23,
  )
  for (let i = 0; i < twinShots.length; i++) {
    const x0 = i * 400
    tctx.drawImage(twinShots[i].img, x0 + 8, 44, 384, 295)
    tctx.strokeStyle = '#e2dfd8'
    tctx.strokeRect(x0, 36, 400, 325)
    tctx.fillStyle = '#4a433d'
    tctx.font = '600 12.5px "Microsoft YaHei", sans-serif'
    tctx.textAlign = 'center'
    tctx.fillText(twinShots[i].label, x0 + 200, 353)
  }
  twinMapTex.dispose(); twinNormTex.dispose(); twinAoTex.dispose(); twinMat.dispose()

  // -------------------------------------------------------------------------
  // 3. Controlled Art A/B on block-bluff: locked mesh, Normal, AO, camera & light — ONLY toggling brushMode!
  // -------------------------------------------------------------------------
  const bluffField = createRockV2Field('block-bluff')
  const bluffLow = extractSurfaceNets(bluffField, { resolution: 30, projectToSurface: true })
  const bluffUv = unwrapRockUvCharts(bluffLow, 512, 12)
  const bakedOff = bakeRockV2Textures(bluffField, bluffUv, { size: 512, dilationPasses: 10, brushMode: 'off' })
  const bakedSubtle = bakeRockV2Textures(bluffField, bluffUv, { size: 512, dilationPasses: 10, brushMode: 'subtle' })
  const bluffMapSheet = build4PanelMapSheet('阶梯方巨岩 block-bluff (brush=off)', bakedOff)

  const sharedNormTex = makeTextureFromRgba(bakedOff.normal, 512, false, 'Bluff_Normal')
  const sharedAoTex = makeTextureFromRgba(bakedOff.ao, 512, false, 'Bluff_AO')
  sharedAoTex.channel = 0
  const albedoOffTex = makeTextureFromRgba(bakedOff.albedo, 512, true, 'Bluff_BaseColor_Off')
  const albedoSubtleTex = makeTextureFromRgba(bakedSubtle.albedo, 512, true, 'Bluff_BaseColor_Subtle')

  const matOff = new MeshStandardMaterial({
    name: 'Mat_RockV2_Bluff',
    color: 0xffffff,
    map: albedoOffTex,
    normalMap: sharedNormTex,
    normalScale: new Vector2(1, 1),
    aoMap: sharedAoTex,
    aoMapIntensity: 0.85,
    roughness: 0.90,
    metalness: 0.0,
  })
  const matSubtle = new MeshStandardMaterial({
    name: 'Mat_RockV2_Bluff_Brush',
    color: 0xffffff,
    map: albedoSubtleTex,
    normalMap: sharedNormTex,
    normalScale: new Vector2(1, 1),
    aoMap: sharedAoTex,
    aoMapIntensity: 0.85,
    roughness: 0.90,
    metalness: 0.0,
  })

  clearRoot()
  const bluffGeo = bluffUv.toBufferGeometry()
  const abMesh = new Mesh(bluffGeo, matOff)
  abMesh.castShadow = true
  abMesh.receiveShadow = true
  rootGroup.add(abMesh)
  const bluffBounds = new Box3().setFromObject(rootGroup)
  const bluffCenter = bluffBounds.getCenter(new Vector3())
  const aspect = STAGE_W / STAGE_H
  keyLight.position.set(-4.2, 5.4, 3.6)

  const captureClose = (): string => {
    camera.position.set(bluffCenter.x - 0.15, bluffCenter.y + 0.52, bluffCenter.z + 7.5)
    camera.lookAt(bluffCenter.x - 0.04, bluffCenter.y + 0.12, bluffCenter.z)
    const zc = 0.62
    camera.top = zc; camera.bottom = -zc
    camera.left = -zc * aspect; camera.right = zc * aspect
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)
    return renderer.domElement.toDataURL('image/png')
  }

  const abShots: { title: string; off: HTMLImageElement; subtle: HTMLImageElement }[] = []
  // Hero 45°
  abMesh.material = matOff
  const heroOff = await loadImg(captureClay('angle', bluffBounds))
  abMesh.material = matSubtle
  const heroSub = await loadImg(captureClay('angle', bluffBounds))
  abShots.push({ title: '45° 主视角 Hero (左: 关闭笔触 Off · 右: 低强度定向宽笔触 Subtle)', off: heroOff, subtle: heroSub })

  // Close-up
  abMesh.material = matOff
  const closeOff = await loadImg(captureClose())
  abMesh.material = matSubtle
  const closeSub = await loadImg(captureClose())
  abShots.push({ title: '主斜面与肩棱近景 Close-Up (左: Off · 右: Subtle)', off: closeOff, subtle: closeSub })

  // Game-scale
  abMesh.material = matOff
  const gameOff = await loadImg(captureClay('gameScale', bluffBounds))
  abMesh.material = matSubtle
  const gameSub = await loadImg(captureClay('gameScale', bluffBounds))
  abShots.push({ title: '目标游戏视距 Game-Scale (左: Off · 右: Subtle · 检验层理可读性)', off: gameOff, subtle: gameSub })

  const abW = 540, abH = 420, abHead = 34
  const abCanvas = document.createElement('canvas')
  abCanvas.width = abW * 2 + 24
  abCanvas.height = (abHead + abH) * abShots.length + 12
  const actx = abCanvas.getContext('2d')!
  actx.fillStyle = '#ffffff'
  actx.fillRect(0, 0, abCanvas.width, abCanvas.height)
  for (let r = 0; r < abShots.length; r++) {
    const y0 = 6 + r * (abHead + abH)
    actx.fillStyle = '#e8ede9'
    actx.fillRect(8, y0, abCanvas.width - 16, abHead - 4)
    actx.fillStyle = '#253129'
    actx.font = '700 14px "Microsoft YaHei", sans-serif'
    actx.textAlign = 'left'
    actx.fillText(abShots[r].title, 18, y0 + 20)
    actx.drawImage(abShots[r].off, 8, y0 + abHead, abW, abH - 8)
    actx.drawImage(abShots[r].subtle, 16 + abW, y0 + abHead, abW, abH - 8)
    actx.strokeStyle = '#d8d4cc'
    actx.strokeRect(8, y0 + abHead, abW, abH - 8)
    actx.strokeRect(16 + abW, y0 + abHead, abW, abH - 8)
  }

  // -------------------------------------------------------------------------
  // 4. Multi-Format Non-Uniformly Scaled Exports for Independent Blender 4.2 Verification!
  //    Non-uniform scale (1.35, 0.82, 1.15) + slight Y rotation exercises our fixed merged tangent transform!
  // -------------------------------------------------------------------------
  const exportGroup = new Group()
  exportGroup.name = 'RockV2_NonUniform_Verification'
  const exportMesh = new Mesh(bluffUv.toBufferGeometry(), matOff)
  exportMesh.name = 'RockV2_BlockBluff_NonUniform'
  exportMesh.scale.set(1.35, 0.82, 1.15)
  exportMesh.rotation.set(0, 0.18, 0)
  exportMesh.updateMatrixWorld(true)
  exportGroup.add(exportMesh)
  exportGroup.updateMatrixWorld(true)

  const glbBlob = await exportGlb(exportGroup, { mode: 'merged', excludeDecorations: false })
  const splitBundle = await exportSplitGltfBundle(exportGroup, 'block_bluff_split', { mode: 'merged', excludeDecorations: false })
  const fbxBundle = await exportFbxBundle(exportGroup, 'block_bluff_fbx', { mode: 'merged', excludeDecorations: false })

  const glbNonUniform = await blobToBase64(glbBlob)
  const splitGltfZip = await blobToBase64(splitBundle.toZipBlob())
  const fbxZip = await blobToBase64(fbxBundle.toZipBlob())

  albedoOffTex.dispose(); albedoSubtleTex.dispose(); sharedNormTex.dispose(); sharedAoTex.dispose()
  matOff.dispose(); matSubtle.dispose()
  exportMesh.geometry.dispose()

  return {
    sheets: {
      clay_bluff: bluffClay.dataUrl,
      bluff_maps: bluffMapSheet,
      twin_maps: twinMapSheet,
      twin_pbr: twinPbrCanvas.toDataURL('image/png'),
      art_ab: abCanvas.toDataURL('image/png'),
    },
    exportsB64: {
      glbNonUniform,
      splitGltfZip,
      fbxZip,
    },
    report: {
      bluffClay: { oldTris: bluffClay.oldTris, low: bluffClay.low, high: bluffClay.high },
      bluffBakeOff: bakedOff.stats,
      bluffBakeSubtle: bakedSubtle.stats,
      twinSlabBake: twinBaked.stats,
      twinSlabUv: twinUv.audit,
      exports: {
        glbBytes: glbBlob.size,
        splitFiles: splitBundle.files.map(f => ({ path: f.path, bytes: f.data.length })),
        fbxFiles: fbxBundle.files.map(f => ({ path: f.path, bytes: f.data.length })),
      },
    },
  }
}

async function renderAbClayComparison(): Promise<{
  dataUrl: string
  triptychUrl: string
  metrics: Record<string, unknown>
}> {
  const silhouetteMat = new MeshBasicMaterial({ color: '#383430' })
  const pureClayMat = new MeshStandardMaterial({
    color: '#aba39a',
    roughness: 0.93,
    metalness: 0.0,
  })
  const aspect = STAGE_W / STAGE_H
  // Fixed sculptural upper-left-high key light so sunlit top ramp / mid-shadow steep front cheek / deep-shadow right cliff read in 3 values!
  keyLight.position.set(-4.0, 6.4, 2.0)

  type AbShotKey = 'silhouette' | 'heroOblique' | 'frontLeftSlope' | 'rearOpposite' | 'lowGround'
  const shotConfigs: { key: AbShotKey; label: string; dir: [number, number, number]; zoom: number; isSil?: boolean; lowTarget?: boolean }[] = [
    { key: 'silhouette', label: '① 黑剪影 Silhouette', dir: [0.16, 0.14, 0.98], zoom: 0.56, isSil: true },
    { key: 'heroOblique', label: '② 斜前主视角 Clay', dir: [0.24, 0.34, 0.91], zoom: 0.58 },
    { key: 'frontLeftSlope', label: '③ 左前顺坡 (验斜台)', dir: [-0.76, 0.28, 0.59], zoom: 0.58 },
    { key: 'rearOpposite', label: '④ 侧后145° 反证机位', dir: [0.54, 0.24, -0.81], zoom: 0.58 },
    { key: 'lowGround', label: '⑤ 低机位6° 底脚', dir: [0.10, 0.08, 0.99], zoom: 0.52, lowTarget: true },
  ]

  // Lock ONE shared framing reference box across both A & B so scale differences are 100% honest!
  const refCenter = new Vector3(-0.04, 0.50, -0.02)
  const refSpan = 2.45

  const rowsSpec: { id: RockV2ArchetypeId; res: number; tag: string; isB: boolean }[] = [
    { id: 'sandstone-ledge-a', res: 64, tag: '方案 A · 多楔融合后雕 (N=64 高精)', isB: false },
    { id: 'sandstone-ledge-a', res: 30, tag: '方案 A · 多楔融合后雕 (N=30 低模)', isB: false },
    { id: 'sandstone-ledge-b', res: 64, tag: '方案 B · 单偏心斜楔减切 (N=64 高精)', isB: true },
    { id: 'sandstone-ledge-b', res: 30, tag: '方案 B · 单偏心斜楔减切 (N=30 低模)', isB: true },
  ]

  const renderedRows: { title: string; isB: boolean; cells: { label: string; img: HTMLImageElement }[] }[] = []
  const metrics: Record<string, unknown> = {}

  for (const row of rowsSpec) {
    const field = createRockV2Field(row.id)
    const extracted = extractSurfaceNets(field, { resolution: row.res, projectToSurface: true })
    const geo = extracted.toBufferGeometry()
    const mesh = new Mesh<typeof geo, Material>(geo, pureClayMat)
    mesh.castShadow = true
    mesh.receiveShadow = true

    clearRoot()
    rootGroup.add(mesh)
    const b = new Box3().setFromObject(rootGroup)
    const sz = b.getSize(new Vector3())
    metrics[`${row.id}_N${row.res}`] = {
      ...extracted.audit,
      size: [Number(sz.x.toFixed(3)), Number(sz.y.toFixed(3)), Number(sz.z.toFixed(3))],
      timings: extracted.timings,
    }

    const cells: { label: string; img: HTMLImageElement }[] = []
    for (const sc of shotConfigs) {
      mesh.material = sc.isSil ? silhouetteMat : pureClayMat
      floor.visible = !sc.isSil
      scene.background = new Color(sc.isSil ? '#f7f3ec' : '#f2efe9')
      const dir = new Vector3(sc.dir[0], sc.dir[1], sc.dir[2]).normalize()
      const target = sc.lowTarget ? new Vector3(refCenter.x, 0.34, refCenter.z) : refCenter.clone()
      camera.position.copy(target).addScaledVector(dir, 9)
      camera.lookAt(target)
      const halfH = refSpan * sc.zoom
      camera.top = halfH
      camera.bottom = -halfH
      camera.left = -halfH * aspect
      camera.right = halfH * aspect
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
      cells.push({ label: sc.label, img: await loadImg(renderer.domElement.toDataURL('image/png')) })
    }
    floor.visible = true
    scene.background = new Color('#f3f1ec')

    renderedRows.push({
      title: `${row.tag} — ${extracted.audit.triangles} tris · ${extracted.timings.totalMs}ms · 尺寸 ${sz.x.toFixed(2)}×${sz.y.toFixed(2)}×${sz.z.toFixed(2)}m · 壳=${extracted.audit.connectedComponents} · 错边=${extracted.audit.openEdges}/${extracted.audit.nonManifoldEdges} · 自交=${extracted.audit.selfIntersections}`,
      isB: row.isB,
      cells,
    })
  }

  silhouetteMat.dispose()
  pureClayMat.dispose()

  const cellW = 360
  const cellH = 290
  const headH = 34
  const pad = 6
  const canvas = document.createElement('canvas')
  canvas.width = cellW * shotConfigs.length
  canvas.height = (headH + cellH) * renderedRows.length
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let r = 0; r < renderedRows.length; r++) {
    const y0 = r * (headH + cellH)
    ctx.fillStyle = renderedRows[r].isB ? '#e2eee5' : '#efe8df'
    ctx.fillRect(0, y0, canvas.width, headH)
    ctx.fillStyle = '#243028'
    ctx.font = '700 14px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(renderedRows[r].title, 12, y0 + 22)
    for (let c = 0; c < renderedRows[r].cells.length; c++) {
      const x0 = c * cellW
      const cy0 = y0 + headH
      ctx.drawImage(renderedRows[r].cells[c].img, x0 + pad, cy0 + pad, cellW - pad * 2, cellH - 28)
      ctx.strokeStyle = '#e2dfd8'
      ctx.lineWidth = 1
      ctx.strokeRect(x0, cy0, cellW, cellH)
      ctx.fillStyle = '#4e4740'
      ctx.font = '600 12px "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(renderedRows[r].cells[c].label, x0 + cellW * 0.5, cy0 + cellH - 7)
    }
  }

  // Bonus: Render Winning Method B (N=30 single mesh!) as a 1:1 Triptych (Silhouette | Pure Clay | 512 PBR)
  // directly comparable to concept-shape-clay-color.png (all 3 panels from the EXACT SAME 3D mesh!)
  const bField = createRockV2Field('sandstone-ledge-b')
  const bLow = extractSurfaceNets(bField, { resolution: 30, projectToSurface: true })
  const bUv = unwrapRockUvCharts(bLow, 512, 12)
  const bBaked = bakeRockV2Textures(bField, bUv, { size: 512, dilationPasses: 10, brushMode: 'subtle', baseColorHex: '#caa57c' })
  metrics.sandstoneLedgeB_N30_bake = bBaked.stats
  metrics.sandstoneLedgeB_N30_uv = bUv.audit

  const bMapTex = makeTextureFromRgba(bBaked.albedo, 512, true, 'LedgeB_BaseColor')
  const bNormTex = makeTextureFromRgba(bBaked.normal, 512, false, 'LedgeB_Normal')
  const bAoTex = makeTextureFromRgba(bBaked.ao, 512, false, 'LedgeB_AO')
  bAoTex.channel = 0
  const bPbrMat = new MeshStandardMaterial({
    name: 'Mat_SandstoneLedgeB_PBR',
    color: 0xffffff,
    map: bMapTex,
    normalMap: bNormTex,
    normalScale: new Vector2(1, 1),
    aoMap: bAoTex,
    aoMapIntensity: 0.85,
    roughness: 0.90,
    metalness: 0.0,
  })
  const tripSilMat = new MeshBasicMaterial({ color: '#383430' })
  const tripClayMat = new MeshStandardMaterial({ color: '#a8a098', roughness: 0.93, metalness: 0.0 })

  clearRoot()
  const bGeo = bUv.toBufferGeometry()
  const bMesh = new Mesh<typeof bGeo, Material>(bGeo, tripClayMat)
  bMesh.castShadow = true
  bMesh.receiveShadow = true
  rootGroup.add(bMesh)

  const tripDir = new Vector3(0.24, 0.30, 0.92).normalize()
  camera.position.copy(refCenter).addScaledVector(tripDir, 9)
  camera.lookAt(refCenter)
  const tripHalfH = refSpan * 0.56
  camera.top = tripHalfH; camera.bottom = -tripHalfH
  camera.left = -tripHalfH * aspect; camera.right = tripHalfH * aspect
  camera.updateProjectionMatrix()

  const tripImgs: { label: string; img: HTMLImageElement }[] = []
  // 1. Silhouette
  bMesh.material = tripSilMat
  floor.visible = false
  scene.background = new Color('#f7f3ec')
  renderer.render(scene, camera)
  tripImgs.push({ label: `① 黑剪影（同网格 ${bUv.audit.triangles} tris）`, img: await loadImg(renderer.domElement.toDataURL('image/png')) })
  // 2. Pure Clay
  bMesh.material = tripClayMat
  floor.visible = true
  scene.background = new Color('#f5f1ea')
  renderer.render(scene, camera)
  tripImgs.push({ label: '② 纯灰模（零贴图，检验形体与 3 阶明暗）', img: await loadImg(renderer.domElement.toDataURL('image/png')) })
  // 3. Standard 512 PBR
  bMesh.material = bPbrMat
  renderer.render(scene, camera)
  tripImgs.push({
    label: `③ 标准 512 PBR（解析命中 ${(bBaked.stats.analyticalHitRate * 100).toFixed(2)}% · 零自定义 Shader）`,
    img: await loadImg(renderer.domElement.toDataURL('image/png')),
  })
  bMapTex.dispose(); bNormTex.dispose(); bAoTex.dispose(); bPbrMat.dispose(); tripSilMat.dispose(); tripClayMat.dispose()

  const tripCanvas = document.createElement('canvas')
  const tW = 520, tH = 420
  tripCanvas.width = tW * 3 + 32
  tripCanvas.height = tH + 56
  const tctx = tripCanvas.getContext('2d')!
  tctx.fillStyle = '#ffffff'
  tctx.fillRect(0, 0, tripCanvas.width, tripCanvas.height)
  tctx.fillStyle = '#e2eee5'
  tctx.fillRect(0, 0, tripCanvas.width, 36)
  tctx.fillStyle = '#243028'
  tctx.font = '700 15px "Microsoft YaHei", sans-serif'
  tctx.fillText(`方案 B（单偏心斜楔减切）同网格三联图 · N=30 低模 (${bUv.audit.triangles} tris · 0 拓扑缺陷 · 512 PBR 烘焙 ${bBaked.stats.timings.totalBakeMs}ms)`, 14, 23)
  for (let i = 0; i < 3; i++) {
    const x0 = 8 + i * (tW + 8)
    tctx.drawImage(tripImgs[i].img, x0, 42, tW, tH - 18)
    tctx.strokeStyle = '#dfd9cf'
    tctx.strokeRect(x0, 42, tW, tH + 6)
    tctx.fillStyle = '#47403a'
    tctx.font = '600 13px "Microsoft YaHei", sans-serif'
    tctx.textAlign = 'center'
    tctx.fillText(tripImgs[i].label, x0 + tW * 0.5, 42 + tH - 1)
  }

  return { dataUrl: canvas.toDataURL('image/png'), triptychUrl: tripCanvas.toDataURL('image/png'), metrics }
}

async function renderEdgeDiagnosisSheet(): Promise<{
  dataUrl: string
  stats: Record<string, unknown>
}> {
  const field = createRockV2Field('sandstone-ledge-b')
  const low = extractSurfaceNets(field, { resolution: 30, projectToSurface: true })
  const high = extractSurfaceNets(field, { resolution: 64, projectToSurface: true })
  const uv = unwrapRockUvCharts(low, 512, 12)
  const baked = bakeRockV2Textures(field, uv, { size: 512, dilationPasses: 10, brushMode: 'subtle', baseColorHex: '#caa57c' })

  const mapTex = makeTextureFromRgba(baked.albedo, 512, true, 'Diag_Base')
  const normTex = makeTextureFromRgba(baked.normal, 512, false, 'Diag_Norm')
  const aoTex = makeTextureFromRgba(baked.ao, 512, false, 'Diag_AO')
  aoTex.channel = 0
  const pbrMat = new MeshStandardMaterial({
    color: 0xffffff,
    map: mapTex,
    normalMap: normTex,
    normalScale: new Vector2(1, 1),
    aoMap: aoTex,
    aoMapIntensity: 0.85,
    roughness: 0.90,
    metalness: 0.0,
  })
  const clayMatDiag = new MeshStandardMaterial({ color: '#b4aca2', roughness: 0.92, metalness: 0.0 })
  const darkWire = new MeshBasicMaterial({ color: '#1b2620', wireframe: true, transparent: true, opacity: 0.62 })

  // Build chart-ID colored BufferGeometry (unshared per-tri vertex colors) to reveal jagged sawtooth UV seams!
  const chartPalette = [
    [0.86, 0.36, 0.34], [0.30, 0.66, 0.48], [0.34, 0.54, 0.86], [0.88, 0.68, 0.28],
    [0.68, 0.42, 0.78], [0.28, 0.72, 0.76], [0.85, 0.50, 0.32], [0.56, 0.74, 0.34],
  ]
  const uvGeo = uv.toBufferGeometry()
  const idxArr = uv.indices
  const posArr = uv.positions
  const nrmArr = uv.normals
  const tCount = idxArr.length / 3
  const chartPos = new Float32Array(tCount * 9)
  const chartNrm = new Float32Array(tCount * 9)
  const chartCol = new Float32Array(tCount * 9)
  for (let t = 0; t < tCount; t++) {
    const cid = uv.triChartIds[t]
    const rgb = chartPalette[Math.abs(cid) % chartPalette.length]
    for (let k = 0; k < 3; k++) {
      const vi = idxArr[t * 3 + k]
      const o = (t * 3 + k) * 3
      chartPos[o] = posArr[vi * 3]; chartPos[o + 1] = posArr[vi * 3 + 1]; chartPos[o + 2] = posArr[vi * 3 + 2]
      chartNrm[o] = nrmArr[vi * 3]; chartNrm[o + 1] = nrmArr[vi * 3 + 1]; chartNrm[o + 2] = nrmArr[vi * 3 + 2]
      chartCol[o] = rgb[0]; chartCol[o + 1] = rgb[1]; chartCol[o + 2] = rgb[2]
    }
  }
  const chartGeo = uvGeo.clone()
  chartGeo.setIndex(null)
  chartGeo.setAttribute('position', new (uvGeo.getAttribute('position').constructor as typeof import('three').BufferAttribute)(chartPos, 3))
  chartGeo.setAttribute('normal', new (uvGeo.getAttribute('normal').constructor as typeof import('three').BufferAttribute)(chartNrm, 3))
  chartGeo.setAttribute('color', new (uvGeo.getAttribute('position').constructor as typeof import('three').BufferAttribute)(chartCol, 3))
  const chartMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 })

  const aspect = STAGE_W / STAGE_H
  keyLight.position.set(-4.0, 6.2, 2.4)
  floor.visible = false
  scene.background = new Color('#f5f1ea')

  // Camera matching user's exact red-circled screenshot angle (low front-left oblique looking up at ramp & shoulder)
  const userDir = new Vector3(-0.34, 0.14, 0.93).normalize()
  const targetFull = new Vector3(-0.02, 0.48, 0.0)
  const targetZoom = new Vector3(-0.18, 0.62, 0.02)

  const setCam = (target: Vector3, halfH: number) => {
    camera.position.copy(target).addScaledVector(userDir, 8.5)
    camera.lookAt(target)
    camera.top = halfH; camera.bottom = -halfH
    camera.left = -halfH * aspect; camera.right = halfH * aspect
    camera.updateProjectionMatrix()
  }

  const shots: { label: string; img: HTMLImageElement }[] = []

  // Shot 1: N=30 PBR + Wireframe at user's exact angle
  clearRoot()
  const m1 = new Mesh(uvGeo, pbrMat)
  const w1 = new Mesh(uvGeo.clone(), darkWire)
  w1.scale.setScalar(1.0015)
  rootGroup.add(m1, w1)
  setCam(targetFull, 0.92)
  renderer.render(scene, camera)
  shots.push({ label: `① N=30 PBR + 线框（同用户视角 · 体素步长 h=${low.voxelSize.toFixed(3)}m）`, img: await loadImg(renderer.domElement.toDataURL('image/png')) })

  // Shot 2: Close-up zoom on the red-circled ridge & shoulder corner in N=30 clay + wireframe
  clearRoot()
  const m2 = new Mesh(uvGeo.clone(), clayMatDiag)
  const w2 = new Mesh(uvGeo.clone(), darkWire)
  w2.scale.setScalar(1.0015)
  rootGroup.add(m2, w2)
  setCam(targetZoom, 0.54)
  renderer.render(scene, camera)
  shots.push({ label: '② N=30 红圈局部放大（体素对角锯齿 + 跨折痕桥接三角）', img: await loadImg(renderer.domElement.toDataURL('image/png')) })

  // Shot 3: Same close-up zoom on N=64 clay + wireframe
  clearRoot()
  const highGeo = high.toBufferGeometry()
  const m3 = new Mesh(highGeo, clayMatDiag)
  const w3 = new Mesh(highGeo.clone(), darkWire)
  w3.scale.setScalar(1.001)
  rootGroup.add(m3, w3)
  setCam(targetZoom, 0.54)
  renderer.render(scene, camera)
  shots.push({ label: `③ 同位 N=64 放大（h=${high.voxelSize.toFixed(3)}m · 锯齿缩小但仍存在斜向微阶梯）`, img: await loadImg(renderer.domElement.toDataURL('image/png')) })

  // Shot 4: Same close-up zoom showing UV Chart IDs + dark elbow artifacts
  clearRoot()
  const m4 = new Mesh(chartGeo, chartMat)
  const w4 = new Mesh(uvGeo.clone(), darkWire)
  w4.scale.setScalar(1.0015)
  rootGroup.add(m4, w4)
  setCam(targetZoom, 0.54)
  renderer.render(scene, camera)
  shots.push({ label: '④ N=30 UV 分片色块（锯齿三角导致 UV 接缝呈锯齿爬行，引发肩肘/棱边暗咬痕）', img: await loadImg(renderer.domElement.toDataURL('image/png')) })

  floor.visible = true
  mapTex.dispose(); normTex.dispose(); aoTex.dispose(); pbrMat.dispose()
  clayMatDiag.dispose(); darkWire.dispose(); chartMat.dispose()

  const cw = 600, ch = 460, head = 34
  const canvas = document.createElement('canvas')
  canvas.width = cw * 2 + 24
  canvas.height = (ch + head) * 2 + 16
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = Math.floor(i / 2)
    const x0 = 8 + col * (cw + 8), y0 = 8 + row * (ch + head + 4)
    ctx.fillStyle = '#e8ede9'
    ctx.fillRect(x0, y0, cw, head - 4)
    ctx.fillStyle = '#243028'
    ctx.font = '700 13px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(shots[i].label, x0 + 10, y0 + 20)
    ctx.drawImage(shots[i].img, x0, y0 + head, cw, ch - 4)
    ctx.strokeStyle = '#dcd6cc'
    ctx.strokeRect(x0, y0, cw, ch + head - 4)
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    stats: {
      lowVoxelSizeM: Number(low.voxelSize.toFixed(4)),
      highVoxelSizeM: Number(high.voxelSize.toFixed(4)),
      lowTris: low.audit.triangles,
      highTris: high.audit.triangles,
      uvChartCount: uv.audit.chartCount,
      bakeHitRate: baked.stats.analyticalHitRate,
      bakeCacheFallback: baked.stats.cacheFallbackRate,
    },
  }
}

/** Draws a 2D cross-section slice comparing analytical SDF zero-contour (red) vs extracted mesh segments (ink). */
function renderCrossSectionCanvas(
  title: string,
  meshSegs: SectionSegment2D[],
  evalSdf2D: (u: number, v: number) => number,
  uRange: [number, number],
  vRange: [number, number],
  w: number,
  h: number,
  meshColor = '#1d5fa8',
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#faf8f4'
  ctx.fillRect(0, 0, w, h)

  const padL = 36, padR = 16, padT = 30, padB = 26
  const pw = w - padL - padR
  const ph = h - padT - padB
  const [uMin, uMax] = uRange
  const [vMin, vMax] = vRange
  const toX = (u: number) => padL + ((u - uMin) / (uMax - uMin)) * pw
  const toY = (v: number) => padT + ph - ((v - vMin) / (vMax - vMin)) * ph

  // Subtle 10cm metric grid
  ctx.strokeStyle = '#e7e2d9'
  ctx.lineWidth = 1
  for (let u = Math.ceil(uMin * 10) / 10; u <= uMax; u += 0.1) {
    const x = toX(u)
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke()
  }
  for (let v = Math.ceil(vMin * 10) / 10; v <= vMax; v += 0.1) {
    const y = toY(v)
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke()
  }

  // Analytical SDF interior shading + zero contour (marching squares on 140x140 grid)
  const GN = 120
  const grid = new Float32Array((GN + 1) * (GN + 1))
  for (let j = 0; j <= GN; j++) {
    const vv = vMin + (j / GN) * (vMax - vMin)
    for (let i = 0; i <= GN; i++) {
      const uu = uMin + (i / GN) * (uMax - uMin)
      grid[j * (GN + 1) + i] = evalSdf2D(uu, vv)
    }
  }
  // Light warm fill for analytical SDF interior
  const imgData = ctx.getImageData(padL, padT, pw, ph)
  for (let py = 0; py < ph; py++) {
    const v = vMax - (py / ph) * (vMax - vMin)
    const fy = clamp01((v - vMin) / (vMax - vMin)) * GN
    const j0 = Math.min(GN - 1, Math.floor(fy))
    const ty = fy - j0
    for (let px = 0; px < pw; px++) {
      const u = uMin + (px / pw) * (uMax - uMin)
      const fx = clamp01((u - uMin) / (uMax - uMin)) * GN
      const i0 = Math.min(GN - 1, Math.floor(fx))
      const tx = fx - i0
      const f00 = grid[j0 * (GN + 1) + i0], f10 = grid[j0 * (GN + 1) + i0 + 1]
      const f01 = grid[(j0 + 1) * (GN + 1) + i0], f11 = grid[(j0 + 1) * (GN + 1) + i0 + 1]
      const val = (f00 * (1 - tx) + f10 * tx) * (1 - ty) + (f01 * (1 - tx) + f11 * tx) * ty
      if (val <= 0) {
        const idx = (py * pw + px) * 4
        imgData.data[idx] = Math.round(imgData.data[idx] * 0.92)
        imgData.data[idx + 1] = Math.round(imgData.data[idx + 1] * 0.88)
        imgData.data[idx + 2] = Math.round(imgData.data[idx + 2] * 0.84)
      }
    }
  }
  ctx.putImageData(imgData, padL, padT)

  // Draw red dashed analytical SDF zero contour
  ctx.strokeStyle = 'rgba(215, 58, 52, 0.85)'
  ctx.lineWidth = 1.6
  ctx.setLineDash([4, 3])
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const u0 = uMin + (i / GN) * (uMax - uMin), u1 = uMin + ((i + 1) / GN) * (uMax - uMin)
      const v0 = vMin + (j / GN) * (vMax - vMin), v1 = vMin + ((j + 1) / GN) * (vMax - vMin)
      const f00 = grid[j * (GN + 1) + i], f10 = grid[j * (GN + 1) + i + 1]
      const f11 = grid[(j + 1) * (GN + 1) + i + 1], f01 = grid[(j + 1) * (GN + 1) + i]
      const pts: [number, number][] = []
      const interp = (a: number, b: number, fa: number, fb: number) => a + (b - a) * (fa / (fa - fb))
      if ((f00 <= 0) !== (f10 <= 0)) pts.push([interp(u0, u1, f00, f10), v0])
      if ((f10 <= 0) !== (f11 <= 0)) pts.push([u1, interp(v0, v1, f10, f11)])
      if ((f11 <= 0) !== (f01 <= 0)) pts.push([interp(u1, u0, f11, f01), v1])
      if ((f01 <= 0) !== (f00 <= 0)) pts.push([u0, interp(v1, v0, f01, f00)])
      if (pts.length >= 2) {
        ctx.beginPath()
        ctx.moveTo(toX(pts[0][0]), toY(pts[0][1]))
        ctx.lineTo(toX(pts[1][0]), toY(pts[1][1]))
        ctx.stroke()
      }
    }
  }
  ctx.setLineDash([])

  // Draw actual extracted mesh triangle intersection segments (solid bold!)
  ctx.strokeStyle = meshColor
  ctx.lineWidth = 2.4
  for (const s of meshSegs) {
    ctx.beginPath()
    ctx.moveTo(toX(s.u0), toY(s.v0))
    ctx.lineTo(toX(s.u1), toY(s.v1))
    ctx.stroke()
  }
  // Highlight actual triangle vertices along the cross-section
  ctx.fillStyle = meshColor
  for (const s of meshSegs) {
    ctx.fillRect(toX(s.u0) - 2, toY(s.v0) - 2, 4, 4)
  }

  // Highlight the exact shoulder-elbow notch center (u=0, v=0) with a subtle dashed amber ring
  const cx0 = toX(0), cy0 = toY(0)
  if (cx0 > padL + 10 && cx0 < padL + pw - 10 && cy0 > padT + 10 && cy0 < padT + ph - 10) {
    ctx.save()
    ctx.strokeStyle = 'rgba(217, 119, 6, 0.72)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.arc(cx0, cy0, Math.min(pw, ph) * 0.18, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  ctx.strokeStyle = '#c8c2b8'
  ctx.lineWidth = 1
  ctx.strokeRect(padL, padT, pw, ph)

  ctx.fillStyle = '#243028'
  ctx.font = '700 12px "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(title, 8, 19)
  ctx.fillStyle = '#5e5750'
  ctx.font = '11px "Microsoft YaHei", sans-serif'
  ctx.fillText('红虚线=解析SDF零面 · 实线=实测网格截面 (格距10cm)', padL, h - 8)
  return c
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

async function renderRouteCPocBundle(
  preset: PolyCsgPresetId = 'sandstone-ledge-c2',
): Promise<{
  sheets: Record<string, string>
  report: Record<string, unknown>
}> {
  const isBluff = preset === 'block-bluff-c2'
  const field = createRockV2Field(isBluff ? 'block-bluff' : 'sandstone-ledge-b')
  const sdfLow = extractSurfaceNets(field, { resolution: 30, projectToSurface: true })
  const sdfHigh = extractSurfaceNets(field, { resolution: 64, projectToSurface: true })
  const c1 = isBluff ? await buildBlockBluffRouteC('c1') : await buildSandstoneLedgeRouteC('c1')
  const c2 = isBluff ? await buildBlockBluffRouteC('c2') : await buildSandstoneLedgeRouteC('c2')

  // Cross-section plane slicing perpendicularly right across the shoulder elbow fracture notch
  // Strictly orthonormalize (sliceU, sliceV, sliceN) so 2D cross-section plots have ZERO shear distortion!
  const sliceOrigin: Vec3 = isBluff ? { x: -0.02, y: 0.72, z: 0.34 } : { x: -0.02, y: 0.49, z: 0.28 }
  const sliceV = vNorm(isBluff ? { x: -0.16, y: 0.92, z: 0.36 } : { x: -0.26, y: 0.88, z: 0.39 })
  const rawU = vNorm(isBluff ? { x: 0.82, y: -0.18, z: -0.54 } : { x: 0.78, y: -0.22, z: -0.58 })
  const dUV = rawU.x * sliceV.x + rawU.y * sliceV.y + rawU.z * sliceV.z
  const sliceU = vNorm({
    x: rawU.x - sliceV.x * dUV,
    y: rawU.y - sliceV.y * dUV,
    z: rawU.z - sliceV.z * dUV,
  })
  const sliceN = vNorm({
    x: sliceU.y * sliceV.z - sliceU.z * sliceV.y,
    y: sliceU.z * sliceV.x - sliceU.x * sliceV.z,
    z: sliceU.x * sliceV.y - sliceU.y * sliceV.x,
  })

  const evalSdfOnSlice = (u: number, v: number) => {
    const px = sliceOrigin.x + sliceU.x * u + sliceV.x * v
    const py = sliceOrigin.y + sliceU.y * u + sliceV.y * v
    const pz = sliceOrigin.z + sliceU.z * u + sliceV.z * v
    return field.evalMacro(px, py, pz)
  }

  // Shift slice origin into each mesh's exact 3D coordinate space (`p_mesh = p_sdf + shift`)!
  // Surface Nets shifts (x, y, z) to center horizontally & ground minY=0; Route C only shifts y.
  const sliceWithShift = (pos: Float32Array, idx: Uint32Array, shift: Vec3) =>
    sliceMeshByPlane(
      pos,
      idx,
      { x: sliceOrigin.x + shift.x, y: sliceOrigin.y + shift.y, z: sliceOrigin.z + shift.z },
      sliceN,
      sliceU,
      sliceV,
    )

  const segsLow = sliceWithShift(sdfLow.positions, sdfLow.indices, sdfLow.shift)
  const segsHigh = sliceWithShift(sdfHigh.positions, sdfHigh.indices, sdfHigh.shift)
  const segsC1 = sliceWithShift(c1.positions, c1.indices, { x: 0, y: c1.shiftY, z: 0 })
  const segsC2 = sliceWithShift(c2.positions, c2.indices, { x: 0, y: c2.shiftY, z: 0 })

  // =========================================================================
  // SHEET 1: Shoulder-Elbow Dark Stain 4-Channel Isolation + Cross-Section (on existing N=30 SDF!)
  // =========================================================================
  const uvLow = unwrapRockUvCharts(sdfLow, 512, 12)
  const bakedLow = bakeRockV2Textures(field, uvLow, { size: 512, dilationPasses: 10, brushMode: 'subtle', baseColorHex: '#caa57c' })
  const mapTex = makeTextureFromRgba(bakedLow.albedo, 512, true, 'Iso_Base')
  const normTex = makeTextureFromRgba(bakedLow.normal, 512, false, 'Iso_Norm')
  const aoTex = makeTextureFromRgba(bakedLow.ao, 512, false, 'Iso_AO')
  aoTex.channel = 0

  const matIsoClay = new MeshStandardMaterial({ color: '#c8c2ba', roughness: 0.90, metalness: 0.0 })
  const matIsoNorm = new MeshStandardMaterial({ color: '#e6e2dc', normalMap: normTex, normalScale: new Vector2(1, 1), roughness: 0.90, metalness: 0.0 })
  const matIsoAo = new MeshStandardMaterial({ color: '#e6e2dc', aoMap: aoTex, aoMapIntensity: 0.85, roughness: 0.90, metalness: 0.0 })
  const matIsoFull = new MeshStandardMaterial({ color: 0xffffff, map: mapTex, normalMap: normTex, normalScale: new Vector2(1, 1), aoMap: aoTex, aoMapIntensity: 0.85, roughness: 0.90, metalness: 0.0 })

  const aspect = STAGE_W / STAGE_H
  keyLight.position.set(-4.0, 6.4, 2.2)
  const userDir = new Vector3(-0.34, 0.14, 0.93).normalize()
  const targetUser = isBluff ? new Vector3(-0.02, 0.68, 0.0) : new Vector3(-0.04, 0.48, 0.0)
  const heroHalfH = isBluff ? 1.08 : 0.88

  const setFixedCam = (dirV: Vector3, targetV: Vector3, halfH: number) => {
    camera.position.copy(targetV).addScaledVector(dirV, 8.8)
    camera.lookAt(targetV)
    camera.top = halfH; camera.bottom = -halfH
    camera.left = -halfH * aspect; camera.right = halfH * aspect
    camera.updateProjectionMatrix()
  }

  clearRoot()
  const isoGeo = uvLow.toBufferGeometry()
  const isoMesh = new Mesh<typeof isoGeo, Material>(isoGeo, matIsoClay)
  isoMesh.castShadow = true; isoMesh.receiveShadow = true
  rootGroup.add(isoMesh)
  floor.visible = true
  scene.background = new Color('#f4f1ea')
  setFixedCam(userDir, targetUser, heroHalfH)

  const isoShots: { label: string; img: HTMLImageElement }[] = []
  for (const [m, lbl] of [
    [matIsoClay, '① 纯灰模（无 Normal / 无 AO）'],
    [matIsoNorm, '② 只开 Normal（白底 · 无 AO）'],
    [matIsoAo, '③ 只开 AO（白底 · 无 Normal）'],
    [matIsoFull, '④ 完整 512 PBR（Base + Normal + AO）'],
  ] as [Material, string][]) {
    isoMesh.material = m
    renderer.render(scene, camera)
    isoShots.push({ label: lbl, img: await loadImg(renderer.domElement.toDataURL('image/png')) })
  }
  mapTex.dispose(); normTex.dispose(); aoTex.dispose()
  matIsoClay.dispose(); matIsoNorm.dispose(); matIsoAo.dispose(); matIsoFull.dispose()

  const isoSliceLow = renderCrossSectionCanvas('⑤ 现有 N=30 肩肘垂直截面（蓝=网格，红虚=设计槽口，橙圈=槽口中心）', segsLow, evalSdfOnSlice, [-0.36, 0.36], [-0.28, 0.28], 600, 340, '#1d5fa8')
  const isoSliceC2 = renderCrossSectionCanvas('⑥ 路线 C2 同位肩肘截面（绿=显式布尔网格，橙圈=V槽完全敞开）', segsC2, evalSdfOnSlice, [-0.36, 0.36], [-0.28, 0.28], 600, 340, '#1b7a46')

  const isoCanvas = document.createElement('canvas')
  isoCanvas.width = 1224
  isoCanvas.height = 420 * 2 + 360 + 36
  const ictx = isoCanvas.getContext('2d')!
  ictx.fillStyle = '#ffffff'
  ictx.fillRect(0, 0, isoCanvas.width, isoCanvas.height)
  ictx.fillStyle = '#efe8df'
  ictx.fillRect(0, 0, isoCanvas.width, 34)
  ictx.fillStyle = '#243028'
  ictx.font = '700 14px "Microsoft YaHei", sans-serif'
  ictx.fillText('证据链 1 · 肩肘暗咬痕 4 通道隔离排查（同网格 N=30 · 同用户红圈机位）+ 肩肘垂直截面对照', 12, 22)
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = Math.floor(i / 2)
    const x0 = 8 + col * 608, y0 = 40 + row * 416
    ictx.fillStyle = '#e8ede9'
    ictx.fillRect(x0, y0, 600, 26)
    ictx.fillStyle = '#243028'
    ictx.font = '700 12.5px "Microsoft YaHei", sans-serif'
    ictx.fillText(isoShots[i].label, x0 + 8, y0 + 17)
    ictx.drawImage(isoShots[i].img, x0, y0 + 26, 600, 384)
    ictx.strokeStyle = '#ddd7ce'
    ictx.strokeRect(x0, y0, 600, 410)
  }
  ictx.drawImage(isoSliceLow, 8, 876)
  ictx.drawImage(isoSliceC2, 616, 876)

  // =========================================================================
  // SHEET 2: 3-Row Locked Grey-Box Comparison (N=64 SDF vs Route C1 Sharp vs Route C2 Local Bevel)
  //   Columns: ① Silhouette + GameScale | ② User Oblique Clay | ③ Oblique Wireframe | ④ 145° Rear-Opposite | ⑤ Low 6° Foot | ⑥ Elbow Cross-Section
  // =========================================================================
  const silMat = new MeshBasicMaterial({ color: '#383430' })
  const pureClayMat = new MeshStandardMaterial({ color: '#ada59c', roughness: 0.93, metalness: 0.0 })
  const wireOverlayMat = new MeshBasicMaterial({ color: '#1b2620', wireframe: true, transparent: true, opacity: 0.56 })

  const refCenter = isBluff ? new Vector3(-0.02, 0.70, -0.02) : new Vector3(-0.04, 0.50, -0.02)
  const dirHeroOblique = new Vector3(0.24, 0.32, 0.91).normalize()
  const dirRear145 = new Vector3(0.54, 0.24, -0.81).normalize()
  const dirLow6 = new Vector3(0.10, 0.08, 0.99).normalize()

  interface RowDef {
    title: string
    bgHead: string
    geo: BufferGeometry
    segs: SectionSegment2D[]
    sliceColor: string
  }
  const rows: RowDef[] = [
    {
      title: `基线 · 现有 SDF N=64 (${sdfHigh.audit.triangles} tris · ${sdfHigh.timings.totalMs}ms · 壳=${sdfHigh.audit.connectedComponents} · 错边=${sdfHigh.audit.openEdges}/${sdfHigh.audit.nonManifoldEdges} · 自交=${sdfHigh.audit.selfIntersections})`,
      bgHead: '#efe8df',
      geo: sdfHigh.toBufferGeometry(),
      segs: segsHigh,
      sliceColor: '#1d5fa8',
    },
    {
      title: `路线 C1 · 显式锐边基底 Manifold (${c1.audit.triangles} tris · ${c1.audit.buildMs}ms · 面组=${c1.audit.faceGroups} · 状态=${c1.audit.manifoldStatus} · 原始壳=${c1.audit.rawManifoldComponents} · 错边=${c1.audit.openEdges}/${c1.audit.nonManifoldEdges} · 自交=${c1.audit.selfIntersections})`,
      bgHead: '#e5edf4',
      geo: c1.toBufferGeometry(18),
      segs: segsC1,
      sliceColor: '#6d3fa0',
    },
    {
      title: `路线 C2 · 显式局部几何倒角版 Manifold (${c2.audit.triangles} tris · ${c2.audit.buildMs}ms · 面组=${c2.audit.faceGroups} · 状态=${c2.audit.manifoldStatus} · 原始壳=${c2.audit.rawManifoldComponents} · 错边=${c2.audit.openEdges}/${c2.audit.nonManifoldEdges} · 自交=${c2.audit.selfIntersections})`,
      bgHead: '#e2eee5',
      geo: c2.toBufferGeometry(24),
      segs: segsC2,
      sliceColor: '#1b7a46',
    },
  ]

  const cellW = 340, cellH = 276, headH = 34
  const cmpCanvas = document.createElement('canvas')
  cmpCanvas.width = cellW * 6
  cmpCanvas.height = (headH + cellH) * rows.length
  const cctx = cmpCanvas.getContext('2d')!
  cctx.fillStyle = '#ffffff'
  cctx.fillRect(0, 0, cmpCanvas.width, cmpCanvas.height)

  const colLabels = [
    '① 纯剪影（用户视角 · 含游戏尺缩略）',
    '② 斜前主视角灰模（用户红圈同机位）',
    '③ 斜前灰模 + 线框（验特征边对齐）',
    '④ 145° 侧后反证机位灰模',
    '⑤ 低机位 6° 底脚灰模',
    '⑥ 肩肘垂直截面（网格 vs 解析轮廓）',
  ]

  // Capture zoom & turntable data simultaneously for Sheet 3!
  const zoomRow: { label: string; clay: HTMLImageElement; sil: HTMLImageElement }[] = []
  const rotSets: { tag: string; angles: { deg: number; img: HTMLImageElement }[] }[] = []

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    clearRoot()
    const mesh = new Mesh<BufferGeometry, Material>(row.geo, pureClayMat)
    mesh.castShadow = true; mesh.receiveShadow = true
    const wire = new Mesh(row.geo.clone(), wireOverlayMat)
    wire.scale.setScalar(1.0012)
    wire.visible = false
    rootGroup.add(mesh, wire)

    const cellImgs: (HTMLImageElement | HTMLCanvasElement)[] = []

    // Col 1: Silhouette at user's red-circled angle + inset game-scale clay
    mesh.material = silMat; wire.visible = false; floor.visible = false
    scene.background = new Color('#f7f3ec')
    setFixedCam(userDir, targetUser, isBluff ? 1.12 : 0.90)
    renderer.render(scene, camera)
    const silMain = await loadImg(renderer.domElement.toDataURL('image/png'))

    // Game-scale inset (3x farther ortho)
    mesh.material = pureClayMat; floor.visible = true
    scene.background = new Color('#f2efe9')
    setFixedCam(dirHeroOblique, refCenter, isBluff ? 2.75 : 2.35)
    renderer.render(scene, camera)
    const gameInset = await loadImg(renderer.domElement.toDataURL('image/png'))

    const col1C = document.createElement('canvas')
    col1C.width = STAGE_W; col1C.height = STAGE_H
    const g1 = col1C.getContext('2d')!
    g1.drawImage(silMain, 0, 0)
    g1.fillStyle = '#ffffff'; g1.fillRect(STAGE_W - 196, 10, 186, 146)
    g1.drawImage(gameInset, STAGE_W - 192, 14, 178, 138)
    g1.strokeStyle = '#c8c2b8'; g1.strokeRect(STAGE_W - 196, 10, 186, 146)
    cellImgs.push(col1C)

    // Col 2: Front-oblique user angle clay
    mesh.material = pureClayMat; wire.visible = false; floor.visible = true
    scene.background = new Color('#f2efe9')
    setFixedCam(userDir, targetUser, isBluff ? 1.12 : 0.90)
    renderer.render(scene, camera)
    cellImgs.push(await loadImg(renderer.domElement.toDataURL('image/png')))

    // Col 3: Same angle + Wireframe
    wire.visible = true
    renderer.render(scene, camera)
    cellImgs.push(await loadImg(renderer.domElement.toDataURL('image/png')))
    wire.visible = false

    // Col 4: 145° Rear-Opposite Counter-Evidence View
    setFixedCam(dirRear145, refCenter, isBluff ? 1.56 : 1.38)
    renderer.render(scene, camera)
    cellImgs.push(await loadImg(renderer.domElement.toDataURL('image/png')))

    // Col 5: Low 6° Grounding Foot View
    setFixedCam(dirLow6, new Vector3(refCenter.x, isBluff ? 0.50 : 0.34, refCenter.z), isBluff ? 1.44 : 1.24)
    renderer.render(scene, camera)
    cellImgs.push(await loadImg(renderer.domElement.toDataURL('image/png')))

    // Col 6: Shoulder-Elbow Cross-Section Canvas (tight 34×26cm zoom right on the V-notch!)
    cellImgs.push(renderCrossSectionCanvas('肩肘截面 (橙圈=V槽中心)', row.segs, evalSdfOnSlice, [-0.34, 0.34], [-0.26, 0.26], 330, 248, row.sliceColor))

    // Draw row on Sheet 2
    const y0 = r * (headH + cellH)
    cctx.fillStyle = row.bgHead
    cctx.fillRect(0, y0, cmpCanvas.width, headH)
    cctx.fillStyle = '#243028'
    cctx.font = '700 13.5px "Microsoft YaHei", sans-serif'
    cctx.textAlign = 'left'
    cctx.fillText(row.title, 12, y0 + 22)
    for (let c = 0; c < 6; c++) {
      const x0 = c * cellW, cy0 = y0 + headH
      cctx.drawImage(cellImgs[c], x0 + 5, cy0 + 5, cellW - 10, cellH - 28)
      cctx.strokeStyle = '#e2ddd5'
      cctx.strokeRect(x0, cy0, cellW, cellH)
      cctx.fillStyle = '#4f4841'
      cctx.font = '600 11.5px "Microsoft YaHei", sans-serif'
      cctx.textAlign = 'center'
      cctx.fillText(colLabels[c], x0 + cellW * 0.5, cy0 + cellH - 7)
    }

    // Capture Sheet 3 Zoom Close-Up (on shoulder terrace + upper cliff ridge!)
    const zoomTarget = isBluff ? new Vector3(-0.14, 0.88, 0.08) : new Vector3(-0.18, 0.62, 0.02)
    const zoomHalfH = isBluff ? 0.66 : 0.52
    mesh.material = pureClayMat; wire.visible = true; floor.visible = false
    scene.background = new Color('#f5f1ea')
    setFixedCam(userDir, zoomTarget, zoomHalfH)
    renderer.render(scene, camera)
    const zClay = await loadImg(renderer.domElement.toDataURL('image/png'))

    mesh.material = silMat; wire.visible = false
    scene.background = new Color('#f7f3ec')
    renderer.render(scene, camera)
    const zSil = await loadImg(renderer.domElement.toDataURL('image/png'))
    zoomRow.push({ label: r === 0 ? '现有 SDF N=64' : r === 1 ? '路线 C1 锐边基底' : '路线 C2 局部倒角版', clay: zClay, sil: zSil })

    // Capture Small-Angle Rotation Crawl Check (-5° / 0° / +5° yaw around userDir) for N=64 and C2!
    if (r === 0 || r === 2) {
      const angles: { deg: number; img: HTMLImageElement }[] = []
      for (const deg of [-5, 0, 5]) {
        const rad = (deg * Math.PI) / 180
        const cosA = Math.cos(rad), sinA = Math.sin(rad)
        const dRot = new Vector3(
          userDir.x * cosA + userDir.z * sinA,
          userDir.y,
          -userDir.x * sinA + userDir.z * cosA,
        ).normalize()
        setFixedCam(dRot, zoomTarget, zoomHalfH)
        renderer.render(scene, camera)
        angles.push({ deg, img: await loadImg(renderer.domElement.toDataURL('image/png')) })
      }
      rotSets.push({ tag: r === 0 ? '现有 SDF N=64（小角度转动剪影爬动测试）' : '路线 C2 局部倒角版（小角度转动剪影稳定性测试）', angles })
    }
  }

  floor.visible = true
  silMat.dispose(); pureClayMat.dispose(); wireOverlayMat.dispose()

  // =========================================================================
  // SHEET 3: Red-Circle Edge Close-Up Zoom + Small-Angle (-5°/0°/+5°) Silhouette Crawl Check
  // =========================================================================
  const zW = 460, zH = 340, zHead = 32
  const zCanvas = document.createElement('canvas')
  zCanvas.width = zW * 3 + 32
  zCanvas.height = (zHead + zH) * 4 + 20
  const zctx = zCanvas.getContext('2d')!
  zctx.fillStyle = '#ffffff'
  zctx.fillRect(0, 0, zCanvas.width, zCanvas.height)

  const drawZRow = (rowIdx: number, title: string, bg: string, imgs: { sub: string; img: HTMLImageElement }[]) => {
    const y0 = 4 + rowIdx * (zHead + zH)
    zctx.fillStyle = bg
    zctx.fillRect(8, y0, zCanvas.width - 16, zHead - 4)
    zctx.fillStyle = '#243028'
    zctx.font = '700 13.5px "Microsoft YaHei", sans-serif'
    zctx.textAlign = 'left'
    zctx.fillText(title, 16, y0 + 19)
    for (let i = 0; i < imgs.length; i++) {
      const x0 = 8 + i * (zW + 8)
      zctx.drawImage(imgs[i].img, x0, y0 + zHead, zW, zH - 22)
      zctx.strokeStyle = '#e0dad0'
      zctx.strokeRect(x0, y0 + zHead, zW, zH - 4)
      zctx.fillStyle = '#4e4740'
      zctx.font = '600 12px "Microsoft YaHei", sans-serif'
      zctx.textAlign = 'center'
      zctx.fillText(imgs[i].sub, x0 + zW * 0.5, y0 + zHead + zH - 8)
    }
  }

  drawZRow(0, '红圈长棱局部放大 · 灰模 + 线框对照（检验特征边对齐与跨折痕桥接）', '#e8ede9',
    zoomRow.map(z => ({ sub: z.label, img: z.clay })))
  drawZRow(1, '红圈长棱局部放大 · 纯黑剪影对照（检验锯齿台阶是否彻底消失）', '#e8ede9',
    zoomRow.map(z => ({ sub: z.label, img: z.sil })))
  drawZRow(2, rotSets[0].tag, '#efe8df',
    rotSets[0].angles.map(a => ({ sub: `水平偏转 ${a.deg >= 0 ? '+' : ''}${a.deg}°`, img: a.img })))
  drawZRow(3, rotSets[1].tag, '#e2eee5',
    rotSets[1].angles.map(a => ({ sub: `水平偏转 ${a.deg >= 0 ? '+' : ''}${a.deg}°`, img: a.img })))

  return {
    sheets: {
      elbow_isolation: isoCanvas.toDataURL('image/png'),
      clay_compare: cmpCanvas.toDataURL('image/png'),
      edge_zoom_rotate: zCanvas.toDataURL('image/png'),
    },
    report: {
      sdfLowN30: { ...sdfLow.audit, timings: sdfLow.timings, bake: bakedLow.stats },
      sdfHighN64: { ...sdfHigh.audit, timings: sdfHigh.timings },
      routeC1: c1.audit,
      routeC2: c2.audit,
      sliceSegmentCounts: {
        sdfLow: segsLow.length,
        sdfHigh: segsHigh.length,
        c1: segsC1.length,
        c2: segsC2.length,
      },
    },
  }
}

/** Builds a high-contrast 512x512 UV checker texture with labeled tile cadence to audit thin-face texel density & straight seams. */
function makeUvCheckerTexture(size = 512): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  const cells = 32
  const step = size / cells
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const alt = (x + y) % 2 === 0
      const major = ((x >> 2) + (y >> 2)) % 2 === 0
      ctx.fillStyle = alt ? (major ? '#f0ebe1' : '#dbe8ee') : (major ? '#485966' : '#7b6352')
      ctx.fillRect(x * step, y * step, step, step)
    }
  }
  ctx.strokeStyle = 'rgba(217, 72, 48, 0.55)'
  ctx.lineWidth = 1.5
  for (let i = 0; i <= cells; i += 4) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke()
  }
  const tex = new CanvasTexture(c)
  tex.flipY = false
  tex.colorSpace = SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

async function renderRouteC2PbrBundle(
  preset: PolyCsgPresetId = 'sandstone-ledge-c2',
): Promise<{
  sheets: Record<string, string>
  exportsB64: {
    glbShallowNonUniform: string
    glbBaselineNonUniform: string
  }
  report: Record<string, unknown>
}> {
  const isBluff = preset === 'block-bluff-c2'
  // 1. Build all three locked comparison assets with identical sandstone base color (#caa57c)
  const field = createRockV2Field(isBluff ? 'block-bluff' : 'sandstone-ledge-b')
  const sdfLow = extractSurfaceNets(field, { resolution: 30, projectToSurface: true })
  const uvOld = unwrapRockUvCharts(sdfLow, 512, 12)
  const bakedOld = bakeRockV2Textures(field, uvOld, { size: 512, dilationPasses: 10, brushMode: 'subtle', baseColorHex: '#caa57c' })

  const c2 = isBluff ? await buildBlockBluffRouteC('c2') : await buildSandstoneLedgeRouteC('c2')
  const uvC2 = unwrapPolyCsgUvCharts(c2, { atlasSize: 512, gutterPx: 10 })
  const bakedBase = bakePolyCsgPbr(c2, uvC2, { size: 512, mode: 'baseline', baseColorHex: '#caa57c', dilationPasses: 14, seed: isBluff ? 7342 : 5104 })
  const bakedDetail = bakePolyCsgPbr(c2, uvC2, { size: 512, mode: 'shallow-detail', baseColorHex: '#caa57c', dilationPasses: 14, seed: isBluff ? 7342 : 5104 })

  const makePbrMat = (
    name: string,
    b: { albedo: Uint8ClampedArray; normal: Uint8ClampedArray; ao: Uint8ClampedArray; size: number },
  ) => {
    const map = makeTextureFromRgba(b.albedo, b.size, true, `${name}_BaseColor`)
    const normalMap = makeTextureFromRgba(b.normal, b.size, false, `${name}_Normal`)
    const aoMap = makeTextureFromRgba(b.ao, b.size, false, `${name}_AO`)
    aoMap.channel = 0
    const mat = new MeshStandardMaterial({
      name: `Mat_${name}`,
      color: 0xffffff,
      map,
      normalMap,
      normalScale: new Vector2(1, 1),
      aoMap,
      aoMapIntensity: 0.85,
      roughness: 0.90,
      metalness: 0.0,
    })
    return { mat, map, normalMap, aoMap }
  }

  const oldPack = makePbrMat('OldSdfN30', bakedOld)
  const basePack = makePbrMat('C2_Baseline', bakedBase)
  const detailPack = makePbrMat('C2_ShallowDetail', bakedDetail)

  const aspect = STAGE_W / STAGE_H
  const userDir = new Vector3(-0.34, 0.14, 0.93).normalize()
  const dirRear145 = new Vector3(0.54, 0.24, -0.81).normalize()
  const dirLow6 = new Vector3(0.10, 0.08, 0.99).normalize()
  const targetUser = isBluff ? new Vector3(-0.02, 0.68, 0.0) : new Vector3(-0.04, 0.48, 0.0)
  const refCenter = isBluff ? new Vector3(-0.02, 0.70, -0.02) : new Vector3(-0.04, 0.50, -0.02)
  const zoomElbowTarget = isBluff ? new Vector3(-0.06, 0.78, 0.12) : new Vector3(-0.08, 0.56, 0.04)
  const pbrHeroH = isBluff ? 1.08 : 0.88
  const pbrRearH = isBluff ? 1.54 : 1.38
  const pbrLowH = isBluff ? 1.44 : 1.24
  const pbrLowY = isBluff ? 0.50 : 0.34
  const pbrGameH = isBluff ? 3.10 : 2.70
  const pbrZoomH = isBluff ? 0.58 : 0.46

  const setCam = (dirV: Vector3, targetV: Vector3, halfH: number) => {
    camera.position.copy(targetV).addScaledVector(dirV, 8.8)
    camera.lookAt(targetV)
    camera.top = halfH; camera.bottom = -halfH
    camera.left = -halfH * aspect; camera.right = halfH * aspect
    camera.updateProjectionMatrix()
  }

  // Locked lighting & exposure across ALL 3 rows of Sheet 1!
  keyLight.position.set(-4.0, 6.4, 2.2)
  floor.visible = true
  scene.background = new Color('#f4f1ea')

  // =========================================================================
  // SHEET 1: 3-Way Locked PBR Comparison (Old N=30 SDF vs C2 Baseline vs C2 Shallow-Detail)
  // =========================================================================
  interface CmpRowSpec {
    title: string
    headBg: string
    geo: BufferGeometry
    mat: Material
  }
  const cmpRows: CmpRowSpec[] = [
    {
      title: `① 旧版 N=30 SDF 完整 512 PBR (${uvOld.audit.triangles} tris · ${uvOld.audit.chartCount} 图表 · 烘焙 ${bakedOld.stats.timings.totalBakeMs}ms)`,
      headBg: '#efe8df',
      geo: uvOld.toBufferGeometry(),
      mat: oldPack.mat,
    },
    {
      title: `② 路线 C2 材质基线 (${uvC2.audit.triangles} tris · ${uvC2.audit.rawFaceGroups}面组→${uvC2.audit.chartCount}图表 · 严格平坦Normal + C2实测几何AO · 烘焙 ${bakedBase.stats.timings.totalBakeMs}ms)`,
      headBg: '#e5edf4',
      geo: uvC2.toBufferGeometry(),
      mat: basePack.mat,
    },
    {
      title: `③ 路线 C2 浅细节版 (${uvC2.audit.triangles} tris · 同C2几何AO + 面内浅层理/微宽笔触/≤${bakedDetail.stats.maxNormalDeviationDeg}°柔法线 · 烘焙 ${bakedDetail.stats.timings.totalBakeMs}ms)`,
      headBg: '#e2eee5',
      geo: uvC2.toBufferGeometry(),
      mat: detailPack.mat,
    },
  ]

  const c1W = 360, c1H = 290, c1Head = 34
  const sheet1 = document.createElement('canvas')
  sheet1.width = c1W * 5
  sheet1.height = (c1Head + c1H) * cmpRows.length
  const s1 = sheet1.getContext('2d')!
  s1.fillStyle = '#ffffff'
  s1.fillRect(0, 0, sheet1.width, sheet1.height)

  const colNames1 = [
    '① 红圈机位（斜前）',
    '② 145° 侧后反证机位',
    '③ 低机位 6° 底脚',
    '④ 实际游戏视距（右上角 3× 像素放大检漏缝）',
    '⑤ 肩肘 V 槽与顶脊近景放大',
  ]

  for (let r = 0; r < cmpRows.length; r++) {
    const row = cmpRows[r]
    clearRoot()
    const mesh = new Mesh(row.geo, row.mat)
    mesh.castShadow = true; mesh.receiveShadow = true
    rootGroup.add(mesh)

    const shots: (HTMLImageElement | HTMLCanvasElement)[] = []
    // Col 1: User red-circle angle
    setCam(userDir, targetUser, pbrHeroH)
    renderer.render(scene, camera)
    shots.push(await loadImg(renderer.domElement.toDataURL('image/png')))

    // Col 2: 145° Rear-opposite
    setCam(dirRear145, refCenter, pbrRearH)
    renderer.render(scene, camera)
    shots.push(await loadImg(renderer.domElement.toDataURL('image/png')))

    // Col 3: Low 6° Foot
    setCam(dirLow6, new Vector3(refCenter.x, pbrLowY, refCenter.z), pbrLowH)
    renderer.render(scene, camera)
    shots.push(await loadImg(renderer.domElement.toDataURL('image/png')))

    // Col 4: Actual game-scale (rock ~110px wide, exercising mip levels 2-3!) + 3x nearest-neighbor pixel loupe!
    setCam(userDir, targetUser, pbrGameH)
    renderer.render(scene, camera)
    const gameImg = await loadImg(renderer.domElement.toDataURL('image/png'))
    const gameComp = document.createElement('canvas')
    gameComp.width = STAGE_W; gameComp.height = STAGE_H
    const gctx = gameComp.getContext('2d')!
    gctx.drawImage(gameImg, 0, 0)
    // Draw 3x nearest-neighbor zoom inset of the center rock (150x100 source -> 300x200 loupe)
    const srcW = 150, srcH = 100
    const srcX = Math.round((STAGE_W - srcW) * 0.5)
    const srcY = Math.round((STAGE_H - srcH) * 0.5)
    const insW = 270, insH = 180
    const insX = STAGE_W - insW - 10, insY = 10
    gctx.fillStyle = '#ffffff'; gctx.fillRect(insX - 3, insY - 3, insW + 6, insH + 6)
    gctx.imageSmoothingEnabled = false
    gctx.drawImage(gameImg, srcX, srcY, srcW, srcH, insX, insY, insW, insH)
    gctx.imageSmoothingEnabled = true
    gctx.strokeStyle = '#c4542d'; gctx.lineWidth = 2
    gctx.strokeRect(insX, insY, insW, insH)
    gctx.strokeStyle = 'rgba(196, 84, 45, 0.55)'; gctx.lineWidth = 1.5
    gctx.strokeRect(srcX, srcY, srcW, srcH)
    shots.push(gameComp)

    // Col 5: Close-up zoom on shoulder elbow + summit bevels
    setCam(userDir, zoomElbowTarget, pbrZoomH)
    renderer.render(scene, camera)
    shots.push(await loadImg(renderer.domElement.toDataURL('image/png')))

    const y0 = r * (c1Head + c1H)
    s1.fillStyle = row.headBg
    s1.fillRect(0, y0, sheet1.width, c1Head)
    s1.fillStyle = '#243028'
    s1.font = '700 13.5px "Microsoft YaHei", sans-serif'
    s1.textAlign = 'left'
    s1.fillText(row.title, 12, y0 + 22)
    for (let c = 0; c < 5; c++) {
      const x0 = c * c1W, cy0 = y0 + c1Head
      s1.drawImage(shots[c], x0 + 5, cy0 + 5, c1W - 10, c1H - 28)
      s1.strokeStyle = '#e2ddd5'
      s1.strokeRect(x0, cy0, c1W, c1H)
      s1.fillStyle = '#4e4740'
      s1.font = '600 11.5px "Microsoft YaHei", sans-serif'
      s1.textAlign = 'center'
      s1.fillText(colNames1[c], x0 + c1W * 0.5, cy0 + c1H - 7)
    }
  }

  // =========================================================================
  // SHEET 2: UV Charts + 3D Checker + 512 Maps Quad + C2 Baseline 4-Channel Isolation
  // =========================================================================
  clearRoot()
  const c2SharedGeo = uvC2.toBufferGeometry()
  const checkerTex = makeUvCheckerTexture(512)
  const matChecker = new MeshStandardMaterial({ color: 0xffffff, map: checkerTex, roughness: 0.92, metalness: 0.0 })
  const matC2Clay = new MeshStandardMaterial({ color: '#c8c2ba', roughness: 0.90, metalness: 0.0 })
  const matC2NormOnly = new MeshStandardMaterial({ color: '#e6e2dc', normalMap: basePack.normalMap, normalScale: new Vector2(1, 1), roughness: 0.90, metalness: 0.0 })
  const matC2AoOnly = new MeshStandardMaterial({ color: '#e6e2dc', aoMap: basePack.aoMap, aoMapIntensity: 0.85, roughness: 0.90, metalness: 0.0 })

  const diagMesh = new Mesh<BufferGeometry, Material>(c2SharedGeo, matChecker)
  diagMesh.castShadow = true; diagMesh.receiveShadow = true
  rootGroup.add(diagMesh)

  // 3D UV checker close-up on shoulder elbow & bevels
  setCam(userDir, zoomElbowTarget, isBluff ? 0.72 : 0.58)
  renderer.render(scene, camera)
  const checkerImg = await loadImg(renderer.domElement.toDataURL('image/png'))

  // C2 Baseline 4-channel isolation at exact user red-circle camera!
  setCam(userDir, targetUser, pbrHeroH)
  const c2IsoShots: { label: string; img: HTMLImageElement }[] = []
  for (const [m, lbl] of [
    [matC2Clay, '④ C2 纯灰模（无 Normal / 无 AO）'],
    [matC2NormOnly, '⑤ C2 基线 · 只开 Normal（严格平坦，零暗痕）'],
    [matC2AoOnly, '⑥ C2 基线 · 只开 AO（纯物理 3D 几何 V 槽遮蔽）'],
    [basePack.mat, '⑦ C2 基线 · 完整 PBR（零假裂纹 / 零暗缝芯）'],
  ] as [Material, string][]) {
    diagMesh.material = m
    renderer.render(scene, camera)
    c2IsoShots.push({ label: lbl, img: await loadImg(renderer.domElement.toDataURL('image/png')) })
  }
  checkerTex.dispose(); matChecker.dispose(); matC2Clay.dispose(); matC2NormOnly.dispose(); matC2AoOnly.dispose()

  const sheet2 = document.createElement('canvas')
  sheet2.width = 1600
  sheet2.height = 960
  const s2 = sheet2.getContext('2d')!
  s2.fillStyle = '#ffffff'
  s2.fillRect(0, 0, sheet2.width, sheet2.height)
  s2.fillStyle = '#e5edf4'
  s2.fillRect(0, 0, sheet2.width, 34)
  s2.fillStyle = '#243028'
  s2.font = '700 14px "Microsoft YaHei", sans-serif'
  s2.textAlign = 'left'
  s2.fillText(
    `路线 C2 UV 折痕拆分与 512 贴图审计（${uvC2.audit.rawFaceGroups} 面组 → ${uvC2.audit.chartCount} 图表 · ${uvC2.audit.pxPerMeter} px/m · 填充 ${(bakedDetail.stats.uvFillRatio * 100).toFixed(1)}% · 扩边 ${uvC2.audit.gutterPx}px · 翻转=${uvC2.audit.flippedUvTris} 重叠=${uvC2.audit.overlappingChartTris} · 肩槽=${bakedDetail.stats.shoulderNotchCoverage.coveredTexels}px 最小宽${bakedDetail.stats.shoulderNotchCoverage.minChartStripPx}px · 倒角=${bakedDetail.stats.bevelCoverage.coveredTexels}px）`,
    12, 22,
  )

  // Top row of Sheet 2: [512 UV Chart Map (500x500)] + [3D UV Checker (520x500)] + [4-up 512 Maps (540x500)]
  const topY = 42, topH = 524
  const drawBoxHead = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, text: string) => {
    ctx.fillStyle = '#e8ede9'
    ctx.fillRect(x, y, w, 24)
    ctx.fillStyle = '#243028'
    ctx.font = '700 12px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(text, x + 8, y + 16)
  }

  // Panel 1: 512 UV Chart color map
  drawBoxHead(s2, 8, topY, 496, `① C2 512 UV 分片图（${uvC2.audit.rawFaceGroups} 面组 → ${uvC2.audit.chartCount} 图表，硬折痕切开、共面/缓折合并）`)
  s2.drawImage(rgbaToCanvas(bakedDetail.uvChartMap, 512), 8, topY + 24, 496, 496)
  s2.strokeStyle = '#d8d2c8'; s2.strokeRect(8, topY, 496, 520)

  // Panel 2: 3D UV Checker close-up
  drawBoxHead(s2, 514, topY, 526, '② 3D UV 棋盘格近景（检肩槽薄面、倒角终点纹素密度与直缝对齐）')
  s2.drawImage(checkerImg, 514, topY + 24, 526, 496)
  s2.strokeStyle = '#d8d2c8'; s2.strokeRect(514, topY, 526, 520)

  // Panel 3: 2x2 512 Maps of C2 Shallow-Detail
  drawBoxHead(s2, 1050, topY, 542, '③ C2 浅细节版 512 四联贴图（左上Base / 右上Normal / 左下C2几何AO / 右下区域保护）')
  const qSize = 244
  const quadData: [Uint8ClampedArray, string, number, number][] = [
    [bakedDetail.albedo, 'BaseColor', 0, 0],
    [bakedDetail.normal, `Normal (≤${bakedDetail.stats.maxNormalDeviationDeg}°)`, 1, 0],
    [bakedDetail.ao, `C2几何AO (槽均值=${bakedDetail.stats.shoulderNotchMeanAo})`, 0, 1],
    [bakedDetail.diagnostic, '绿=V槽 青=倒角 橙=护边 蓝=面内', 1, 1],
  ]
  for (const [buf, lbl, qc, qr] of quadData) {
    const qx = 1058 + qc * (qSize + 10)
    const qy = topY + 30 + qr * (qSize + 4)
    s2.drawImage(rgbaToCanvas(buf, 512), qx, qy, qSize, qSize - 18)
    s2.fillStyle = 'rgba(255,255,255,0.88)'
    s2.fillRect(qx, qy + qSize - 20, qSize, 18)
    s2.fillStyle = '#2b342d'
    s2.font = '600 11px "Microsoft YaHei", sans-serif'
    s2.textAlign = 'center'
    s2.fillText(lbl, qx + qSize * 0.5, qy + qSize - 7)
    s2.strokeStyle = '#dcd6cc'; s2.strokeRect(qx, qy, qSize, qSize - 2)
  }
  s2.strokeStyle = '#d8d2c8'; s2.strokeRect(1050, topY, 542, 520)

  // Bottom row of Sheet 2: C2 Baseline 4-Channel Isolation (4 cards across 1600px)
  const botY = topY + topH + 10
  s2.fillStyle = '#e2eee5'
  s2.fillRect(8, botY, sheet2.width - 16, 26)
  s2.fillStyle = '#243028'
  s2.font = '700 13px "Microsoft YaHei", sans-serif'
  s2.textAlign = 'left'
  s2.fillText('C2 材质基线 · 同用户红圈机位 4 通道隔离复核（确认肩肘暗痕彻底清零，仅由真实 V 槽 + C2 几何 AO 表达深度）', 16, botY + 18)
  const isoW = 388, isoH = 342
  for (let i = 0; i < 4; i++) {
    const ix = 8 + i * (isoW + 10)
    const iy = botY + 32
    s2.drawImage(c2IsoShots[i].img, ix, iy, isoW, isoH - 24)
    s2.strokeStyle = '#dcd6cc'; s2.strokeRect(ix, iy, isoW, isoH)
    s2.fillStyle = '#4e4740'
    s2.font = '600 11.5px "Microsoft YaHei", sans-serif'
    s2.textAlign = 'center'
    s2.fillText(c2IsoShots[i].label, ix + isoW * 0.5, iy + isoH - 7)
  }

  // =========================================================================
  // SHEET 3: Rotating Key Light (0°/90°/180°/270°) + Non-Uniform Scaled Merged GLB Reload
  // =========================================================================
  const rotLightAngles: [string, [number, number, number]][] = [
    ['主光 0°（左上前）', [-4.0, 6.4, 2.2]],
    ['主光 90°（右上前）', [4.2, 5.8, 2.8]],
    ['主光 180°（右后顶）', [3.6, 6.0, -3.8]],
    ['主光 270°（左后侧）', [-4.4, 5.4, -3.2]],
  ]

  const captureRotRow = async (mat: Material): Promise<{ label: string; img: HTMLImageElement }[]> => {
    clearRoot()
    const m = new Mesh(uvC2.toBufferGeometry(), mat)
    m.castShadow = true; m.receiveShadow = true
    rootGroup.add(m)
    setCam(userDir, targetUser, pbrHeroH)
    const out: { label: string; img: HTMLImageElement }[] = []
    for (const [lbl, lp] of rotLightAngles) {
      keyLight.position.set(lp[0], lp[1], lp[2])
      renderer.render(scene, camera)
      out.push({ label: lbl, img: await loadImg(renderer.domElement.toDataURL('image/png')) })
    }
    return out
  }

  const rotBaseImgs = await captureRotRow(basePack.mat)
  const rotDetailImgs = await captureRotRow(detailPack.mat)
  keyLight.position.set(-4.0, 6.4, 2.2)

  // Non-uniformly scaled (1.35, 0.82, 1.15) + rotY=0.18 merged GLB export & Three.js GLTFLoader reload!
  const buildNonUniformExport = async (name: string, mat: MeshStandardMaterial) => {
    const grp = new Group()
    grp.name = `${name}_Root`
    const m = new Mesh(uvC2.toBufferGeometry(), mat)
    m.name = name
    m.scale.set(1.35, 0.82, 1.15)
    m.rotation.set(0, 0.18, 0)
    m.updateMatrixWorld(true)
    grp.add(m)
    grp.updateMatrixWorld(true)
    const blob = await exportGlb(grp, { mode: 'merged', excludeDecorations: false })
    return { grp, blob }
  }

  const expBase = await buildNonUniformExport('RockC2_Baseline_NonUniform', basePack.mat)
  const expDetail = await buildNonUniformExport('RockC2_ShallowDetail_NonUniform', detailPack.mat)
  const glbShallowNonUniform = await blobToBase64(expDetail.blob)
  const glbBaselineNonUniform = await blobToBase64(expBase.blob)

  // Reload merged non-uniform GLB via independent GLTFLoader!
  const loader = new GLTFLoader()
  const glbBuf = await expDetail.blob.arrayBuffer()
  const loaded = await new Promise<{ scene: Group }>((ok, bad) => loader.parse(glbBuf, '', ok, bad))
  let reloadedMeshCount = 0
  let reloadedTris = 0
  let reloadedHasTangent = false
  let reloadedHasAo = false
  let reloadedHasNormal = false
  loaded.scene.traverse(obj => {
    if (obj instanceof Mesh) {
      obj.castShadow = true; obj.receiveShadow = true
      reloadedMeshCount++
      const idxAttr = obj.geometry.getIndex()
      reloadedTris += idxAttr ? idxAttr.count / 3 : obj.geometry.getAttribute('position').count / 3
      if (obj.geometry.getAttribute('tangent')) reloadedHasTangent = true
      const mat = obj.material as MeshStandardMaterial
      if (mat.normalMap) reloadedHasNormal = true
      if (mat.aoMap) reloadedHasAo = true
    }
  })

  // Render 4 GLB round-trip parity panels
  const glbShots: { label: string; img: HTMLImageElement | HTMLCanvasElement }[] = []
  // ① Source non-uniformly scaled C2 shallow-detail mesh
  clearRoot()
  const srcClone = new Mesh(uvC2.toBufferGeometry(), detailPack.mat)
  srcClone.scale.set(1.35, 0.82, 1.15)
  srcClone.rotation.set(0, 0.18, 0)
  srcClone.castShadow = true; srcClone.receiveShadow = true
  rootGroup.add(srcClone)
  const nuBounds = new Box3().setFromObject(rootGroup)
  const nuCenter = nuBounds.getCenter(new Vector3())
  const nuHeroH = isBluff ? 1.24 : 1.05
  setCam(userDir, nuCenter, nuHeroH)
  renderer.render(scene, camera)
  glbShots.push({ label: '① 源网格（非均匀缩放 1.35×0.82×1.15）', img: await loadImg(renderer.domElement.toDataURL('image/png')) })

  // ② Reloaded merged GLB (exact same camera!)
  clearRoot()
  rootGroup.add(loaded.scene)
  setCam(userDir, nuCenter, nuHeroH)
  renderer.render(scene, camera)
  glbShots.push({ label: `② GLTFLoader 重载合并 GLB (${reloadedTris} tris)`, img: await loadImg(renderer.domElement.toDataURL('image/png')) })

  // ③ Reloaded GLB close-up on shoulder V-notch & bevel seam
  setCam(userDir, new Vector3(nuCenter.x - 0.08, nuCenter.y + 0.08, nuCenter.z + 0.06), isBluff ? 0.66 : 0.54)
  renderer.render(scene, camera)
  glbShots.push({ label: '③ 重载 GLB · 肩肘槽口与切线近景', img: await loadImg(renderer.domElement.toDataURL('image/png')) })

  // ④ Reloaded GLB 145° rear-opposite + game-scale mipmap inset
  setCam(dirRear145, nuCenter, isBluff ? 1.66 : 1.48)
  renderer.render(scene, camera)
  const glbRear = await loadImg(renderer.domElement.toDataURL('image/png'))
  setCam(userDir, nuCenter, isBluff ? 3.35 : 3.0)
  renderer.render(scene, camera)
  const glbGame = await loadImg(renderer.domElement.toDataURL('image/png'))
  const glbComp = document.createElement('canvas')
  glbComp.width = STAGE_W; glbComp.height = STAGE_H
  const g4 = glbComp.getContext('2d')!
  g4.drawImage(glbRear, 0, 0)
  g4.fillStyle = '#ffffff'; g4.fillRect(STAGE_W - 216, 10, 206, 166)
  g4.drawImage(glbGame, STAGE_W - 212, 14, 198, 158)
  g4.strokeStyle = '#b9b1a5'; g4.strokeRect(STAGE_W - 216, 10, 206, 166)
  glbShots.push({ label: '④ 重载 GLB · 145° 侧后 + 游戏视距小图', img: glbComp })

  // Compose Sheet 3 (3 rows × 4 columns)
  const r3W = 400, r3H = 316, r3Head = 34
  const sheet3 = document.createElement('canvas')
  sheet3.width = r3W * 4
  sheet3.height = (r3Head + r3H) * 3
  const s3 = sheet3.getContext('2d')!
  s3.fillStyle = '#ffffff'
  s3.fillRect(0, 0, sheet3.width, sheet3.height)

  const s3Rows: { title: string; bg: string; cells: { label: string; img: HTMLImageElement | HTMLCanvasElement }[] }[] = [
    { title: '路线 C2 材质基线 · 四向旋转主光（检验敞开 V 槽受光换边、零暗痕）', bg: '#e5edf4', cells: rotBaseImgs },
    { title: '路线 C2 浅细节版 · 四向旋转主光（检验面内浅层理换边、硬棱零画脏）', bg: '#e2eee5', cells: rotDetailImgs },
    {
      title: `非均匀缩放合并 GLB 往返重载（1.35×0.82×1.15 · ${(expDetail.blob.size / 1024).toFixed(1)} KB · Tangent=${reloadedHasTangent} Normal=${reloadedHasNormal} AO=${reloadedHasAo}）`,
      bg: '#efe8df',
      cells: glbShots,
    },
  ]

  for (let r = 0; r < s3Rows.length; r++) {
    const row = s3Rows[r]
    const y0 = r * (r3Head + r3H)
    s3.fillStyle = row.bg
    s3.fillRect(0, y0, sheet3.width, r3Head)
    s3.fillStyle = '#243028'
    s3.font = '700 13.5px "Microsoft YaHei", sans-serif'
    s3.textAlign = 'left'
    s3.fillText(row.title, 12, y0 + 22)
    for (let c = 0; c < 4; c++) {
      const x0 = c * r3W, cy0 = y0 + r3Head
      s3.drawImage(row.cells[c].img, x0 + 6, cy0 + 6, r3W - 12, r3H - 30)
      s3.strokeStyle = '#e2ddd5'
      s3.strokeRect(x0, cy0, r3W, r3H)
      s3.fillStyle = '#4e4740'
      s3.font = '600 11.5px "Microsoft YaHei", sans-serif'
      s3.textAlign = 'center'
      s3.fillText(row.cells[c].label, x0 + r3W * 0.5, cy0 + r3H - 8)
    }
  }

  // Cleanup GPU resources
  for (const p of [oldPack, basePack, detailPack]) {
    p.map.dispose(); p.normalMap.dispose(); p.aoMap.dispose(); p.mat.dispose()
  }
  expBase.grp.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() })
  expDetail.grp.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() })

  return {
    sheets: {
      pbr_3way_compare: sheet1.toDataURL('image/png'),
      pbr_maps_and_uv: sheet2.toDataURL('image/png'),
      pbr_rotlight_and_glb: sheet3.toDataURL('image/png'),
    },
    exportsB64: {
      glbShallowNonUniform,
      glbBaselineNonUniform,
    },
    report: {
      oldSdfN30: { uv: uvOld.audit, bake: bakedOld.stats },
      c2Geo: c2.audit,
      c2Uv: uvC2.audit,
      c2BakeBaseline: bakedBase.stats,
      c2BakeShallowDetail: bakedDetail.stats,
      glbReload: {
        shallowBytes: expDetail.blob.size,
        baselineBytes: expBase.blob.size,
        reloadedMeshCount,
        reloadedTris,
        reloadedHasTangent,
        reloadedHasNormal,
        reloadedHasAo,
      },
    },
  }
}

;(window as unknown as Record<string, unknown>).__rockProto = {
  renderGate1Sheet,
  renderGate2Bundle,
  renderRound2Bundle,
  renderAbClayComparison,
  renderEdgeDiagnosisSheet,
  renderRouteCPocBundle,
  renderRouteC2PbrBundle,
  renderPhase2BenchmarkBundle,
  renderPhase3All16PlantsSheet,
}
