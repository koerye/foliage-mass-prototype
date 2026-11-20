// Procedural pine-bough card texture: stem at top centre (v = 1), hanging
// feathered pine frond tapering to a pointed tip at the bottom (v = 0).
import { CanvasTexture, SRGBColorSpace } from 'three'
import { dilateAlphaCanvas } from '../broadleaf/leaf-material'
import { rng } from '../shape'

export function makeNeedleTexture(width = 512, height = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const random = rng(911)
  const cx = width / 2
  const profile = (s: number) => s <= .28 ? .04 + .96 * (s / .28) : s <= .72 ? 1 - .24 * ((s - .28) / .44) : .04 + .72 * (1 - (s - .72) / .28)

  const blade = (x0: number, y0: number, x1: number, y1: number, halfW: number, light: number) => {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1
    const nx = -dy / L, ny = dx / L
    const mx = (x0 + x1) * .5, my = (y0 + y1) * .5
    const grad = g.createLinearGradient(x0, y0, x1, y1)
    grad.addColorStop(0, `hsl(148, 44%, ${20 + light * 7}%)`)
    grad.addColorStop(.55, `hsl(126, 52%, ${34 + light * 12}%)`)
    grad.addColorStop(1, `hsl(88, 66%, ${54 + light * 14}%)`)
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(x0, y0)
    g.quadraticCurveTo(mx + nx * halfW, my + ny * halfW, x1, y1)
    g.quadraticCurveTo(mx - nx * halfW, my - ny * halfW, x0, y0)
    g.fill()
    // subtle central highlight rib on each feathered lobe
    g.strokeStyle = `hsla(92, 65%, ${58 + light * 14}%, .32)`
    g.lineWidth = Math.max(2, halfW * .18)
    g.beginPath()
    g.moveTo(x0, y0)
    g.lineTo(x1 * .9 + x0 * .1, y1 * .9 + y0 * .1)
    g.stroke()
  }

  // Broad feathered pine-bough lobes hanging downward inside the kite silhouette
  // (back darker pass for solid core, front lighter pass for crisp painted separation)
  for (const pass of [0, 1]) {
    const pairs = pass ? 9 : 8
    for (let i = 0; i < pairs; i++) {
      const s = .05 + .72 * (i + (pass ? .35 : .1)) / pairs
      const y0 = height * s
      const sTip = Math.min(.97, s + .24)
      const reach = width * .48 * profile(sTip) * (.92 + random() * .08)
      const y1 = height * Math.min(.99, sTip + .03)
      for (const side of [-1, 1]) {
        const x1 = cx + side * reach
        const w = width * (pass ? .068 : .085) * (1 - s * .25)
        blade(cx + side * 2, y0, x1, y1, w, pass ? .45 + random() * .5 : random() * .25)
      }
    }
  }
  // green shoulder fill right at the stem entry so converging apex cards stay green
  blade(cx, 0, cx - width * .12, height * .22, width * .06, .35)
  blade(cx, 0, cx + width * .12, height * .22, width * .06, .35)
  blade(cx, 0, cx, height * .22, width * .05, .3)
  // central terminal lobe reaching the pointed bottom tip
  blade(cx, height * .52, cx, height * .99, width * .11, .75)
  blade(cx, height * .68, cx - width * .13, height * .92, width * .058, .65)
  blade(cx, height * .68, cx + width * .13, height * .92, width * .058, .65)

  // painted woody midrib + subtle side twigs (slightly below top -> ~74% down)
  g.lineCap = 'round'
  g.strokeStyle = '#7b5536'
  for (let i = 0; i < 3; i++) {
    const s = .16 + i * .19
    const y0 = height * s
    const side = i % 2 ? 1 : -1
    g.lineWidth = Math.max(3, 6 - i * 1.2)
    g.beginPath()
    g.moveTo(cx, y0)
    g.lineTo(cx + side * width * (.24 - i * .04), y0 + height * .16)
    g.stroke()
  }
  const stem = g.createLinearGradient(0, height * .05, 0, height * .76)
  stem.addColorStop(0, '#5a6b32')
  stem.addColorStop(.15, '#765133')
  stem.addColorStop(.75, '#87603e')
  stem.addColorStop(1, '#5d7d3a')
  g.strokeStyle = stem
  g.lineWidth = 8
  g.beginPath()
  g.moveTo(cx, height * .05)
  g.lineTo(cx, height * .74)
  g.stroke()

  return canvasTexture(canvas, 'placeholder_pine_card')
}

function canvasTexture(canvas: HTMLCanvasElement, name: string) {
  dilateAlphaCanvas(canvas, 6)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  texture.name = name
  return texture
}

/** Drape texture: branch along the top edge (u = base -> tip), needles hanging down toward the tip. */
export function makeDrapeTexture(width = 512, height = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const random = rng(4242)
  g.lineCap = 'round'
  const top = height * .06
  for (const pass of [0, 1]) {
    const count = pass ? 120 : 90
    for (let i = 0; i < count; i++) {
      const s = (i + random()) / count
      const x = width * (.02 + s * .94)
      const envelope = Math.min(1, s / .1) * (s > .82 ? 1 - (s - .82) / .18 * .75 : 1)
      const L = (height - top - 6) * envelope * (.78 + random() * .22) / Math.cos(.45)
      const a = .32 + random() * .3 + s * .1
      const x2 = x + Math.sin(a) * L, y2 = top + Math.cos(a) * L
      const light = pass ? .35 + random() * .65 : random() * .3
      const grad = g.createLinearGradient(x, top, x2, y2)
      grad.addColorStop(0, `hsl(150, 42%, ${18 + light * 8}%)`)
      grad.addColorStop(.5, `hsl(132, 48%, ${34 + light * 12}%)`)
      grad.addColorStop(1, `hsl(90, 62%, ${56 + light * 14}%)`)
      g.strokeStyle = grad
      g.lineWidth = pass ? 4 : 5
      g.beginPath()
      g.moveTo(x, top)
      g.quadraticCurveTo(x + Math.sin(a) * L * .25, top + Math.cos(a) * L * .6, Math.min(width - 2, x2), Math.min(height - 2, y2))
      g.stroke()
    }
  }
  g.strokeStyle = '#4f3a26'
  g.lineWidth = 6
  g.beginPath()
  g.moveTo(0, top)
  g.lineTo(width * .97, top + 2)
  g.stroke()
  return canvasTexture(canvas, 'placeholder_drape_needles')
}

/** Grass card: bold stylized tapered blades rising from the bottom centre. */
export function makeGrassTexture(width = 256, height = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const random = rng(5151)
  for (let i = 0; i < 7; i++) {
    const x0 = width * (.24 + (i + random() * .5) / 7 * .52)
    const lean = ((i / 6 - .5) * .7 + (random() - .5) * .35) * width * .75
    const h = height * (.68 + random() * .3), w = width * (.11 + random() * .045)
    const grad = g.createLinearGradient(0, height, 0, height - h)
    const light = random()
    grad.addColorStop(0, `hsl(112, 46%, ${26 + light * 7}%)`)
    grad.addColorStop(.55, `hsl(96, 56%, ${42 + light * 10}%)`)
    grad.addColorStop(1, `hsl(76, 68%, ${64 + light * 12}%)`)
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(x0 - w / 2, height)
    g.quadraticCurveTo(x0 - w * .38 + lean * .35, height - h * .52, x0 + lean, height - h)
    g.quadraticCurveTo(x0 + w * .38 + lean * .35, height - h * .52, x0 + w / 2, height)
    g.fill()
  }
  return canvasTexture(canvas, 'placeholder_grass_blades')
}

/** Fern frond: rachis along the vertical centre, clearly separated paired pinnae. */
export function makeFernTexture(width = 256, height = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const random = rng(6161)
  const cx = width / 2
  const pairs = 17
  for (let i = 0; i < pairs; i++) {
    const s = i / (pairs - 1)
    const y = height * (.92 - s * .86)
    const len = width * .46 * (s < .12 ? .48 + s * 4.2 : 1 - (s - .12) * .88)
    for (const side of [-1, 1]) {
      g.save()
      g.translate(cx, y)
      g.rotate(side * (1.22 - s * .42))
      const grad = g.createLinearGradient(0, 0, 0, -len)
      const light = random()
      grad.addColorStop(0, `hsl(128, 48%, ${26 + light * 6}%)`)
      grad.addColorStop(1, `hsl(92, 60%, ${52 + light * 12}%)`)
      g.fillStyle = grad
      const pw = Math.max(4, len * .13)
      g.beginPath()
      g.moveTo(0, 0)
      g.quadraticCurveTo(pw, -len * .35, 0, -len)
      g.quadraticCurveTo(-pw, -len * .35, 0, 0)
      g.fill()
      g.restore()
    }
  }
  g.strokeStyle = '#4e7430'
  g.lineWidth = 6
  g.beginPath()
  g.moveTo(cx, height)
  g.lineTo(cx, height * .04)
  g.stroke()
  return canvasTexture(canvas, 'placeholder_fern_frond')
}

/** Stylized tropical palm frond: petiole at bottom centre (v = 0), broad
 *  feathered/wind-split green blades sweeping up to the tip (v = 1). */
export function makePalmTexture(width = 512, height = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const random = rng(7373)
  const cx = width / 2
  const profile = (s: number) => s < .12 ? .16 + .48 * (s / .12) : s < .55 ? .64 + .36 * Math.sin((s - .12) / .43 * Math.PI / 2) : Math.max(.08, Math.cos((s - .55) / .45 * Math.PI / 2) ** .72)

  // broad feathered/split palm leaflets rising upward-outward from the rachis
  const leaflet = (x0: number, y0: number, x1: number, y1: number, halfW: number, light: number) => {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1
    const nx = -dy / L, ny = dx / L
    const mx = (x0 + x1) * .5, my = (y0 + y1) * .5
    const grad = g.createLinearGradient(x0, y0, x1, y1)
    grad.addColorStop(0, `hsl(114, 46%, ${26 + light * 7}%)`)
    grad.addColorStop(.55, `hsl(100, 54%, ${40 + light * 10}%)`)
    grad.addColorStop(1, `hsl(82, 64%, ${54 + light * 12}%)`)
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(x0, y0)
    g.quadraticCurveTo(mx + nx * halfW, my + ny * halfW, x1, y1)
    g.quadraticCurveTo(mx - nx * halfW, my - ny * halfW, x0, y0)
    g.fill()
    // faint lighter vein along each blade segment
    g.strokeStyle = `hsla(84, 60%, ${64 + light * 10}%, .28)`
    g.lineWidth = Math.max(1.5, halfW * .12)
    g.beginPath()
    g.moveTo(x0, y0)
    g.lineTo(x1 * .88 + x0 * .12, y1 * .88 + y0 * .12)
    g.stroke()
  }

  // Stylized broad lush palm blade with crisp organic V-splits (matches painterly game palms)
  const bg = g.createLinearGradient(0, height * .92, 0, height * .04)
  bg.addColorStop(0, '#36742b')
  bg.addColorStop(.55, '#53a038')
  bg.addColorStop(1, '#84cb4c')
  g.fillStyle = bg
  g.beginPath()
  g.moveTo(cx, height * .9)
  for (let i = 0; i <= 24; i++) {
    const s = .12 + .87 * i / 24
    g.lineTo(cx - width * .47 * profile(s), height * (1 - s))
  }
  g.lineTo(cx, height * .01)
  for (let i = 24; i >= 0; i--) {
    const s = .12 + .87 * i / 24
    g.lineTo(cx + width * .47 * profile(s), height * (1 - s))
  }
  g.closePath()
  g.fill()

  // Painted feathered blade ribs & broad overlapping palm segments for rich tonal breakup
  const pairs = 14
  for (let i = 0; i < pairs; i++) {
    const s = .15 + .78 * i / (pairs - 1)
    const y0 = height * (1 - s)
    const sTip = Math.min(.98, s + .09)
    const reach = width * .47 * profile(sTip) * (.94 + random() * .06)
    const y1 = height * Math.max(.02, 1 - sTip)
    for (const side of [-1, 1]) {
      const hw = width * .064 * (1 - s * .25)
      leaflet(cx + side * 3, y0, cx + side * reach, y1, hw, .32 + s * .35 + random() * .28)
    }
  }
  leaflet(cx, height * .25, cx, height * .01, width * .08, .85)

  // Cut 5-6 crisp V-shaped wind splits into the left/right edges so silhouette reads unmistakably as palm
  g.save()
  g.globalCompositeOperation = 'destination-out'
  g.fillStyle = '#000'
  const notchList: [number, number, number][] = [
    [-1, .28, .28], [1, .34, .32], [-1, .48, .36], [1, .53, .30], [-1, .68, .30], [1, .73, .28], [-1, .84, .22],
  ]
  for (const [side, s, depth] of notchList) {
    const outerX = cx + side * width * .49 * profile(s)
    const innerX = cx + side * width * .48 * profile(s) * (1 - depth)
    const y = height * (1 - s)
    const gap = height * (.022 + depth * .03)
    g.beginPath()
    g.moveTo(outerX + side * 6, y - gap)
    g.lineTo(innerX, y + gap * .5)
    g.lineTo(outerX + side * 6, y + gap * .9)
    g.closePath()
    g.fill()
  }
  g.restore()

  // central pale-green-tan petiole & rachis tapering from bottom -> top
  g.lineCap = 'round'
  const stem = g.createLinearGradient(0, height, 0, height * .06)
  stem.addColorStop(0, '#6a7836')
  stem.addColorStop(.35, '#89a342')
  stem.addColorStop(1, '#a9c956')
  g.strokeStyle = stem
  for (let i = 0; i < 16; i++) {
    const t0 = i / 16, t1 = (i + 1) / 16
    g.lineWidth = Math.max(2, 13 * (1 - t0 * .82))
    g.beginPath()
    g.moveTo(cx, height * (1 - t0 * .94))
    g.lineTo(cx, height * (1 - t1 * .94))
    g.stroke()
  }
  return canvasTexture(canvas, 'placeholder_palm_frond')
}

/** Stylized flower cluster: ivory-white 5-petal blossoms with warm stamens so
 *  the flower tint controls can dye them cleanly into pink, gold, red or white. */
export function makeFlowerTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const random = rng(9091)
  const s = size / 512

  const blossom = (cx: number, cy: number, radius: number, rot: number, bright: number) => {
    g.save()
    g.translate(cx * s, cy * s)
    g.rotate(rot)
    const R = radius * s
    // 5 rounded overlapping petals
    for (let k = 0; k < 5; k++) {
      g.save()
      g.rotate(k * Math.PI * 2 / 5)
      const grad = g.createRadialGradient(0, -R * .18, R * .05, 0, -R * .48, R * .62)
      grad.addColorStop(0, `hsl(340, 22%, ${Math.round(84 + bright * 6)}%)`)
      grad.addColorStop(.55, `hsl(345, 14%, ${Math.round(93 + bright * 5)}%)`)
      grad.addColorStop(1, `hsl(345, 16%, ${Math.round(88 + bright * 4)}%)`)
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(0, -R * .08)
      g.bezierCurveTo(R * .46, -R * .24, R * .48, -R * .86, 0, -R)
      g.bezierCurveTo(-R * .48, -R * .86, -R * .46, -R * .24, 0, -R * .08)
      g.fill()
      g.restore()
    }
    // warm golden centre & tiny stamen dots
    const center = g.createRadialGradient(0, 0, R * .02, 0, 0, R * .26)
    center.addColorStop(0, '#e89b2d')
    center.addColorStop(.65, '#f6cd52')
    center.addColorStop(1, 'rgba(246, 205, 82, 0)')
    g.fillStyle = center
    g.beginPath()
    g.arc(0, 0, R * .26, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#d47c1e'
    for (let k = 0; k < 7; k++) {
      const a = k * Math.PI * 2 / 7 + .2
      g.beginPath()
      g.arc(Math.cos(a) * R * .17, Math.sin(a) * R * .17, R * .038, 0, Math.PI * 2)
      g.fill()
    }
    g.restore()
  }

  // bouquet of 6 blossoms of varied sizes centered cleanly in the square card
  const items: [number, number, number, number][] = [
    [155, 165, 86, .2], [352, 172, 82, .9], [148, 338, 78, 1.5],
    [356, 336, 84, 2.2], [256, 376, 74, .6], [256, 248, 108, .4],
  ]
  for (const [x, y, r, rot] of items) {
    blossom(x + (random() - .5) * 14, y + (random() - .5) * 14, r * (.94 + random() * .12), rot + (random() - .5) * .4, .5 + random() * .5)
  }
  return canvasTexture(canvas, 'placeholder_flower_cluster')
}

/** Single stylized daisy/cosmos blossom centered in the square alpha card.
 *  Ivory-white petals with subtle radial shading and a warm golden button center
 *  so tintInner/tintOuter can cleanly dye it yellow, coral, peach, pink or sky-blue. */
export function makeSingleFlowerTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const s = size / 512
  const cx = 256 * s, cy = 256 * s, R = 228 * s

  g.save()
  g.translate(cx, cy)

  // 12 crisp stylized daisy/cosmos petals with clear gaps between petal tips
  const petalCount = 12
  for (let k = 0; k < petalCount; k++) {
    g.save()
    const a = k * Math.PI * 2 / petalCount
    g.rotate(a)
    const len = R * (.91 + ((k * 47) % 10) * .009)
    const w = R * .175
    const grad = g.createLinearGradient(0, -R * .14, 0, -len)
    grad.addColorStop(0, '#cfd6dc')
    grad.addColorStop(.28, '#f0f3f6')
    grad.addColorStop(.78, '#ffffff')
    grad.addColorStop(1, '#ffffff')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, -R * .14)
    g.bezierCurveTo(w * .82, -len * .34, w * 1.12, -len * .86, 0, -len)
    g.bezierCurveTo(-w * 1.12, -len * .86, -w * .82, -len * .34, 0, -R * .14)
    g.fill()
    // subtle petal center crease
    g.strokeStyle = 'rgba(175, 184, 194, 0.34)'
    g.lineWidth = Math.max(1, 2.2 * s)
    g.beginPath()
    g.moveTo(0, -R * .24)
    g.lineTo(0, -len * .76)
    g.stroke()
    g.restore()
  }

  // Soft shadow halo around the golden center disk
  const halo = g.createRadialGradient(0, 0, R * .15, 0, 0, R * .34)
  halo.addColorStop(0, 'rgba(140, 102, 42, 0.38)')
  halo.addColorStop(1, 'rgba(140, 102, 42, 0)')
  g.fillStyle = halo
  g.beginPath()
  g.arc(0, 0, R * .34, 0, Math.PI * 2)
  g.fill()

  // Warm golden-amber center button (stylized daisy disc)
  const discR = R * .245
  const center = g.createRadialGradient(-discR * .2, -discR * .2, discR * .08, 0, 0, discR)
  center.addColorStop(0, '#ffdf6b')
  center.addColorStop(.55, '#f2b12e')
  center.addColorStop(1, '#c97614')
  g.fillStyle = center
  g.beginPath()
  g.arc(0, 0, discR, 0, Math.PI * 2)
  g.fill()

  // Crisp stamen ring dots
  g.fillStyle = 'rgba(255, 245, 195, 0.78)'
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI * 2 / 12
    g.beginPath()
    g.arc(Math.cos(a) * discR * .62, Math.sin(a) * discR * .62, discR * .11, 0, Math.PI * 2)
    g.fill()
  }
  g.fillStyle = 'rgba(175, 92, 12, 0.5)'
  for (let k = 0; k < 6; k++) {
    const a = (k + .5) * Math.PI * 2 / 6
    g.beginPath()
    g.arc(Math.cos(a) * discR * .3, Math.sin(a) * discR * .3, discR * .09, 0, Math.PI * 2)
    g.fill()
  }

  g.restore()
  return canvasTexture(canvas, 'placeholder_flower_single')
}

/** Neutral white/ivory grass blades so vertex colors can cleanly dye grass into
 *  pink, gold, autumn red, turquoise, or custom meadow palettes. */
export function makeNeutralGrassTexture(width = 256, height = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const random = rng(5151)
  const blades = 6
  for (let i = 0; i < blades; i++) {
    const x0 = width * (.16 + .68 * (i + .5) / blades) + (random() - .5) * 10
    const w = width * (.13 + random() * .07)
    const h = height * (.72 + random() * .26)
    const lean = (random() - .5) * width * .16
    const grad = g.createLinearGradient(0, height, 0, height - h)
    const light = random()
    grad.addColorStop(0, `hsl(0, 0%, ${64 + light * 8}%)`)
    grad.addColorStop(.52, `hsl(0, 0%, ${84 + light * 8}%)`)
    grad.addColorStop(1, '#ffffff')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(x0 - w / 2, height)
    g.quadraticCurveTo(x0 - w * .38 + lean * .35, height - h * .52, x0 + lean, height - h)
    g.quadraticCurveTo(x0 + w * .38 + lean * .35, height - h * .52, x0 + w / 2, height)
    g.fill()
  }
  return canvasTexture(canvas, 'placeholder_grass_neutral')
}

/** Authentic Japanese Sakura cluster: overlapping 5-petal notched cherry blossoms
 *  with soft rose-blush throats, delicate stamens and tiny unopened buds.
 *  Ivory-white petals allow tintInner/tintOuter to dye freely into sakura pink, snow white or peach. */
export function makeSakuraTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const random = rng(9241)
  const s = size / 512

  const sakuraBlossom = (cx: number, cy: number, radius: number, rot: number, bright: number) => {
    g.save()
    g.translate(cx * s, cy * s)
    g.rotate(rot)
    const R = radius * s
    // 5 authentic notched sakura petals (cleft notch at tip)
    for (let k = 0; k < 5; k++) {
      g.save()
      g.rotate(k * Math.PI * 2 / 5)
      const grad = g.createRadialGradient(0, -R * .14, R * .04, 0, -R * .5, R * .72)
      grad.addColorStop(0, `hsl(342, 24%, ${Math.round(84 + bright * 5)}%)`)
      grad.addColorStop(.55, `hsl(344, 14%, ${Math.round(93 + bright * 4)}%)`)
      grad.addColorStop(1, `hsl(344, 18%, ${Math.round(88 + bright * 4)}%)`)
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(0, -R * .06)
      g.bezierCurveTo(R * .44, -R * .22, R * .48, -R * .78, R * .14, -R * .98)
      // iconic sakura petal tip notch
      g.lineTo(0, -R * .84)
      g.lineTo(-R * .14, -R * .98)
      g.bezierCurveTo(-R * .48, -R * .78, -R * .44, -R * .22, 0, -R * .06)
      g.fill()
      g.restore()
    }
    // Soft rosy throat blush + hair-fine delicate stamens (no heavy orange circle!)
    const throat = g.createRadialGradient(0, 0, 0, 0, 0, R * .28)
    throat.addColorStop(0, 'rgba(222, 118, 152, 0.72)')
    throat.addColorStop(.55, 'rgba(244, 178, 200, 0.34)')
    throat.addColorStop(1, 'rgba(255, 240, 245, 0)')
    g.fillStyle = throat
    g.beginPath()
    g.arc(0, 0, R * .28, 0, Math.PI * 2)
    g.fill()

    g.strokeStyle = 'rgba(218, 128, 154, 0.65)'
    g.lineWidth = Math.max(1, 1.4 * s)
    for (let k = 0; k < 9; k++) {
      const a = k * Math.PI * 2 / 9 + .18
      const len = R * (.16 + (k % 2) * .05)
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len)
      g.stroke()
      g.fillStyle = 'rgba(255, 232, 182, 0.88)'
      g.beginPath()
      g.arc(Math.cos(a) * len, Math.sin(a) * len, R * .028, 0, Math.PI * 2)
      g.fill()
    }
    g.restore()
  }

  // Tiny plump cherry buds tucked around the cluster edges
  const bud = (cx: number, cy: number, r: number, rot: number) => {
    g.save()
    g.translate(cx * s, cy * s)
    g.rotate(rot)
    g.fillStyle = '#f2cfd9'
    g.beginPath()
    g.ellipse(0, 0, r * .62 * s, r * s, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }

  const buds: [number, number, number, number][] = [
    [94, 246, 22, -.5], [418, 242, 20, .6], [258, 92, 21, .1], [150, 412, 18, -.8], [362, 408, 19, .7],
  ]
  for (const [x, y, r, rot] of buds) bud(x, y, r, rot)

  // Lush 8-blossom asymmetric sakura cluster
  const items: [number, number, number, number][] = [
    [152, 162, 82, .2], [356, 168, 80, .85], [128, 304, 78, 1.4],
    [382, 302, 76, 2.1], [210, 382, 74, .55], [312, 376, 72, 1.9],
    [258, 152, 78, 1.1], [254, 258, 102, .35],
  ]
  for (const [x, y, r, rot] of items) {
    sakuraBlossom(
      x + (random() - .5) * 12,
      y + (random() - .5) * 12,
      r * (.94 + random() * .12),
      rot + (random() - .5) * .45,
      .45 + random() * .55,
    )
  }
  return canvasTexture(canvas, 'placeholder_sakura_cluster')
}

/** Stylized painterly Ghibli/BotW rounded cloud leaf puff (neutral ivory-white shading
 *  for rich clean tinting into any lush green, teal, autumn gold or pastel). */
export function makeCloudLeafTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const random = rng(8317)
  const s = size / 512

  const puff = (cx: number, cy: number, r: number, rot: number, shade: number) => {
    g.save()
    g.translate(cx * s, cy * s)
    g.rotate(rot)
    const R = r * s
    const grad = g.createRadialGradient(-R * .15, -R * .28, R * .08, 0, 0, R)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(.58, `hsl(90, 8%, ${Math.round(86 + shade * 8)}%)`)
    grad.addColorStop(1, `hsl(110, 12%, ${Math.round(68 + shade * 8)}%)`)
    g.fillStyle = grad
    g.beginPath()
    // Soft rounded scalloped leaf lobe
    g.moveTo(0, R * .88)
    g.bezierCurveTo(R * .95, R * .7, R * 1.04, -R * .52, 0, -R)
    g.bezierCurveTo(-R * 1.04, -R * .52, -R * .95, R * .7, 0, R * .88)
    g.fill()
    g.restore()
  }

  // Layered cloud cluster of 16 rounded painterly leaves, darker back -> brighter front
  const back: [number, number, number, number][] = [
    [130, 320, 74, -.7], [382, 316, 74, .7], [116, 224, 72, -.9], [396, 222, 72, .9],
    [176, 134, 76, -.45], [336, 134, 76, .45], [256, 386, 70, .05],
  ]
  const front: [number, number, number, number][] = [
    [186, 306, 78, -.4], [328, 304, 78, .4], [174, 212, 82, -.5], [340, 210, 82, .5],
    [256, 126, 84, .0], [218, 184, 78, -.25], [296, 184, 78, .25], [256, 268, 92, .08],
  ]
  for (const [x, y, r, rot] of back) puff(x + (random() - .5) * 14, y + (random() - .5) * 14, r, rot, .15 + random() * .25)
  for (const [x, y, r, rot] of front) puff(x + (random() - .5) * 12, y + (random() - .5) * 12, r, rot, .55 + random() * .45)
  return canvasTexture(canvas, 'placeholder_cloud_leaves')
}

/** Crisp 5-lobed palmate Japanese maple leaf cluster (neutral bright ivory shading
 *  so vertex colors dye vividly into crimson, amber, gold or fresh spring green). */
export function makeMapleTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const random = rng(8743)
  const s = size / 512

  const mapleLeaf = (cx: number, cy: number, radius: number, rot: number, bright: number) => {
    g.save()
    g.translate(cx * s, cy * s)
    g.rotate(rot)
    const R = radius * s
    // 5 radiating pointed lobes (Japanese momiji silhouette)
    const lobes: [number, number, number][] = [
      [-1.38, .54, .22], [-.72, .82, .26], [0, 1.0, .29], [.72, .82, .26], [1.38, .54, .22],
    ]
    const grad = g.createRadialGradient(0, -R * .15, R * .05, 0, -R * .35, R)
    grad.addColorStop(0, `hsl(25, 14%, ${Math.round(78 + bright * 8)}%)`)
    grad.addColorStop(.55, `hsl(30, 10%, ${Math.round(91 + bright * 6)}%)`)
    grad.addColorStop(1, `hsl(28, 12%, ${Math.round(85 + bright * 5)}%)`)
    g.fillStyle = grad
    for (const [ang, lenK, wK] of lobes) {
      g.save()
      g.rotate(ang)
      const L = R * lenK, W = R * wK
      g.beginPath()
      g.moveTo(0, 0)
      g.bezierCurveTo(W * .95, -L * .28, W * .7, -L * .74, 0, -L)
      g.bezierCurveTo(-W * .7, -L * .74, -W * .95, -L * .28, 0, 0)
      g.fill()
      g.strokeStyle = 'rgba(155, 130, 118, 0.35)'
      g.lineWidth = Math.max(1, 1.6 * s)
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(0, -L * .84)
      g.stroke()
      g.restore()
    }
    g.restore()
  }

  // Slender twig petiole fanning into 6 overlapping maple leaves
  g.strokeStyle = 'rgba(128, 96, 82, 0.85)'
  g.lineWidth = 3.5 * s
  g.beginPath()
  g.moveTo(256 * s, 488 * s)
  g.quadraticCurveTo(252 * s, 360 * s, 256 * s, 240 * s)
  g.stroke()

  const leaves: [number, number, number, number][] = [
    [136, 336, 104, -.85], [376, 332, 104, .85],
    [126, 206, 112, -.52], [386, 208, 112, .52],
    [256, 138, 122, .02], [254, 294, 118, -.08],
  ]
  for (const [x, y, r, rot] of leaves) {
    mapleLeaf(x + (random() - .5) * 14, y + (random() - .5) * 14, r * (.94 + random() * .12), rot + (random() - .5) * .25, .4 + random() * .6)
  }
  return canvasTexture(canvas, 'placeholder_maple_cluster')
}

/** Stylized weeping-willow hanging curtain texture (512x512).
 *  Top edge (y = 0, UV v = 1) = branch attachment; bottom edge (y = 512, UV v = 0) = graceful
 *  tapering willow tips. Broad painterly willow leaves prevent mipmap break-up into noisy dots. */
export function makeWillowTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const random = rng(8891)
  const s = size / 512
  g.lineCap = 'round'

  const drawLeaf = (x: number, y: number, ang: number, len: number, width: number, bright: number, curve = 0) => {
    g.save()
    g.translate(x * s, y * s)
    g.rotate(ang)
    const L = len * s, W = width * s, C = curve * s
    // Slender weeping-willow lance leaf hanging downward (+Y) with gentle natural curve
    const grad = g.createLinearGradient(0, 0, C, L)
    grad.addColorStop(0, `hsl(86, 11%, ${Math.round(73 + bright * 8)}%)`)
    grad.addColorStop(.52, `hsl(80, 9%, ${Math.round(88 + bright * 7)}%)`)
    grad.addColorStop(1, `hsl(74, 8%, ${Math.round(95 + bright * 4)}%)`)
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, 0)
    g.bezierCurveTo(W * .92 + C * .25, L * .22, W * .62 + C * .7, L * .68, C, L)
    g.bezierCurveTo(-W * .62 + C * .7, L * .68, -W * .92 + C * .25, L * .22, 0, 0)
    g.fill()
    g.strokeStyle = 'rgba(225, 234, 198, 0.34)'
    g.lineWidth = Math.max(1, 1.2 * s)
    g.beginPath()
    g.moveTo(0, L * .06)
    g.quadraticCurveTo(C * .45, L * .48, C * .86, L * .86)
    g.stroke()
    g.restore()
  }

  // 5 arched cascading willow strands: domed top origins eliminate flat "haircut" edges at v=1
  // [startX, topY, endX, endY, pairs]
  const strandConfigs: [number, number, number, number, number][] = [
    [130, 56, 84, 378, 11],
    [188, 24, 168, 458, 14],
    [256, 10, 258, 502, 16],
    [324, 26, 344, 452, 14],
    [382, 58, 424, 372, 11],
  ]

  // Pass 1: arching golden-olive weeping stems curving softly outward from dome crest then down
  const curves: { startX: number; topY: number; midX: number; midY: number; endX: number; endY: number; pairs: number }[] = []
  for (const [x0, y0, x1, y1, pairs] of strandConfigs) {
    const startX = x0 + (random() - .5) * 10
    const endX = x1 + (random() - .5) * 16
    const midX = x1 * .7 + startX * .3 + (random() - .5) * 10
    const midY = y0 + (y1 - y0) * .36
    curves.push({ startX, topY: y0, midX, midY, endX, endY: y1, pairs })

    const grad = g.createLinearGradient(0, y0 * s, 0, y1 * s)
    grad.addColorStop(0, 'rgba(138, 148, 112, 0.92)')
    grad.addColorStop(.68, 'rgba(170, 182, 138, 0.86)')
    grad.addColorStop(1, 'rgba(196, 208, 166, 0.72)')
    g.strokeStyle = grad
    g.lineWidth = 3.4 * s
    g.beginPath()
    g.moveTo(startX * s, y0 * s)
    g.quadraticCurveTo(midX * s, midY * s, endX * s, y1 * s)
    g.stroke()
  }

  // Pass 2: slender overlapping willow leaves draped along every strand (zero floating leaves)
  for (const c of curves) {
    const ptX = (t: number) => (1 - t) * (1 - t) * c.startX + 2 * (1 - t) * t * c.midX + t * t * c.endX
    const ptY = (t: number) => (1 - t) * (1 - t) * c.topY + 2 * (1 - t) * t * c.midY + t * t * c.endY

    for (let i = 0; i < c.pairs; i++) {
      const t = (i + .18) / c.pairs
      const px = ptX(t)
      const py = ptY(t)
      const taper = 1 - t * .36
      for (const side of [-1, 1]) {
        const leafLen = (64 + random() * 24) * taper
        const leafW = (10.2 + random() * 3.8) * (.88 + .18 * (1 - t))
        const ang = side * (.20 + random() * .24) * (1 - t * .3)
        drawLeaf(px + side * 2, py + (random() - .5) * 5, ang, leafLen, leafW, .25 + random() * .75, -side * 7 * taper)
      }
      if (i % 2 === 0 && t < .85) {
        drawLeaf(px + (random() - .5) * 4, py + 3, (random() - .5) * .16, (58 + random() * 18) * taper, 10 * taper, .4 + random() * .6)
      }
    }
    drawLeaf(ptX(1), ptY(1) - 5, (random() - .5) * .12, 48 + random() * 12, 8.8, .78)
  }

  return canvasTexture(canvas, 'placeholder_willow_strands')
}

/** Crisp anime/Ghibli pointed-leaf bush sprig cluster (3 branching leafy shoots with
 *  distinct, individually shaded pointed elliptical leaves + dark overlap separation). */
export function makeBushSprigTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const random = rng(9207)
  const s = size / 512

  const drawLeaf = (cx: number, cy: number, ang: number, len: number, wid: number, tier: number) => {
    g.save()
    g.translate(cx * s, cy * s)
    g.rotate(ang)
    const L = len * s, W = wid * s
    // Soft dark-emerald drop shadow beneath overlapping upper leaves so every individual leaf reads crisply
    if (tier > .35) {
      g.fillStyle = 'rgba(14, 52, 26, 0.34)'
      g.beginPath()
      g.moveTo(2 * s, 5 * s)
      g.bezierCurveTo(W * .94, -L * .22 + 5 * s, W * .78, -L * .70 + 5 * s, 2 * s, -L + 4 * s)
      g.bezierCurveTo(-W * .78, -L * .70 + 5 * s, -W * .94, -L * .22 + 5 * s, 2 * s, 5 * s)
      g.fill()
    }
    // Rich Ghibli layered green luminance: back leaves deeper emerald, front leaves bright sunlit spring green
    const hue = Math.round(122 - tier * 34) // 122 (cool deep emerald) -> 88 (fresh bright spring lime)
    const sat = Math.round(42 + tier * 20)
    const lBase = Math.round(34 + tier * 26)
    const lMid = Math.round(46 + tier * 30)
    const lTip = Math.round(58 + tier * 32)
    const grad = g.createLinearGradient(0, 0, 0, -L)
    grad.addColorStop(0, `hsl(${hue + 6}, ${sat}%, ${lBase}%)`)
    grad.addColorStop(.52, `hsl(${hue}, ${sat + 6}%, ${lMid}%)`)
    grad.addColorStop(1, `hsl(${hue - 8}, ${sat + 10}%, ${lTip}%)`)
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, 0)
    g.bezierCurveTo(W * .92, -L * .24, W * .76, -L * .72, 0, -L)
    g.bezierCurveTo(-W * .76, -L * .72, -W * .92, -L * .24, 0, 0)
    g.fill()

    // Crisp subtle leaf edge definition & pale central midrib
    g.strokeStyle = `hsla(${hue + 14}, ${sat}%, ${Math.max(18, lBase - 14)}%, .35)`
    g.lineWidth = Math.max(1, 1.5 * s)
    g.stroke()

    g.strokeStyle = `hsla(${hue - 10}, ${sat + 8}%, ${Math.min(96, lTip + 12)}%, .55)`
    g.lineWidth = Math.max(1, 1.7 * s)
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(0, -L * .08)
    g.quadraticCurveTo(W * .03, -L * .50, 0, -L * .88)
    g.stroke()
    g.restore()
  }

  // Build 5 natural branching sprigs fanning from bottom-center with individually separated pointed leaves
  const sprigs: [number, number, number, number][] = [
    [256, 446, -0.82, 275],
    [256, 446, -0.38, 330],
    [256, 446,  0.02, 355],
    [256, 446,  0.40, 325],
    [256, 446,  0.84, 270],
  ]
  const leaves: { x: number; y: number; a: number; l: number; w: number; tier: number }[] = []

  // Subtle dark green inner leaf stems (no ugly brown sticks)
  g.strokeStyle = '#25602d'
  g.lineWidth = 3.2 * s
  g.lineCap = 'round'
  for (const [sx, sy, baseAng, span] of sprigs) {
    const ex = sx + Math.sin(baseAng) * span
    const ey = sy - Math.cos(baseAng) * span
    g.beginPath()
    g.moveTo(sx * s, sy * s)
    g.lineTo(ex * s, ey * s)
    g.stroke()

    const pairs = 4
    for (let i = 0; i < pairs; i++) {
      const t = .20 + .68 * (i / (pairs - 1))
      const px = sx + (ex - sx) * t
      const py = sy + (ey - sy) * t
      for (const side of [-1, 1]) {
        const a = baseAng + side * (.52 + (1 - t) * .28 + (random() - .5) * .16)
        const len = (88 + random() * 24) * (.86 + .20 * (1 - Math.abs(t - .55)))
        const wid = len * (.34 + random() * .06)
        const tier = Math.min(1, Math.max(0, .12 + t * .68 + (random() - .5) * .22))
        leaves.push({ x: px + side * 4, y: py, a, l: len, w: wid, tier })
      }
    }
    // Crisp terminal shoot leaf at each sprig tip
    leaves.push({
      x: ex, y: ey,
      a: baseAng + (random() - .5) * .14,
      l: 96 + random() * 18,
      w: 36 + random() * 6,
      tier: .78 + random() * .22,
    })
  }
  // Extra bottom-flank pointed leaves so lower bush edges bristle crisply downward/outward
  for (const [x, y, a, l] of [[156, 396, -1.72, 92], [356, 396, 1.72, 92], [202, 428, -2.18, 86], [310, 428, 2.18, 86], [256, 434, 3.12, 82]]) {
    leaves.push({ x, y, a: a + (random() - .5) * .12, l, w: l * .36, tier: .14 + random() * .16 })
  }

  // Paint darker back leaves first, bright sunlit pointed leaves on top
  leaves.sort((a, b) => a.tier - b.tier)
  for (const lf of leaves) drawLeaf(lf.x, lf.y, lf.a, lf.l, lf.w, lf.tier)

  return canvasTexture(canvas, 'placeholder_bush_sprig')
}

/** Single crisp 5-petal pure-white wild-rose / jasmine blossom with distinct warm chestnut-gold eye. */
export function makeWildRoseTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const s = size / 512
  const cx = 256 * s, cy = 256 * s, R = 210 * s

  // 5 clearly separated rounded-cupped white petals (unmistakable 5-petal rose silhouette at any distance)
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 - Math.PI / 2
    g.save()
    g.translate(cx, cy)
    g.rotate(a)
    const grad = g.createLinearGradient(0, -R * .08, 0, -R)
    grad.addColorStop(0, '#dad3c6')
    grad.addColorStop(.30, '#f8f7f2')
    grad.addColorStop(1, '#ffffff')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, -R * .10)
    g.bezierCurveTo(R * .54, -R * .18, R * .60, -R * .82, R * .14, -R * .98)
    g.quadraticCurveTo(0, -R * .89, -R * .14, -R * .98)
    g.bezierCurveTo(-R * .60, -R * .82, -R * .54, -R * .18, 0, -R * .10)
    g.fill()
    g.strokeStyle = 'rgba(148, 138, 122, 0.42)'
    g.lineWidth = 2.6 * s
    g.stroke()
    g.restore()
  }

  // Bold warm chestnut-amber stamen center matching reference's crisp dark-centered white blossoms
  const core = g.createRadialGradient(cx, cy, R * .02, cx, cy, R * .29)
  core.addColorStop(0, '#5a3420')
  core.addColorStop(.48, '#8a5232')
  core.addColorStop(.78, '#dfa442')
  core.addColorStop(1, 'rgba(226, 184, 108, 0)')
  g.fillStyle = core
  g.beginPath()
  g.arc(cx, cy, R * .29, 0, Math.PI * 2)
  g.fill()

  for (let k = 0; k < 10; k++) {
    const a = k * Math.PI * 2 / 10 + .15
    const rr = R * (.18 + (k % 2) * .045)
    g.fillStyle = k % 2 === 0 ? '#f6cc68' : '#6c3e26'
    g.beginPath()
    g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * .040, 0, Math.PI * 2)
    g.fill()
  }

  return canvasTexture(canvas, 'placeholder_wild_rose')
}
