import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, MeshStandardMaterial, SRGBColorSpace, Vector3 } from 'three'

export const textureWidth = 384, textureHeight = 224, inset = 8, vLimit = 1.20
const W = textureWidth, H = textureHeight
export const foliage = { side: DoubleSide, roughness: .94, alphaTest: .44 }
const pigment = ['#1c473c', '#2e644f', '#447c53', '#61925b', '#86a963', '#b0c475']

export type Fan = {
  yaw: number; length: number; width: number; drop: number; lift: number; index: number; origin: Vector3
  profile?: readonly (readonly [number, number])[];
  palette?: readonly [string, string, string, string, string, string];
  climb?: number;
  tilt?: number;
}
const rails = [
  [0, .028], [.11, .25], [.24, .57], [.34, .89], [.43, .77], [.53, .94],
  [.61, .82], [.69, .90], [.77, .55], [.84, .61], [.93, .26], [1, .020],
]

function smooth(t: number) { return t * t * (3 - 2 * t) }
function widthAt(t: number, side: number, fan: Fan) {
  const shape = fan.profile ?? rails
  const u = Math.max(0, Math.min(1, t + Math.sin(t * Math.PI) * (.028 * side + .012 * Math.sin(fan.index * 2))))
  const index = shape.findIndex(([x], i) => i + 1 < shape.length && x <= u && u <= shape[i + 1][0])
  const i = index < 0 ? shape.length - 2 : index
  const [start, a] = shape[i], [end, b] = shape[i + 1]
  return (a + (b - a) * smooth((u - start) / (end - start))) * (1 + .065 * Math.sin(t * 7 + side + fan.index * .61))
}

function sway(t: number, fan: Fan) {
  const sign = fan.yaw >= 0 ? 1 : -1
  return .19 * sign * Math.sin(t * Math.PI) * Math.sin(t * 2.8 + fan.index * .2)
}
const direction = (fan: Fan) => new Vector3(Math.cos(fan.yaw), 0, Math.sin(fan.yaw))
export const across = (fan: Fan) => new Vector3(-Math.sin(fan.yaw), 0, Math.cos(fan.yaw))

export function paint(fan: Fan) {
  const colors = fan.palette ?? pigment
  const sheet = document.createElement('canvas')
  sheet.width = W
  sheet.height = H
  const ctx = sheet.getContext('2d')!
  const x = (u: number) => inset + u * (W - 2 * inset)
  const y = (v: number) => (v + vLimit) * H / (vLimit * 2)
  const outline = new Path2D()
  outline.moveTo(x(0), y(sway(0, fan) - widthAt(0, -1, fan)))
  for (let i = 1; i <= 88; i++) {
    const t = i / 88
    outline.lineTo(x(t), y(sway(t, fan) - widthAt(t, -1, fan)))
  }
  for (let i = 88; i >= 0; i--) {
    const t = i / 88
    outline.lineTo(x(t), y(sway(t, fan) + widthAt(t, 1, fan)))
  }
  outline.closePath()
  ctx.clip(outline)
  const color = ctx.createLinearGradient(0, H * .87, W * .52, H * .13)
  color.addColorStop(0, colors[0])
  color.addColorStop(.35, colors[1])
  color.addColorStop(.65, fan.index % 3 === 0 ? colors[2] : colors[3])
  color.addColorStop(1, colors[4])
  ctx.fillStyle = color
  ctx.fillRect(0, 0, W, H)

  // Pigment lobes travel from the interior rachis towards the authored scallops.
  for (const side of [1, -1]) {
    for (const [i, u] of [.25, .38, .50, .62, .74, .85, .94].entries()) {
      const start = Math.max(.03, u - .24)
      const reach = sway(u, fan) + side * widthAt(u, side, fan) * (.89 + .14 * Math.sin(i * 2.7))
      const mass = sway(u - .07, fan) + side * widthAt(u - .07, side, fan) * .70
      const lower = sway(u + .03, fan) + side * widthAt(u + .03, side, fan) * .35
      ctx.beginPath()
      ctx.moveTo(x(start), y(sway(start, fan) + side * .07))
      ctx.bezierCurveTo(x(u - .15), y(mass * .56), x(u - .09), y(reach * 1.13), x(u), y(reach))
      ctx.bezierCurveTo(x(u - .018), y(lower), x(u - .14), y(sway(u, fan) - side * .15), x(start), y(sway(start, fan) + side * .07))
      ctx.fillStyle = colors[side === -1 ? 3 + Number(i % 3 !== 0) : 1 + Number(i % 3 !== 0)]
      ctx.globalAlpha = .43 + .14 * Math.cos(i + fan.index)
      ctx.fill()
    }
  }
  ctx.globalAlpha = .71
  const gradient = ctx.createLinearGradient(x(.08), 0, x(.82), H * .42)
  gradient.addColorStop(0, fan.palette?.[1] ?? '#3b6549')
  gradient.addColorStop(.68, fan.palette?.[3] ?? '#75a461')
  gradient.addColorStop(1, fan.palette?.[5] ?? '#aec372')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.moveTo(x(.05), y(.09))
  ctx.bezierCurveTo(x(.31), y(-.36), x(.63), y(sway(.63, fan) - .22), x(.94), y(sway(.94, fan) - .061))
  ctx.bezierCurveTo(x(.73), y(sway(.73, fan) + .01), x(.40), y(sway(.40, fan) + .17), x(.05), y(.09))
  ctx.fill()
  ctx.globalAlpha = .38
  ctx.lineWidth = 1.65
  ctx.strokeStyle = colors[5]
  ctx.lineCap = 'round'
  for (let i = 0; i < 8; i++) {
    const t = .23 + i * .082
    const a = sway(t, fan) - widthAt(t, -1, fan) * (.23 + (i % 3) * .14)
    ctx.beginPath()
    ctx.moveTo(x(t - .072), y(a * .53))
    ctx.quadraticCurveTo(x(t - .041), y(a * 1.06), x(t + .02), y(a))
    ctx.stroke()
  }
  const map = new CanvasTexture(sheet)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8
  return { sheet, material: new MeshStandardMaterial({ ...foliage, map }) }
}

export function leafPoint(fan: Fan, t: number, fraction: number, lower = false) {
  const width = widthAt(t, fraction < 0 ? -1 : 1, fan)
  const v = sway(t, fan) + fraction * width
  const origin = fan.origin.clone()
  const pos = origin.clone().addScaledVector(direction(fan), fan.length * t).addScaledVector(across(fan), v * fan.width)
  const body = Math.sin(Math.PI * t) ** .84
  // A shallow crest falls into thin hanging rims. The thickness tapers separately from the outline.
  const sag = fan.width * .43 * body * Math.abs(fraction) ** 1.65
  const thickness = .0018 + .024 * body * (1 - Math.abs(fraction) ** .72)
  pos.y += fan.lift * body - fan.drop * t ** 1.63 - sag - (pos.z - origin.z) * .21
  if (fan.climb !== undefined) pos.y += fan.climb * t
  if (fan.tilt !== undefined) pos.y += fan.tilt * fan.width * v
  if (lower) pos.y -= thickness
  return { pos, v }
}

export function sheetGeometry(fan: Fan, widthCuts = 4, smooth = true) {
  const shape = fan.profile ?? rails
  const sections = shape.flatMap(([t], i) => i === shape.length - 1 || !smooth ? [t] : [t, (t + shape[i + 1][0]) * .5])
  const lengthCuts = sections.length - 1
  const count = (lengthCuts + 1) * (widthCuts + 1)
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  const step = widthCuts + 1
  for (const bottom of [false, true]) {
    for (let i = 0; i <= lengthCuts; i++) {
      for (let j = 0; j <= widthCuts; j++) {
        const t = sections[i], fraction = j / widthCuts * 2 - 1
        const { pos, v } = leafPoint(fan, t, fraction, bottom)
        positions.push(pos.x, pos.y, pos.z)
        uv.push((inset + t * (W - 2 * inset)) / W, 1 - (v + vLimit) / (vLimit * 2))
        if (i === lengthCuts || j === widthCuts) continue
        const a = i * step + j + (bottom ? count : 0), b = a + 1, c = b + step, d = a + step
        indices.push(...(bottom ? [a, c, b, a, d, c] : [a, b, c, a, c, d]))
      }
    }
  }
  const cap = (a: number, b: number) => indices.push(b, a, a + count, b, a + count, b + count)
  for (let i = 0; i < lengthCuts; i++) {
    cap(i * step, (i + 1) * step)
    cap((i + 1) * step + widthCuts, i * step + widthCuts)
  }
  for (let j = 0; j < widthCuts; j++) {
    cap(j + 1, j)
    cap(lengthCuts * step + j, lengthCuts * step + j + 1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.addGroup(0, lengthCuts * widthCuts * 6, 0)
  geometry.addGroup(lengthCuts * widthCuts * 6, indices.length - lengthCuts * widthCuts * 6, 1)
  geometry.computeVertexNormals()
  return geometry
}

