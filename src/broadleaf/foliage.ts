import { BufferGeometry, CanvasTexture, Float32BufferAttribute, MeshStandardMaterial, SRGBColorSpace, Vector3 } from 'three'
import { paint, sheetGeometry, textureHeight as tileHeight, textureWidth as tileWidth, type Fan } from '../foliage-sheets'
import { clamp, rng } from '../shape'
import type { CrownCluster, Growth } from './growth'

const templates = {
  broadleaf: [[0, .035], [.14, .43], [.26, .81], [.38, .95], [.48, .85], [.59, .98], [.7, .85], [.8, .90], [.9, .59], [.96, .35], [1, .055]],
  open: [[0, .026], [.15, .41], [.31, .77], [.43, .94], [.51, .73], [.61, .91], [.72, .65], [.82, .74], [.91, .49], [.97, .26], [1, .025]],
  edge: [[0, .034], [.16, .42], [.30, .76], [.40, .61], [.51, .90], [.58, .68], [.67, .86], [.76, .57], [.83, .73], [.94, .36], [1, .04]],
} as const satisfies Record<string, Fan['profile']>
type Template = keyof typeof templates
const variants = 4
const palettes: NonNullable<Fan['palette']>[] = [
  ['#254d3c', '#38684a', '#4c754e', '#568455', '#719859', '#8fa75a'],
  ['#2a5541', '#40714b', '#508054', '#609054', '#79a15b', '#99b363'],
  ['#366147', '#4a7a50', '#588956', '#6a9755', '#82a75c', '#a2b963'],
  ['#3e663c', '#538447', '#66944b', '#7ba44f', '#9ab457', '#b4c36a'],
]
let atlas: CanvasTexture | undefined
let users = 0
const keys = Object.keys(templates) as Template[]
const tileRow = (template: Template, yaw: number) => keys.indexOf(template) * 2 + Number(yaw < 0)
const rows = keys.length * 2

function leafDab(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, width: number, yaw: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(yaw)
  ctx.scale(length, width)
  ctx.beginPath()
  ctx.moveTo(-1, 0)
  ctx.bezierCurveTo(-.83, -.33, -.48, -1.04, -.16, -.78)
  ctx.quadraticCurveTo(.04, -1.08, .29, -.72)
  ctx.quadraticCurveTo(.69, -.71, .97, -.07)
  ctx.quadraticCurveTo(.98, .23, .60, .30)
  ctx.quadraticCurveTo(.48, .83, .13, .56)
  ctx.quadraticCurveTo(-.22, .96, -.48, .47)
  ctx.quadraticCurveTo(-.72, .38, -1, 0)
  ctx.fill()
  ctx.restore()
}

function paintBroadleafSurface(sheet: HTMLCanvasElement, template: Template, row: number, variant: number) {
  const ctx = sheet.getContext('2d')!
  const alpha = document.createElement('canvas')
  alpha.width = sheet.width
  alpha.height = sheet.height
  const mask = alpha.getContext('2d')!
  const palette = palettes[variant]
  const random = rng(1619 + row * 223 + variant * 379)
  mask.fillStyle = '#fff'
  ctx.save()
  // Retain the directed paint and build the frond's perimeter from
  // overlapping lobed silhouettes. Dabs are baked into the sheet texture.
  const profile = templates[template]
  for (let i = 0; i < 132; i++) {
    const u = .048 + random() * .925
    const right = profile.findIndex(([t]) => t > u)
    const [start, a] = profile[right - 1], [end, b] = profile[right]
    const radius = a + (b - a) * (u - start) / (end - start)
    const lane = i < 60 ? (i % 2 === 0 ? -1 : 1) * (.68 + random() * .32) : random() * 1.42 - .71
    const x = 8 + u * (tileWidth - 16)
    const y = tileHeight * .50 + radius * tileHeight * .35 * lane
    const length = 15 + random() * 18
    const width = 17 + random() * 18
    const yaw = lane * (.28 + random() * .65)
    leafDab(mask, x, y, length, width, yaw)
    const crownLight = (lane < 0 ? .86 : .25) + u * .85
    const light = Math.min(5, 1 + Math.round(crownLight + random() * 2))
    ctx.fillStyle = palette[light]
    ctx.globalAlpha = .21 + random() * .49
    leafDab(ctx, x + 1, y - 1, length * .89, width * .83, yaw)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(alpha, 0, 0)
  ctx.restore()
}

function acquireAtlas() {
  if (!atlas) {
    const canvas = document.createElement('canvas')
    canvas.width = tileWidth * variants
    canvas.height = tileHeight * rows
    const ctx = canvas.getContext('2d')!
    for (const template of keys) {
      for (const yaw of [1, -1]) {
        for (let variant = 0; variant < variants; variant++) {
          const row = tileRow(template, yaw)
          const { sheet, material } = paint({ yaw, origin: new Vector3(), length: 1, width: 1, drop: 0, lift: 0,
            index: row * variants + variant, palette: palettes[variant], profile: templates[template] })
          // paint() keeps its clipping context for the original texture.
          const surface = document.createElement('canvas')
          surface.width = tileWidth
          surface.height = tileHeight
          surface.getContext('2d')!.drawImage(sheet, 0, 0)
          paintBroadleafSurface(surface, template, row, variant)
          ctx.drawImage(surface, variant * tileWidth, row * tileHeight)
          material.map!.dispose()
          material.dispose()
        }
      }
    }
    atlas = new CanvasTexture(canvas)
    atlas.colorSpace = SRGBColorSpace
    atlas.anisotropy = 8
  }
  users++
  const map = atlas
  return {
    map,
    release() {
      users--
      if (!users) { map.dispose(); atlas = undefined }
    },
  }
}

class SheetBatch {
  private positions: number[] = []
  private normals: number[] = []
  private uv: number[] = []
  private colors: number[] = []
  private top: number[] = []
  private bottom: number[] = []

  add(fan: Fan, template: Template, variant: number, size: 'form' | 'detail', cluster: CrownCluster, tint: number) {
    const geometry = sheetGeometry(fan, size === 'form' ? 3 : 2, false)
    const row = tileRow(template, fan.yaw)
    const vertexBase = this.positions.length / 3
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')
    const center = cluster.center.clone().addScaledVector(cluster.direction, cluster.width * .19)
    center.y += cluster.height * .08
    const outward = new Vector3()
    const surface = new Vector3()
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
      this.positions.push(x, y, z)
      // Bent foliage normals keep the lighting continuous across overlapping
      // sprays. Face winding and top/bottom geometry still come from the sheets.
      outward.set((x - center.x) / cluster.width, (y - center.y) / cluster.height * 1.4,
        (z - center.z) / cluster.depth).normalize()
      surface.fromBufferAttribute(normal, i).multiplyScalar(.56).addScaledVector(outward, .44).normalize()
      this.normals.push(surface.x, surface.y, surface.z)
      this.uv.push((variant + uv.getX(i)) / variants, (rows - row - 1 + uv.getY(i)) / rows)
      const light = clamp(tint * (.76 + .26 * clamp(.51 + (y - center.y) / cluster.height)))
      this.colors.push(light, light * .996, light * .984)
    }
    const index = geometry.index!
    for (const [group, indices] of [[geometry.groups[0], this.top], [geometry.groups[1], this.bottom]] as const) {
      for (let i = group.start; i < group.start + group.count; i++) indices.push(index.getX(i) + vertexBase)
    }
    geometry.dispose()
  }

  finish() {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uv, 2))
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3))
    geometry.setIndex(this.top.concat(this.bottom))
    geometry.addGroup(0, this.top.length, 0)
    geometry.addGroup(this.top.length, this.bottom.length, 1)
    geometry.computeBoundingBox()
    return geometry
  }
}

type Spray = readonly [offset: number, origin: number, length: number, breadth: number, incline: number]

const roundForm: Spray[] = [[-.55, .96, 1.10, .66, -.35], [.61, .90, 1.10, .69, .34], [.13, .98, .91, .59, .73], [2.22, .94, .94, .63, .42]]
const openForm: Spray[] = [[-.48, .96, 1.11, .56, -.28], [.68, .85, 1.07, .63, .40], [.10, .98, 1.02, .55, .81], [-2.12, .84, .90, .54, .15]]
const detail: Spray[] = [
  [-1.23, .79, .75, .44, -.14], [1.17, .86, .82, .42, -.19], [-.41, .97, 1.13, .40, .02],
  [.50, .98, .87, .42, .70], [2.37, .85, .69, .46, .34], [-2.11, .87, .59, .44, .20],
  [-1.2, .94, .75, .38, .84], [.87, .84, .70, .41, .67], [2.69, .95, .67, .40, -.21],
]

export function makeFoliage(growth: Growth) {
  const { map, release } = acquireAtlas()
  const top = new MeshStandardMaterial({ name: 'Foliage · lit', map, vertexColors: true, roughness: .95, alphaTest: .44 })
  const underside = new MeshStandardMaterial({ name: 'Foliage · shade', color: '#c3d2aa', map, vertexColors: true, roughness: 1, alphaTest: .44 })
  const macro = new SheetBatch()
  const meso = new SheetBatch()
  const isRound = growth.config.species === 'round'
  for (const cluster of growth.clusters) {
    const random = rng(cluster.seed)
    const branch = growth.limbs[cluster.branchId]
    const yaw = Math.atan2(cluster.direction.z, cluster.direction.x)
    const create = (spray: Spray, index: number, size: 'form' | 'detail') => {
      const [dYaw, socket, lengthFactor, breadth, incline] = spray
      const angle = Math.atan2(Math.sin(yaw + dYaw), Math.cos(yaw + dYaw)) + (random() - .5) * (.16 + cluster.irregularity * .50)
      const template = size === 'detail' && (index % 3 !== 1) ? 'edge' : isRound ? 'broadleaf' : 'open'
      const row = tileRow(template, angle)
      const variant = Math.round(clamp(cluster.tone + (random() - .5) * .44 + incline * .17) * (variants - 1))
      const nominalLength = cluster.width * lengthFactor * growth.config.foliageScale * (.86 + random() * .26)
      const origin = branch.curve.getPoint(Math.min(cluster.socket, socket) * (.98 + random() * .015))
      if (index === 2 && size === 'form') origin.copy(cluster.center)
      const limitY = growth.config.treeHeight - origin.y
      const length = nominalLength * (limitY < .6 ? .81 : 1)
      const lift = cluster.height * (.19 + random() * .08)
      const climb = Math.min(limitY * .70, cluster.height * incline + (random() - .5) * .14)
      const fan: Fan = {
        origin, yaw: angle, index: row * variants + variant, profile: templates[template],
        length, width: cluster.depth * breadth * growth.config.foliageScale * (.85 + random() * .30),
        lift, drop: cluster.height * (.12 + random() * .27),
        climb: climb + Math.sin(angle) * length * .21,
        tilt: Math.cos(angle) * .21 + Math.sin(index * 2.37 + cluster.id) * (.47 + cluster.irregularity * .22),
      }
      const tint = .77 + cluster.tone * .20 + random() * .09 + (incline < 0 ? -.09 : 0)
      const batch = size === 'form' ? macro : meso
      batch.add(fan, template, variant, size, cluster, tint)
    }
    ;(isRound ? roundForm : openForm).forEach((spray, index) => create(spray, index, 'form'))
    detail.slice(0, Math.round(detail.length * cluster.density / 1.4)).forEach((spray, index) => create(spray, index, 'detail'))
  }
  const form = macro.finish()
  const detailGeometry = meso.finish()
  return { form, detail: detailGeometry, materials: [top, underside], dispose() {
    form.dispose()
    detailGeometry.dispose()
    top.dispose()
    underside.dispose()
    release()
  } }
}

