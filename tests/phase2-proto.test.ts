import { describe, expect, it } from 'vitest'
import type { Mesh } from 'three'
import { buildAssemblyItem, type AssemblySharedTextures } from '../src/assembly/builder'
import { createRockC2Item, defaultPolyCRockSpec, parsePolyCRockSpec } from '../src/assembly/spec'
import { makeSolidMapSet } from '../src/rock-v2/photocraft-pbr'
import { buildTerracedMossBluffRouteC } from '../src/rock-v2/poly-csg'
import { bakePolyCsgPbr, unwrapPolyCsgUvCharts } from '../src/rock-v2/poly-pbr'
import { buildTree, type TreeTextures } from '../src/tree/assemble'
import { botanicalTextureKeys, getBotanicalTexture } from '../src/tree/botanical-textures'
import { botanicalLayouts, sampleHorizontalSlots, type BotanicalLayout } from '../src/tree/botanical-layout'
import { rng } from '../src/shape'
import { CrownEnvelope } from '../src/tree/envelope'
import { buildHerbShrub } from '../src/tree/herb-shrub'
import { buildRosetteShrub } from '../src/tree/rosette-shrub'
import { parseTreeSpec, presetIds, presetSpec, type PresetId } from '../src/tree/spec'

function assertFiniteGeometry(pos: Float32Array, nor: Float32Array) {
  expect(pos.length).toBeGreaterThan(0)
  expect(nor.length).toBe(pos.length)
  for (let i = 0; i < pos.length; i++) {
    expect(Number.isFinite(pos[i])).toBe(true)
    expect(Number.isFinite(nor[i])).toBe(true)
  }
  for (let i = 0; i < nor.length; i += 3) {
    const len = Math.hypot(nor[i], nor[i + 1], nor[i + 2])
    expect(len).toBeGreaterThan(0.95)
    expect(len).toBeLessThan(1.05)
  }
}

describe('Phase 2 High-Craft Benchmark Prototypes', () => {
  it('loads botanical textures safely in headless Node fallback', () => {
    const t1 = getBotanicalTexture('heart-leaf-a')
    const t2 = getBotanicalTexture('hydrangea-leaf')
    const t3 = getBotanicalTexture('hydrangea-floret-2x2')
    expect(t1.name).toBe('Botanical_HeartLeafA')
    expect(t2.name).toBe('Botanical_HydrangeaLeaf')
    expect(t3.name).toBe('Botanical_HydrangeaFloret2x2')
  })

  it('builds deterministic Prototype 1 (04 阔叶灌木 A) rosette petiole single-leaf dome', () => {
    const spec = presetSpec('broadleaf-round')
    spec.seed = 4041
    spec.trunk.height = 0.70
    spec.crown.width = 0.62
    spec.ground.count = 46
    spec.leaves.leafSize = 0.36
    const env = new CrownEnvelope(spec)
    const a = buildRosetteShrub(spec, env)
    const b = buildRosetteShrub(spec, env)

    expect(a.leaves).toBeGreaterThanOrEqual(28)
    expect(a.stems).toBe(a.leaves)
    expect(a.leaves).toBe(b.leaves)

    const lPos = a.leafGeometry.getAttribute('position').array as Float32Array
    const lNor = a.leafGeometry.getAttribute('normal').array as Float32Array
    const sPos = a.stemGeometry.getAttribute('position').array as Float32Array
    const sNor = a.stemGeometry.getAttribute('normal').array as Float32Array
    assertFiniteGeometry(lPos, lNor)
    assertFiniteGeometry(sPos, sNor)
    expect(Array.from(lPos.slice(0, 18))).toEqual(Array.from((b.leafGeometry.getAttribute('position').array as Float32Array).slice(0, 18)))

    a.stemGeometry.dispose(); a.leafGeometry.dispose()
    b.stemGeometry.dispose(); b.leafGeometry.dispose()
  })

  it('builds deterministic Prototype 2 (10 绣球花丛) with true 3D hydrangea pom-pom clusters', () => {
    const spec = presetSpec('broadleaf-round')
    spec.seed = 1017
    spec.trunk.height = 0.72
    spec.crown.width = 0.68
    spec.branches.count = 12
    spec.flowers.enabled = true
    spec.flowers.clusterCount = 6
    spec.flowers.count = 28
    const env = new CrownEnvelope(spec)
    const built = buildHerbShrub(spec, env)

    expect(built.stems).toBeGreaterThanOrEqual(12)
    expect(built.leaves).toBeGreaterThanOrEqual(40)
    expect(built.flowers).toBeGreaterThanOrEqual(90)

    assertFiniteGeometry(
      built.leafGeometry.getAttribute('position').array as Float32Array,
      built.leafGeometry.getAttribute('normal').array as Float32Array,
    )
    assertFiniteGeometry(
      built.flowerGeometry.getAttribute('position').array as Float32Array,
      built.flowerGeometry.getAttribute('normal').array as Float32Array,
    )
    assertFiniteGeometry(
      built.coreGeometry.getAttribute('position').array as Float32Array,
      built.coreGeometry.getAttribute('normal').array as Float32Array,
    )

    built.stemGeometry.dispose()
    built.leafGeometry.dispose()
    built.flowerGeometry.dispose()
    built.coreGeometry.dispose()
  })

  it('builds watertight Prototype 3 (17 苔藓层叠方巨岩) with clean UV charts and inset moss PBR', async () => {
    const rock = await buildTerracedMossBluffRouteC('c2', { seed: 7301 })
    expect(rock.audit.manifoldStatus).toBe('NoError')
    expect(rock.audit.connectedComponents).toBe(1)
    expect(rock.audit.openEdges).toBe(0)
    expect(rock.audit.nonManifoldEdges).toBe(0)
    expect(rock.audit.windingMismatches).toBe(0)
    expect(rock.audit.selfIntersections).toBe(0)
    expect(rock.audit.minY).toBe(0)
    expect(rock.audit.triangles).toBeGreaterThan(220)
    expect(rock.audit.triangles).toBeLessThan(2000)

    const uv = unwrapPolyCsgUvCharts(rock, { atlasSize: 512, gutterPx: 6, mergeCreaseDeg: 32, shadingCreaseDeg: 24 })
    expect(uv.audit.flippedUvTris).toBe(0)
    expect(uv.audit.overlappingChartTris).toBe(0)
    expect(uv.audit.tangentInvalidCount).toBe(0)

    const baked = bakePolyCsgPbr(rock, uv, {
      size: 512,
      mode: 'shallow-detail',
      baseColorHex: '#c69f7b',
      mossTop: true,
      mossColorHex: '#76b82c',
      aoRays: 8,
      dilationPasses: 8,
      seed: 7301,
    })

    // Verify both distinct vibrant green terrace moss texels AND warm sandstone wall texels exist!
    let mossPixels = 0
    let stonePixels = 0
    for (let i = 0; i < baked.albedo.length; i += 4) {
      const r = baked.albedo[i], g = baked.albedo[i + 1], b = baked.albedo[i + 2]
      if (g > r + 18 && g > b + 45) mossPixels++
      else if (r > g + 8 && g > b + 8) stonePixels++
    }
    expect(mossPixels).toBeGreaterThan(4000)
    expect(stonePixels).toBeGreaterThan(40000)
  })

  it('registers all 15 botanical textures and builds all 16 stylized botanical presets with valid normals, JSON round-trip, and LOD', () => {
    expect(botanicalTextureKeys.length).toBe(15)
    for (const key of botanicalTextureKeys) {
      const tex = getBotanicalTexture(key)
      expect(tex).toBeTruthy()
      expect(tex.name).toContain('Botanical_')
    }

    const botIds = presetIds.filter(id => id.startsWith('botanical-')) as PresetId[]
    expect(botIds.length).toBe(16)

    const stubTextures = {} as unknown as TreeTextures
    for (const id of botIds) {
      const spec = presetSpec(id)
      expect(spec.kind).toBe('botanical')
      expect(spec.botanical).toBeTruthy()

      // JSON serialization & parseTreeSpec round-trip
      const parsed = parseTreeSpec(JSON.parse(JSON.stringify(spec)))
      expect(parsed.kind).toBe('botanical')
      expect(parsed.botanical?.mode).toBe(spec.botanical?.mode)
      expect(parsed.botanical?.leafTexture).toBe(spec.botanical?.leafTexture)

      const built = buildTree(parsed, stubTextures)
      expect(built.stats.triangles).toBeGreaterThan(100)
      expect(built.stats.leaves).toBeGreaterThan(0)
      let meshCount = 0
      built.group.traverse(obj => {
        const m = obj as Mesh
        if (!m.isMesh) return
        meshCount++
        assertFiniteGeometry(
          m.geometry.getAttribute('position').array as Float32Array,
          m.geometry.getAttribute('normal').array as Float32Array,
        )
      })
      expect(meshCount).toBeGreaterThan(0)

      // LOD reduction check via remeshForOptimize
      const lodSpec = parseTreeSpec(JSON.parse(JSON.stringify(parsed)))
      lodSpec.optimize = { ...lodSpec.optimize, level: 2, cardReduction: 0.45, flatCards: true }
      const beforeTris = built.stats.triangles
      built.remeshForOptimize(lodSpec)
      expect(built.stats.triangles).toBeLessThan(beforeTris)
      built.dispose()
    }
  })

  it('builds terraced-moss-bluff-c2 cleanly inside Scene Assembly (kind: rock-c2)', async () => {
    const item = createRockC2Item(defaultPolyCRockSpec('terraced-moss-bluff-c2'), { name: '17 苔藓层叠方巨岩 · C2' })
    const stubShared = {} as unknown as AssemblySharedTextures
    const built = await buildAssemblyItem(item, stubShared)
    expect(built.triangles).toBeGreaterThan(300)
    expect(built.triangles).toBeLessThan(2000)
    expect(built.wrapper.name).toBe('17 苔藓层叠方巨岩 · C2')
    let hasMesh = false
    built.lod0Group.traverse(obj => {
      const m = obj as Mesh
      if (!m.isMesh) return
      hasMesh = true
      assertFiniteGeometry(
        m.geometry.getAttribute('position').array as Float32Array,
        m.geometry.getAttribute('normal').array as Float32Array,
      )
    })
    expect(hasMesh).toBe(true)
    built.dispose()
  })

  it('botanical.heightJitter alters vertical leaf height spread cleanly with finite normals and round-trips through parseTreeSpec', () => {
    const stubTextures = {} as unknown as TreeTextures
    const measureYStats = (presetId: PresetId, hj: number) => {
      const raw = presetSpec(presetId)
      raw.botanical = { ...raw.botanical!, heightJitter: hj }
      const parsed = parseTreeSpec(JSON.parse(JSON.stringify(raw)))
      expect(parsed.botanical?.heightJitter).toBeCloseTo(hj, 4)
      const built = buildTree(parsed, stubTextures)
      let maxY = -Infinity
      let sumY = 0
      let sumY2 = 0
      let count = 0
      built.group.traverse(obj => {
        const m = obj as Mesh
        if (!m.isMesh) return
        const pos = m.geometry.getAttribute('position').array as Float32Array
        const nor = m.geometry.getAttribute('normal').array as Float32Array
        assertFiniteGeometry(pos, nor)
        for (let i = 1; i < pos.length; i += 3) {
          const y = pos[i]
          if (y > maxY) maxY = y
          sumY += y
          sumY2 += y * y
          count++
        }
      })
      built.dispose()
      const mean = sumY / Math.max(1, count)
      const std = Math.sqrt(Math.max(0, sumY2 / Math.max(1, count) - mean * mean))
      return { maxY, mean, std }
    }

    // Clamp bounds check
    const clampedHigh = parseTreeSpec({ ...presetSpec('botanical-large-grass-a'), botanical: { ...presetSpec('botanical-large-grass-a').botanical!, heightJitter: 5 } })
    const clampedLow = parseTreeSpec({ ...presetSpec('botanical-large-grass-a'), botanical: { ...presetSpec('botanical-large-grass-a').botanical!, heightJitter: -1 } })
    expect(clampedHigh.botanical?.heightJitter).toBe(1)
    expect(clampedLow.botanical?.heightJitter).toBe(0)

    // Fountain grass (02 大型草丛 A), fern (01 大蕨类 A), broadleaf rosette (04 阔叶灌木 A) all widen vertical distribution cleanly
    for (const id of ['botanical-large-grass-a', 'botanical-fern-a', 'botanical-shrub-a'] as const) {
      const low = measureYStats(id, 0)
      const high = measureYStats(id, 0.85)
      expect(high.maxY).toBeGreaterThan(low.maxY)
      expect(high.std).toBeGreaterThan(low.std)
    }
  })

  it('botanical.layout (all 5 algorithms) and botanical.lateralJitter produce distinct horizontal footprints & valid meshes', () => {
    // 1. Direct horizontal algorithm invariants
    for (const layout of botanicalLayouts) {
      const slots = sampleHorizontalSlots({
        layout,
        count: 18,
        radius: 0.12,
        areaRadius: 0.45,
        lateralJitter: 0.5,
        random: rng(4242),
      })
      expect(slots.length).toBe(18)
      for (const s of slots) {
        expect(Number.isFinite(s.x)).toBe(true)
        expect(Number.isFinite(s.z)).toBe(true)
        expect(Number.isFinite(s.angle)).toBe(true)
      }
      if (layout === 'fan') {
        // Fan must be strongly bilateral (X span >> Z span) with strictly alternating left/right sides
        const spanX = Math.max(...slots.map(s => s.x)) - Math.min(...slots.map(s => s.x))
        const spanZ = Math.max(...slots.map(s => s.z)) - Math.min(...slots.map(s => s.z))
        expect(spanX).toBeGreaterThan(spanZ * 1.4)
        for (let i = 1; i < slots.length; i++) {
          expect(slots[i].sideSign).toBe(-slots[i - 1].sideSign)
        }
      }
      if (layout === 'phyllotaxis' || layout === 'ring') {
        // Every 90° quadrant must be covered cleanly (no empty half-circle)
        const quads = new Set(slots.map(s => Math.floor(((s.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 2))))
        expect(quads.size).toBe(4)
      }
    }

    // 2. End-to-end 3D build across all 5 layouts + parseTreeSpec round-trip + lateralJitter effect
    const stubTextures = {} as unknown as TreeTextures
    const measureXZ = (presetId: PresetId, layout: BotanicalLayout, lj: number) => {
      const raw = presetSpec(presetId)
      raw.botanical = { ...raw.botanical!, layout, lateralJitter: lj }
      const parsed = parseTreeSpec(JSON.parse(JSON.stringify(raw)))
      expect(parsed.botanical?.layout).toBe(layout)
      expect(parsed.botanical?.lateralJitter).toBeCloseTo(lj, 4)
      const built = buildTree(parsed, stubTextures)
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      let sumR = 0, count = 0
      built.group.traverse(obj => {
        const m = obj as Mesh
        if (!m.isMesh) return
        const pos = m.geometry.getAttribute('position').array as Float32Array
        const nor = m.geometry.getAttribute('normal').array as Float32Array
        assertFiniteGeometry(pos, nor)
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], z = pos[i + 2]
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (z < minZ) minZ = z
          if (z > maxZ) maxZ = z
          sumR += Math.hypot(x, z)
          count++
        }
      })
      built.dispose()
      return { spanX: maxX - minX, spanZ: maxZ - minZ, meanR: sumR / Math.max(1, count) }
    }

    for (const id of ['botanical-large-grass-a', 'botanical-shrub-a', 'botanical-clover-cover'] as const) {
      for (const layout of botanicalLayouts) {
        const m = measureXZ(id, layout, 0.5)
        expect(m.spanX).toBeGreaterThan(0.1)
        expect(m.spanZ).toBeGreaterThan(0.1)
      }
    }

    // On 02 大型草丛 A, fan is wider in X than Z, lateralJitter widens footprint, and scatter spreads root anchors much wider than tight spiral
    const grassFan = measureXZ('botanical-large-grass-a', 'fan', 0.55)
    expect(grassFan.spanX).toBeGreaterThan(grassFan.spanZ * 1.15)
    const grassTight = measureXZ('botanical-large-grass-a', 'phyllotaxis', 0)
    const grassLoose = measureXZ('botanical-large-grass-a', 'phyllotaxis', 0.9)
    expect(grassLoose.meanR).toBeGreaterThan(grassTight.meanR)
    const grassScatter = measureXZ('botanical-large-grass-a', 'scatter', 0.65)
    expect(grassScatter.meanR).toBeGreaterThan(grassTight.meanR)
    const scatterSlots = sampleHorizontalSlots({ layout: 'scatter', count: 18, radius: 0.08, areaRadius: 0.28, lateralJitter: 0.65, random: rng(77) })
    const spiralSlots = sampleHorizontalSlots({ layout: 'phyllotaxis', count: 18, radius: 0.08, areaRadius: 0.28, lateralJitter: 0.0, random: rng(77) })
    const avgSlotR = (arr: typeof scatterSlots) => arr.reduce((a, s) => a + Math.hypot(s.x, s.z), 0) / arr.length
    expect(avgSlotR(scatterSlots)).toBeGreaterThan(avgSlotR(spiralSlots) * 2.0)

    // Backward-compatible legacy JSON without layout/lateralJitter falls back cleanly
    const legacyRaw = JSON.parse(JSON.stringify(presetSpec('botanical-large-grass-a')))
    delete legacyRaw.botanical.layout
    delete legacyRaw.botanical.lateralJitter
    const parsedLegacy = parseTreeSpec(legacyRaw)
    expect(parsedLegacy.botanical?.layout).toBe('phyllotaxis')
    expect(parsedLegacy.botanical?.lateralJitter).toBeGreaterThan(0)
  })

  it('supports PhotoCraft PBR mode on terraced-moss-bluff-c2 with triplanar strata, moss roughness & normal baking', async () => {
    const def = defaultPolyCRockSpec('terraced-moss-bluff-c2')
    expect(def.mode).toBe('photocraft-pbr')
    const parsed = parsePolyCRockSpec(JSON.parse(JSON.stringify(def)))
    expect(parsed.mode).toBe('photocraft-pbr')

    // Build synthetic stratified stone + velvety moss ExternalPbrLayers to test triplanar + tangent normal + roughness math cleanly in headless Node
    const stone = makeSolidMapSet([212, 166, 118], 0.76, 16)
    const moss = makeSolidMapSet([92, 168, 42], 0.92, 16)
    for (let y = 0; y < 16; y++) {
      const band = Math.sin((y / 16) * Math.PI * 4)
      for (let x = 0; x < 16; x++) {
        const o = (y * 16 + x) * 4
        stone.albedo[o] = Math.round(205 + band * 24)
        stone.albedo[o + 1] = Math.round(160 + band * 20)
        stone.albedo[o + 2] = Math.round(112 + band * 16)
        stone.normal[o] = Math.round(128 + band * 26)
        stone.normal[o + 1] = Math.round(128 + Math.cos((y / 16) * Math.PI * 4) * 32)
        stone.normal[o + 2] = 248
      }
    }

    const c2 = await buildTerracedMossBluffRouteC('c2', { seed: 7301 })
    const uv = unwrapPolyCsgUvCharts(c2, { atlasSize: 256, gutterPx: 4 })
    const baked = bakePolyCsgPbr(c2, uv, {
      size: 256,
      mode: 'photocraft-pbr',
      baseColorHex: '#cfa87d',
      dilationPasses: 4,
      aoRays: 6,
      seed: 7301,
      mossTop: true,
      externalPbr: { stone, moss },
    })

    expect(baked.roughness.length).toBe(256 * 256 * 4)
    expect(baked.stats.maxNormalDeviationDeg).toBeGreaterThan(2.5)
    let mossPx = 0, stonePx = 0, minRgh = 255, maxRgh = 0
    for (let i = 0; i < baked.albedo.length; i += 4) {
      const r = baked.albedo[i], g = baked.albedo[i + 1], b = baked.albedo[i + 2]
      const rg = baked.roughness[i]
      if (rg < minRgh) minRgh = rg
      if (rg > maxRgh) maxRgh = rg
      if (g > r + 18 && g > b + 40) mossPx++
      else if (r > g + 8 && g > b + 8) stonePx++
    }
    expect(mossPx).toBeGreaterThan(800)
    expect(stonePx).toBeGreaterThan(8000)
    expect(maxRgh - minRgh).toBeGreaterThan(25)
  })
})
