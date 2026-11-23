import { CatmullRomCurve3, MathUtils, Vector3 } from 'three'
import { CrownEnvelope } from '../tree/envelope'
import { radiusAt, type Branch, type Skeleton } from '../tree/skeleton'
import type { TreeSpec } from '../tree/spec'
import type { BirchFoliageClump } from './birch-foliage'

type Point = [number, number, number]

// Centerlines in tree space at the design height of 7.35 units. Local X crosses
// the fork, Z separates foreground and rear boughs. The guides remain 3D in orbit.
export function buildMeadowBirchStructure(spec: TreeSpec): { skeleton: Skeleton; clumps: BirchFoliageClump[] } {
  const heightScale = spec.trunk.height / 7.35
  const spread = spec.crown.width / 1.88
  const point = ([x, y, z]: Point) => new Vector3(x * spread, y * heightScale, z * spread)
  const branches: Branch[] = []
  function add(controls: Point[], startRadius: number, endRadius: number, parent?: Branch, socket = 0) {
    const points = controls.map(point)
    if (parent) points.unshift(parent.curve.getPoint(socket))
    const curve = new CatmullRomCurve3(points)
    const level = parent ? parent.level + 1 : 0
    const radii = points.map((_, i) => MathUtils.lerp(startRadius, endRadius, (i / (points.length - 1)) ** (level === 0 ? 1.27 : .85)))
    const branch: Branch = {
      id: branches.length, kind: level === 0 ? 'trunk' : level === 1 ? 'primary' : 'secondary',
      role: level === 0 ? 'trunk' : level === 1 ? 'limb' : 'child', level,
      ...(parent ? { parentId: parent.id, socket, baseSocket: socket } : {}),
      points, curve, length: curve.getLength(), radii, rootRadius: startRadius, tipRadius: endRadius,
    }
    branches.push(branch)
    return branch
  }

  const trunk = add([
    [0, 0, 0], [-.08, .72, -.035], [-.055, 1.42, .035], [-.065, 2.02, .025],
    [-.38, 2.75, -.02], [-.57, 3.55, -.17], [-.43, 4.46, -.22], [-.33, 5.54, -.31], [-.48, 6.76, -.47],
  ], spec.trunk.radius, .023)
  function bough(parent: Branch, socket: number, proportion: number, controls: Point[]) {
    return add(controls, radiusAt(parent, socket) * proportion, .011, parent, socket)
  }

  const lowerRight = bough(trunk, .37, .7, [[.32, 2.44, .10], [.63, 2.96, .13], [.83, 3.48, .17], [1.49, 3.80, .13]])
  const lowerLeft = bough(trunk, .60, .61, [[-.84, 3.75, .09], [-1.29, 4.13, .39], [-1.39, 4.55, .46]])
  const upperLeft = bough(trunk, .73, .56, [[-.84, 4.82, -.33], [-1.53, 5.32, -.36], [-1.71, 5.65, -.43]])
  const upperRight = bough(trunk, .79, .65, [[.02, 4.98, -.53], [.42, 5.55, -.59], [.91, 6.10, -.52], [1.19, 6.45, -.58]])
  const back = bough(trunk, .68, .48, [[-.14, 4.46, -.77], [.33, 4.99, -1.03], [.52, 5.65, -.99]])

  const shoots = [
    bough(lowerRight, .58, .56, [[.60, 3.51, .54], [.65, 4.03, .69]]),
    bough(lowerLeft, .62, .56, [[-1.42, 4.19, -.01], [-1.74, 4.23, -.17]]),
    bough(upperLeft, .68, .61, [[-1.72, 5.14, .08], [-1.86, 5.32, .19]]),
    bough(upperRight, .62, .58, [[1.01, 5.65, -.12], [1.37, 5.55, .02]]),
  ]
  function pad(branch: Branch, offset: Point, radii: Point, density: number, shade: number): BirchFoliageClump {
    return {
      center: branch.curve.getPoint(1).add(point(offset)), radii: point(radii),
      direction: branch.curve.getTangent(.85), density, shade,
    }
  }
  const clumps = [
    pad(trunk, [.11, .03, .03], [1.05, .90, .86], 1.39, .035),
    pad(upperRight, [-.58, .30, .10], [1.04, .80, .80], 1.29, .065),
    pad(shoots[3], [.05, .12, -.06], [.67, .62, .54], .74, .02),
    pad(upperLeft, [.09, -.13, .18], [1.04, .76, .74], 1.33, .035),
    pad(lowerLeft, [.18, -.04, .09], [.86, .79, .66], 1.14, -.09),
    pad(lowerRight, [-.20, .25, .09], [1.09, .64, .68], 1.36, .07),
    pad(back, [-.16, -.15, -.12], [.82, .94, .66], .94, -.18),
    pad(shoots[0], [.02, .13, -.03], [.53, .51, .45], .72, -.015),
    pad(shoots[1], [-.06, -.21, .02], [.66, .65, .57], .79, -.18),
  ]
  const skeleton: Skeleton = {
    branches, trunk, envelope: new CrownEnvelope(spec, trunk.curve.getPoint(1)),
    clusters: clumps.map(({ center, radii, direction }) => ({ center, direction, width: radii.x * 2, height: radii.y * 2, depth: radii.z * 2 })),
  }
  return { skeleton, clumps }
}
