import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { exportGlb } from '../export-glb'
import { buildTree, type TreeTextures } from '../tree/assemble'
import { botanicalTextureKeys, getBotanicalTexture, waitBotanicalTextures } from '../tree/botanical-textures'
import { CrownEnvelope } from '../tree/envelope'
import { buildHerbShrub } from '../tree/herb-shrub'
import { buildRosetteShrub } from '../tree/rosette-shrub'
import { presetIds, presets, presetSpec, type PresetId, type TreeSpec } from '../tree/spec'
import { buildTerracedMossBluffRouteC } from './poly-csg'
import { bakePolyCsgPbr, unwrapPolyCsgUvCharts } from './poly-pbr'

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = bad
    img.src = url
  })
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function makeCanvasTex(data: Uint8ClampedArray, size: number, isSrgb: boolean, name: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0)
  const tex = new CanvasTexture(c)
  tex.name = name
  tex.colorSpace = isSrgb ? SRGBColorSpace : NoColorSpace
  tex.flipY = false
  tex.generateMipmaps = true
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

function makePrototype1Spec(): TreeSpec {
  const spec = presetSpec('broadleaf-round')
  spec.seed = 4041
  spec.trunk.height = 0.72
  spec.trunk.radius = 0.0085
  spec.crown.width = 0.45
  spec.crown.depth = 0.96
  spec.ground.count = 44
  spec.ground.arch = 0.28
  spec.leaves.leafSize = 0.29
  spec.leaves.leafAspect = 1.00
  spec.leaves.leafFold = 0.17
  spec.leaves.leafCurl = 0.16
  spec.leaves.normalSpherize = 0.44
  spec.leaves.tintInner = '#4c8858'
  spec.leaves.tintOuter = '#ffffff'
  spec.leaves.tintVariance = 0.09
  spec.leaves.aoStrength = 0.56
  spec.flowerbed.stemTint = '#2b6a24'
  return spec
}

function makePrototype2Spec(): TreeSpec {
  const spec = presetSpec('broadleaf-round')
  spec.seed = 1017
  spec.trunk.height = 0.56
  spec.crown.width = 0.72
  spec.crown.depth = 0.94
  spec.branches.count = 11
  spec.leaves.leafSize = 0.25
  spec.leaves.leafAspect = 0.76
  spec.leaves.tintInner = '#82ac90'
  spec.leaves.tintOuter = '#ffffff'
  spec.leaves.aoStrength = 0.44
  spec.flowers.enabled = true
  spec.flowers.clusterCount = 6
  spec.flowers.count = 32
  spec.flowers.tintInner = '#bac4f8'
  spec.flowers.tintOuter = '#ffffff'
  return spec
}

export interface Phase2BenchmarkBundle {
  sheets: {
    proto1_rosette_4view: string
    proto2_hydrangea_4view: string
    proto3_mossyrock_pbr_4view: string
    proto3_mossyrock_clay_4view: string
  }
  exportsB64: {
    proto1_glb: string
    proto2_glb: string
    proto3_glb: string
  }
  report: {
    proto1: { stems: number; leaves: number; triangles: number; size: [number, number, number] }
    proto2: { stems: number; leaves: number; flowers: number; triangles: number; size: [number, number, number] }
    proto3: {
      geo: Awaited<ReturnType<typeof buildTerracedMossBluffRouteC>>['audit']
      uv: ReturnType<typeof unwrapPolyCsgUvCharts>['audit']
      bake: ReturnType<typeof bakePolyCsgPbr>['stats']
      glbBytes: number
    }
  }
}

export async function renderPhase2BenchmarkBundle(opts?: { onlyProto1?: boolean }): Promise<Phase2BenchmarkBundle> {
  await waitBotanicalTextures(['heart-leaf-a', 'hydrangea-leaf', 'hydrangea-floret-2x2'])

  const W = 640
  const H = 480
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
  renderer.setSize(W, H)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap

  const scene = new Scene()
  scene.background = new Color('#3b3e44')

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.05, 60)
  const keyLight = new DirectionalLight('#fff8eb', 2.45)
  keyLight.position.set(-3.8, 5.6, 4.2)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(1024, 1024)
  keyLight.shadow.camera.near = 0.5
  keyLight.shadow.camera.far = 20
  keyLight.shadow.camera.left = -2.4
  keyLight.shadow.camera.right = 2.4
  keyLight.shadow.camera.top = 2.4
  keyLight.shadow.camera.bottom = -2.4
  keyLight.shadow.bias = -0.0004
  scene.add(keyLight)

  const fillLight = new DirectionalLight('#c9dbf5', 0.68)
  fillLight.position.set(4.2, 2.4, -3.2)
  scene.add(fillLight)

  const rimLight = new DirectionalLight('#e8f2dc', 0.45)
  rimLight.position.set(0.6, 3.8, -5.0)
  scene.add(rimLight)

  const hemiLight = new HemisphereLight('#eef3fb', '#5a5f58', 0.92)
  scene.add(hemiLight)

  const floor = new Mesh(
    new PlaneGeometry(16, 16),
    new ShadowMaterial({ color: '#14171c', opacity: 0.42 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  const root = new Group()
  scene.add(root)

  const setRoot = (grp: Group) => {
    while (root.children.length > 0) root.remove(root.children[0])
    root.add(grp)
  }

  const aspect = W / H
  const captureView = async (
    bounds: Box3,
    dirArr: [number, number, number],
    padScale: number,
    upArr?: [number, number, number],
  ): Promise<HTMLImageElement> => {
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const dir = new Vector3(dirArr[0], dirArr[1], dirArr[2]).normalize()
    if (upArr) camera.up.set(upArr[0], upArr[1], upArr[2]).normalize()
    else camera.up.set(0, 1, 0)
    camera.position.copy(center).addScaledVector(dir, 9)
    camera.lookAt(center)

    // Exact projected bounding span in camera plane so every object frames cleanly with balanced studio padding!
    const corners = [
      new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
      new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
      new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
      new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
      new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    ]
    camera.updateMatrixWorld(true)
    const inv = camera.matrixWorldInverse
    let maxX = 0, maxY = 0
    for (const c of corners) {
      const p = c.clone().applyMatrix4(inv)
      if (Math.abs(p.x) > maxX) maxX = Math.abs(p.x)
      if (Math.abs(p.y) > maxY) maxY = Math.abs(p.y)
    }
    const halfH = Math.max(maxY, maxX / aspect, Math.max(size.x, size.y, size.z) * 0.35) * padScale
    camera.top = halfH
    camera.bottom = -halfH
    camera.left = -halfH * aspect
    camera.right = halfH * aspect
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)
    return loadImg(renderer.domElement.toDataURL('image/png'))
  }

  const compose2x2 = (
    title: string,
    panels: { label: string; img: HTMLImageElement }[],
  ): string => {
    const headH = 38
    const canvas = document.createElement('canvas')
    canvas.width = W * 2
    canvas.height = H * 2 + headH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#2b2e33'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#edf0f4'
    ctx.font = '700 16px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(title, 16, 25)

    for (let i = 0; i < 4; i++) {
      const col = i % 2
      const row = Math.floor(i / 2)
      const x0 = col * W
      const y0 = headH + row * H
      ctx.drawImage(panels[i].img, x0, y0, W, H)
      ctx.strokeStyle = '#585d66'
      ctx.lineWidth = 2
      ctx.strokeRect(x0 + 1, y0 + 1, W - 2, H - 2)
      ctx.fillStyle = 'rgba(24, 27, 32, 0.72)'
      ctx.fillRect(x0 + 10, y0 + H - 32, 230, 24)
      ctx.fillStyle = '#f2f5f9'
      ctx.font = '600 13px "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(panels[i].label, x0 + 18, y0 + H - 15)
    }
    return canvas.toDataURL('image/png')
  }

  const countGroupTris = (grp: Group): number => {
    let tris = 0
    grp.traverse(o => {
      if (o instanceof Mesh) {
        const idx = o.geometry.getIndex()
        tris += idx ? idx.count / 3 : o.geometry.getAttribute('position').count / 3
      }
    })
    return Math.round(tris)
  }

  // =========================================================================
  // Prototype 1: 04 阔叶灌木 A (Rosette Petiole Single-Heart-Leaf Dome)
  // =========================================================================
  const spec1 = makePrototype1Spec()
  const env1 = new CrownEnvelope(spec1)
  const built1 = buildRosetteShrub(spec1, env1)
  const heartTex = getBotanicalTexture('heart-leaf-a')
  const stemMat1 = new MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 })
  const leafMat1 = new MeshStandardMaterial({
    map: heartTex,
    alphaTest: 0.42,
    side: DoubleSide,
    vertexColors: true,
    roughness: 0.66,
    metalness: 0,
    emissive: new Color('#142a0a'),
    emissiveIntensity: 0.24,
  })
  const grp1 = new Group()
  grp1.name = 'Proto1_RosetteShrubA'
  const stemMesh1 = new Mesh(built1.stemGeometry, stemMat1)
  stemMesh1.name = 'Petioles'
  stemMesh1.castShadow = true; stemMesh1.receiveShadow = true
  const leafMesh1 = new Mesh(built1.leafGeometry, leafMat1)
  leafMesh1.name = 'HeartLeaves'
  leafMesh1.castShadow = true; leafMesh1.receiveShadow = false
  grp1.add(stemMesh1, leafMesh1)

  setRoot(grp1)
  const b1 = new Box3().setFromObject(grp1)
  const s1 = b1.getSize(new Vector3())
  const p1Tris = countGroupTris(grp1)
  const proto1_rosette_4view = compose2x2(
    `原型 1 · 04 阔叶灌木 A（基生叶柄 + ${built1.leaves} 片独立3D微弯心形单叶 · ${p1Tris} tris）`,
    [
      { label: 'FRONT VIEW 正视图', img: await captureView(b1, [0, 0.14, 1.0], 1.24) },
      { label: 'SIDE VIEW 侧视图', img: await captureView(b1, [1.0, 0.14, 0], 1.24) },
      { label: 'TOP VIEW 顶视图', img: await captureView(b1, [0, 1.0, 0.02], 1.24, [0, 0, -1]) },
      { label: 'HERO 3/4 VIEW 英雄斜视', img: await captureView(b1, [0.56, 0.40, 0.78], 1.22) },
    ],
  )
  const proto1_glb = await blobToBase64(await exportGlb(grp1, { mode: 'merged', excludeDecorations: false }))

  if (opts?.onlyProto1) {
    built1.stemGeometry.dispose(); built1.leafGeometry.dispose(); stemMat1.dispose(); leafMat1.dispose()
    renderer.dispose()
    return {
      sheets: {
        proto1_rosette_4view,
        proto2_hydrangea_4view: '',
        proto3_mossyrock_pbr_4view: '',
        proto3_mossyrock_clay_4view: '',
      },
      exportsB64: { proto1_glb, proto2_glb: '', proto3_glb: '' },
      report: {
        proto1: {
          stems: built1.stems,
          leaves: built1.leaves,
          triangles: p1Tris,
          size: [Number(s1.x.toFixed(3)), Number(s1.y.toFixed(3)), Number(s1.z.toFixed(3))],
        },
        proto2: { stems: 0, leaves: 0, flowers: 0, triangles: 0, size: [0, 0, 0] },
        proto3: null as unknown as Phase2BenchmarkBundle['report']['proto3'],
      },
    }
  }

  // =========================================================================
  // Prototype 2: 10 绣球花丛 (Branching Herb Shrub + True 3D Hydrangea Pom-Poms)
  // =========================================================================
  const spec2 = makePrototype2Spec()
  const env2 = new CrownEnvelope(spec2)
  const built2 = buildHerbShrub(spec2, env2)
  const hydLeafTex = getBotanicalTexture('hydrangea-leaf')
  const hydFloretTex = getBotanicalTexture('hydrangea-floret-2x2')
  const stemMat2 = new MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 })
  const leafMat2 = new MeshStandardMaterial({
    map: hydLeafTex,
    alphaTest: 0.42,
    side: DoubleSide,
    vertexColors: true,
    roughness: 0.66,
    metalness: 0,
    emissive: new Color('#142a0a'),
    emissiveIntensity: 0.22,
  })
  const floretMat2 = new MeshStandardMaterial({
    map: hydFloretTex,
    alphaTest: 0.42,
    side: DoubleSide,
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
    emissive: new Color('#24294a'),
    emissiveIntensity: 0.35,
  })
  const coreMat2 = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    emissive: new Color('#363f78'),
    emissiveIntensity: 0.40,
  })

  const grp2 = new Group()
  grp2.name = 'Proto2_HydrangeaShrub'
  const stemMesh2 = new Mesh(built2.stemGeometry, stemMat2)
  stemMesh2.name = 'Stems'; stemMesh2.castShadow = true; stemMesh2.receiveShadow = true
  const leafMesh2 = new Mesh(built2.leafGeometry, leafMat2)
  leafMesh2.name = 'SerratedLeaves'; leafMesh2.castShadow = true; leafMesh2.receiveShadow = false
  const coreMesh2 = new Mesh(built2.coreGeometry, coreMat2)
  coreMesh2.name = 'FlowerCores'; coreMesh2.castShadow = false; coreMesh2.receiveShadow = false
  const flowerMesh2 = new Mesh(built2.flowerGeometry, floretMat2)
  flowerMesh2.name = 'HydrangeaFlorets'; flowerMesh2.castShadow = true; flowerMesh2.receiveShadow = false
  grp2.add(stemMesh2, leafMesh2, coreMesh2, flowerMesh2)

  setRoot(grp2)
  const b2 = new Box3().setFromObject(grp2)
  const s2 = b2.getSize(new Vector3())
  const p2Tris = countGroupTris(grp2)
  const proto2_hydrangea_4view = compose2x2(
    `原型 2 · 10 绣球花丛（${built2.stems} 枝条 + ${built2.leaves} 片锯齿叶 + ${built2.flowers} 朵真3D立体小花球 · ${p2Tris} tris）`,
    [
      { label: 'FRONT VIEW 正视图', img: await captureView(b2, [0, 0.14, 1.0], 1.24) },
      { label: 'SIDE VIEW 侧视图', img: await captureView(b2, [1.0, 0.14, 0], 1.24) },
      { label: 'TOP VIEW 顶视图', img: await captureView(b2, [0, 1.0, 0.02], 1.24, [0, 0, -1]) },
      { label: 'HERO 3/4 VIEW 英雄斜视', img: await captureView(b2, [0.54, 0.36, 0.80], 1.22) },
    ],
  )
  const proto2_glb = await blobToBase64(await exportGlb(grp2, { mode: 'merged', excludeDecorations: false }))

  // =========================================================================
  // Prototype 3: 17 苔藓层叠方巨岩 (9-Block Manifold Union + Inset Terrace Moss PBR)
  // =========================================================================
  const c2 = await buildTerracedMossBluffRouteC('c2', { seed: 7301, shoulderDepth: 1.0, bevelScale: 1.0, notchDepth: 1.0 })
  const uvC2 = unwrapPolyCsgUvCharts(c2, { atlasSize: 1024, gutterPx: 10, mergeCreaseDeg: 32, shadingCreaseDeg: 24 })
  const baked = bakePolyCsgPbr(c2, uvC2, {
    size: 1024,
    mode: 'shallow-detail',
    baseColorHex: '#c49b76',
    mossTop: true,
    mossColorHex: '#68a624',
    aoRays: 16,
    dilationPasses: 14,
    seed: 7301,
    strataStrength: 1.0,
  })

  const albedoTex = makeCanvasTex(baked.albedo, baked.size, true, 'TerracedMossRock_Albedo')
  const normalTex = makeCanvasTex(baked.normal, baked.size, false, 'TerracedMossRock_Normal')
  const aoTex = makeCanvasTex(baked.ao, baked.size, false, 'TerracedMossRock_AO')
  const rockMat = new MeshStandardMaterial({
    map: albedoTex,
    normalMap: normalTex,
    normalScale: new Vector2(1, 1),
    aoMap: aoTex,
    aoMapIntensity: 0.96,
    roughness: 0.86,
    metalness: 0.0,
  })

  const rockGeo = uvC2.toBufferGeometry()
  const grp3 = new Group()
  grp3.name = 'Proto3_TerracedMossBluffC2'
  const rockMesh = new Mesh(rockGeo, rockMat)
  rockMesh.name = 'TerracedMossBluff_C2'
  rockMesh.castShadow = true; rockMesh.receiveShadow = true
  grp3.add(rockMesh)

  setRoot(grp3)
  const b3 = new Box3().setFromObject(grp3)
  const proto3_mossyrock_pbr_4view = compose2x2(
    `原型 3 · 17 苔藓层叠方巨岩 PBR（${c2.audit.triangles} tris · 水密=${c2.audit.openEdges}/${c2.audit.nonManifoldEdges} · 自交=${c2.audit.selfIntersections} · UV重叠=${uvC2.audit.overlappingChartTris}）`,
    [
      { label: 'FRONT VIEW 正视图', img: await captureView(b3, [0, 0.14, 1.0], 1.24) },
      { label: 'SIDE VIEW 侧视图', img: await captureView(b3, [1.0, 0.14, 0], 1.24) },
      { label: 'TOP VIEW 顶视图', img: await captureView(b3, [0, 1.0, 0.02], 1.24, [0, 0, -1]) },
      { label: 'HERO 3/4 VIEW 英雄斜视', img: await captureView(b3, [0.46, 0.44, 0.78], 1.22) },
    ],
  )

  // Clay & wireframe sheet matching reference's cool-gray ZBrush clay view!
  const clayMat = new MeshStandardMaterial({ color: '#c4ccd6', roughness: 0.84, metalness: 0.0 })
  const wireMat = new MeshBasicMaterial({ color: '#1b2630', wireframe: true, transparent: true, opacity: 0.46 })
  const grp3Clay = new Group()
  const clayMesh = new Mesh(rockGeo, clayMat)
  clayMesh.castShadow = true; clayMesh.receiveShadow = true
  grp3Clay.add(clayMesh)
  setRoot(grp3Clay)
  const clayFront = await captureView(b3, [0, 0.14, 1.0], 1.24)
  const claySide = await captureView(b3, [1.0, 0.14, 0], 1.24)
  const clayHero = await captureView(b3, [0.46, 0.44, 0.78], 1.22)
  const wireMesh = new Mesh(rockGeo, wireMat)
  wireMesh.scale.setScalar(1.002)
  grp3Clay.add(wireMesh)
  const clayWire = await captureView(b3, [0.46, 0.44, 0.78], 1.22)
  const proto3_mossyrock_clay_4view = compose2x2(
    `原型 3 · 17 苔藓层叠方巨岩 灰模与布线（13 块非正交倒角层叠并集 + 贯通竖缝与外缘崩口 · ${c2.audit.triangles} tris）`,
    [
      { label: 'FRONT CLAY 正面灰模', img: clayFront },
      { label: 'SIDE CLAY 侧面灰模', img: claySide },
      { label: 'HERO 3/4 CLAY 英雄灰模', img: clayHero },
      { label: 'HERO 3/4 WIREFRAME 拓扑线框', img: clayWire },
    ],
  )

  const glb3Blob = await exportGlb(grp3, { mode: 'merged', excludeDecorations: false })
  const proto3_glb = await blobToBase64(glb3Blob)

  // Cleanup GPU allocations cleanly
  built1.stemGeometry.dispose(); built1.leafGeometry.dispose(); stemMat1.dispose(); leafMat1.dispose()
  built2.stemGeometry.dispose(); built2.leafGeometry.dispose(); built2.coreGeometry.dispose(); built2.flowerGeometry.dispose()
  stemMat2.dispose(); leafMat2.dispose(); coreMat2.dispose(); floretMat2.dispose()
  rockGeo.dispose(); rockMat.dispose(); clayMat.dispose(); wireMat.dispose()
  albedoTex.dispose(); normalTex.dispose(); aoTex.dispose()
  renderer.dispose()

  return {
    sheets: {
      proto1_rosette_4view,
      proto2_hydrangea_4view,
      proto3_mossyrock_pbr_4view,
      proto3_mossyrock_clay_4view,
    },
    exportsB64: {
      proto1_glb,
      proto2_glb,
      proto3_glb,
    },
    report: {
      proto1: {
        stems: built1.stems,
        leaves: built1.leaves,
        triangles: p1Tris,
        size: [Number(s1.x.toFixed(3)), Number(s1.y.toFixed(3)), Number(s1.z.toFixed(3))],
      },
      proto2: {
        stems: built2.stems,
        leaves: built2.leaves,
        flowers: built2.flowers,
        triangles: p2Tris,
        size: [Number(s2.x.toFixed(3)), Number(s2.y.toFixed(3)), Number(s2.z.toFixed(3))],
      },
      proto3: {
        geo: c2.audit,
        uv: uvC2.audit,
        bake: baked.stats,
        glbBytes: glb3Blob.size,
      },
    },
  }
}

export interface Phase3All16Bundle {
  heroSheet: string
  topSheet: string
  items: {
    id: PresetId
    name: string
    stems: number
    leaves: number
    flowers: number
    triangles: number
    size: [number, number, number]
    glbB64?: string
  }[]
}

export async function renderPhase3All16PlantsSheet(opts?: { exportGlbs?: boolean }): Promise<Phase3All16Bundle> {
  await waitBotanicalTextures(botanicalTextureKeys)

  const W = 480
  const H = 360
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
  renderer.setSize(W, H)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap

  const scene = new Scene()
  scene.background = new Color('#3b3e44')
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.05, 60)

  const keyLight = new DirectionalLight('#fff8eb', 2.45)
  keyLight.position.set(-3.8, 5.6, 4.2)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(1024, 1024)
  keyLight.shadow.camera.near = 0.5
  keyLight.shadow.camera.far = 20
  keyLight.shadow.camera.left = -2.2
  keyLight.shadow.camera.right = 2.2
  keyLight.shadow.camera.top = 2.2
  keyLight.shadow.camera.bottom = -2.2
  keyLight.shadow.bias = -0.0004
  scene.add(keyLight)

  const fillLight = new DirectionalLight('#c9dbf5', 0.68)
  fillLight.position.set(4.2, 2.4, -3.2)
  scene.add(fillLight)
  const rimLight = new DirectionalLight('#e8f2dc', 0.44)
  rimLight.position.set(0.6, 3.8, -5.0)
  scene.add(rimLight)
  scene.add(new HemisphereLight('#eef3fb', '#5a5f58', 0.92))

  const floor = new Mesh(new PlaneGeometry(16, 16), new ShadowMaterial({ color: '#14171c', opacity: 0.42 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  const root = new Group()
  scene.add(root)
  const aspect = W / H

  const snap = async (bounds: Box3, dirArr: [number, number, number], padScale: number, upArr?: [number, number, number]) => {
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const dir = new Vector3(dirArr[0], dirArr[1], dirArr[2]).normalize()
    if (upArr) camera.up.set(upArr[0], upArr[1], upArr[2]).normalize()
    else camera.up.set(0, 1, 0)
    camera.position.copy(center).addScaledVector(dir, 9)
    camera.lookAt(center)
    camera.updateMatrixWorld(true)
    const inv = camera.matrixWorldInverse
    let maxX = 0, maxY = 0
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = new Vector3(x, y, z).applyMatrix4(inv)
          if (Math.abs(p.x) > maxX) maxX = Math.abs(p.x)
          if (Math.abs(p.y) > maxY) maxY = Math.abs(p.y)
        }
      }
    }
    const halfH = Math.max(maxY, maxX / aspect, Math.max(size.x, size.y, size.z) * 0.32) * padScale
    camera.top = halfH
    camera.bottom = -halfH
    camera.left = -halfH * aspect
    camera.right = halfH * aspect
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)
    return loadImg(renderer.domElement.toDataURL('image/png'))
  }

  const dummyTex = {} as unknown as TreeTextures
  const botIds = presetIds.filter(id => presets[id].kind === 'botanical')
  const heroCells: { label: string; img: HTMLImageElement }[] = []
  const topCells: { label: string; img: HTMLImageElement }[] = []
  const items: Phase3All16Bundle['items'] = []

  for (const id of botIds) {
    const spec = presetSpec(id)
    const built = buildTree(spec, dummyTex)
    while (root.children.length > 0) root.remove(root.children[0])
    root.add(built.group)
    const bounds = new Box3().setFromObject(built.group)
    const sz = bounds.getSize(new Vector3())
    const isCover = spec.botanical?.mode === 'clover-groundcover'
    // Groundcovers frame better at slightly higher 3/4 elevation (just like reference poster!)
    const heroDir: [number, number, number] = isCover ? [0.22, 0.72, 0.85] : [0.36, 0.32, 0.92]
    const hImg = await snap(bounds, heroDir, 1.24)
    const tImg = await snap(bounds, [0, 1.0, 0.02], 1.24, [0, 0, -1])
    const cap = `${spec.name} · ${built.stats.triangles} tris`
    heroCells.push({ label: cap, img: hImg })
    topCells.push({ label: cap, img: tImg })

    let glbB64: string | undefined
    if (opts?.exportGlbs) {
      const blob = await exportGlb(built.group, { mode: 'merged', excludeDecorations: false })
      glbB64 = await blobToBase64(blob)
    }
    items.push({
      id,
      name: spec.name,
      stems: built.stats.branches,
      leaves: built.stats.leaves,
      flowers: built.stats.flowers,
      triangles: built.stats.triangles,
      size: [Number(sz.x.toFixed(3)), Number(sz.y.toFixed(3)), Number(sz.z.toFixed(3))],
      ...(glbB64 ? { glbB64 } : {}),
    })
    built.dispose()
  }

  const compose4x4 = (title: string, cells: { label: string; img: HTMLImageElement }[]) => {
    const headH = 44
    const canvas = document.createElement('canvas')
    canvas.width = W * 4
    canvas.height = H * 4 + headH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#282b30'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#eef2f6'
    ctx.font = '700 20px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(title, 18, 29)
    for (let i = 0; i < cells.length && i < 16; i++) {
      const col = i % 4
      const row = Math.floor(i / 4)
      const x0 = col * W
      const y0 = headH + row * H
      ctx.drawImage(cells[i].img, x0, y0, W, H)
      ctx.strokeStyle = '#555b64'
      ctx.lineWidth = 2
      ctx.strokeRect(x0 + 1, y0 + 1, W - 2, H - 2)
      ctx.fillStyle = 'rgba(20, 23, 28, 0.78)'
      ctx.fillRect(x0 + 8, y0 + H - 30, W - 16, 23)
      ctx.fillStyle = '#f2f5f9'
      ctx.font = '600 13px "Microsoft YaHei", sans-serif'
      ctx.fillText(cells[i].label, x0 + 15, y0 + H - 14)
    }
    return canvas.toDataURL('image/png')
  }

  const heroSheet = compose4x4('Phase 3 全套 16 种风格化高精植物 · 实时 3D 英雄视角总览（Zero-Halo 512 手绘贴图）', heroCells)
  const topSheet = compose4x4('Phase 3 全套 16 种风格化高精植物 · 实时 3D 顶视图总览', topCells)

  renderer.dispose()
  return { heroSheet, topSheet, items }
}
