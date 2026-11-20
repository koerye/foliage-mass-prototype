import { describe, expect, it, vi } from 'vitest'
import { Mesh, MeshStandardMaterial, Texture } from 'three'
import { dilateAlphaRgba } from '../src/broadleaf/leaf-material'
import { allTextureSlots, createTextureRegistry, type AllTextureSlot, type TextureFactories } from '../src/studio/texture-slots'
import { buildAiScene } from '../src/ai/scene'
import { sakuraBonsaiShowcase } from '../src/ai/showcase'
import { buildTree } from '../src/tree/assemble'
import { presetSpec } from '../src/tree/spec'

/** Reference naive full-image multi-pass alpha dilation (original implementation). */
function referenceDilateRgba(d: Uint8ClampedArray, w: number, h: number, passes = 6) {
  const N = w * h
  let filled = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (d[i * 4 + 3] >= 220) filled[i] = 1
  const rgb = new Uint8Array(N * 3)
  for (let i = 0; i < N; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2] }
  for (let pass = 0; pass < passes; pass++) {
    const nextFilled = new Uint8Array(filled)
    const nextRgb = new Uint8Array(rgb)
    let changed = false
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (filled[i]) continue
        let sr = 0, sg = 0, sb = 0, cnt = 0
        const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1)
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const ni = ny * w + nx
            if (filled[ni]) { sr += rgb[ni * 3]; sg += rgb[ni * 3 + 1]; sb += rgb[ni * 3 + 2]; cnt++ }
          }
        }
        if (cnt > 0) {
          nextRgb[i * 3] = Math.round(sr / cnt)
          nextRgb[i * 3 + 1] = Math.round(sg / cnt)
          nextRgb[i * 3 + 2] = Math.round(sb / cnt)
          nextFilled[i] = 1
          changed = true
        }
      }
    }
    filled = nextFilled
    rgb.set(nextRgb)
    if (!changed) break
  }
  for (let i = 0; i < N; i++) {
    if (filled[i] && d[i * 4 + 3] < 220) {
      d[i * 4] = rgb[i * 3]; d[i * 4 + 1] = rgb[i * 3 + 1]; d[i * 4 + 2] = rgb[i * 3 + 2]
    }
  }
}

function makeSpyRegistry() {
  const calls: Record<string, number> = {}
  const factories = {} as TextureFactories
  for (const slot of allTextureSlots) {
    calls[slot] = 0
    factories[slot] = () => {
      calls[slot]++
      const t = new Texture()
      t.name = slot
      return t
    }
  }
  return { registry: createTextureRegistry(factories), calls }
}

describe('Batch 2 optimizations (P1-1, P1-3, P2-1)', () => {
  it('frontier-BFS dilateAlphaRgba is bit-for-bit identical to full-image multi-pass dilation', () => {
    const w = 64, h = 64
    const src = new Uint8ClampedArray(w * h * 4)
    // Paint two colored islands (one touching border, one centered) with soft AA fringes
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        const d1 = Math.hypot(x - 20, y - 24)
        const d2 = Math.hypot(x - 60, y - 58)
        if (d1 < 10) {
          src[o] = 240; src[o + 1] = 120 + x * 2; src[o + 2] = 160; src[o + 3] = 255
        } else if (d1 < 12) {
          src[o] = 255; src[o + 1] = 255; src[o + 2] = 255; src[o + 3] = 140 // white AA fringe to overwrite
        } else if (d2 < 6) {
          src[o] = 60; src[o + 1] = 180; src[o + 2] = 90; src[o + 3] = 230
        } else if (d2 < 7.5) {
          src[o] = 0; src[o + 1] = 0; src[o + 2] = 0; src[o + 3] = 80
        }
      }
    }
    const bfsBuf = new Uint8ClampedArray(src)
    const refBuf = new Uint8ClampedArray(src)
    dilateAlphaRgba(bfsBuf, w, h, 6)
    referenceDilateRgba(refBuf, w, h, 6)
    expect(bfsBuf).toEqual(refBuf)
  })

  it('TextureRegistry synthesizes procedural textures strictly on demand (including across AiScene parts)', () => {
    const { registry, calls } = makeSpyRegistry()
    expect(registry.loadedSlots()).toEqual([])

    // Single broadleaf-round needs only 'leaf'
    const tree = buildTree(presetSpec('broadleaf-round'), registry.textures)
    expect(registry.loadedSlots()).toEqual(['leaf'])
    expect(calls.leaf).toBe(1)
    expect(calls.sakura).toBe(0)
    expect(calls.palm).toBe(0)
    tree.dispose()

    // Multi-part Sakura Bonsai Showcase only touches sakura, grassTint, blossom (not all 13!)
    const { registry: aiReg, calls: aiCalls } = makeSpyRegistry()
    const showcase = buildAiScene(sakuraBonsaiShowcase(), aiReg.textures)
    expect(aiReg.loadedSlots().sort()).toEqual(['blossom', 'grassTint', 'sakura'] as AllTextureSlot[])
    expect(aiCalls.leaf).toBe(0)
    expect(aiCalls.needle).toBe(0)
    expect(aiCalls.palm).toBe(0)
    expect(aiCalls.maple).toBe(0)
    showcase.dispose()

    // Custom override disposes previous custom texture cleanly without touching default
    const c1 = new Texture()
    const disposeSpy = vi.spyOn(c1, 'dispose')
    const c2 = new Texture()
    registry.setCustom('leaf', c1)
    expect(registry.get('leaf')).toBe(c1)
    expect(registry.isCustom('leaf')).toBe(true)
    registry.setCustom('leaf', c2)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    registry.resetDefault('leaf')
    expect(registry.isCustom('leaf')).toBe(false)
    registry.dispose()
  })

  it('applyLiveParam hot-updates shader uniforms, alphaTest, and softSelfShadow without rebuilding geometry', () => {
    const { registry } = makeSpyRegistry()
    const spec = presetSpec('broadleaf-sakura')
    spec.flowers.enabled = true
    const asset = buildTree(spec, registry.textures)

    const leafMesh = asset.group.children.find(c => c.name === 'Leaf cards') as Mesh
    const flowerMesh = asset.group.children.find(c => c.name === 'Flower cards') as Mesh
    const leafMat = leafMesh.material as MeshStandardMaterial
    const flowerMat = flowerMesh.material as MeshStandardMaterial
    const leafU = leafMat.userData.leafUniforms as Record<string, { value: number }>
    const flowerU = flowerMat.userData.leafUniforms as Record<string, { value: number }>

    const next = {
      ...spec,
      shading: { ...spec.shading, translucency: 0.88, rimLight: 0.77, shadowShift: 0.12, topWarmth: 0.91, softSelfShadow: false },
      leaves: { ...spec.leaves, alphaCutoff: 0.63, cameraFacing: 0.42 },
      flowers: { ...spec.flowers, alphaCutoff: 0.55, cameraFacing: 0.25 },
    }
    expect(asset.applyLiveParam('shading.translucency', next)).toBe(true)
    expect(asset.applyLiveParam('shading.rimLight', next)).toBe(true)
    expect(asset.applyLiveParam('shading.shadowShift', next)).toBe(true)
    expect(asset.applyLiveParam('shading.topWarmth', next)).toBe(true)
    expect(asset.applyLiveParam('shading.softSelfShadow', next)).toBe(true)
    expect(asset.applyLiveParam('leaves.alphaCutoff', next)).toBe(true)
    expect(asset.applyLiveParam('leaves.cameraFacing', next)).toBe(true)
    expect(asset.applyLiveParam('flowers.alphaCutoff', next)).toBe(true)
    expect(asset.applyLiveParam('flowers.cameraFacing', next)).toBe(true)
    expect(asset.applyLiveParam('trunk.height', next)).toBe(false)

    expect(leafU.uLeafSSS.value).toBeCloseTo(0.88)
    expect(leafU.uLeafRim.value).toBeCloseTo(0.77)
    expect(leafU.uShadowShift.value).toBeCloseTo(0.12)
    expect(leafU.uTopWarmth.value).toBeCloseTo(0.91)
    expect(leafU.uLeafFacing.value).toBeCloseTo(0.42)
    expect(leafMat.alphaTest).toBeCloseTo(0.63)
    expect(leafMesh.receiveShadow).toBe(true)
    expect(flowerMat.alphaTest).toBeCloseTo(0.55)
    expect(flowerU.uLeafFacing.value).toBeCloseTo(0.25)
    expect(asset.group.userData.spec).toBe(next)

    asset.dispose()
    registry.dispose()
  })

  it('AiSceneAsset supports single-part incremental rebuild, zero-rebuild transforms, and live material updates', () => {
    const { registry } = makeSpyRegistry()
    const sc = sakuraBonsaiShowcase()
    const built = buildAiScene(sc, registry.textures)

    const origMain = built.partAssets.get('part-main')!
    const origLeft = built.partAssets.get('part-left')!
    const origRight = built.partAssets.get('part-right')!
    const origGround = built.partAssets.get('part-ground')!
    const origFl = built.partAssets.get('part-ground-flowers')!
    const origGroundIdx = built.group.children.indexOf(origGround.group)
    const trisBefore = built.stats.triangles

    // 1. Transform-only update touches zero geometry
    const leftPart = sc.parts.find(p => p.id === 'part-left')!
    leftPart.position = [-1.8, 0.2, 0.5]
    leftPart.rotationY = 45
    leftPart.scale = 1.25
    expect(built.updatePartTransform(leftPart, sc)).toBe(true)
    expect(built.partAssets.get('part-left')).toBe(origLeft)
    expect(origLeft.group.position.toArray()).toEqual([-1.8, 0.2, 0.5])
    expect(origLeft.group.scale.x).toBeCloseTo(1.25)

    // 2. Live material param update touches zero geometry
    const mainPart = sc.parts.find(p => p.id === 'part-main')!
    mainPart.spec = { ...mainPart.spec, shading: { ...mainPart.spec.shading, translucency: 0.92 } }
    expect(built.applyPartLiveParam(mainPart, 'shading.translucency', sc)).toBe(true)
    expect(built.partAssets.get('part-main')).toBe(origMain)

    // 3. Single-part incremental rebuild replaces ONLY part-ground, leaving all other 4 parts untouched
    const groundPart = sc.parts.find(p => p.id === 'part-ground')!
    groundPart.spec = { ...groundPart.spec, ground: { ...groundPart.spec.ground, count: 40 } }
    expect(built.rebuildPart(groundPart, registry.textures, 'final', sc)).toBe(true)

    expect(built.partAssets.get('part-main')).toBe(origMain)
    expect(built.partAssets.get('part-left')).toBe(origLeft)
    expect(built.partAssets.get('part-right')).toBe(origRight)
    expect(built.partAssets.get('part-ground-flowers')).toBe(origFl)
    expect(built.partAssets.get('part-ground')).not.toBe(origGround)
    expect(built.group.children.indexOf(built.partAssets.get('part-ground')!.group)).toBe(origGroundIdx)
    expect(built.stats.triangles).toBeLessThan(trisBefore)

    built.dispose()
    registry.dispose()
  })
})
