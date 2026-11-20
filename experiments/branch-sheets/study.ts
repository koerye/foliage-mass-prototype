import {
  BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, DirectionalLight, DoubleSide,
  Float32BufferAttribute, Group, HemisphereLight, Mesh, MeshStandardMaterial, OrthographicCamera, PCFShadowMap,
  PlaneGeometry, Scene, ShadowMaterial, SRGBColorSpace, TubeGeometry, Vector3, WebGLRenderer,
} from 'three'

import { across, foliage, inset, leafPoint as sheetPoint, paint, sheetGeometry, textureWidth as W, vLimit, type Fan as SheetFan } from '../../src/foliage-sheets'

const groundY = -.91
const up = new Vector3(0, 1, 0)
const background = '#eef0e5'
const bark = new MeshStandardMaterial({ color: '#796044', roughness: .95 })
const underside = new MeshStandardMaterial({ color: '#365b43', side: DoubleSide, roughness: 1 })
type Fan = Omit<SheetFan, 'origin'> & { at: number; origin?: Vector3 }
const stems: Fan[] = [
  [.12, -.95, 1.33, .34, .31, .08], [.18, .99, 1.29, .34, .37, .08],
  [.27, -.74, 1.36, .33, .31, .11], [.34, .88, 1.37, .38, .43, .08],
  [.43, -.80, 1.28, .33, .26, .11], [.49, .74, 1.25, .33, .35, .08],
  [.58, -.63, 1.14, .29, .23, .10], [.63, .62, 1.17, .29, .29, .10],
  [.72, -.42, .99, .25, .23, .10], [.76, .42, .94, .25, .28, .08],
  [.78, -.055, 1.18, .23, .26, .13],
].map(([at, yaw, length, width, drop, lift], index) => ({ at, yaw, length, width, drop, lift, index }))

function centerline(t: number) {
  return new Vector3(t * 4.12, .13 + .185 * Math.sin(t * Math.PI) - .60 * t ** 1.65, .115 * Math.sin(t * 4.0))
}
const originOf = (fan: Fan) => fan.origin?.clone() ?? centerline(fan.at)
const planarHeight = (x: number, z: number) => .15 - x * .117 - z * .37

const asSheet = (fan: Fan): SheetFan => ({ ...fan, origin: originOf(fan) })
const leafPoint = (fan: Fan, t: number, fraction: number) => sheetPoint(asSheet(fan), t, fraction)

function compoundSprays() {
  return stems.flatMap(stem => {
    const sign = stem.index % 2 ? -1 : 1
    const core = { ...stem, width: stem.width * .54, index: stem.index * 4 + 3 }
    const subordinate = [
      [.12, -.48 * sign, .83, .51],
      [.26, .48 * sign, .75, .48],
      [.48, -.37 * sign, .59, .41],
    ]
    const wings = subordinate.map(([t, rake, length, width], index) => {
      const root = leafPoint(core, t, rake < 0 ? -.23 : .23).pos
      root.y -= .013 + index * .015
      return { ...stem, origin: root, yaw: stem.yaw + rake, length: stem.length * length, width: stem.width * width,
        lift: stem.lift * .61, drop: stem.drop * (.71 + index * .11), index: stem.index * 4 + index }
    })
    return [...wings, core]
  })
}

function sheetVolume(fan: Fan, material: MeshStandardMaterial) {
  return new Mesh(sheetGeometry(asSheet(fan)), [material, underside])
}

function quad(corners: Vector3[], material: MeshStandardMaterial, uv = [0, 1, 0, 0, 1, 1, 1, 0]) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(corners.flatMap(vertex => vertex.toArray()), 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex([0, 1, 3, 0, 3, 2])
  geometry.computeVertexNormals()
  return new Mesh(geometry, material)
}

function planar(fans: Fan[], painted: ReturnType<typeof paint>[]) {
  const minX = -.25, maxX = 4.61, minZ = -1.73, maxZ = 1.77
  const canvas = document.createElement('canvas')
  canvas.width = 1400
  canvas.height = 1010
  const ctx = canvas.getContext('2d')!
  ctx.scale(canvas.width / (maxX - minX), canvas.height / (maxZ - minZ))
  ctx.translate(-minX, -minZ)
  fans.forEach((fan, i) => {
    const origin = originOf(fan)
    ctx.save()
    ctx.translate(origin.x, origin.z)
    ctx.rotate(fan.yaw)
    ctx.drawImage(painted[i].sheet, -fan.length * inset / (W - 2 * inset), -fan.width * vLimit,
      fan.length * W / (W - 2 * inset), fan.width * vLimit * 2)
    ctx.restore()
  })
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8
  const coordinates = [[minX, minZ], [minX, maxZ], [maxX, minZ], [maxX, maxZ]]
  return quad(coordinates.map(([x, z]) => new Vector3(x, planarHeight(x, z), z)), new MeshStandardMaterial({ ...foliage, map }))
}

function crossed(fan: Fan, material: MeshStandardMaterial) {
  const root = originOf(fan)
  const axis = leafPoint(fan, 1, 0).pos.sub(root).normalize()
  const length = leafPoint(fan, 1, 0).pos.distanceTo(root)
  const side = across(asSheet(fan))
  return [-Math.PI / 4, Math.PI / 4].map(angle => {
    const width = side.clone().applyAxisAngle(axis, angle + fan.yaw * .10)
    const corners = [[-inset / (W - 2 * inset), -1], [-inset / (W - 2 * inset), 1], [1 + inset / (W - 2 * inset), -1], [1 + inset / (W - 2 * inset), 1]]
    return quad(corners.map(([u, v]) => root.clone().addScaledVector(axis, u * length).addScaledVector(width, v * fan.width * vLimit)), material)
  })
}

function shoot(points: Vector3[], width: number) {
  const curve = new CatmullRomCurve3(points)
  const segments = 24, sides = 8
  const geometry = new TubeGeometry(curve, segments, width, sides)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const t = Math.floor(i / (sides + 1)) / segments
    const center = curve.getPointAt(t)
    const result = new Vector3().fromBufferAttribute(position, i).lerp(center, .90 * t ** .90)
    position.setXYZ(i, result.x, result.y, result.z)
  }
  geometry.computeVertexNormals()
  return new Mesh(geometry, bark)
}

function commonWood() {
  const wood = new Group()
  wood.add(shoot(Array.from({ length: 8 }, (_, i) => centerline(i / 7)), .072))
  for (const fan of stems) {
    const root = centerline(fan.at)
    const middle = leafPoint(fan, .29, 0).pos
    middle.y -= .035
    const end = leafPoint(fan, .64, 0).pos
    end.y -= .061
    wood.add(shoot([root, middle, end], .018 * (1 - .50 * fan.at)))
  }
  return wood
}

export const variants = ['A', 'B', 'C'] as const
type Variant = typeof variants[number]

export function createBranchTemplates() {
  const fans = compoundSprays()
  const samples = fans.map(fan => paint(asSheet(fan)))
  const flat = planar(fans, samples)
  const wood = commonWood()
  const models = new Map<Variant, Group>()
  for (const variant of variants) {
    const model = wood.clone()
    if (variant === 'A') model.add(flat)
    else if (variant === 'B') fans.forEach((fan, i) => model.add(sheetVolume(fan, samples[i].material)))
    else fans.forEach((fan, i) => model.add(...crossed(fan, samples[i].material)))
    model.traverse(node => { if (node instanceof Mesh) node.castShadow = node.receiveShadow = true })
    models.set(variant, model)
  }
  return {
    clone: (variant: Variant) => models.get(variant)!.clone(),
    dispose() {
      const geometries = new Set<BufferGeometry>()
      for (const model of models.values()) {
        model.traverse(node => { if (node instanceof Mesh) geometries.add(node.geometry) })
      }
      geometries.forEach(geometry => geometry.dispose())
      flat.material.map?.dispose()
      flat.material.dispose()
      samples.forEach(({ material }) => { material.map?.dispose(); material.dispose() })
    },
  }
}

const cameras = { front: [0, .38, 1], angle: [1, .58, 1], side: [1, .23, 0], overhead: [.22, 1, .56] } as const

export async function renderStudy() {
  const rendered: Record<string, string> = {}
  const scene = new Scene()
  scene.background = new Color(background)
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(760, 468)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  const floor = new Mesh(new PlaneGeometry(45, 45), new ShadowMaterial({ color: '#426454', opacity: .20 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = groundY
  floor.receiveShadow = true
  const key = new DirectionalLight('#fff0c8', 2.18)
  key.position.set(-1.2, 7, 4)
  key.target.position.set(1.95, 0, 0)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 3.1, bottom: -3.1, far: 25 })
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.normalBias = .016
  key.shadow.bias = -.00014
  scene.add(floor, key, key.target, new HemisphereLight('#f2ffe6', '#b1c4aa', 1.52))
  const fill = new DirectionalLight('#c4e3e5', .36)
  fill.position.set(5, 2, -5)
  scene.add(fill)
  const camera = new OrthographicCamera(-2.58, 2.58, 1.59, -1.59, .01, 35)
  const target = new Vector3(1.95, -.12, 0)
  const templates = createBranchTemplates()
  for (const technique of variants) {
    const model = templates.clone(technique)
    scene.add(model)
    renderer.shadowMap.needsUpdate = true
    for (const [view, xyz] of Object.entries(cameras)) {
      camera.zoom = view === 'overhead' ? .88 : 1
      camera.updateProjectionMatrix()
      camera.position.copy(target).addScaledVector(new Vector3(...xyz).normalize(), 9)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      renderer.render(scene, camera)
      rendered[technique + '-' + view] = renderer.domElement.toDataURL('image/png').split(',')[1]
    }
    scene.remove(model)
  }
  templates.dispose()
  floor.geometry.dispose()
  floor.material.dispose()
  key.shadow.dispose()
  renderer.dispose()
  return rendered
}

declare global { interface Window { renderStudy: typeof renderStudy } }
if (typeof window !== 'undefined') window.renderStudy = renderStudy

