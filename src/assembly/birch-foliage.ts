import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MathUtils, Mesh, MeshStandardMaterial, Vector3,
} from 'three'
import { rng } from '../shape'
import type { TreeSpec } from '../tree/spec'

export interface BirchFoliageClump {
  center: Vector3
  radii: Vector3
  direction: Vector3
  density?: number
  shade?: number
}

const UP = new Vector3(0, 1, 0)
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const LEAF_OUTLINE = [
  [0, 0],
  [.18, .72],
  [.44, .99],
  [.73, .77],
  [1, 0],
  [.74, -.74],
  [.42, -1],
  [.17, -.68],
] as const

/** Meshed broadleaf sprays, with pigment grouped by bough and actual blade normals. */
export function buildBirchFoliage(spec: TreeSpec, clumps: readonly BirchFoliageClump[]): Mesh {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const shade = new Color(spec.leaves.tintInner)
  const sun = new Color(spec.leaves.tintOuter)
  const twig = new Color(spec.trunk.barkColor).lerp(shade, .32)
  const pigment = new Color()
  const bladePoint = new Vector3()

  function vertex(point: Vector3, color: Color, value = 1) {
    positions.push(point.x, point.y, point.z)
    colors.push(color.r * value, color.g * value, color.b * value)
  }

  function appendLeaf(base: Vector3, axis: Vector3, normal: Vector3, length: number, halfWidth: number) {
    const side = new Vector3().crossVectors(normal, axis).normalize()
    const index = positions.length / 3
    for (const [u, v] of LEAF_OUTLINE) {
      bladePoint.copy(base).addScaledVector(axis, u * length)
        .addScaledVector(side, v * halfWidth)
        .addScaledVector(normal, length * (.052 * u * u - .043 * Math.abs(v)))
      vertex(bladePoint, pigment, 1 + v * .035)
    }
    bladePoint.copy(base).addScaledVector(axis, .46 * length).addScaledVector(normal, .018 * length)
    vertex(bladePoint, pigment, 1.019)
    for (let i = 0; i < LEAF_OUTLINE.length; i++) {
      indices.push(index + i, index + LEAF_OUTLINE.length, index + (i + 1) % LEAF_OUTLINE.length)
    }
  }

  function appendTwig(start: Vector3, end: Vector3, width: number) {
    const along = end.clone().sub(start).normalize()
    const edge = UP.clone().addScaledVector(along, -UP.dot(along)).normalize()
    if (edge.lengthSq() < .01) edge.set(1, 0, 0)
    const side = new Vector3().crossVectors(along, edge).normalize()
    const index = positions.length / 3
    for (let ring = 0; ring < 2; ring++) {
      const base = ring === 0 ? start : end
      const radius = width * (ring === 0 ? 1 : .22)
      for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3
        bladePoint.copy(base).addScaledVector(edge, Math.cos(angle) * radius)
          .addScaledVector(side, Math.sin(angle) * radius)
        vertex(bladePoint, twig)
      }
    }
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3
      indices.push(index + i, index + j, index + i + 3, index + j, index + j + 3, index + i + 3)
    }
  }

  for (const [clumpIndex, clump] of clumps.entries()) {
    if (clump.radii.x <= 0 || clump.radii.y <= 0 || clump.radii.z <= 0 || (clump.density ?? 1) <= 0) continue
    const seed = Math.imul(spec.seed, 2246822519) ^ Math.imul(spec.leaves.leafSeed, 3266489917)
    const random = rng(seed ^ Math.imul(clumpIndex + 1, 668265263))
    const forward = clump.direction.clone().setY(0)
    if (forward.lengthSq() < 1e-5) forward.set(1, 0, 0)
    forward.normalize()
    const across = new Vector3().crossVectors(forward, UP)
    const { x: rx, y: ry, z: rz } = clump.radii
    const spread = Math.sqrt(rx * rz)
    const length = Math.min(spread * .58, Math.max(.04, spec.leaves.leafSize * .365))
    const sprays = MathUtils.clamp(Math.round((25 + spread * 20) * (clump.density ?? 1)), 6, 58)
    const phase = random() * Math.PI * 2

    for (let spray = 0; spray < sprays; spray++) {
      // Jitter a low-discrepancy shell into overlapping sprays, with one layer in the interior
      // to keep the core coherent from side views.
      const y = 1 - 2 * (spray + .32 + random() * .36) / sprays
      const ring = Math.sqrt(1 - y * y)
      const angle = phase + spray * GOLDEN_ANGLE + (random() - .5) * .38
      const a = Math.cos(angle) * ring
      const b = Math.sin(angle) * ring
      const shell = (spray % 4 === 0 ? .43 + random() * .32 : .76 + random() * .18)
        * (1 + .15 * Math.sin(3 * angle + phase))
      const offset = new Vector3(0, y * ry, 0).addScaledVector(forward, a * rx)
        .addScaledVector(across, b * rz).multiplyScalar(shell)
      const tip = clump.center.clone().add(offset)
      const spreadAxis = offset.clone().setY(0).normalize().addScaledVector(forward, .34).normalize()
      if (spreadAxis.lengthSq() < 1e-5) spreadAxis.copy(forward)
      const spraySide = new Vector3().crossVectors(UP, spreadAxis).normalize()
      const span = Math.min(spread * .90, length * (1.18 + random() * 1.1))
      spreadAxis.y = .20 + y * .42 + (random() - .5) * .24
      spreadAxis.normalize()
      const start = tip.clone().addScaledVector(spreadAxis, -span)
      const sprayTone = MathUtils.smoothstep(.48 + y * .39 + (a * forward.x + b * across.x) * .20
        - (a * forward.z + b * across.z) * .12 + (clump.shade ?? 0) + (random() - .5) * .11, .16, .79)
      const leafCount = 10 + Math.floor(random() * 5)
      appendTwig(clump.center.clone().lerp(start, .34), start, length * .023)
      appendTwig(start, tip, length * .018)

      for (let i = 0; i < leafCount; i++) {
        const f = (i + .55) / leafCount
        const sign = i % 2 === 0 ? -1 : 1
        const base = start.clone().lerp(tip, f)
          .addScaledVector(spraySide, sign * length * (.04 + random() * .18))
          .addScaledVector(UP, (random() - .5) * length * .35)
        const normal = offset.clone().setY(0).normalize().multiplyScalar(.63 + random() * .35)
          .addScaledVector(UP, .29 + y * .51 + random() * .28)
          .addScaledVector(spraySide, (random() - .5) * .57 + sign * .24)
          .normalize()
        const axis = spreadAxis.clone().multiplyScalar(.42 + .75 * f + random() * .25)
          .addScaledVector(spraySide, sign * (.43 + random() * .76))
          .addScaledVector(UP, (random() - .37) * .96 + y * .52)
        axis.addScaledVector(normal, -axis.dot(normal)).normalize()
        const tone = MathUtils.clamp(sprayTone + (f - .4) * .075 + (random() - .5) * .20, 0, 1)
        pigment.copy(shade).lerp(sun, tone)
        const bladeLength = length * (.65 + random() * .72) * (1.11 - f * .31)
        const halfWidth = bladeLength * (.24 + random() * .108)
        appendLeaf(base, axis, normal, bladeLength, halfWidth)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const material = new MeshStandardMaterial({
    name: 'Matte leaf pigment', vertexColors: true, roughness: .98, side: DoubleSide,
    // A small diffuse floor approximates transmitted sky light on the blade underside.
    emissive: shade, emissiveIntensity: .17,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'Broadleaf sprays'
  mesh.userData.role = 'foliage'
  mesh.castShadow = true
  return mesh
}
