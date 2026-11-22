import { describe, expect, it } from 'vitest'
import { Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { foliageWind } from '../src/broadleaf/leaf-material'
import { inspectGlbExport, prepareGlbScene } from '../src/export-glb'
import { evaluateTextureGraph } from '../src/texgraph/engine'
import { createNode } from '../src/texgraph/nodes'
import { createTextureLibraryStore } from '../src/texgraph/store'
import { detectGraphAtlasGrid, textureTemplates } from '../src/texgraph/templates'
import { buildTree } from '../src/tree/assemble'
import {
  buildNormalVectorsGeometry, defaultLeafNormalEdit, isCustomNormalActive,
  leafNormalModes, type LeafNormalEditSpec,
} from '../src/tree/leaf-normals'
import { parseTreeSpec, presetSpec } from '../src/tree/spec'

const textures = {
  leaf: new Texture(), needle: new Texture(), drape: new Texture(),
  palm: new Texture(), grass: new Texture(), grassTint: new Texture(), fern: new Texture(),
  flower: new Texture(), blossom: new Texture(),
  sakura: new Texture(), cloud: new Texture(), oak: new Texture(), oakAtlas: new Texture(),
  maple: new Texture(), willow: new Texture(), bush: new Texture(), wildrose: new Texture(),
}

function getMesh(root: { traverse: (cb: (o: unknown) => void) => void }, match: (m: Mesh) => boolean): Mesh | undefined {
  let found: Mesh | undefined
  root.traverse(o => { if (!found && o instanceof Mesh && match(o)) found = o })
  return found
}

describe('GLB 3D Bark Moss Baking & Wind-Animated Wishing Accents', () => {
  it('bakes 3D world-space upward moss into exported GLB wood vertex colors and strips wind attributes cleanly', () => {
    const spec = presetSpec('broadleaf-wishing')
    spec.trunk.barkMoss = 0.78
    spec.trunk.barkRootAO = 0.45
    const tree = buildTree(spec, textures)

    // Verify silk sashes & plaques carry live wind uniforms + vertex wind attributes
    const ribbon = getMesh(tree.group, m => m.name.includes('Ribbon 2'))!
    const plaque = getMesh(tree.group, m => m.name.includes('Plaques'))!
    const tassel = getMesh(tree.group, m => m.name.includes('Tassels'))!
    expect(ribbon).toBeDefined()
    expect(plaque).toBeDefined()
    expect(tassel).toBeDefined()
    expect((ribbon.material as MeshStandardMaterial).userData.windUniforms).toBe(foliageWind)
    expect((plaque.material as MeshStandardMaterial).userData.windUniforms).toBe(foliageWind)
    const rw = ribbon.geometry.getAttribute('windWeight')
    expect(rw).toBeDefined()
    let maxRw = 0
    for (let i = 0; i < rw.count; i++) maxRw = Math.max(maxRw, rw.getX(i))
    expect(maxRw).toBeGreaterThan(0.85)
    expect(plaque.geometry.getAttribute('pivotPos')).toBeDefined()
    expect(tassel.geometry.getAttribute('windWeight')).toBeDefined()

    // Inspect preview reports baked moss wood meshes
    const preview = inspectGlbExport(tree.group, { mode: 'merged', bakeBarkMoss: true })
    expect(preview.mossBakedMeshes).toBeGreaterThanOrEqual(1)

    // Prepare GLB with bakeBarkMoss: true -> upward-facing wood vertices bake greener than downward undersides
    const baked = prepareGlbScene(tree.group, { mode: 'separate', bakeBarkMoss: true })
    const expWood = getMesh(baked, m => m.name === 'Trunk and branches')!
    const norm = expWood.geometry.getAttribute('normal')
    const col = expWood.geometry.getAttribute('color')
    let upGreenness = 0, upCount = 0
    let downGreenness = 0, downCount = 0
    for (let i = 0; i < norm.count; i++) {
      const ny = norm.getY(i)
      const r = col.getX(i)
      const g = col.getY(i)
      if (ny > 0.65) { upGreenness += g - r; upCount++ }
      else if (ny < -0.45) { downGreenness += g - r; downCount++ }
    }
    expect(upCount).toBeGreaterThan(10)
    expect(downCount).toBeGreaterThan(10)
    expect(upGreenness / upCount).toBeGreaterThan(downGreenness / downCount + 0.03)

    // Verify merged-mode GLB ALSO preserves bright non-zero baked vertex colors (no Uint16 double-normalization!)
    const mergedBaked = prepareGlbScene(tree.group, { mode: 'merged', bakeBarkMoss: true })
    const mergedMesh = getMesh(mergedBaked, () => true)!
    const mCol = mergedMesh.geometry.getAttribute('color')
    let avgLum = 0
    for (let i = 0; i < mCol.count; i++) avgLum += (mCol.getX(i) + mCol.getY(i) + mCol.getZ(i)) / 3
    expect(avgLum / mCol.count).toBeGreaterThan(0.15)

    // Verify wind-only attributes & userData are stripped cleanly in GLB export
    const expRibbon = getMesh(baked, m => m.name.includes('Ribbon 2'))!
    const expPlaque = getMesh(baked, m => m.name.includes('Plaques'))!
    expect(expRibbon.geometry.getAttribute('windWeight')).toBeUndefined()
    expect(expPlaque.geometry.getAttribute('pivotPos')).toBeUndefined()
    expect((expRibbon.material as MeshStandardMaterial).userData.windUniforms).toBeUndefined()
    tree.dispose()
  })
})

describe('Arbitrary N x M Texture Atlas Grid & Store Metadata', () => {
  it('bakes leak-free 3x2 and 3x3 custom foliage atlases and persists atlasCols/atlasRows metadata', async () => {
    const baseTpl = textureTemplates.find(t => t.id === 'leaf-stylized')!.build()
    const scatter = baseTpl.nodes.find(n => n.type === 'branch_scatter')!
    scatter.params.atlasCols = 3
    scatter.params.atlasRows = 2

    expect(detectGraphAtlasGrid(baseTpl)).toEqual({ cols: 3, rows: 2 })
    // Legacy atlas2x2 backward compatibility
    const legacyGraph = {
      ...baseTpl,
      nodes: [createNode('branch_scatter', 0, 0, 'sc', { layout: 'oak_rosette', atlas2x2: true })],
    }
    expect(detectGraphAtlasGrid(legacyGraph)).toEqual({ cols: 2, rows: 2 })

    // Verify all 6 cells of a 3x2 atlas have opaque leaf pixels and distinct per-cell variation
    const ev = evaluateTextureGraph(baseTpl, 192)
    const d = ev.output.baseColor.data
    const w = 192, h = 192
    const cellSums: number[] = []
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        let opaque = 0, lumSum = 0
        for (let y = gy * 96; y < (gy + 1) * 96; y++) {
          for (let x = gx * 64; x < (gx + 1) * 64; x++) {
            const o = (y * w + x) * 4
            if (d[o + 3] > 0.4) { opaque++; lumSum += d[o] + d[o + 1] + d[o + 2] }
          }
        }
        expect(opaque).toBeGreaterThan(150)
        cellSums.push(lumSum / opaque)
      }
    }
    expect(Math.max(...cellSums) - Math.min(...cellSums)).toBeGreaterThan(0.05)

    // Store persists atlasCols & atlasRows automatically
    const store = createTextureLibraryStore({ storage: null, apiUrl: null })
    const saved = await store.saveNew({
      name: '三列两行阔叶图集',
      targetSlot: 'leaf',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      graph: baseTpl,
    })
    expect(saved.atlasCols).toBe(3)
    expect(saved.atlasRows).toBe(2)
  })
})

describe('Custom Leaf Normal Editing Engine (leaf-normals.ts)', () => {
  it('keeps default normals untouched, supports all 6 projection modes, local 3D brushes, JSON round-trip & GLB preservation', () => {
    const baseSpec = presetSpec('broadleaf-round')
    expect(isCustomNormalActive(baseSpec.normalEdit)).toBe(false)

    // 1. All 6 modes yield valid exact unit normals on broadleaf & conifer
    for (const mode of leafNormalModes) {
      const s = presetSpec('broadleaf-round')
      s.normalEdit = { ...defaultLeafNormalEdit(), mode, strength: 0.9 }
      const built = buildTree(s, textures)
      const leaves = getMesh(built.group, m => m.name === 'Leaf cards')!
      const nAttr = leaves.geometry.getAttribute('normal')
      for (let i = 0; i < nAttr.count; i += 7) {
        const len = Math.hypot(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i))
        expect(len).toBeCloseTo(1, 3)
      }
      built.dispose()
    }

    // 2. Directional mode pointing straight up (elevation = 90, strength = 1) aims every leaf normal to (0, 1, 0)
    const dirSpec = presetSpec('broadleaf-round')
    dirSpec.normalEdit = { ...defaultLeafNormalEdit(), mode: 'directional', azimuth: 0, elevation: 90, strength: 1 }
    const dirBuilt = buildTree(dirSpec, textures)
    const dirLeaves = getMesh(dirBuilt.group, m => m.name === 'Leaf cards')!
    const dirN = dirLeaves.geometry.getAttribute('normal')
    for (let i = 0; i < dirN.count; i += 5) {
      expect(dirN.getY(i)).toBeGreaterThan(0.995)
    }

    // GLB export preserves sculpted custom normals faithfully!
    const glbPrepared = prepareGlbScene(dirBuilt.group, { mode: 'merged' })
    const glbMesh = getMesh(glbPrepared, () => true)!
    expect(glbMesh.geometry.getAttribute('normal')).toBeDefined()
    dirBuilt.dispose()

    // 3. Radial mode with lowered centerOffsetY (-2.2m) lifts average normal Y upward across the crown
    const hiSpec = presetSpec('broadleaf-round')
    hiSpec.normalEdit = { ...defaultLeafNormalEdit(), mode: 'radial', strength: 1, centerOffsetY: 1.8 }
    const loSpec = presetSpec('broadleaf-round')
    loSpec.normalEdit = { ...defaultLeafNormalEdit(), mode: 'radial', strength: 1, centerOffsetY: -2.2 }
    const avgY = (sp: typeof hiSpec) => {
      const t = buildTree(sp, textures)
      const m = getMesh(t.group, x => x.name === 'Leaf cards')!
      const na = m.geometry.getAttribute('normal')
      let s = 0
      for (let i = 0; i < na.count; i++) s += na.getY(i)
      const res = s / na.count
      t.dispose()
      return res
    }
    expect(avgY(loSpec)).toBeGreaterThan(avgY(hiSpec) + 0.35)

    // 4. Local 3D Normal Brush modifies ONLY vertices inside its sphere radius
    const cleanSpec = presetSpec('broadleaf-round')
    const cleanTree = buildTree(cleanSpec, textures)
    const cleanMesh = getMesh(cleanTree.group, m => m.name === 'Leaf cards')!
    const cleanPos = cleanMesh.geometry.getAttribute('position')
    const cleanNorm = cleanMesh.geometry.getAttribute('normal')
    const probePos = new Vector3(cleanPos.getX(0), cleanPos.getY(0), cleanPos.getZ(0))

    const brushedSpec = presetSpec('broadleaf-round')
    const brushEdit: LeafNormalEditSpec = {
      ...defaultLeafNormalEdit(),
      brushes: [{
        id: 1,
        kind: 'comb',
        center: [probePos.x, probePos.y, probePos.z],
        radius: 0.9,
        strength: 1.0,
        direction: [1, 0, 0],
      }],
    }
    brushedSpec.normalEdit = brushEdit
    // JSON round-trip preserves normalEdit & brushes intact
    const parsed = parseTreeSpec(JSON.parse(JSON.stringify(brushedSpec)))
    expect(parsed.normalEdit?.brushes).toHaveLength(1)
    expect(parsed.normalEdit?.brushes[0].kind).toBe('comb')

    const brushedTree = buildTree(parsed, textures)
    const brushedMesh = getMesh(brushedTree.group, m => m.name === 'Leaf cards')!
    const bNorm = brushedMesh.geometry.getAttribute('normal')
    // Vertex 0 is at exact brush center -> must align tightly to [1, 0, 0]
    expect(bNorm.getX(0)).toBeGreaterThan(0.95)
    // Far-away vertices outside radius 0.9 remain unchanged
    let unchangedFar = 0
    for (let i = 0; i < cleanPos.count; i++) {
      const dist = Math.hypot(cleanPos.getX(i) - probePos.x, cleanPos.getY(i) - probePos.y, cleanPos.getZ(i) - probePos.z)
      if (dist > 1.5) {
        expect(Math.abs(bNorm.getX(i) - cleanNorm.getX(i))).toBeLessThan(1e-4)
        unchangedFar++
      }
    }
    expect(unchangedFar).toBeGreaterThan(50)

    // 5. 3D Normal vector needles builder outputs paired line segments with RGB colors
    const needles = buildNormalVectorsGeometry(brushedTree.group, 300, 0.25)
    expect(needles.getAttribute('position').count).toBeGreaterThan(100)
    expect(needles.getAttribute('color').count).toBe(needles.getAttribute('position').count)
    needles.dispose()
    cleanTree.dispose()
    brushedTree.dispose()
  })
})
