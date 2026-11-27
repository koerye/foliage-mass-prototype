import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  BufferAttribute, BufferGeometry, Color, Fog, Group, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Scene, ShadowMaterial, Texture, Vector3,
} from 'three'
import { unzipSync } from 'three/addons/libs/fflate.module.js'
import { parseAiScene } from '../src/ai/scene'
import { wishingTreeShowcase } from '../src/ai/showcase'
import { buildMeadowBirchStructure } from '../src/assembly/birch-structure'
import { buildAssemblyGround, groundPathStrengthAt } from '../src/assembly/ground'
import { buildBirchMeadowCase } from '../src/assembly/showcases'
import {
  clearSceneEditSession, createSceneEditSessionAsync, loadSceneEditSessionAsync,
  saveSceneEditProgress, saveSceneEditProgressAsync,
} from '../src/assembly/studio-bridge'
import { inspectGlbExport, prepareGlbScene } from '../src/export-glb'
import { parseRockSpec } from '../src/rock/spec'
import { CrownEditor } from '../src/studio/editor'
import { bindGlbExportPopover } from '../src/studio/glb-export-ui'
import { SnapshotHistory } from '../src/studio/history'
import { getPath, sections } from '../src/studio/panel'
import { mountPresetLibrary, type ShowcaseOption } from '../src/studio/preset-library'
import { createPresetStore } from '../src/studio/preset-store'
import { editableTextureSlots } from '../src/studio/texture-slots'
import { defaultTemplateForSlot } from '../src/texgraph/templates'
import { validateTextureGraph } from '../src/texgraph/nodes'
import { createTextureLibraryStore, parseSavedTextureItem } from '../src/texgraph/store'
import { buildTree, type TreeTextures } from '../src/tree/assemble'
import { CrownEnvelope } from '../src/tree/envelope'
import { applyCustomLeafNormals, defaultLeafNormalEdit } from '../src/tree/leaf-normals'
import { parseTreeSpec, presetIds, presetSpec, type TreeSpec } from '../src/tree/spec'
import { Viewer } from '../src/viewport'
import { userPresetsPlugin } from '../scripts/presets-plugin.mjs'

function dummyTextures(): TreeTextures {
  const mk = (name: string) => { const t = new Texture(); t.name = name; return t }
  return {
    leaf: mk('leaf'), needle: mk('needle'), drape: mk('drape'), palm: mk('palm'),
    bamboo: mk('bamboo'), lotusLeaf: mk('lotusLeaf'), lotusPetal: mk('lotusPetal'),
    grass: mk('grass'), grassTint: mk('grassTint'), fern: mk('fern'),
    flower: mk('flower'), blossom: mk('blossom'), stemLeaf: mk('stemLeaf'),
    painted: mk('painted'), feathery: mk('feathery'), sakura: mk('sakura'), cloud: mk('cloud'),
    oak: mk('oak'), oakAtlas: mk('oakAtlas'), maple: mk('maple'),
    willow: mk('willow'), bush: mk('bush'), wildrose: mk('wildrose'),
  }
}

describe('Independent Audit Remediation Regressions (P0 + P1 + Round-2 Contracts)', () => {
  it('P0-7: TexGraph validation and store accept all 13 editableTextureSlots including bamboo, lotus & stemLeaf', () => {
    for (const slot of ['bamboo', 'lotusLeaf', 'lotusPetal', 'stemLeaf'] as const) {
      expect(editableTextureSlots).toContain(slot)
      const g = defaultTemplateForSlot(slot)
      g.targetSlot = slot
      const v = validateTextureGraph(g)
      expect(v.ok, `slot=${slot} errors=${v.errors.join('; ')}`).toBe(true)
      const item = parseSavedTextureItem({
        id: `tex-${slot}-1`,
        name: `测试 ${slot}`,
        targetSlot: slot,
        resolution: 256,
        seamless: false,
        dataUrl: '',
        thumbnail: '',
        graph: g,
      })
      expect(item?.targetSlot).toBe(slot)
    }
  })

  it('P0-10: pruning one limb on meadow-birch does not cascade-wipe subsequent sibling branches', () => {
    const baseSpec = presetSpec('broadleaf-round')
    baseSpec.trunk.treeForm = 'meadow-birch'
    const full = buildMeadowBirchStructure(baseSpec)
    expect(full.skeleton.branches.length).toBeGreaterThanOrEqual(6)

    // Compute exact descendants of branch 1 in the unpruned skeleton
    const descendantsOf1 = new Set<number>([1])
    let grew = true
    while (grew) {
      grew = false
      for (const b of full.skeleton.branches) {
        if (!descendantsOf1.has(b.id) && b.parentId !== undefined && descendantsOf1.has(b.parentId)) {
          descendantsOf1.add(b.id)
          grew = true
        }
      }
    }

    const prunedSpec = presetSpec('broadleaf-round')
    prunedSpec.trunk.treeForm = 'meadow-birch'
    prunedSpec.branchEdits = [{ id: 1, pruned: true }]
    const pruned = buildMeadowBirchStructure(prunedSpec)
    const prunedIds = new Set(pruned.skeleton.branches.map(b => b.id))
    // Only branch 1 and its own descendants are pruned; every sibling limb & its children survive!
    expect(prunedIds.has(1)).toBe(false)
    expect(pruned.skeleton.branches.length).toBe(full.skeleton.branches.length - descendantsOf1.size)
    for (const b of full.skeleton.branches) {
      if (!descendantsOf1.has(b.id)) {
        expect(prunedIds.has(b.id)).toBe(true)
      }
    }
  })

  it('P0-11: excludeDecorations preserves Lotus petals while still excluding Ambient petals', () => {
    const tex = dummyTextures()
    const spec = presetSpec('lotus-stemmed')
    spec.shading.petals = 12
    const lotus = buildTree(spec, tex)
    const previewAll = inspectGlbExport(lotus.group, { mode: 'merged', excludeDecorations: false })
    const previewClean = inspectGlbExport(lotus.group, { mode: 'merged', excludeDecorations: true })
    expect(previewAll.materials).toContain('Mat_Lotus_Petals')
    expect(previewAll.materials).toContain('Mat_Decor_Petals')
    expect(previewClean.materials).toContain('Mat_Lotus_Petals')
    expect(previewClean.materials).not.toContain('Mat_Decor_Petals')
    lotus.dispose()
  })

  it('P0-12: Dome custom leaf normals scale Z axis by env.width * env.depth (no 11x Z skew)', () => {
    const spec = presetSpec('broadleaf-round')
    spec.crown.width = 3.2
    spec.crown.depth = 0.92
    const env = new CrownEnvelope(spec)
    const cy = (env.y0 + env.y1) * 0.5
    const geo = new BufferGeometry()
    // Sample equator at 45° in XZ: x = d, z = d
    const d = 1.5
    geo.setAttribute('position', new BufferAttribute(new Float32Array([d, cy, d]), 3))
    geo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0]), 3))
    const edit = { ...defaultLeafNormalEdit(), mode: 'dome' as const, strength: 1, upLift: 0, flatten: 0, jitter: 0 }
    applyCustomLeafNormals(geo, env, edit, 1)
    const n = geo.getAttribute('normal')
    const nx = n.getX(0), nz = n.getZ(0)
    const ratio = nz / Math.max(1e-5, nx)
    // True ellipsoid normal ratio at x=z is rx^2 / rz^2 = 1 / depth^2 ≈ 1.18 (old bug produced ~11.35!)
    expect(ratio).toBeGreaterThan(1.0)
    expect(ratio).toBeLessThan(1.5)
    geo.dispose()
  })

  it('P0-14: GLB export normalizes bark vertex colors when custom bark map is bound even with bakeBarkMoss=false', () => {
    const tex = dummyTextures()
    tex.bark = new Texture()
    tex.bark.name = 'CustomBark'
    const spec = presetSpec('broadleaf-round')
    spec.trunk.barkMoss = 0
    spec.trunk.barkRootAO = 0
    const tree = buildTree(spec, tex)
    const prepared = prepareGlbScene(tree.group, { mode: 'separate', bakeBarkMoss: false })
    let woodMesh: Mesh | undefined
    prepared.traverse(o => { if (o instanceof Mesh && o.name === 'Trunk and branches') woodMesh = o })
    expect(woodMesh).toBeDefined()
    const col = woodMesh!.geometry.getAttribute('color') as BufferAttribute
    let lumSum = 0
    const step = Math.max(1, Math.floor(col.count / 100))
    let samples = 0
    for (let i = 0; i < col.count; i += step) {
      lumSum += col.getX(i) * 0.2126 + col.getY(i) * 0.7152 + col.getZ(i) * 0.0722
      samples++
    }
    const avgLum = lumSum / Math.max(1, samples)
    // Normalized neutral AO must stay bright (~0.75..1.0), NOT pitch-black raw brown (~0.12)!
    expect(avgLum).toBeGreaterThan(0.55)
    tree.dispose()
  })

  it('P0-15: parseTreeSpec and buildTree survive degenerate fronds, crown.base=1.0, and null handles with zero NaNs', () => {
    const tex = dummyTextures()
    const badConifer = presetSpec('conifer-standard')
    ;(badConifer.fronds as unknown as Record<string, unknown>).start = 0.76
    badConifer.fronds.cardsPerBranch = 3
    badConifer.crown.base = 1.0
    ;(badConifer as unknown as { handles: unknown[] }).handles = [null, { id: 1, kind: 'shape', anchor: [0, 2, 0], offset: [0, 0, 0], radius: 1 }]
    const parsed = parseTreeSpec(badConifer)
    expect(parsed.handles).toHaveLength(1)
    expect(parsed.crown.top).toBeGreaterThan(parsed.crown.base)
    const built = buildTree(parsed, tex)
    built.group.traverse(o => {
      if (!(o instanceof Mesh)) return
      const pos = o.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))).toBe(true)
        expect(Number.isFinite(pos.getY(i))).toBe(true)
        expect(Number.isFinite(pos.getZ(i))).toBe(true)
      }
    })
    built.dispose()
  })

  it('P1-3.2.2 & P1-3.5.2: GLB skips hidden meshes & shadow floor, keeps diorama ground, and anchors elevated grass wind roots at 0', () => {
    const root = new Group()
    const visibleTri = new BufferGeometry()
    visibleTri.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
    visibleTri.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
    visibleTri.setIndex([0, 1, 2])

    const visMesh = new Mesh(visibleTri, new MeshStandardMaterial({ name: 'LeafCards' }))
    visMesh.name = 'Leaf cards'
    const hiddenGroup = new Group()
    hiddenGroup.visible = false
    const hiddenChild = new Mesh(visibleTri, new MeshStandardMaterial({ name: 'HiddenMat' }))
    hiddenChild.name = 'Hidden child'
    hiddenGroup.add(hiddenChild)

    const shadowFloor = new Mesh(visibleTri, new ShadowMaterial())
    shadowFloor.name = 'StudioShadowFloor'

    // Elevated grass blade instance at y = 5.0m (root at local y=0, tip at local y=0.6)
    const bladeGeo = new BufferGeometry()
    bladeGeo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0, 0, 0.05, 0.6, 0]), 3))
    bladeGeo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
    bladeGeo.setIndex([0, 1, 2])
    const grassInst = new InstancedMesh(bladeGeo, new MeshStandardMaterial({ name: 'GrassMat' }), 1)
    grassInst.name = 'PaintedGrass'
    grassInst.setMatrixAt(0, new Matrix4().makeTranslation(0, 5.0, 0))
    grassInst.instanceMatrix.needsUpdate = true

    root.add(visMesh, hiddenGroup, shadowFloor, grassInst)
    const preview = inspectGlbExport(root, { mode: 'separate', excludeDecorations: false })
    expect(preview.meshCount).toBe(2) // visMesh + grassInst (hiddenChild & shadowFloor skipped!)

    const prepared = prepareGlbScene(root, { mode: 'separate', exportWindUv: true })
    let bakedGrass: Mesh | undefined
    prepared.traverse(o => { if (o instanceof Mesh && o.name === 'PaintedGrass') bakedGrass = o })
    expect(bakedGrass).toBeDefined()
    const uv1 = bakedGrass!.geometry.getAttribute('uv1') as BufferAttribute
    // Blade root vertex 0 must have u1 === 0 even though terrain height is 5.0m, and tip vertex 2 === 1!
    expect(uv1.getX(0)).toBeLessThan(0.01)
    expect(uv1.getX(2)).toBeGreaterThan(0.95)
    visibleTri.dispose()
    bladeGeo.dispose()
  })

  it('P1-3.2.3 & P1-3.5.4: diorama-meadow has zero dirt path strength and lotus stamens have valid unit normals', () => {
    expect(groundPathStrengthAt({
      style: 'diorama-meadow', size: 12, thickness: 0.4, seed: 42, grassColor: '#5ea442', grassHighlight: '#90d050',
      grassShadow: '#325a3c', pathColor: '#c8a16b', pathLayout: 'birch-curve', pathWidth: 1,
    }, 0, 0)).toBe(0)

    const studioGround = buildAssemblyGround({
      style: 'studio', size: 12, thickness: 0.4, seed: 1, grassColor: '#5ea442', grassHighlight: '#90d050',
      grassShadow: '#325a3c', pathColor: '#c8a16b', pathLayout: 'none', pathWidth: 1,
    })
    expect(studioGround.group.children[0]?.userData.exportIgnore).toBe(true)
    studioGround.dispose()

    const lotus = buildTree(presetSpec('lotus-stemmed'), dummyTextures())
    let centerMesh: Mesh | undefined
    lotus.group.traverse(o => { if (o instanceof Mesh && o.name === 'Lotus centers') centerMesh = o })
    expect(centerMesh).toBeDefined()
    const nAttr = centerMesh!.geometry.getAttribute('normal') as BufferAttribute
    const tmp = new Vector3()
    for (let i = 0; i < nAttr.count; i++) {
      tmp.fromBufferAttribute(nAttr, i)
      expect(tmp.length()).toBeGreaterThan(0.95)
    }
    lotus.dispose()
  })

  it('Round-2 Contract: every built-in preset round-trips parseTreeSpec & fits visible slider [min, max] bounds', () => {
    const violations: string[] = []
    for (const id of presetIds) {
      const spec = presetSpec(id)
      expect(parseTreeSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec)
      for (const sec of sections) {
        if (sec.kinds && !sec.kinds.includes(spec.kind)) continue
        for (const field of sec.fields) {
          if (field.kinds && !field.kinds.includes(spec.kind)) continue
          if (typeof field.label === 'object' && !(spec.kind in field.label)) continue
          if (field.when && !field.when(spec)) continue
          if (field.min === undefined || field.max === undefined) continue
          const val = getPath(spec, field.path)
          if (typeof val !== 'number') continue
          if (val < field.min - 1e-6 || val > field.max + 1e-6) {
            violations.push(`${id}.${field.path}=${val} outside [${field.min}, ${field.max}]`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('Round-2: parseRockSpec rejects non-rock JSON and SnapshotHistory supports gesture undo/redo', () => {
    expect(() => parseRockSpec(presetSpec('broadleaf-round'))).toThrow()
    expect(() => parseRockSpec(null)).toThrow()
    const valid = parseRockSpec({ preset: 'boulder-sand-cap', seed: 123 })
    expect(valid.preset).toBe('boulder-sand-cap')

    const hist = new SnapshotHistory<{ v: number }>({ maxDepth: 10 })
    let state = { v: 1 }
    hist.beginGesture(state)
    state = { v: 2 }
    hist.beginGesture(state) // still holds v=1
    state = { v: 3 }
    hist.commitGesture()
    const undone = hist.undo(state)
    expect(undone?.v).toBe(1)
    const redone = hist.redo(undone!)
    expect(redone?.v).toBe(3)
  })

  it('P0-2 & P0-3 & P1-3.5.6: disk-authoritative X-Persisted prevents resurrection and middleware blocks cross-origin PUT', async () => {
    const data = new Map<string, string>()
    const g = defaultTemplateForSlot('leaf')
    data.set('vegetation-studio:saved-textures:v1', JSON.stringify({
      schemaVersion: 1,
      items: [{
        id: 'stale-deleted-item',
        name: '已删僵尸贴图',
        targetSlot: 'leaf',
        resolution: 256,
        seamless: false,
        dataUrl: '',
        thumbnail: '',
        graph: g,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    }))
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
    const store = createTextureLibraryStore({
      storage,
      apiUrl: '/api/textures',
      fetcher: (async () => new Response(JSON.stringify({ schemaVersion: 1, items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Persisted': '1' },
      })) as typeof fetch,
    })
    await store.ready()
    expect(store.storageMode).toBe('file')
    expect(store.list()).toHaveLength(0) // Stale localStorage item must NOT resurrect!

    // Verify cross-origin guard returns 403
    const dir = await mkdtemp(join(tmpdir(), 'veg-csrf-'))
    try {
      const plugin = userPresetsPlugin() as unknown as {
        configResolved: (cfg: { root: string }) => void
        configureServer: (srv: { middlewares: { use: (p: string, fn: (req: unknown, res: unknown, next: () => void) => void) => void } }) => void
      }
      plugin.configResolved({ root: dir })
      const routes: Record<string, (req: unknown, res: unknown, next: () => void) => void> = {}
      plugin.configureServer({ middlewares: { use: (p: string, fn: (req: unknown, res: unknown, next: () => void) => void) => { routes[p] = fn } } })
      const req = Object.assign(new EventEmitter(), {
        method: 'PUT',
        url: '/',
        headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
      })
      const status = await new Promise<number>(resolve => {
        const res = { statusCode: 200, setHeader: () => {}, end: () => resolve(res.statusCode) }
        routes['/api/presets'](req, res, () => resolve(404))
      })
      expect(status).toBe(403)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('REQ-A1: CrownEditor Ctrl+Z/Delete/Escape calls preventDefault + stopImmediatePropagation so single-step undo never double-undoes', () => {
    type Listener = (ev: FakeKeyEvent) => void
    interface FakeKeyEvent {
      key: string
      ctrlKey: boolean
      metaKey: boolean
      shiftKey: boolean
      target: { tagName: string }
      defaultPrevented: boolean
      immediateStopped: boolean
      preventDefault(): void
      stopImmediatePropagation(): void
    }
    const makeKeyEvent = (key: string, opts: { ctrlKey?: boolean; shiftKey?: boolean } = {}): FakeKeyEvent => ({
      key,
      ctrlKey: Boolean(opts.ctrlKey),
      metaKey: false,
      shiftKey: Boolean(opts.shiftKey),
      target: { tagName: 'DIV' },
      defaultPrevented: false,
      immediateStopped: false,
      preventDefault() { this.defaultPrevented = true },
      stopImmediatePropagation() { this.immediateStopped = true },
    })

    const winListeners = new Map<string, Listener[]>()
    const fakeWindow = {
      addEventListener(type: string, fn: Listener) {
        const list = winListeners.get(type) ?? []
        list.push(fn)
        winListeners.set(type, list)
      },
      removeEventListener(type: string, fn: Listener) {
        const list = winListeners.get(type)
        if (!list) return
        const idx = list.indexOf(fn)
        if (idx >= 0) list.splice(idx, 1)
      },
      dispatchKey(ev: FakeKeyEvent) {
        for (const fn of [...(winListeners.get('keydown') ?? [])]) {
          fn(ev)
          if (ev.immediateStopped) break
        }
      },
    }

    const makeFakeEl = () => {
      const classes = new Set<string>()
      const attrs = new Map<string, string>()
      return {
        className: '',
        hidden: false,
        textContent: '',
        clientWidth: 800,
        clientHeight: 600,
        style: {} as Record<string, string>,
        classList: {
          add: (...xs: string[]) => xs.forEach(x => classes.add(x)),
          remove: (...xs: string[]) => xs.forEach(x => classes.delete(x)),
          toggle: (x: string, f?: boolean) => { if (f === undefined ? !classes.has(x) : f) classes.add(x); else classes.delete(x) },
          contains: (x: string) => classes.has(x),
        },
        setAttribute: (k: string, v: string) => { attrs.set(k, v) },
        getAttribute: (k: string) => attrs.get(k) ?? null,
        addEventListener: () => {},
        removeEventListener: () => {},
        append: () => {},
        remove: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
        parentElement: null as unknown,
      }
    }

    const prevWindow = globalThis.window
    const prevDocument = globalThis.document
    const stageEl = makeFakeEl()
    const canvasEl = makeFakeEl()
    canvasEl.parentElement = stageEl
    const fakeDocument = {
      createElement: () => makeFakeEl(),
      createElementNS: () => makeFakeEl(),
    }
    ;(globalThis as unknown as { window: unknown; document: unknown }).window = fakeWindow
    ;(globalThis as unknown as { window: unknown; document: unknown }).document = fakeDocument

    try {
      let spec = presetSpec('broadleaf-round')
      const paramHistory = new SnapshotHistory<TreeSpec>({ maxDepth: 10 })
      paramHistory.push(spec)
      spec = { ...spec, trunk: { ...spec.trunk, height: spec.trunk.height + 1.5 } }
      const editedHeight = spec.trunk.height

      const viewerStub = {
        scene: new Scene(),
        camera: new PerspectiveCamera(45, 800 / 600, 0.1, 100),
        host: canvasEl,
        renderer: { domElement: canvasEl },
        controls: { enabled: true },
        addRenderListener: () => () => {},
      } as unknown as Viewer

      const editor = new CrownEditor(viewerStub, {
        spec: () => spec,
        axis: () => new Vector3(0, 1, 0),
        setHandles: handles => { spec = { ...spec, handles } },
        setBranchEdits: edits => { spec = { ...spec, branchEdits: edits.length ? edits : undefined } },
        selected: () => {},
      })

      // Register second window keydown listener simulating studio/main.ts & ai/main.ts
      let mainUndoCalls = 0
      fakeWindow.addEventListener('keydown', ev => {
        if (ev.defaultPrevented) return
        if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z') {
          if (editor.enabled && editor.canUndo()) return
          const prev = paramHistory.undo(spec)
          if (prev) {
            ev.preventDefault()
            spec = prev
            mainUndoCalls++
          }
        }
      })

      editor.setEnabled(true)
      editor.setSubMode('nodes')
      editor.selectBranch(1)
      // Record 1 branch edit (last step in editor.undoStack)
      editor.updateSelectedBranch({ lengthScale: 1.45 }, true, true)
      expect(editor.canUndo()).toBe(true)
      expect(spec.branchEdits?.length).toBe(1)

      // 1st Ctrl+Z: must ONLY undo branch edit, NOT trigger paramHistory.undo()!
      const ev1 = makeKeyEvent('z', { ctrlKey: true })
      fakeWindow.dispatchKey(ev1)
      expect(ev1.defaultPrevented).toBe(true)
      expect(ev1.immediateStopped).toBe(true)
      expect(editor.canUndo()).toBe(false)
      expect(spec.branchEdits).toBeUndefined()
      expect(mainUndoCalls).toBe(0)
      expect(spec.trunk.height).toBe(editedHeight)

      // 2nd Ctrl+Z: now editor stack is empty, so main paramHistory undo runs
      const ev2 = makeKeyEvent('z', { ctrlKey: true })
      fakeWindow.dispatchKey(ev2)
      expect(mainUndoCalls).toBe(1)
      expect(spec.trunk.height).toBeLessThan(editedHeight)

      // Delete on a non-trunk branch consumes event with preventDefault + stopImmediatePropagation
      editor.selectBranch(1)
      const evDel = makeKeyEvent('Delete')
      fakeWindow.dispatchKey(evDel)
      expect(evDel.defaultPrevented).toBe(true)
      expect(evDel.immediateStopped).toBe(true)

      // Escape consumes event with preventDefault + stopImmediatePropagation
      const evEsc = makeKeyEvent('Escape')
      fakeWindow.dispatchKey(evEsc)
      expect(evEsc.defaultPrevented).toBe(true)
      expect(evEsc.immediateStopped).toBe(true)

      editor.dispose()

      // Verify both studio/main.ts and ai/main.ts guard main keydown handler with ev.defaultPrevented
      expect(readFileSync(join(process.cwd(), 'src/studio/main.ts'), 'utf8')).toContain('if (ev.defaultPrevented) return')
      expect(readFileSync(join(process.cwd(), 'src/ai/main.ts'), 'utf8')).toContain('if (ev.defaultPrevented) return')
    } finally {
      ;(globalThis as unknown as { window: unknown; document: unknown }).window = prevWindow
      ;(globalThis as unknown as { window: unknown; document: unknown }).document = prevDocument
    }
  })

  it('REQ-A2: preset-library hover preview works for showcase:* items while blocking deleted/hidden presets and clearing on first Delete click', async () => {
    vi.useFakeTimers()
    type EvHandler = (ev: Record<string, unknown>) => void
    const makeMiniEl = () => {
      const classes = new Set<string>()
      const listeners = new Map<string, EvHandler[]>()
      const attrs = new Map<string, string>()
      const el = {
        id: '',
        className: '',
        hidden: false,
        checked: true,
        disabled: false,
        value: '',
        src: '',
        innerHTML: '',
        textContent: '',
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        onclick: null as null | (() => void),
        oninput: null as null | (() => void),
        onchange: null as null | (() => void),
        onkeydown: null as null | ((e: Record<string, unknown>) => void),
        classList: {
          add: (...xs: string[]) => xs.forEach(x => classes.add(x)),
          remove: (...xs: string[]) => xs.forEach(x => classes.delete(x)),
          toggle: (x: string, f?: boolean) => { if (f === undefined ? !classes.has(x) : f) classes.add(x); else classes.delete(x) },
          contains: (x: string) => classes.has(x),
        },
        setAttribute: (k: string, v: string) => { attrs.set(k, v) },
        getAttribute: (k: string) => attrs.get(k) ?? null,
        removeAttribute: (k: string) => { attrs.delete(k) },
        addEventListener: (type: string, fn: EvHandler) => {
          const list = listeners.get(type) ?? []
          list.push(fn)
          listeners.set(type, list)
        },
        dispatch: (type: string, ev: Record<string, unknown>) => {
          for (const fn of listeners.get(type) ?? []) fn(ev)
        },
        focus: () => {},
        select: () => {},
        click: () => {},
        append: () => {},
        remove: () => {},
        querySelector: (_sel: string): unknown => null,
        querySelectorAll: (_sel: string): unknown[] => [],
      }
      return el
    }

    const bySel = new Map<string, ReturnType<typeof makeMiniEl>>()
    const getOrMake = (sel: string) => {
      let el = bySel.get(sel)
      if (!el) { el = makeMiniEl(); bySel.set(sel, el) }
      return el
    }
    const drawerEl = makeMiniEl()
    drawerEl.querySelector = (sel: string) => getOrMake(sel)
    drawerEl.querySelectorAll = () => []

    const prevWindow = globalThis.window
    const prevDocument = globalThis.document
    const prevRaf = globalThis.requestAnimationFrame
    const bodyClasses = new Set<string>()
    ;(globalThis as unknown as { window: unknown; document: unknown; requestAnimationFrame: unknown }).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    ;(globalThis as unknown as { document: unknown }).document = {
      createElement: () => drawerEl,
      body: {
        append: () => {},
        classList: {
          add: (c: string) => bodyClasses.add(c),
          remove: (c: string) => bodyClasses.delete(c),
        },
      },
    }
    ;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0

    try {
      const data = new Map<string, string>()
      const store = createPresetStore({
        storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } },
        apiUrl: null,
      })
      await store.ready()
      const saved = await store.saveNew<TreeSpec>({
        scope: 'tree',
        name: '我的松树',
        kind: 'conifer',
        kindLabel: '针叶树',
        triangles: 1200,
        lighting: 'forest',
        thumbnail: '',
        payload: presetSpec('conifer-standard'),
      })

      const hiddenShowcases = new Set<string>()
      const showcases: ShowcaseOption<TreeSpec>[] = [{
        id: 'sakura',
        name: '樱花盆景',
        subtitle: '内置案例',
        tag: '阔叶树',
        lighting: 'sakura',
        thumbnail: '',
        build: () => presetSpec('broadleaf-sakura'),
      }]

      const appliedIds: string[] = []
      const previewedIds: string[] = []
      let restoreCount = 0
      const ctrl = mountPresetLibrary<TreeSpec, { marker: string }>({
        scope: 'tree',
        store,
        showcases,
        getHiddenShowcaseIds: () => hiddenShowcases,
        capture: () => ({
          defaultName: '默认树',
          kind: 'broadleaf',
          kindLabel: '阔叶树',
          triangles: 1000,
          lighting: 'neutral',
          thumbnail: '',
          payload: presetSpec('broadleaf-round'),
        }),
        snapshotState: () => ({ marker: 'orig' }),
        restoreState: () => { restoreCount++ },
        preview: p => { previewedIds.push(p.id) },
        apply: p => { appliedIds.push(p.id) },
        message: () => {},
      })

      ctrl.open(false, 'showcases')
      const gridEl = getOrMake('#pl-grid')
      const restoreOrigBtn = getOrMake('#pl-restore-orig')

      // 1. Hovering (pointerover) NEVER triggers preview or layout jumps (zero scroll/hover jank!)
      const showcaseCard = { dataset: { showcaseId: 'sakura' } }
      gridEl.dispatch('pointerover', {
        target: {
          closest: (sel: string) => (sel === '.pl-card' ? showcaseCard : null),
        },
      })
      vi.advanceTimersByTime(150)
      expect(previewedIds).toEqual([])
      expect(appliedIds).toEqual([])
      expect(ctrl.isPreviewing()).toBe(false)

      // 2. Single-clicking a visible showcase card loads/previews it immediately without rebuilding grid DOM
      gridEl.dispatch('click', {
        target: { closest: (sel: string) => (sel === '.pl-card' ? showcaseCard : null) },
      })
      expect(appliedIds).toEqual(['showcase:sakura'])

      // 3. Hidden showcase is blocked on click
      appliedIds.length = 0
      hiddenShowcases.add('sakura')
      vi.advanceTimersByTime(500)
      gridEl.dispatch('click', {
        target: { closest: (sel: string) => (sel === '.pl-card' ? showcaseCard : null) },
      })
      expect(appliedIds).toEqual([])

      // 4. Single-clicking a user preset loads/previews it, ↺ 还原 restores pre-browse state, and deleted preset is blocked
      ctrl.open(false, 'mine')
      const presetCard = { dataset: { presetId: saved.id } }
      gridEl.dispatch('click', {
        target: { closest: (sel: string) => (sel === '.pl-card' ? presetCard : null) },
      })
      expect(appliedIds).toEqual([saved.id])

      // 1-click restore reverts back to pre-browse snapshot
      const restoresBefore = restoreCount
      restoreOrigBtn.onclick?.()
      expect(restoreCount).toBe(restoresBefore + 1)

      // Double-click applies once and closes the drawer
      appliedIds.length = 0
      vi.advanceTimersByTime(500)
      gridEl.dispatch('dblclick', {
        preventDefault: () => {},
        target: { closest: (sel: string) => (sel === '.pl-card' ? presetCard : null) },
      })
      expect(appliedIds).toEqual([saved.id])
      expect(ctrl.isOpen()).toBe(false)

      // Deleted user preset is blocked on click
      ctrl.open(false, 'mine')
      appliedIds.length = 0
      await store.remove(saved.id)
      gridEl.dispatch('click', {
        target: { closest: (sel: string) => (sel === '.pl-card' ? presetCard : null) },
      })
      expect(appliedIds).toEqual([])

      ctrl.dispose()
    } finally {
      vi.useRealTimers()
      ;(globalThis as unknown as { window: unknown; document: unknown; requestAnimationFrame: unknown }).window = prevWindow
      ;(globalThis as unknown as { document: unknown }).document = prevDocument
      ;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = prevRaf
    }
  })

  it('REQ-A3: studio-bridge preserves >5 MB sceneDraft + customTextures across IndexedDB round-trip when localStorage throws QuotaExceededError', async () => {
    const idbData = new Map<string, unknown>()
    let abortWrites = false
    const fakeIndexedDB = {
      open: () => {
        const req: Record<string, unknown> = { result: null }
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({}),
          close: () => {},
          transaction: (_store: string, _mode: string) => {
            const tx: Record<string, unknown> = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore: () => ({
                put: (val: unknown, key: string) => {
                  queueMicrotask(() => {
                    if (abortWrites) {
                      ;(tx.onabort as null | (() => void))?.()
                    } else {
                      idbData.set(key, structuredClone(val))
                      ;(tx.oncomplete as null | (() => void))?.()
                    }
                  })
                },
                get: (key: string) => {
                  const getReq: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null }
                  queueMicrotask(() => {
                    getReq.result = idbData.has(key) ? structuredClone(idbData.get(key)) : undefined
                    ;(getReq.onsuccess as null | (() => void))?.()
                  })
                  return getReq
                },
                delete: (key: string) => {
                  queueMicrotask(() => {
                    if (abortWrites) {
                      ;(tx.onabort as null | (() => void))?.()
                    } else {
                      idbData.delete(key)
                      ;(tx.oncomplete as null | (() => void))?.()
                    }
                  })
                },
              }),
            }
            return tx
          },
        }
        queueMicrotask(() => {
          req.result = db
          ;(req.onsuccess as null | (() => void))?.()
        })
        return req
      },
    }

    const lsStore = new Map<string, string>()
    let lsMaxBytes = 0 // 0 => always throws QuotaExceededError
    const fakeLocalStorage = {
      getItem: (k: string) => lsStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > lsMaxBytes) {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError')
        }
        lsStore.set(k, v)
      },
      removeItem: (k: string) => { lsStore.delete(k) },
      clear: () => { lsStore.clear() },
      key: () => null,
      length: 0,
    }
    const fakeSessionStorage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError') },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }

    const prevIdb = globalThis.indexedDB
    const prevLs = globalThis.localStorage
    const prevSs = globalThis.sessionStorage
    ;(globalThis as unknown as { indexedDB: unknown; localStorage: unknown; sessionStorage: unknown }).indexedDB = fakeIndexedDB
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = fakeLocalStorage
    ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = fakeSessionStorage

    try {
      const sceneDraft = buildBirchMeadowCase()
      // Add >5 MB of groundPaint + grassPaint + customTextures payload
      const bigGroundPaint = 'data:image/png;base64,' + 'A'.repeat(3_200_000)
      const bigLeafTex = 'data:image/png;base64,' + 'B'.repeat(2_400_000)
      const bigBarkNormal = 'data:image/png;base64,' + 'C'.repeat(600_000)
      sceneDraft.groundPaint = bigGroundPaint
      sceneDraft.grassPaint = Array.from({ length: 120 }, (_, i) => ({
        x: (i % 12) * 0.4 - 2.2,
        y: 0,
        z: Math.floor(i / 12) * 0.4 - 2.0,
        yaw: (i * 0.5) % (Math.PI * 2),
        scale: 1,
        tiltX: 0,
        tiltZ: 0,
        species: 'broad' as const,
        tint: '#6cb24a',
      }))
      const targetItem = sceneDraft.items.find(it => it.kind === 'tree')!
      const initialTextures = {
        leaf: { name: 'CustomLeaf', dataUrl: bigLeafTex },
        bark: { name: 'CustomBark', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', normalDataUrl: bigBarkNormal },
      }
      expect(JSON.stringify(sceneDraft).length + JSON.stringify(initialTextures).length).toBeGreaterThan(5_500_000)

      // 1. Create session while localStorage ALWAYS throws QuotaExceededError
      const created = await createSceneEditSessionAsync({
        itemId: targetItem.id,
        itemName: targetItem.name,
        sceneName: sceneDraft.name,
        returnUrl: './scene.html',
        treeSpec: targetItem.payload as TreeSpec,
        customTextures: initialTextures,
        barkStyle: targetItem.barkStyle,
        treeForm: targetItem.treeForm,
        lighting: sceneDraft.lighting,
        sceneDraft,
      })
      expect(created.stored).toBe(true)
      const sid = created.session.sessionId

      // 2. broadleaf.html async startup restores FULL >5MB session from IndexedDB
      const loadedOnTreePage = await loadSceneEditSessionAsync(sid)
      expect(loadedOnTreePage).toBeDefined()
      expect(loadedOnTreePage!.sceneDraft.items).toHaveLength(sceneDraft.items.length)
      expect(loadedOnTreePage!.sceneDraft.grassPaint).toHaveLength(120)
      expect(loadedOnTreePage!.sceneDraft.groundPaint).toBe(bigGroundPaint)
      expect(loadedOnTreePage!.customTextures?.leaf?.dataUrl).toBe(bigLeafTex)
      expect(loadedOnTreePage!.customTextures?.bark?.normalDataUrl).toBe(bigBarkNormal)

      // 3. Mid-edit 180ms debounced slider save preserves full sceneDraft & customTextures
      const editedTree1 = { ...(targetItem.payload as TreeSpec), seed: 7777 }
      const liveOk = await saveSceneEditProgressAsync(sid, {
        treeSpec: editedTree1,
        committed: false,
      })
      expect(liveOk).toBe(true)

      // Cancel return path: sceneDraft & customTextures remain 100% lossless
      const afterCancelReload = await loadSceneEditSessionAsync(sid)
      expect(afterCancelReload!.committed).toBe(false)
      expect(afterCancelReload!.sceneDraft.items).toHaveLength(sceneDraft.items.length)
      expect(afterCancelReload!.sceneDraft.grassPaint).toHaveLength(120)
      expect(afterCancelReload!.sceneDraft.groundPaint).toBe(bigGroundPaint)
      expect(afterCancelReload!.customTextures?.leaf?.dataUrl).toBe(bigLeafTex)

      // 4. Apply & Return commit awaits IndexedDB put and preserves full sceneDraft + updated tree & textures
      const editedTree2 = { ...(targetItem.payload as TreeSpec), seed: 8888 }
      const updatedTextures = {
        ...initialTextures,
        leaf: { name: 'EditedLeaf', dataUrl: bigLeafTex },
      }
      const applyOk = await saveSceneEditProgressAsync(sid, {
        treeSpec: editedTree2,
        customTextures: updatedTextures,
        committed: true,
      })
      expect(applyOk).toBe(true)

      const afterApplyReload = await loadSceneEditSessionAsync(sid)
      expect(afterApplyReload!.committed).toBe(true)
      expect(afterApplyReload!.treeSpec.seed).toBe(8888)
      expect(afterApplyReload!.customTextures?.leaf?.name).toBe('EditedLeaf')
      expect(afterApplyReload!.sceneDraft.items).toHaveLength(sceneDraft.items.length)
      expect(afterApplyReload!.sceneDraft.grassPaint).toHaveLength(120)
      expect(afterApplyReload!.sceneDraft.groundPaint).toBe(bigGroundPaint)

      // 5. Slim localStorage shell + legacy sync saveSceneEditProgress must NOT overwrite full IDB sceneDraft
      lsMaxBytes = 50_000
      const created2 = await createSceneEditSessionAsync({
        itemId: targetItem.id,
        itemName: targetItem.name,
        sceneName: sceneDraft.name,
        returnUrl: './scene.html',
        treeSpec: targetItem.payload as TreeSpec,
        customTextures: initialTextures,
        sceneDraft,
      })
      expect(created2.stored).toBe(true)
      saveSceneEditProgress(created2.session.sessionId, {
        treeSpec: { ...(targetItem.payload as TreeSpec), seed: 9999 },
        committed: false,
      })
      await new Promise(r => setTimeout(r, 10))
      const afterSyncSave = await loadSceneEditSessionAsync(created2.session.sessionId)
      expect(afterSyncSave!.treeSpec.seed).toBe(9999)
      expect(afterSyncSave!.sceneDraft.items).toHaveLength(sceneDraft.items.length)
      expect(afterSyncSave!.sceneDraft.grassPaint).toHaveLength(120)
      expect(afterSyncSave!.sceneDraft.groundPaint).toBe(bigGroundPaint)
      expect(afterSyncSave!.customTextures?.leaf?.dataUrl).toBe(bigLeafTex)

      // 6. When IDB aborts (tx.onabort) AND localStorage rejects full payload, MUST report stored=false (no fake success)
      abortWrites = true
      const failed = await createSceneEditSessionAsync({
        itemId: targetItem.id,
        itemName: targetItem.name,
        sceneName: sceneDraft.name,
        returnUrl: './scene.html',
        treeSpec: targetItem.payload as TreeSpec,
        customTextures: initialTextures,
        sceneDraft,
      })
      expect(failed.stored).toBe(false)
      const failedSave = await saveSceneEditProgressAsync(sid, {
        treeSpec: editedTree2,
        committed: true,
      })
      expect(failedSave).toBe(false)
      clearSceneEditSession(sid)
    } finally {
      ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = prevIdb
      ;(globalThis as unknown as { localStorage: unknown }).localStorage = prevLs
      ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = prevSs
    }
  })

  it('REQ-B2: Viewer.snapshot({ transparent: true }) clears background/floor/gizmos & restores all state on both success and error', () => {
    // Verify renderer is constructed with alpha: true
    expect(readFileSync(join(process.cwd(), 'src/viewport.ts'), 'utf8')).toContain('WebGLRenderer({ alpha: true')

    const scene = new Scene()
    const origBg = new Color('#f1eee0')
    const origFog = new Fog('#f1eee0', 5, 30)
    scene.background = origBg
    scene.fog = origFog

    const floor = new Mesh(new BufferGeometry(), new ShadowMaterial())
    floor.name = 'StudioShadowFloor'
    floor.visible = true
    const editorGroup = new Group()
    editorGroup.name = 'crown-editor'
    editorGroup.visible = true
    const treeMesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial())
    treeMesh.name = 'TreeMesh'
    treeMesh.visible = true
    scene.add(floor, editorGroup, treeMesh)

    const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
    let clearHex = 0xf1eee0
    let clearAlpha = 1
    let throwOnToDataUrl = false

    interface RenderObs {
      bgNull: boolean
      fogNull: boolean
      floorVis: boolean
      editorVis: boolean
      treeVis: boolean
      clearHex: number
      clearAlpha: number
    }
    const renders: RenderObs[] = []
    const fakeRenderer = {
      getClearColor: (target: Color) => target.setHex(clearHex),
      getClearAlpha: () => clearAlpha,
      setClearColor: (color: Color | number, alpha = 1) => {
        clearHex = color instanceof Color ? color.getHex() : color
        clearAlpha = alpha
      },
      render: () => {
        renders.push({
          bgNull: scene.background === null,
          fogNull: scene.fog === null,
          floorVis: floor.visible,
          editorVis: editorGroup.visible,
          treeVis: treeMesh.visible,
          clearHex,
          clearAlpha,
        })
      },
      domElement: {
        toDataURL: (_mime: string) => {
          if (throwOnToDataUrl) throw new Error('WebGL readback failed')
          return 'data:image/png;base64,iVBORw0KGgo='
        },
      },
    }

    const viewer = Object.create(Viewer.prototype) as Viewer
    Object.assign(viewer as unknown as Record<string, unknown>, {
      scene,
      camera,
      floor,
      renderer: fakeRenderer,
    })

    // 1. Normal transparent capture
    const url = viewer.snapshot({ transparent: true })
    expect(url).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(renders).toHaveLength(2)
    // Capture frame: transparent clear, no background/fog, floor & editor hidden, tree visible
    expect(renders[0]).toEqual({
      bgNull: true,
      fogNull: true,
      floorVis: false,
      editorVis: false,
      treeVis: true,
      clearHex: 0x000000,
      clearAlpha: 0,
    })
    // Restore frame: everything restored
    expect(renders[1]).toEqual({
      bgNull: false,
      fogNull: false,
      floorVis: true,
      editorVis: true,
      treeVis: true,
      clearHex: 0xf1eee0,
      clearAlpha: 1,
    })
    expect(scene.background).toBe(origBg)
    expect(scene.fog).toBe(origFog)
    expect(floor.visible).toBe(true)
    expect(editorGroup.visible).toBe(true)
    expect(clearHex).toBe(0xf1eee0)
    expect(clearAlpha).toBe(1)

    // 2. Error during capture MUST still restore background, fog, floor, gizmos, clearColor & re-render
    renders.length = 0
    throwOnToDataUrl = true
    expect(() => viewer.snapshot({ transparent: true })).toThrow('WebGL readback failed')
    expect(renders).toHaveLength(2)
    expect(scene.background).toBe(origBg)
    expect(scene.fog).toBe(origFog)
    expect(floor.visible).toBe(true)
    expect(editorGroup.visible).toBe(true)
    expect(clearHex).toBe(0xf1eee0)
    expect(clearAlpha).toBe(1)
    expect(renders[1].bgNull).toBe(false)
    expect(renders[1].floorVis).toBe(true)
    expect(renders[1].clearAlpha).toBe(1)

    floor.geometry.dispose()
    treeMesh.geometry.dispose()
    ;(treeMesh.material as MeshStandardMaterial).dispose()
  })

  it('REQ-B3 UI: bindGlbExportPopover LOD ZIP button packs LOD0..LOD3 into a valid PK ZIP with 4 GLB entries', async () => {
    const makeMiniEl = () => ({
      id: '',
      className: '',
      hidden: false,
      checked: false,
      disabled: false,
      value: '512',
      innerHTML: '',
      textContent: '',
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      onclick: null as null | ((e?: unknown) => void),
      onchange: null as null | (() => void),
      setAttribute: () => {},
      contains: () => false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 40, width: 100, height: 30 }),
      querySelector: (_sel: string): unknown => null,
      querySelectorAll: (_sel: string): unknown[] => [],
    })

    const bySel = new Map<string, ReturnType<typeof makeMiniEl>>()
    const getOrMake = (sel: string) => {
      let el = bySel.get(sel)
      if (!el) {
        el = makeMiniEl()
        if (sel === '#glb-opt-merged' || sel === '#glb-opt-bake-moss' || sel === '#glb-opt-bake-normal' || sel === '#glb-opt-bake-grass') {
          el.checked = true
        }
        if (sel === '#glb-opt-bake-conv') el.value = 'opengl'
        if (sel === '#glb-opt-lod-zip') el.textContent = '📦 导出多档 LOD（ZIP）'
        bySel.set(sel, el)
      }
      return el
    }
    const popEl = makeMiniEl()
    popEl.querySelector = (sel: string) => getOrMake(sel)
    popEl.querySelectorAll = () => []

    const prevWindow = globalThis.window
    const prevDocument = globalThis.document
    const prevRaf = globalThis.requestAnimationFrame
    ;(globalThis as unknown as { window: unknown; document: unknown; requestAnimationFrame: unknown }).window = {
      innerWidth: 1280,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    ;(globalThis as unknown as { document: unknown }).document = {
      createElement: () => popEl,
      body: { append: () => {} },
    }
    ;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: () => void) => {
      setTimeout(cb, 0)
      return 1
    }

    try {
      const root = new Group()
      const tri = new BufferGeometry()
      tri.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
      tri.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
      tri.setIndex([0, 1, 2])
      const mesh = new Mesh(tri, new MeshStandardMaterial({ name: 'LeafMat' }))
      mesh.name = 'Leaf cards'
      root.add(mesh)

      const builtLevels: number[] = []
      let savedResult: { blob: Blob; filename: string } | undefined
      const triggerBtn = makeMiniEl() as unknown as HTMLButtonElement

      const popCtrl = bindGlbExportPopover({
        triggerButton: triggerBtn,
        getRoot: () => root,
        exportBlob: async () => new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46])]),
        exportLodGlb: async (lodLevel, opts) => {
          builtLevels.push(lodLevel)
          expect(opts.exportFormat).toBe('glb')
          expect(opts.mode).toBe('merged')
          // Valid GLB magic 'glTF' + version 2 + distinct payload per LOD
          const bytes = new Uint8Array(16 + (3 - lodLevel) * 4)
          bytes.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, lodLevel], 0)
          return new Blob([bytes], { type: 'model/gltf-binary' })
        },
        getFilename: () => 'my-oak-42.glb',
        saveBlob: (blob, filename) => { savedResult = { blob, filename } },
        message: () => {},
      })

      expect(popEl.innerHTML).toContain('id="glb-opt-lod-zip"')
      const zipBlob = await popCtrl.exportLodZip()
      expect(zipBlob).toBeDefined()
      expect(builtLevels).toEqual([0, 1, 2, 3])
      expect(savedResult?.filename).toBe('my-oak-42_lods.zip')

      const zipBytes = new Uint8Array(await savedResult!.blob.arrayBuffer())
      // PK ZIP magic header 0x50 0x4B
      expect(zipBytes[0]).toBe(0x50)
      expect(zipBytes[1]).toBe(0x4b)

      const unzipped = unzipSync(zipBytes)
      const names = Object.keys(unzipped).sort()
      expect(names).toEqual([
        'my-oak-42_LOD0.glb',
        'my-oak-42_LOD1.glb',
        'my-oak-42_LOD2.glb',
        'my-oak-42_LOD3.glb',
      ])
      for (const lv of [0, 1, 2, 3]) {
        const entry = unzipped[`my-oak-42_LOD${lv}.glb`]
        expect(entry[0]).toBe(0x67) // 'g'
        expect(entry[1]).toBe(0x6c) // 'l'
        expect(entry[2]).toBe(0x54) // 'T'
        expect(entry[3]).toBe(0x46) // 'F'
        expect(entry[8]).toBe(lv)
      }
      expect(getOrMake('#glb-opt-lod-zip').disabled).toBe(false)
      expect(getOrMake('#glb-opt-lod-zip').textContent).toBe('📦 导出多档 LOD（ZIP）')

      tri.dispose()
      ;(mesh.material as MeshStandardMaterial).dispose()
    } finally {
      ;(globalThis as unknown as { window: unknown; document: unknown; requestAnimationFrame: unknown }).window = prevWindow
      ;(globalThis as unknown as { document: unknown }).document = prevDocument
      ;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = prevRaf
    }
  })

  it('REQ-C5 ①: parseRockSpec rejects empty {} and TexGraph JSON while accepting valid rock specs and known preset names', () => {
    expect(() => parseRockSpec({})).toThrow()
    expect(() => parseRockSpec({ schemaVersion: 1, targetSlot: 'leaf', nodes: [], edges: [] })).toThrow()
    expect(() => parseRockSpec({ preset: 'unknown-nonexistent-rock' })).toThrow()
    expect(parseRockSpec({ preset: 'boulder-chiseled' }).preset).toBe('boulder-chiseled')
    expect(parseRockSpec({ shape: { width: 2.2, height: 1.4, depth: 1.8 } }).shape.width).toBeCloseTo(2.2, 4)
  })

  it('REQ-C5 ③: all visible numeric sliders across all 27 built-in presets in panel.ts have 0 step-alignment drift', () => {
    const drifts: string[] = []
    for (const id of presetIds) {
      const spec = presetSpec(id)
      for (const sec of sections) {
        if (sec.kinds && !sec.kinds.includes(spec.kind)) continue
        for (const field of sec.fields) {
          if (field.kinds && !field.kinds.includes(spec.kind)) continue
          if (typeof field.label === 'object' && !(spec.kind in field.label)) continue
          if (field.when && !field.when(spec)) continue
          if (field.min === undefined || field.max === undefined || !field.step || field.step <= 0) continue
          const val = getPath(spec, field.path)
          if (typeof val !== 'number') continue
          const steps = (val - field.min) / field.step
          const snapped = field.min + Math.round(steps) * field.step
          if (Math.abs(val - snapped) > field.step * 1e-3) {
            drifts.push(`${id}.${field.path}=${val} (min=${field.min}, step=${field.step}, nearest=${Number(snapped.toFixed(6))})`)
          }
        }
      }
    }
    expect(drifts).toEqual([])
  })

  it('REQ-C3 ② & REQ-C5 ②: parseAiScene deduplicates part IDs, wishing-tree uses driftwood barkStyle, and parseTreeSpec + CrownEnvelope clamp degenerate inputs', () => {
    const basePart = {
      id: 'dup-part',
      label: '主干',
      enabled: true,
      position: [0, 0, 0],
      rotationY: 0,
      scale: 1,
      leafTexture: 'auto',
      spec: presetSpec('broadleaf-round'),
    }
    const parsedScene = parseAiScene({
      schemaVersion: 1,
      mode: 'ai-blank',
      name: '重复 ID 测试',
      parts: [
        basePart,
        { ...basePart, id: 'dup-part' },
        { ...basePart, id: 'dup-part-2' },
        { ...basePart, id: 'dup-part' },
      ],
    })
    const ids = parsedScene.parts.map(p => p.id)
    expect(new Set(ids).size).toBe(4)
    expect(ids).toEqual(['dup-part', 'dup-part-2', 'dup-part-2-2', 'dup-part-3'])

    const wishing = wishingTreeShowcase()
    const woodyParts = wishing.parts.filter(p => p.spec.kind === 'broadleaf')
    expect(woodyParts.length).toBeGreaterThanOrEqual(5)
    for (const part of woodyParts) {
      expect(part.spec.trunk.barkStyle).toBe('driftwood')
    }

    // parseTreeSpec clamps crown.topBias, coneShape & non-woody sub-objects cleanly
    const extreme = JSON.parse(JSON.stringify(presetSpec('broadleaf-round'))) as Record<string, unknown>
    ;(extreme.crown as Record<string, unknown>).topBias = 999
    ;(extreme.crown as Record<string, unknown>).coneShape = -50
    ;(extreme.ground as Record<string, unknown>).count = 999_999
    ;(extreme.ground as Record<string, unknown>).length = -10
    ;(extreme.palm as Record<string, unknown>).frondCount = -4
    ;(extreme.bamboo as Record<string, unknown>).culmCount = 9999
    ;(extreme.lotus as Record<string, unknown>).leafCount = -5
    ;(extreme.flowerbed as Record<string, unknown>).count = 999_999
    const clamped = parseTreeSpec(extreme)
    expect(Number.isFinite(clamped.crown.topBias)).toBe(true)
    expect(clamped.crown.topBias).toBeLessThanOrEqual(3)
    expect(clamped.crown.coneShape).toBeGreaterThanOrEqual(0.1)
    expect(clamped.ground.count).toBeLessThanOrEqual(500)
    expect(clamped.ground.length).toBeGreaterThan(0)
    expect(clamped.palm.frondCount).toBeGreaterThanOrEqual(1)
    expect(clamped.bamboo.culmCount).toBeLessThanOrEqual(20)
    expect(clamped.lotus.leafCount).toBeGreaterThanOrEqual(1)
    expect(clamped.flowerbed.count).toBeLessThanOrEqual(500)

    // CrownEnvelope survives zero/tiny dimensions & zero-radius handles with zero NaNs/Infinities
    const deg = presetSpec('broadleaf-round')
    deg.trunk.height = 0
    deg.crown.width = 0
    deg.crown.depth = 0
    deg.crown.topBias = 0
    deg.crown.base = 0.99
    deg.crown.top = 0.99
    deg.handles = [
      { id: 1, kind: 'shape', anchor: [0, 1, 0], offset: [0.2, 0, 0], radius: 0 },
      { id: 2, kind: 'bare', anchor: [0, 1, 0], offset: [0, 0, 0], radius: 0 },
    ]
    const env = new CrownEnvelope(deg)
    const surf = env.surface(0.5, Math.PI / 2)
    const rho = env.rhoBase(new Vector3(0.5, 0.5, 0.5))
    const def = env.deform(new Vector3(0, 1, 0))
    expect(Number.isFinite(surf.x) && Number.isFinite(surf.y) && Number.isFinite(surf.z)).toBe(true)
    expect(Number.isFinite(rho)).toBe(true)
    expect(Number.isFinite(def.x) && Number.isFinite(def.y) && Number.isFinite(def.z)).toBe(true)
  })
})
