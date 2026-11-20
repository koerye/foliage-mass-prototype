import { describe, expect, it } from 'vitest'
import { Box3, Mesh, MeshStandardMaterial, Texture } from 'three'
import { analyzePlantImage, computeScribbleMask, type PixelBuffer } from '../src/ai/analyze'
import {
  aiCapabilitySchema, applySceneLeafTexture, applySceneParam, applySceneSeed, applySceneUniformScale,
  blankAiScene, buildAiScene, parseAiScene, solveSceneForTriangleBudget, type PartCustomTextures,
} from '../src/ai/scene'
import { aiShowcases, floweringBushShowcase, getAiShowcase, sakuraBonsaiShowcase, twistedSakuraShowcase } from '../src/ai/showcase'
import { buildTree } from '../src/tree/assemble'
import { optimizeAt } from '../src/tree/optimize'
import { buildSkeleton } from '../src/tree/skeleton'
import { parseTreeSpec, presetSpec, treeKinds } from '../src/tree/spec'

const textures = {
  leaf: new Texture(), needle: new Texture(), drape: new Texture(),
  palm: new Texture(), grass: new Texture(), grassTint: new Texture(), fern: new Texture(),
  flower: new Texture(), blossom: new Texture(),
  sakura: new Texture(), cloud: new Texture(), maple: new Texture(), willow: new Texture(),
  bush: new Texture(), wildrose: new Texture(),
}

function makeCanvas(w: number, h: number, bg: [number, number, number] = [255, 255, 255]): PixelBuffer {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255
  }
  return { width: w, height: h, data }
}
function fillDisk(buf: PixelBuffer, cx: number, cy: number, rx: number, ry: number, rgb: [number, number, number]) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(buf.height - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(buf.width - 1, Math.ceil(cx + rx)); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) {
        const o = (y * buf.width + x) * 4
        buf.data[o] = rgb[0]; buf.data[o + 1] = rgb[1]; buf.data[o + 2] = rgb[2]; buf.data[o + 3] = 255
      }
    }
  }
}
function fillRect(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(buf.height - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(buf.width - 1, Math.ceil(x1)); x++) {
      const o = (y * buf.width + x) * 4
      buf.data[o] = rgb[0]; buf.data[o + 1] = rgb[1]; buf.data[o + 2] = rgb[2]; buf.data[o + 3] = 255
    }
  }
}

describe('AI Mode blank project & scene composition', () => {
  it('starts completely blank and exposes all plant kinds & parameter schemas', () => {
    const empty = blankAiScene()
    expect(empty.parts).toHaveLength(0)
    const built = buildAiScene(empty, textures)
    expect(built.stats.parts).toBe(0)
    expect(built.stats.triangles).toBe(0)
    built.dispose()

    const schema = aiCapabilitySchema()
    expect(schema.kinds).toEqual([...treeKinds])
    expect(schema.parameters.length).toBeGreaterThanOrEqual(8)
  })

  it('round-trips AiSceneSpec and upgrades single TreeSpec JSON', () => {
    const single = presetSpec('palm-tropical')
    const wrapped = parseAiScene(JSON.parse(JSON.stringify(single)))
    expect(wrapped.parts).toHaveLength(1)
    expect(wrapped.parts[0].spec.kind).toBe('palm')
    const built = buildAiScene(wrapped, textures)
    expect(built.stats.parts).toBe(1)
    expect(built.stats.triangles).toBeGreaterThan(1000)
    built.dispose()
  })
})

describe('AI Mode image-to-plant CV analyzer', () => {
  it('detects multi-stem pink sakura bonsai + base grass skirt and builds valid 3D scene', () => {
    const img = makeCanvas(128, 128)
    // central gnarly gray-lavender trunk + two side trunks
    fillRect(img, 58, 52, 70, 114, [118, 98, 108])
    fillRect(img, 32, 76, 39, 114, [112, 92, 104])
    fillRect(img, 88, 82, 95, 114, [112, 92, 104])
    // main upper pink blossom canopy + two separated lower satellite blossom clouds
    fillDisk(img, 62, 34, 42, 22, [242, 122, 166])
    fillDisk(img, 54, 28, 28, 16, [252, 158, 194])
    fillDisk(img, 30, 68, 17, 15, [240, 118, 162])
    fillDisk(img, 96, 74, 16, 13, [240, 118, 162])
    // pink grass skirt at bottom
    fillRect(img, 14, 112, 114, 122, [246, 98, 148])

    const { report, scene } = analyzePlantImage(img, 'sakura_bonsai.png')
    expect(report.kind).toBe('broadleaf')
    expect(report.foliageStyle).toBe('blossom')
    expect(report.crownCount).toBe(3)
    expect(report.hasGroundSkirt).toBe(true)
    expect(scene.parts.length).toBeGreaterThanOrEqual(4) // main + 2 sub-trunks + ground grass (+ optional ground flowers)
    expect(scene.parts[0].leafTexture).toBe('sakura')
    expect(report.leafStyle).toBe('sakura')

    const asset = buildAiScene(scene, textures)
    expect(asset.stats.parts).toBe(scene.parts.length)
    expect(asset.stats.triangles).toBeGreaterThan(5000)
    // round-trip generated scene JSON
    const parsed = parseAiScene(JSON.parse(JSON.stringify(scene)))
    expect(parsed.parts).toHaveLength(scene.parts.length)
    asset.dispose()
  })

  it('classifies triangular green pine as conifer', () => {
    const img = makeCanvas(128, 128)
    fillRect(img, 60, 96, 68, 120, [92, 66, 44])
    for (let y = 12; y <= 100; y++) {
      const half = Math.round(((y - 12) / 88) * 34)
      fillRect(img, 64 - half, y, 64 + half, y, [56, 128, 52])
    }
    const { report, scene } = analyzePlantImage(img, 'pine.png')
    expect(report.kind).toBe('conifer')
    expect(scene.parts[0].spec.kind).toBe('conifer')
    const asset = buildAiScene(scene, textures)
    expect(asset.stats.triangles).toBeGreaterThan(3000)
    asset.dispose()
  })

  it('classifies tall narrow trunk + top fan as palm', () => {
    const img = makeCanvas(128, 128)
    fillRect(img, 61, 48, 67, 122, [118, 86, 54])
    fillDisk(img, 64, 34, 42, 16, [72, 152, 58])
    const { report, scene } = analyzePlantImage(img, 'palm.png')
    expect(report.kind).toBe('palm')
    expect(scene.parts[0].spec.kind).toBe('palm')
    const asset = buildAiScene(scene, textures)
    expect(asset.stats.triangles).toBeGreaterThan(1000)
    asset.dispose()
  })

  it('detects flowering green shrub with accent flowers and ground flowerbeds', () => {
    // flowering bush
    const bush = makeCanvas(128, 128)
    fillRect(bush, 60, 94, 68, 118, [88, 64, 44])
    fillDisk(bush, 64, 62, 42, 34, [66, 134, 54])
    for (const [fx, fy] of [[42, 50], [58, 42], [78, 48], [86, 64], [52, 68], [72, 72]]) {
      fillDisk(bush, fx, fy, 6, 6, [242, 74, 130])
    }
    const bushRes = analyzePlantImage(bush, 'rose_bush.png')
    expect(bushRes.report.kind).toBe('broadleaf')
    expect(bushRes.report.hasAccentFlowers).toBe(true)
    expect(bushRes.scene.parts[0].spec.flowers.enabled).toBe(true)

    // meadow flowerbed (stems + yellow blossoms, no woody trunk)
    const meadow = makeCanvas(128, 128)
    for (let x = 26; x <= 102; x += 12) {
      fillRect(meadow, x - 1, 74, x + 1, 118, [68, 136, 48])
      fillDisk(meadow, x, 68, 7, 6, [245, 110, 150])
    }
    const meadowRes = analyzePlantImage(meadow, 'meadow.png')
    expect(meadowRes.report.kind).toBe('flowerbed')
    expect(meadowRes.scene.parts[0].spec.flowerbed.withStems).toBe(true)
  })
})

describe('Stage A & B aesthetic engine upgrades', () => {
  it('surfaceRoots stay grounded at y >= 0, canopyLift exposes lower limbs, and ambient petals assemble cleanly', () => {
    const base = presetSpec('broadleaf-open')
    const baseAsset = buildTree(base, textures)
    const sculpted = {
      ...base,
      trunk: { ...base.trunk, gnarl: .6, surfaceRoots: 5 },
      crown: { ...base.crown, canopyLift: .55, padFlatten: .55 },
      shading: { ...base.shading, petals: 24 },
    }
    const asset = buildTree(sculpted, textures)
    const wood = asset.group.children.find(m => m.name === 'Trunk and branches')!
    const baseWood = baseAsset.group.children.find(m => m.name === 'Trunk and branches')!
    // surface roots add geometry & remain strictly above y = 0
    expect(new Box3().setFromObject(wood).min.y).toBeGreaterThanOrEqual(-1e-5)
    expect((wood as unknown as { geometry: import('three').BufferGeometry }).geometry.index!.count)
      .toBeGreaterThan((baseWood as unknown as { geometry: import('three').BufferGeometry }).geometry.index!.count)
    // canopyLift removes lower interior cards
    expect(asset.stats.leaves).toBeLessThan(baseAsset.stats.leaves)
    // ambient petals mesh created with 24 * 4 = 96 triangles
    const petals = asset.group.children.find(m => m.name === 'Ambient petals') as unknown as { geometry: import('three').BufferGeometry } | undefined
    expect(petals).toBeTruthy()
    expect(petals!.geometry.index!.count / 3).toBe(96)
    // JSON round-trip preserves Stage A & B fields
    const parsed = parseTreeSpec(JSON.parse(JSON.stringify(sculpted)))
    expect(parsed.trunk.gnarl).toBe(.6)
    expect(parsed.trunk.surfaceRoots).toBe(5)
    expect(parsed.crown.canopyLift).toBe(.55)
    expect(parsed.crown.padFlatten).toBe(.55)
    expect(parsed.shading.petals).toBe(24)
    baseAsset.dispose(); asset.dispose()
  })

  it('Stage C-1: extracts medial-axis curved S-hook trunk spine from image and drives 3D skeleton directly', () => {
    const img = makeCanvas(128, 128)
    // Paint a bold S-curved trunk: starts at x=64, curves sharply right to x=84 at mid-height, then hooks left to x=56
    for (let y = 46; y <= 118; y++) {
      const t = (118 - y) / 72 // 0 at ground -> 1 at crown fork
      const cx = 64 + Math.sin(t * Math.PI * 1.45) * 20 - t * 6
      fillDisk(img, cx, y, 5, 3, [104, 82, 66])
    }
    fillDisk(img, 58, 30, 36, 20, [74, 148, 62])

    const { report, scene } = analyzePlantImage(img, 'hooked_bonsai.png')
    expect(report.tracedSpines).toBeGreaterThanOrEqual(1)
    const spine = scene.parts[0].spec.trunk.spine
    expect(spine).toBeTruthy()
    expect(spine!.length).toBeGreaterThanOrEqual(6)
    // spine starts at [0,0,0], bulges right (+x) at mid-height, and hooks back left at top
    expect(spine![0]).toEqual([0, 0, 0])
    const maxRight = Math.max(...spine!.map(p => p[0]))
    expect(maxRight).toBeGreaterThan(.5)
    expect(spine![spine!.length - 1][0]).toBeLessThan(maxRight - .35)
    // 3D skeleton honors the traced spine & stays rooted at origin
    const sk = buildSkeleton(scene.parts[0].spec)
    expect(sk.trunk.points[0].length()).toBeLessThan(1e-6)
    expect(Math.max(...sk.trunk.points.map(p => p.x))).toBeGreaterThan(.45)
    // JSON round-trip preserves trunk.spine
    const parsed = parseTreeSpec(JSON.parse(JSON.stringify(scene.parts[0].spec)))
    expect(parsed.trunk.spine).toEqual(spine)
  })

  it('C-2: auto-matches maple, cloud & sakura leaf styles, builds sakura showcase, and cuts out noisy backgrounds with scribble mask', () => {
    // 1. Autumn crimson/orange tree -> auto-matches 'maple'
    const autumn = makeCanvas(128, 128)
    fillRect(autumn, 60, 74, 68, 118, [88, 60, 44])
    fillDisk(autumn, 64, 46, 38, 28, [224, 96, 34])
    const autumnRes = analyzePlantImage(autumn, 'autumn_maple.png')
    expect(autumnRes.report.foliageStyle).toBe('autumn')
    expect(autumnRes.report.leafStyle).toBe('maple')
    expect(autumnRes.scene.parts[0].leafTexture).toBe('maple')

    // 2. Built-in 5-part Sakura Bonsai Showcase builds cleanly & supports global LOD
    const showcase = sakuraBonsaiShowcase()
    expect(showcase.parts).toHaveLength(5)
    expect(showcase.parts.filter(p => (p.spec.trunk.spine?.length ?? 0) >= 3)).toHaveLength(3)
    const high = buildAiScene(showcase, textures)
    expect(high.stats.parts).toBe(5)
    expect(high.stats.triangles).toBeGreaterThan(15000)
    const lodScene = { ...showcase, parts: showcase.parts.map(p => ({ ...p, spec: { ...p.spec, optimize: optimizeAt(.68) } })) }
    const low = buildAiScene(lodScene, textures)
    expect(low.stats.triangles).toBeLessThan(high.stats.triangles * .5)
    expect(parseAiScene(JSON.parse(JSON.stringify(showcase))).parts).toHaveLength(5)
    high.dispose(); low.dispose()

    // 3. Scribble cutout removes busy blue-sky + red-wall background and recovers a clean green tree
    const busy = makeCanvas(96, 96, [110, 175, 235]) // blue sky background
    fillRect(busy, 0, 56, 95, 95, [195, 78, 68])     // red brick wall behind lower half
    fillRect(busy, 44, 52, 52, 88, [88, 64, 46])     // brown trunk
    fillDisk(busy, 48, 36, 24, 20, [62, 148, 56])    // green canopy
    const strokes = new Uint8Array(96 * 96)
    // green foreground strokes on canopy & trunk
    for (let y = 26; y <= 46; y++) for (let x = 38; x <= 58; x++) strokes[y * 96 + x] = 1
    for (let y = 54; y <= 84; y++) for (let x = 46; x <= 50; x++) strokes[y * 96 + x] = 1
    // red background strokes on sky & wall
    for (let y = 4; y <= 14; y++) for (let x = 4; x <= 24; x++) strokes[y * 96 + x] = 2
    for (let y = 66; y <= 86; y++) for (let x = 6; x <= 28; x++) strokes[y * 96 + x] = 2
    for (let y = 66; y <= 86; y++) for (let x = 68; x <= 90; x++) strokes[y * 96 + x] = 2

    const mask = computeScribbleMask(busy, strokes)
    // Canopy center kept, brick wall & sky excluded
    expect(mask[36 * 96 + 48]).toBe(1)
    expect(mask[75 * 96 + 15]).toBe(0)
    expect(mask[8 * 96 + 80]).toBe(0)
    const cutRes = analyzePlantImage(busy, 'busy_photo.png', { customMask: mask, customMaskWidth: 96, customMaskHeight: 96 })
    expect(cutRes.report.kind).toBe('broadleaf')
    expect(cutRes.report.foliageStyle).toBe('green')
  })

  it('AI Showcase Case Library registers flowering bush, twisted sakura & bonsai, builds all cases cleanly, and supports global LOD', () => {
    expect(aiShowcases.length).toBeGreaterThanOrEqual(3)
    expect(getAiShowcase('flowering-bush')?.name).toBe('繁花绿灌木丛')
    expect(getAiShowcase('sakura-twist')?.name).toBe('盘曲古樱')
    expect(getAiShowcase('sakura')?.name).toBe('三干樱花盆景')

    const bush = floweringBushShowcase()
    expect(bush.parts).toHaveLength(4)
    const bushAsset = buildAiScene(bush, textures)
    expect(bushAsset.stats.parts).toBe(4)
    expect(bushAsset.stats.flowers).toBeGreaterThanOrEqual(80)
    expect(new Box3().setFromObject(bushAsset.group).min.y).toBeGreaterThanOrEqual(-0.15)
    bushAsset.dispose()

    const twisted = twistedSakuraShowcase()
    expect(twisted.parts).toHaveLength(6)
    expect(twisted.parts.filter(p => (p.spec.trunk.spine?.length ?? 0) >= 3)).toHaveLength(4)
    expect(twisted.parts.filter(p => p.spec.kind === 'grass' && p.spec.ground.mode === 'blade')).toHaveLength(2)

    const high = buildAiScene(twisted, textures)
    expect(high.stats.parts).toBe(6)
    expect(high.stats.triangles).toBeGreaterThan(20000)
    expect(new Box3().setFromObject(high.group).min.y).toBeGreaterThanOrEqual(-0.02)

    const lodScene = { ...twisted, parts: twisted.parts.map(p => ({ ...p, spec: { ...p.spec, optimize: optimizeAt(.68) } })) }
    const low = buildAiScene(lodScene, textures)
    expect(low.stats.triangles).toBeLessThan(high.stats.triangles * .45)
    expect(parseAiScene(JSON.parse(JSON.stringify(twisted))).parts).toHaveLength(6)

    // Whole-tree triangle budget solver optimizes ALL enabled parts together
    const solved = solveSceneForTriangleBudget(twisted, textures, 8000)
    expect(solved.reached).toBe(true)
    expect(solved.after).toBeLessThanOrEqual(8000)
    expect(solved.before).toBe(high.stats.triangles)
    const applied = buildAiScene(
      { ...twisted, parts: twisted.parts.map(p => ({ ...p, spec: { ...p.spec, optimize: solved.optimize } })) },
      textures,
    )
    expect(applied.stats.triangles).toBe(solved.after)
    applied.dispose()
    high.dispose(); low.dispose()
  })

  it('syncs colors, materials, textures, shading, flowers & proportional geometry across the whole asset by default, and isolates single part in edit mode', () => {
    // 1. Whole-asset default sync on 4-part Flowering Bush
    const bush = floweringBushShowcase()
    const leadId = bush.parts[0].id
    const widthsBefore = bush.parts.map(p => p.spec.crown.width)
    const flowersBefore = bush.parts.map(p => p.spec.flowers.count)

    // Uniform color & flower & shading sync across all 4 mounds
    const cRes = applySceneParam(bush, leadId, 'leaves.tintOuter', '#b81010', 'whole')
    expect(cRes.changedIds).toHaveLength(4)
    expect(bush.parts.every(p => p.spec.leaves.tintOuter === '#b81010')).toBe(true)

    applySceneParam(bush, leadId, 'flowers.tintOuter', '#ffd6eb', 'whole')
    expect(bush.parts.every(p => p.spec.flowers.tintOuter === '#ffd6eb')).toBe(true)

    // Switching shading.leafStyle clears explicit leafTexture override on all 4 mounds so built-in style applies
    const styleRes = applySceneParam(bush, leadId, 'shading.leafStyle', 'maple', 'whole')
    expect(styleRes.needsPanelSync).toBe(true)
    expect(bush.parts.every(p => p.leafTexture === 'auto' && p.spec.shading.leafStyle === 'maple')).toBe(true)

    // Proportional scaling preserves large main vs small shoulder mound ratios
    applySceneParam(bush, leadId, 'crown.width', widthsBefore[0] * 1.25, 'whole')
    for (let i = 0; i < 4; i++) {
      expect(bush.parts[i].spec.crown.width / widthsBefore[i]).toBeCloseTo(1.25, 2)
    }
    applySceneParam(bush, leadId, 'flowers.count', flowersBefore[0] * 2, 'whole')
    for (let i = 0; i < 4; i++) {
      expect(bush.parts[i].spec.flowers.count).toBe(Math.round(flowersBefore[i] * 2))
    }

    // Whole leaf texture dropdown, seed & uniform scale
    applySceneLeafTexture(bush, leadId, 'cloud', 'whole')
    expect(bush.parts.every(p => p.leafTexture === 'cloud')).toBe(true)
    const seeds0 = bush.parts.map(p => p.spec.seed)
    applySceneSeed(bush, leadId, seeds0[0] + 100, 'whole')
    expect(bush.parts.map(p => p.spec.seed)).toEqual(seeds0.map(s => s + 100))
    const posBefore = bush.parts.map(p => [...p.position])
    applySceneUniformScale(bush, leadId, 1.5, 'whole')
    expect(bush.parts.every(p => Math.abs(p.scale - 1.5) < 1e-3)).toBe(true)
    expect(bush.parts[1].position[0]).toBeCloseTo(posBefore[1][0] * 1.5, 3)

    // 2. Mixed-kind asset (Twisted Sakura: 4 broadleaf + 2 grass)
    const sakura = twistedSakuraShowcase()
    const trunkId = sakura.parts[0].id
    const grassBefore = sakura.parts.filter(p => p.spec.kind === 'grass').map(p => p.spec.ground.tintTip)
    applySceneParam(sakura, trunkId, 'leaves.tintOuter', '#ffe0a8', 'whole')
    expect(sakura.parts.filter(p => p.spec.kind === 'broadleaf').every(p => p.spec.leaves.tintOuter === '#ffe0a8')).toBe(true)
    expect(sakura.parts.filter(p => p.spec.kind === 'grass').map(p => p.spec.ground.tintTip)).toEqual(grassBefore)
    // Shading translucency syncs to ALL 6 parts (broadleaf + grass); petals stay non-duplicated on lead
    applySceneParam(sakura, trunkId, 'shading.translucency', .88, 'whole')
    expect(sakura.parts.every(p => p.spec.shading.translucency === .88)).toBe(true)
    applySceneParam(sakura, trunkId, 'shading.petals', 40, 'whole')
    expect(sakura.parts[0].spec.shading.petals).toBe(40)
    expect(sakura.parts.slice(1).every(p => p.spec.shading.petals === 0)).toBe(true)

    // 3. Single-Part Edit Mode ('part' scope) isolates changes strictly to selected part
    const bushSingle = floweringBushShowcase()
    const targetId = bushSingle.parts[1].id
    const part0Color = bushSingle.parts[0].spec.leaves.tintOuter
    const part2Color = bushSingle.parts[2].spec.leaves.tintOuter
    const sRes = applySceneParam(bushSingle, targetId, 'leaves.tintOuter', '#ff9900', 'part')
    expect(sRes.changedIds).toEqual([targetId])
    expect(bushSingle.parts[1].spec.leaves.tintOuter).toBe('#ff9900')
    expect(bushSingle.parts[0].spec.leaves.tintOuter).toBe(part0Color)
    expect(bushSingle.parts[2].spec.leaves.tintOuter).toBe(part2Color)

    // Per-part custom texture override applies ONLY to the selected single part
    const customLeaf = new Texture()
    customLeaf.name = 'custom-single-leaf.png'
    bushSingle.parts[1].leafTexture = 'leaf'
    const partTextures: PartCustomTextures = new Map([[targetId, { leaf: customLeaf }]])
    const built = buildAiScene(bushSingle, textures, partTextures)
    const meshOf = (pid: string) => {
      let found: Mesh | undefined
      built.partAssets.get(pid)!.group.traverse(o => { if (o instanceof Mesh && o.name === 'Leaf cards') found = o })
      return found!
    }
    expect((meshOf(targetId).material as MeshStandardMaterial).map).toBe(customLeaf)
    expect((meshOf(bushSingle.parts[0].id).material as MeshStandardMaterial).map).not.toBe(customLeaf)
    built.dispose()
    customLeaf.dispose()
  })
})
