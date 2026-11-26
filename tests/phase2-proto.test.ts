import { describe, expect, it } from 'vitest'
import type { Mesh } from 'three'
import { buildAssemblyItem, type AssemblySharedTextures } from '../src/assembly/builder'
import { createRockC2Item, defaultPolyCRockSpec } from '../src/assembly/spec'
import { buildTerracedMossBluffRouteC } from '../src/rock-v2/poly-csg'
import { bakePolyCsgPbr, unwrapPolyCsgUvCharts } from '../src/rock-v2/poly-pbr'
import { buildTree, type TreeTextures } from '../src/tree/assemble'
import { botanicalTextureKeys, getBotanicalTexture } from '../src/tree/botanical-textures'
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
})
