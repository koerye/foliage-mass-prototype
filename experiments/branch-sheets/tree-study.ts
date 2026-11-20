import {
  Color, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial, OrthographicCamera,
  PCFShadowMap, PlaneGeometry, Quaternion, Scene, ShadowMaterial, Vector3, WebGLRenderer,
} from 'three'
import { createBranchTemplates, variants } from './study'

export type TierCount = 3 | 7
export type Variant = typeof variants[number]
const profiles: Record<TierCount, number[]> = {
  3: [1, .77, .53],
  7: [1, .93, .80, .67, .55, .42, .28],
}
const angles = { front: [0, .23, 1], angle: [1, .36, 1], side: [1, .23, 0] } as const
const xAxis = new Vector3(1, 0, 0), yAxis = new Vector3(0, 1, 0), zAxis = new Vector3(0, 0, 1)

export type Placement = { tier: number; x: number; y: number; z: number; azimuth: number; pitch: number; roll: number; scale: number }

export function stemX(height: number) {
  return .042 * Math.sin(height * 1.42) * height
}
export const stemZ = (height: number) => Math.sin(height * 1.7) * .031

export function arrange(count: TierCount) {
  const placement: Placement[] = []
  const base = count === 3 ? .83 : .89
  const step = count === 3 ? .192 : .245
  const scale = count === 3 ? .242 : .311
  const twigCount = 4
  const tierTop = base + step * (count - 1)
  profiles[count].forEach((proportion, tier) => {
    const u = tier / (count - 1)
    const y = base + step * tier
    const apex = tier === count - 1
    const yaw = .40 + tier * .62 + .14 * Math.sin(tier * 1.9)
    for (let j = 0; j < twigCount; j++) {
      const azimuth = yaw + j * Math.PI / 2 + Math.sin(j * 2.3 + tier) * .11
      const tip = j === 3 && apex
      const branchScale = proportion * scale * [.99, .89, .98, .91][j] * (tip ? .72 : 1)
      placement.push({
        tier, x: stemX(y), y: y + (tip ? .034 : [.014, -.047, .025, -.022][j]),
        z: stemZ(y),
        azimuth, scale: branchScale,
        pitch: tip ? 1.34 : -.18 - u * .13 + Math.sin(j * 2.8 + tier * 2) * .071,
        roll: tip ? 0 : Math.sin(j * 3.1 + tier * 1.8) * .22,
      })
    }
  })
  return { placement, stemHeight: tierTop + .105, height: tierTop + 4.12 * scale * profiles[count].at(-1)! * .72 + .08 }
}

export function tree(variant: Variant, layout: ReturnType<typeof arrange>, branch: ReturnType<typeof createBranchTemplates>,
  trunk: CylinderGeometry, bark: MeshStandardMaterial) {
  const group = new Group()
  const wood = new Mesh(trunk, bark)
  wood.position.y = layout.stemHeight / 2
  wood.castShadow = wood.receiveShadow = true
  group.add(wood)
  for (const p of layout.placement) {
    const instance = branch.clone(variant)
    instance.position.set(p.x, p.y, p.z)
    instance.scale.setScalar(p.scale)
    instance.quaternion.setFromAxisAngle(yAxis, -p.azimuth).multiply(new Quaternion().setFromAxisAngle(zAxis, p.pitch))
      .multiply(new Quaternion().setFromAxisAngle(xAxis, p.roll))
    group.add(instance)
  }
  return group
}

export function trunkGeometry(height: number, radius: number, atX = stemX, atZ = stemZ) {
  const geometry = new CylinderGeometry(.021, radius, height, 12, 17)
  const points = geometry.getAttribute('position')
  for (let i = 0; i < points.count; i++) {
    const y = points.getY(i) + height * .5
    points.setX(i, points.getX(i) + atX(y))
    points.setZ(i, points.getZ(i) + atZ(y))
  }
  geometry.computeVertexNormals()
  return geometry
}

export function captureTrees(cases: { key: string; model: Group; sculptedLight?: boolean }[], height: number) {
  const renderer = new WebGLRenderer({ antialias: true })
  const scene = new Scene()
  scene.background = new Color('#eef0e5')
  const width = 690, pixels = 580
  renderer.setSize(width, pixels)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  const floor = new Mesh(new PlaneGeometry(30, 30), new ShadowMaterial({ color: '#426454', opacity: .17 }))
  floor.rotateX(-Math.PI / 2)
  floor.position.y = -.012
  floor.receiveShadow = true
  const key = new DirectionalLight('#fff0c8', 2.05)
  key.position.set(-2.9, 7.4, 4.8)
  key.target.position.set(0, height * .43, 0)
  key.castShadow = true
  key.shadow.mapSize.set(1536, 1536)
  Object.assign(key.shadow.camera, { left: -3.8, right: 3.8, top: 3.9, bottom: -3.9, near: .2, far: 18 })
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.normalBias = .017
  key.shadow.bias = -.00018
  const sky = new HemisphereLight('#f2ffe6', '#b1c4aa', 1.57)
  scene.add(floor, key, key.target, sky)
  const fill = new DirectionalLight('#c4e3e5', .38)
  fill.position.set(5, 2, -5)
  scene.add(fill)
  const halfHeight = height * .64
  const halfWidth = halfHeight * width / pixels
  const camera = new OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, .01, 40)
  const center = new Vector3(.04, height * .49, 0)
  const files: Record<string, string> = {}
  try {
    for (const { key: name, model, sculptedLight } of cases) {
      key.position.set(-2.9, sculptedLight ? 8.4 : 7.4, sculptedLight ? 3.4 : 4.8)
      key.intensity = sculptedLight ? 2.28 : 2.05
      sky.intensity = sculptedLight ? 1.39 : 1.57
      sky.groundColor.set(sculptedLight ? '#879f93' : '#b1c4aa')
      fill.intensity = sculptedLight ? .50 : .38
      scene.add(model)
      renderer.shadowMap.needsUpdate = true
      for (const [view, xyz] of Object.entries(angles)) {
        camera.position.copy(center).addScaledVector(new Vector3(...xyz).normalize(), 9)
        camera.lookAt(center)
        camera.updateMatrixWorld()
        renderer.render(scene, camera)
        files[name + '-' + view] = renderer.domElement.toDataURL('image/png').split(',')[1]
      }
      scene.remove(model)
    }
    return files
  } finally {
    floor.geometry.dispose()
    floor.material.dispose()
    key.shadow.dispose()
    renderer.dispose()
  }
}

export function renderCanopies(layers: TierCount) {
  const layout = arrange(layers)
  const geometry = trunkGeometry(layout.stemHeight, layers === 3 ? .067 : .088)
  const bark = new MeshStandardMaterial({ color: '#796044', roughness: .95 })
  const templates = createBranchTemplates()
  try {
    const cases = variants.map(variant => ({ key: variant, model: tree(variant, layout, templates, geometry, bark) }))
    return { files: captureTrees(cases, layout.height), placements: layout.placement.length }
  } finally {
    templates.dispose()
    geometry.dispose()
    bark.dispose()
  }
}

declare global { interface Window { renderCanopies: typeof renderCanopies } }
window.renderCanopies = renderCanopies

