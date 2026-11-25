import { describe, expect, it } from 'vitest'
import { Box3, InstancedMesh, Material, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { buildMeadowBirchStructure } from '../src/assembly/birch-structure'
import { buildAssemblyItem, buildAssemblyTreeAsset, type AssemblySharedTextures } from '../src/assembly/builder'
import { defaultGrassBrushOptions, MAX_GRASS_CLUSTERS, PaintedGrassLayer, syncGrassRvtUniforms } from '../src/assembly/grass-brush'
import { buildAssemblyGround, groundPathStrengthAt } from '../src/assembly/ground'
import { defaultTerrainBrushOptions } from '../src/assembly/terrain-brush'
import {
  buildBirchMeadowCase, builtInAssemblyCases, curatedAssemblyAssets,
} from '../src/assembly/showcases'
import {
  blankAssemblyScene, defaultGrassRvtSpec, detectImportedAssetJson, parseAssemblyReference,
  parseAssemblyScene, parseGrassRvt, type GrassPaintCluster,
} from '../src/assembly/spec'
import { createAssemblySceneStore } from '../src/assembly/store'
import {
  clearSceneEditSession, createSceneEditSession, loadSceneEditSession, saveSceneEditProgress,
} from '../src/assembly/studio-bridge'
import { foliageRvt } from '../src/broadleaf/leaf-material'
import { inspectGlbExport, prepareGlbScene } from '../src/export-glb'
import { rockPresetSpec } from '../src/rock/spec'
import type { StorageLike } from '../src/studio/preset-store'
import { createTextureRegistry } from '../src/studio/texture-slots'
import { buildTree } from '../src/tree/assemble'
import { defaultLeafNormalEdit, parseTreeSpec, presetSpec, type TreeSpec } from '../src/tree/spec'

function dummySharedTextures(): AssemblySharedTextures {
  const mk = (name: string) => () => { const t = new Texture(); t.name = name; return t }
  const registry = createTextureRegistry({
    bark: mk('bark'), leaf: mk('leaf'), needle: mk('needle'), drape: mk('drape'),
    palm: mk('palm'), bamboo: mk('bamboo'), lotusLeaf: mk('lotusLeaf'), lotusPetal: mk('lotusPetal'),
    grass: mk('grass'), grassTint: mk('grassTint'), fern: mk('fern'),
    flower: mk('flower'), blossom: mk('blossom'), stemLeaf: mk('stemLeaf'),
    painted: mk('painted'), feathery: mk('feathery'), sakura: mk('sakura'), cloud: mk('cloud'), oak: mk('oak'), oakAtlas: mk('oakAtlas'),
    maple: mk('maple'), willow: mk('willow'), bush: mk('bush'), wildrose: mk('wildrose'),
  })
  return { registry, barkTemplates: {} }
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } }
}

describe('Scene Assembly Studio — schema, showcases, ground, builder & store', () => {
  it('builds the user-saved reference diorama case 1 completely and round-trips through parseAssemblyScene', async () => {
    const shared = dummySharedTextures()
    expect(builtInAssemblyCases).toHaveLength(1)
    expect(builtInAssemblyCases[0].id).toBe('birch-meadow')

    const case1 = buildBirchMeadowCase()
    expect(case1.items).toHaveLength(12)
    expect(case1.items[0].barkStyle).toBe('birch')
    expect(case1.items[0].customTextures?.leaf?.name).toBeTruthy()
    expect(case1.grassPaint?.length).toBe(772)
    expect(case1.groundPaint?.startsWith('data:image/png;base64,')).toBe(true)
    expect(case1.rvt?.mode).toBe('root-blend')

    // Round-trip JSON serialization
    const parsed1 = parseAssemblyScene(JSON.parse(JSON.stringify(case1)))
    expect(parsed1.items).toHaveLength(case1.items.length)
    expect(parsed1.cameraPreset).toBe('illustration')
    expect(parsed1.items[0].crownStyle).toBeUndefined()
    expect(parsed1.items[0].treeForm).toBe('meadow-birch')
    expect(parseAssemblyScene({ ...case1, items: [{ ...case1.items[0], crownStyle: undefined }] }).items[0].crownStyle).toBeUndefined()
    expect(parsed1.ground.pathLayout).toBe('birch-curve')
    expect(parsed1.grassPaint?.length).toBe(772)
    expect(parsed1.groundPaint).toBe(case1.groundPaint)

    // Build ground slab & every item in Case 1 cleanly
    for (const sc of [case1]) {
      const ground = buildAssemblyGround(sc.ground)
      expect(ground.group.children.length).toBeGreaterThan(0)
      ground.dispose()
      for (const item of sc.items) {
        const inst = await buildAssemblyItem(item, shared)
        if (item.kind === 'tree' && (item.payload as TreeSpec).kind === 'broadleaf' && item.category !== 'deadwood') {
          const leaves = inst.content.getObjectByName('Leaf cards') as Mesh
          expect(leaves).toBeDefined()
          expect(inst.content.getObjectByName('Broadleaf sprays')).toBeUndefined()
          const normals = leaves.geometry.getAttribute('normal')
          expect(normals.count).toBeGreaterThan(100)
          const directions = new Set<number>()
          for (let i = 0; i < normals.count; i++) directions.add(Math.round(normals.getY(i) * 10))
          expect(directions.size).toBeGreaterThan(6)
        }
        expect(inst.triangles).toBeGreaterThan(0)
        expect(Number.isFinite(inst.localMinY)).toBe(true)
        inst.dispose()
      }
    }
    shared.registry.dispose()
  })

  it('supports curated asset catalog & auto-detects imported Tree/Rock/Assembly JSONs', () => {
    expect(curatedAssemblyAssets.length).toBeGreaterThanOrEqual(10)
    const treeRes = detectImportedAssetJson(presetSpec('broadleaf-sakura'))
    expect(treeRes.type).toBe('item')
    if (treeRes.type === 'item') expect(treeRes.item.kind).toBe('tree')

    const rockRes = detectImportedAssetJson(rockPresetSpec('boulder-chiseled'))
    expect(rockRes.type).toBe('item')
    if (rockRes.type === 'item') expect(rockRes.item.kind).toBe('rock')

    const sceneRes = detectImportedAssetJson(blankAssemblyScene('测试空场'))
    expect(sceneRes.type).toBe('assembly')
  })

  it('persists, overwrites, renames, and deletes saved assembly scenes in store', async () => {
    const storage = memoryStorage()
    const store = createAssemblySceneStore({ storage, apiUrl: null })
    await store.ready()

    const c1 = buildBirchMeadowCase()
    const saved = await store.saveNew({
      name: '我的白桦地块',
      itemCount: c1.items.length,
      triangles: 42000,
      thumbnail: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
      scene: c1,
    })
    expect(store.list()).toHaveLength(1)
    expect(saved.name).toBe('我的白桦地块')

    const renamed = await store.rename(saved.id, '林间白桦场景 V2')
    expect(renamed.name).toBe('林间白桦场景 V2')

    const reloaded = createAssemblySceneStore({ storage, apiUrl: null })
    await reloaded.ready()
    expect(reloaded.list()[0].name).toBe('林间白桦场景 V2')
    expect(reloaded.list()[0].scene.items).toHaveLength(c1.items.length)

    expect(await store.remove(saved.id)).toBe(true)
    expect(store.list()).toHaveLength(0)
  })

  it('validates & round-trips reference image specs and pre-wires built-in showcase references', () => {
    const c1 = buildBirchMeadowCase()
    expect(c1.reference?.src).toBe('./showcases/reference-birch-meadow.jpg')
    expect(c1.reference?.mode).toBe('off')

    const parsed = parseAssemblyReference({
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      name: 'Agent 注入图',
      mode: 'wipe',
      opacity: 0.72,
      split: 0.42,
      scale: 1.15,
      offsetX: 6,
      offsetY: -4,
    })
    expect(parsed).toBeDefined()
    expect(parsed!.mode).toBe('wipe')
    expect(parsed!.split).toBeCloseTo(0.42, 3)

    // Unsafe URLs must be rejected cleanly
    expect(parseAssemblyReference({ src: 'javascript:alert(1)', mode: 'wipe' })).toBeUndefined()
    expect(parseAssemblyReference({ src: '', mode: 'wipe' })).toBeUndefined()

    const sceneWithRef = parseAssemblyScene({ ...c1, reference: parsed })
    expect(sceneWithRef.reference?.name).toBe('Agent 注入图')
    expect(sceneWithRef.reference?.scale).toBeCloseTo(1.15, 3)
  })

  it('round-trips Tree Studio live-edit sessions through studio-bridge', () => {
    // Provide clean global localStorage shim in Node test env if absent
    const mem = new Map<string, string>()
    const prevLs = (globalThis as { localStorage?: Storage }).localStorage
    if (!prevLs) {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          getItem: (k: string) => mem.get(k) ?? null,
          setItem: (k: string, v: string) => { mem.set(k, v) },
          removeItem: (k: string) => { mem.delete(k) },
          clear: () => mem.clear(),
          key: (i: number) => [...mem.keys()][i] ?? null,
          get length() { return mem.size },
        },
      })
    }
    try {
      const c1 = buildBirchMeadowCase()
      const hero = c1.items[0]
      const session = createSceneEditSession({
        itemId: hero.id,
        itemName: hero.name,
        sceneName: c1.name,
        treeSpec: hero.payload as TreeSpec,
        sceneDraft: c1,
        activeBuiltInCaseId: 'birch-meadow',
        selectedId: hero.id,
      })

      const loaded = loadSceneEditSession(session.sessionId)
      expect(loaded).toBeDefined()
      expect(loaded!.itemId).toBe(hero.id)
      expect(loaded!.sceneDraft.items).toHaveLength(c1.items.length)
      expect(loaded!.committed).toBe(false)

      const editedSpec = presetSpec('broadleaf-sakura', 9901)
      const committed = saveSceneEditProgress(session.sessionId, {
        treeSpec: editedSpec,
        itemName: hero.name,
        committed: true,
      })
      expect(committed?.committed).toBe(true)

      const reloaded = loadSceneEditSession(session.sessionId)
      expect(reloaded?.committed).toBe(true)
      expect(reloaded?.treeSpec.seed).toBe(9901)

      clearSceneEditSession(session.sessionId)
      expect(loadSceneEditSession(session.sessionId)).toBeUndefined()
    } finally {
      if (!prevLs) {
        delete (globalThis as { localStorage?: Storage }).localStorage
      }
    }
  })

  it('paints, erases, scatters UE-style instanced grass with path avoidance, JSON round-trip & GLB baking', () => {
    const c1 = buildBirchMeadowCase()
    const layer = new PaintedGrassLayer()
    const opts = defaultGrassBrushOptions()
    opts.species = ['broad', 'narrow', 'clover']
    opts.minSpacing = 0.24
    opts.avoidPath = true

    const clusters: GrassPaintCluster[] = []
    const addedPaint = layer.paintAt(clusters, -1.8, 1.4, opts, c1.ground, 1001)
    expect(addedPaint).toBeGreaterThan(4)

    // Verify Poisson minimum spacing & dirt-path avoidance on all painted tufts
    for (let i = 0; i < clusters.length; i++) {
      expect(groundPathStrengthAt(c1.ground, clusters[i].x, clusters[i].z)).toBeLessThanOrEqual(0.34)
      for (let j = i + 1; j < clusters.length; j++) {
        const d = Math.hypot(clusters[i].x - clusters[j].x, clusters[i].z - clusters[j].z)
        expect(d).toBeGreaterThanOrEqual(opts.minSpacing - 0.004)
      }
    }

    // One-click meadow scatter fill should spawn hundreds of tufts in <= 3 draw calls
    const addedFill = layer.fillMeadow(clusters, opts, c1.ground, 240, 7777)
    expect(addedFill).toBeGreaterThan(100)
    const st = layer.stats()
    expect(st.clusters).toBe(clusters.length)
    expect(st.drawCalls).toBeLessThanOrEqual(3)
    expect(st.drawCalls).toBeGreaterThanOrEqual(1)
    expect(st.triangles).toBeGreaterThan(2000)

    // Verify Scene JSON round-trip preserves grassPaint faithfully
    const parsedScene = parseAssemblyScene({ ...c1, grassPaint: clusters })
    expect(parsedScene.grassPaint).toHaveLength(clusters.length)

    // Verify GLB export bakes InstancedMesh grass into standard Mesh with exact triangle counts (merged & separate)
    const preview = inspectGlbExport(layer.group, { mode: 'merged', excludeDecorations: false })
    expect(preview.triangles).toBe(st.triangles)
    expect(preview.meshCount).toBe(1)

    const merged = prepareGlbScene(layer.group, { mode: 'merged', excludeDecorations: false })
    let mergedTris = 0
    merged.traverse(o => {
      if (o instanceof Mesh) {
        expect(o instanceof InstancedMesh).toBe(false)
        mergedTris += o.geometry.index ? o.geometry.index.count / 3 : 0
      }
    })
    expect(mergedTris).toBe(st.triangles)

    const separate = prepareGlbScene(layer.group, { mode: 'separate', excludeDecorations: false })
    let separateTris = 0
    separate.traverse(o => {
      if (o instanceof Mesh) {
        expect(o instanceof InstancedMesh).toBe(false)
        separateTris += o.geometry.index ? o.geometry.index.count / 3 : 0
      }
    })
    expect(separateTris).toBe(st.triangles)

    // Erase circle removes clusters cleanly
    const beforeErase = clusters.length
    const removed = layer.eraseAt(clusters, -1.8, 1.4, 1.5)
    expect(removed).toBeGreaterThan(0)
    expect(clusters.length).toBe(beforeErase - removed)
    expect(layer.stats().clusters).toBe(clusters.length)

    layer.dispose()
  })

  it('keeps 1:1 Tree Studio <-> Scene Studio asset parity (appearance recipe + identical geometry) & supports RVT ground fusion', async () => {
    const shared = dummySharedTextures()
    const c1 = buildBirchMeadowCase()
    const hero = c1.items.find(i => i.id === 'birch-hero-tree')!
    expect(hero.barkStyle).toBe('birch')
    expect(hero.crownStyle).toBeUndefined()
    expect(hero.treeForm).toBe('meadow-birch')
    expect((hero.payload as TreeSpec).leaves.cardType).toBe('cross')

    // Build via Scene Studio wrapper AND directly via shared Tree Studio helper -> MUST match 1:1!
    const sceneInst = await buildAssemblyItem(hero, shared)
    const studioAsset = buildAssemblyTreeAsset(
      hero.payload as TreeSpec,
      {
        barkStyle: hero.barkStyle,
        crownStyle: hero.crownStyle,
        treeForm: hero.treeForm,
        leafTexture: hero.leafTexture,
        category: hero.category,
      },
      shared.registry.textures,
      shared.barkTemplates,
    )
    expect(studioAsset.stats.triangles).toBe(sceneInst.triangles)
    sceneInst.dispose()
    studioAsset.dispose()
    shared.registry.dispose()

    // RVT spec parsing, JSON round-trip, ground sampling, and GPU uniform binding
    const rvt = parseGrassRvt({ mode: 'full-tint', strength: 0.85, fadeHeight: 0.32, normalBlend: 0.75, affectPlacedGrass: true })
    expect(rvt).toEqual({ mode: 'full-tint', strength: 0.85, fadeHeight: 0.32, normalBlend: 0.75, affectPlacedGrass: true })

    const parsedScene = parseAssemblyScene({ ...c1, rvt })
    expect(parsedScene.rvt).toEqual(rvt)

    const ground = buildAssemblyGround(c1.ground)
    const sample = ground.sampleRvtColor(0, 0)
    expect(Number.isFinite(sample.r) && Number.isFinite(sample.g) && Number.isFinite(sample.b)).toBe(true)

    syncGrassRvtUniforms(ground, rvt)
    expect(foliageRvt.uRvtMode.value).toBe(2) // full-tint
    expect(foliageRvt.uRvtStrength.value).toBeCloseTo(0.85, 3)
    expect(foliageRvt.uRvtFadeHeight.value).toBeCloseTo(0.32, 3)
    expect(foliageRvt.uRvtNormalBlend.value).toBeCloseTo(0.75, 3)

    syncGrassRvtUniforms(ground, defaultGrassRvtSpec({ mode: 'off' }))
    expect(foliageRvt.uRvtMode.value).toBe(0)
    ground.dispose()
  })

  it('keeps meadow-birch smoothly parametric, removes hidden ground turf by default, and supports live terrain material brush', () => {
    const shared = dummySharedTextures()
    const c1 = buildBirchMeadowCase()

    // 1. Bare diorama ground has ZERO hidden baked grass mesh unless builtInTurf is explicitly true
    const cleanGround = buildAssemblyGround(c1.ground)
    const meshNames: string[] = []
    cleanGround.group.traverse(o => { if (o instanceof Mesh) meshNames.push(o.name) })
    expect(meshNames).toEqual(['DioramaGroundSlab'])

    // 2. Terrain Material Paint Brush alters live surface & RVT color and erases/clears cleanly
    expect(cleanGround.terrainPaint).toBeDefined()
    const beforeCol = cleanGround.sampleRvtColor(0, 0).clone()
    const tOpts = defaultTerrainBrushOptions()
    tOpts.material = 'dirt'
    tOpts.radius = 1.6
    tOpts.strength = 1.0
    tOpts.hardness = 0.85
    for (let k = 0; k < 5; k++) cleanGround.terrainPaint!.paintAt(0, 0, tOpts, false)
    expect(cleanGround.terrainPaint!.hasPaint()).toBe(true)
    const afterDirt = cleanGround.sampleRvtColor(0, 0).clone()
    // Warm ochre dirt has significantly higher R relative to G than meadow green
    expect(afterDirt.r / Math.max(0.01, afterDirt.g)).toBeGreaterThan(beforeCol.r / Math.max(0.01, beforeCol.g) + 0.15)
    cleanGround.terrainPaint!.clear()
    expect(cleanGround.terrainPaint!.hasPaint()).toBe(false)
    const afterClear = cleanGround.sampleRvtColor(0, 0).clone()
    expect(afterClear.r).toBeCloseTo(beforeCol.r, 3)
    expect(afterClear.g).toBeCloseTo(beforeCol.g, 3)
    cleanGround.dispose()

    // 3. Meadow-birch + painted foliage responds smoothly to leaf density, LOD, and branch reach sliders!
    const hero = c1.items.find(i => i.id === 'birch-hero-tree')!
    const baseSpec = JSON.parse(JSON.stringify(hero.payload)) as TreeSpec
    const denseSpec = JSON.parse(JSON.stringify(hero.payload)) as TreeSpec
    denseSpec.leaves.twigFrequency = Math.max(5.4, baseSpec.leaves.twigFrequency * 1.6)
    denseSpec.leaves.leavesPerTwig = Math.max(6, Math.round(baseSpec.leaves.leavesPerTwig * 1.5))
    denseSpec.leaves.clumpFill = Math.max(baseSpec.leaves.clumpFill, baseSpec.leaves.clumpFill * 1.4)
    const lodSpec = JSON.parse(JSON.stringify(hero.payload)) as TreeSpec
    lodSpec.optimize.cardReduction = 0.65

    const app = { barkStyle: hero.barkStyle, crownStyle: hero.crownStyle, treeForm: hero.treeForm, leafTexture: hero.leafTexture, category: hero.category }
    const baseAsset = buildAssemblyTreeAsset(baseSpec, app, shared.registry.textures, shared.barkTemplates)
    const denseAsset = buildAssemblyTreeAsset(denseSpec, app, shared.registry.textures, shared.barkTemplates)
    const lodAsset = buildAssemblyTreeAsset(lodSpec, app, shared.registry.textures, shared.barkTemplates)

    expect(denseAsset.stats.triangles).toBeGreaterThan(baseAsset.stats.triangles)
    expect(lodAsset.stats.triangles).toBeLessThan(baseAsset.stats.triangles)
    baseAsset.dispose()
    denseAsset.dispose()
    lodAsset.dispose()
    shared.registry.dispose()
  })

  it('responds to all trunk/branch/crown params on meadow-birch, wires wind onto painted foliage, and supports 3x+ grass density', () => {
    const shared = dummySharedTextures()
    const c1 = buildBirchMeadowCase()
    const hero = c1.items.find(i => i.id === 'birch-hero-tree')!
    const cloneSpec = () => JSON.parse(JSON.stringify(hero.payload)) as TreeSpec
    const app = { barkStyle: hero.barkStyle, crownStyle: hero.crownStyle, treeForm: hero.treeForm, leafTexture: hero.leafTexture, category: hero.category }

    // 1. Trunk, branch count, child count, deadwood, lean, and crown padFlatten ALL drive meadow-birch structure
    const baseStruct = buildMeadowBirchStructure(cloneSpec())
    const manyBranchesSpec = cloneSpec()
    manyBranchesSpec.branches.count = 12
    manyBranchesSpec.branches.childCount = 5
    manyBranchesSpec.branches.deadCount = 4
    const manyStruct = buildMeadowBirchStructure(manyBranchesSpec)
    expect(manyStruct.skeleton.branches.length).toBeGreaterThan(baseStruct.skeleton.branches.length + 10)
    expect(manyStruct.clumps.length).toBeGreaterThan(baseStruct.clumps.length)

    const fewBranchesSpec = cloneSpec()
    fewBranchesSpec.branches.count = 2
    fewBranchesSpec.branches.childCount = 0
    fewBranchesSpec.branches.deadCount = 0
    const fewStruct = buildMeadowBirchStructure(fewBranchesSpec)
    expect(fewStruct.skeleton.branches.length).toBeLessThan(baseStruct.skeleton.branches.length)

    const tallLeanSpec = cloneSpec()
    tallLeanSpec.trunk.height = 10.5
    tallLeanSpec.trunk.lean = 0.28
    tallLeanSpec.crown.padFlatten = 0.65
    const baseAsset = buildAssemblyTreeAsset(cloneSpec(), app, shared.registry.textures, shared.barkTemplates)
    const tallAsset = buildAssemblyTreeAsset(tallLeanSpec, app, shared.registry.textures, shared.barkTemplates)
    const baseBox = new Box3().setFromObject(baseAsset.group)
    const tallBox = new Box3().setFromObject(tallAsset.group)
    const baseSize = baseBox.getSize(new Vector3())
    const tallSize = tallBox.getSize(new Vector3())
    expect(tallSize.y).toBeGreaterThan(baseSize.y + 1.8)

    // 2. Pure game-ready Alpha-Tested Leaf Cards ONLY (zero 3D-modeled blades!)
    //    - Uses unified makeLeafMaterial ('stylized-foliage-v8') with rvtChannel=0
    //    - Game-ready triangle budget (< 25,000 tris for hero birch tree)
    //    - Lower-right Y-fork bough MUST have lush leaf cards (NEVER bare!)
    let foliageMesh: Mesh | undefined
    baseAsset.group.traverse(o => {
      if (o instanceof Mesh && o.userData?.role === 'foliage') foliageMesh = o
    })
    expect(foliageMesh).toBeDefined()
    expect(foliageMesh!.name).toBe('Leaf cards')
    const fMat = foliageMesh!.material as MeshStandardMaterial
    expect(fMat.customProgramCacheKey?.()).toBe('stylized-foliage-v8')
    expect(fMat.map).toBeDefined()
    expect(baseAsset.stats.triangles).toBeLessThan(25000)
    const leafUniforms = fMat.userData?.leafUniforms as Record<string, { value: number }> | undefined
    expect(leafUniforms).toBeDefined()
    expect(leafUniforms!.uRvtChannel.value).toBe(0)

    // Verify lower-right Y-fork branch cluster (x > 0.6, y in [3.0, 4.7]) actually carries abundant leaf vertices!
    const leafPos = foliageMesh!.geometry.getAttribute('position')
    let lowerRightVerts = 0
    for (let i = 0; i < leafPos.count; i++) {
      if (leafPos.getX(i) > 0.65 && leafPos.getY(i) >= 3.0 && leafPos.getY(i) <= 4.8) lowerRightVerts++
    }
    expect(lowerRightVerts).toBeGreaterThan(300)

    // 2b. Unified 6-stage architecture guarantees:
    //   - Single Source of Truth: `buildTree(spec)` === `buildAssemblyTreeAsset(spec)`
    //   - Legacy `cardType: 'blades'` JSON migrates cleanly to `'cross'`
    //   - Custom Normal Transfer (directional / upLift / 3D brushes) + leaf morphology + cardType switching all work!
    //   - Live shading uniforms (`applyLiveParam`) & fast wood-only rebuild (`rebuildWoodOnly`) preserve birch bark!
    const directAsset = buildTree(cloneSpec(), shared.registry.textures)
    expect(directAsset.stats.triangles).toBe(baseAsset.stats.triangles)
    directAsset.dispose()

    const roundTripped = parseTreeSpec(JSON.parse(JSON.stringify(cloneSpec())))
    expect(roundTripped.trunk.barkStyle).toBe('birch')
    expect(roundTripped.trunk.treeForm).toBe('meadow-birch')
    expect(roundTripped.leaves.cardType).toBe('cross')

    const legacyBladesJson = JSON.parse(JSON.stringify(cloneSpec()))
    legacyBladesJson.leaves.cardType = 'blades'
    expect(parseTreeSpec(legacyBladesJson).leaves.cardType).toBe('cross')

    // Custom Normal Transfer + 3D Normal Brush actually rewrite blade vertex normals!
    const normSpec = cloneSpec()
    normSpec.normalEdit = {
      ...defaultLeafNormalEdit(),
      mode: 'directional',
      strength: 1.0,
      azimuth: 0,
      elevation: 88,
      brushes: [{ id: 1, kind: 'up', center: [0, 5, 0], radius: 3, strength: 1, direction: [0, 1, 0] }],
    }
    const normAsset = buildTree(normSpec, shared.registry.textures)
    let baseAvgNy = 0, normAvgNy = 0
    const avgNy = (root: import('three').Object3D) => {
      let sum = 0, cnt = 0
      root.traverse(o => {
        if (o instanceof Mesh && o.userData?.role === 'foliage') {
          const n = o.geometry.getAttribute('normal')
          for (let i = 0; i < n.count; i++) { sum += n.getY(i); cnt++ }
        }
      })
      return sum / Math.max(1, cnt)
    }
    baseAvgNy = avgNy(baseAsset.group)
    normAvgNy = avgNy(normAsset.group)
    expect(normAvgNy).toBeGreaterThan(baseAvgNy + 0.35)
    normAsset.dispose()

    // Leaf morphology, distribution & cardType switching all change geometry cleanly
    const morphSpec = cloneSpec()
    morphSpec.leaves.leafAspect = 2.4
    morphSpec.leaves.twigGravity = -0.8
    morphSpec.leaves.pruneOuter = 0.72
    morphSpec.leaves.limbLeafFrequency = 8.0
    const morphAsset = buildTree(morphSpec, shared.registry.textures)
    expect(morphAsset.stats.triangles).not.toBe(baseAsset.stats.triangles)
    morphAsset.dispose()

    const fanSpec = cloneSpec()
    fanSpec.leaves.cardType = 'fan'
    const fanAsset = buildTree(fanSpec, shared.registry.textures)
    expect(fanAsset.stats.triangles).not.toBe(baseAsset.stats.triangles)
    fanAsset.dispose()

    // Live shading uniform update works in 0ms on blades, AND rebuildWoodOnly preserves birch bark!
    const liveSpec = cloneSpec()
    liveSpec.shading.translucency = 0.92
    expect(baseAsset.applyLiveParam('shading.translucency', liveSpec)).toBe(true)
    expect(leafUniforms!.uLeafSSS.value).toBeCloseTo(0.92, 3)

    const barkSpec = cloneSpec()
    barkSpec.trunk.barkMoss = 0.9
    barkSpec.trunk.flare = 1.15
    expect(baseAsset.applyLiveParam('trunk.barkMoss', barkSpec)).toBe(false)
    expect(baseAsset.rebuildWoodOnly(barkSpec, shared.registry.textures)).toBe(true)
    let woodBarkStyle = ''
    baseAsset.group.traverse(o => {
      if (o instanceof Mesh && o.userData?.role === 'wood') {
        woodBarkStyle = (o.material as Material).userData?.barkStyle ?? ''
      }
    })
    expect(woodBarkStyle).toBe('birch')

    // 2c. Universal painterly color-mass (`shading.colorMass`) works on ANY tree & shrub (NOT locked to meadow-birch!)
    //     and works with ANY leafStyle (e.g. 'painted', 'cloud', 'sakura')!
    const roundBase = presetSpec('broadleaf-round')
    const roundPainted = presetSpec('broadleaf-round')
    roundPainted.shading.leafStyle = 'painted'
    roundPainted.shading.colorMass = 0.90
    const rBaseAsset = buildTree(roundBase, shared.registry.textures)
    const rPaintAsset = buildTree(roundPainted, shared.registry.textures)
    const getPaintedUniform = (root: import('three').Object3D) => {
      let val = -1
      root.traverse(o => {
        if (o instanceof Mesh && o.userData?.role === 'foliage') {
          const u = (o.material as MeshStandardMaterial).userData?.leafUniforms as Record<string, { value: number }> | undefined
          if (u && 'uPaintedLight' in u) val = u.uPaintedLight.value
        }
      })
      return val
    }
    expect(getPaintedUniform(rBaseAsset.group)).toBe(0)
    expect(getPaintedUniform(rPaintAsset.group)).toBeCloseTo(0.90 * 0.86, 2)
    expect(rPaintAsset.stats.triangles).toBeGreaterThan(2000)
    expect(rPaintAsset.stats.triangles).toBeLessThan(30000)
    // Also works on non-painted leafStyle (e.g. 'sakura') when user turns up colorMass!
    const sakuraMass = presetSpec('broadleaf-sakura')
    sakuraMass.shading.colorMass = 0.75
    const sMassAsset = buildTree(sakuraMass, shared.registry.textures)
    expect(getPaintedUniform(sMassAsset.group)).toBeCloseTo(0.75 * 0.86, 2)
    expect(parseTreeSpec(JSON.parse(JSON.stringify(sakuraMass))).shading.colorMass).toBeCloseTo(0.75, 3)
    rBaseAsset.dispose()
    rPaintAsset.dispose()
    sMassAsset.dispose()

    baseAsset.dispose()
    tallAsset.dispose()
    shared.registry.dispose()

    // 3. 3x+ Grass Brush density ceiling (MAX_GRASS_CLUSTERS >= 30000, high-density single stamp & lush meadow fill)
    expect(MAX_GRASS_CLUSTERS).toBeGreaterThanOrEqual(30000)
    const layer = new PaintedGrassLayer()
    const clusters: GrassPaintCluster[] = []
    const hiOpts = defaultGrassBrushOptions()
    hiOpts.radius = 2.0
    hiOpts.density = 120
    hiOpts.minSpacing = 0.06
    const addedOneStroke = layer.paintAt(clusters, -1.6, 1.4, hiOpts, c1.ground, 2026)
    expect(addedOneStroke).toBeGreaterThan(80)

    const addedFill = layer.fillMeadow(clusters, hiOpts, c1.ground, 2400, 9090)
    expect(addedFill).toBeGreaterThan(1500)
    expect(layer.stats().drawCalls).toBeLessThanOrEqual(5)
    layer.dispose()
  })
})
