// Browser-side leaf card material and a procedural placeholder leaf texture.
// The user is expected to replace the texture with their own alpha leaf image.
import {
  CanvasTexture, Color, DoubleSide, MeshStandardMaterial, SRGBColorSpace, ShaderChunk, Texture,
} from 'three'
import { rng } from '../shape'

/** Frontier-BFS alpha dilation directly on an RGBA buffer (bit-exact with full-image
 *  multi-pass 8-neighbor dilation, but visits only the narrow transparent border band). */
export function dilateAlphaRgba(d: Uint8ClampedArray, w: number, h: number, passes = 6) {
  if (w < 2 || h < 2 || passes <= 0) return
  const N = w * h
  // 0 = unfilled transparent, 1 = filled (opaque or already dilated), 2 = queued in frontier
  const filled = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (d[i * 4 + 3] >= 220) filled[i] = 1
  }
  let curr: number[] = []
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0, y1 = y + 1 < h ? y + 1 : h - 1
    const row = y * w
    for (let x = 0; x < w; x++) {
      const i = row + x
      if (filled[i] !== 1) continue
      const x0 = x > 0 ? x - 1 : 0, x1 = x + 1 < w ? x + 1 : w - 1
      for (let ny = y0; ny <= y1; ny++) {
        const nrow = ny * w
        for (let nx = x0; nx <= x1; nx++) {
          const ni = nrow + nx
          if (filled[ni] === 0) {
            filled[ni] = 2
            curr.push(ni)
          }
        }
      }
    }
  }

  for (let pass = 0; pass < passes && curr.length > 0; pass++) {
    const len = curr.length
    const outR = new Uint8Array(len)
    const outG = new Uint8Array(len)
    const outB = new Uint8Array(len)

    // Phase 1: sample only already-committed (filled === 1) 8-neighbors
    for (let k = 0; k < len; k++) {
      const i = curr[k]
      const x = i % w, y = (i - x) / w
      const y0 = y > 0 ? y - 1 : 0, y1 = y + 1 < h ? y + 1 : h - 1
      const x0 = x > 0 ? x - 1 : 0, x1 = x + 1 < w ? x + 1 : w - 1
      let sr = 0, sg = 0, sb = 0, cnt = 0
      for (let ny = y0; ny <= y1; ny++) {
        const nrow = ny * w
        for (let nx = x0; nx <= x1; nx++) {
          const ni = nrow + nx
          if (filled[ni] === 1) {
            const o = ni * 4
            sr += d[o]; sg += d[o + 1]; sb += d[o + 2]; cnt++
          }
        }
      }
      if (cnt > 0) {
        outR[k] = Math.round(sr / cnt)
        outG[k] = Math.round(sg / cnt)
        outB[k] = Math.round(sb / cnt)
      }
    }

    // Phase 2: commit dilated RGB (preserving alpha) & enqueue next frontier ring
    const next: number[] = []
    const needNext = pass + 1 < passes
    for (let k = 0; k < len; k++) {
      const i = curr[k]
      const o = i * 4
      d[o] = outR[k]
      d[o + 1] = outG[k]
      d[o + 2] = outB[k]
      filled[i] = 1
      if (!needNext) continue
      const x = i % w, y = (i - x) / w
      const y0 = y > 0 ? y - 1 : 0, y1 = y + 1 < h ? y + 1 : h - 1
      const x0 = x > 0 ? x - 1 : 0, x1 = x + 1 < w ? x + 1 : w - 1
      for (let ny = y0; ny <= y1; ny++) {
        const nrow = ny * w
        for (let nx = x0; nx <= x1; nx++) {
          const ni = nrow + nx
          if (filled[ni] === 0) {
            filled[ni] = 2
            next.push(ni)
          }
        }
      }
    }
    curr = next
  }
}

/** Bleed opaque interior RGB outward across semi-transparent & transparent border
 *  texels (SpeedTree/Unreal alpha dilation) while preserving original alpha.
 *  Eliminates 1px white/dark cutout halos caused by bilinear filtering & mipmaps. */
export function dilateAlphaCanvas(canvas: HTMLCanvasElement, passes = 6) {
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return canvas
  const w = canvas.width, h = canvas.height
  if (w < 2 || h < 2) return canvas
  const img = g.getImageData(0, 0, w, h)
  dilateAlphaRgba(img.data, w, h, passes)
  g.putImageData(img, 0, 0)
  return canvas
}

/** Procedural leaf cluster: stem at the bottom center, leaves fanning upward. */
export function makePlaceholderLeafTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const random = rng(20261118)
  const s = size / 512
  g.lineCap = 'round'
  const leaf = (x: number, y: number, angle: number, length: number, width: number, hue: number) => {
    g.save()
    g.translate(x * s, y * s)
    g.rotate(angle)
    const L = length * s, W = width * s
    const grad = g.createLinearGradient(0, 0, 0, -L)
    grad.addColorStop(0, `hsl(${hue}, 48%, 26%)`)
    grad.addColorStop(.55, `hsl(${hue - 6}, 55%, 40%)`)
    grad.addColorStop(1, `hsl(${hue - 12}, 62%, 52%)`)
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, 0)
    g.bezierCurveTo(W, -L * .18, W * .9, -L * .72, 0, -L)
    g.bezierCurveTo(-W * .9, -L * .72, -W, -L * .18, 0, 0)
    g.fill()
    g.strokeStyle = `hsla(${hue - 10}, 50%, 70%, .55)`
    g.lineWidth = 2.2 * s
    g.beginPath()
    g.moveTo(0, -L * .04)
    g.quadraticCurveTo(W * .08, -L * .5, 0, -L * .93)
    g.stroke()
    g.restore()
  }
  const leaves: [number, number, number, number, number, number][] = []
  // Small leaves along a few sub-stems, filling a rounded clump silhouette
  // (stylized leaf cluster card, stem at bottom center).
  const stems = [[-0.95, 300], [-0.45, 360], [0, 380], [0.45, 360], [0.95, 300]] as const
  g.strokeStyle = '#5a4630'
  g.lineWidth = 4 * s
  for (const [angle, length] of stems) {
    const ex = 256 + Math.sin(angle) * length * .78, ey = 500 - Math.cos(angle) * length * .9
    g.beginPath()
    g.moveTo(256 * s, 500 * s)
    g.quadraticCurveTo((256 + Math.sin(angle) * length * .2) * s, (500 - length * .5) * s, ex * s, ey * s)
    g.stroke()
    const count = 7
    for (let i = 0; i < count; i++) {
      const t = .35 + .65 * i / (count - 1)
      const x = 256 + (ex - 256) * t, y = 500 + (ey - 500) * t
      const side = i % 2 === 0 ? -1 : 1
      const spread = angle + side * (.7 + random() * .35) * (1 - t * .45)
      const len = 78 + random() * 34 - t * 10
      leaves.push([x, y, spread, len, len * (.46 + random() * .1), 80 + random() * 30])
    }
    leaves.push([ex, ey, angle + (random() - .5) * .3, 96, 46, 84 + random() * 20])
  }
  // back leaves first so the canopy reads with depth
  leaves.sort((a, b) => a[1] - b[1])
  for (const item of leaves) leaf(...item)
  dilateAlphaCanvas(canvas, 6)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  texture.name = 'placeholder_leaf_cluster'
  return texture
}

export function loadLeafTexture(file: File): Promise<Texture> {
  const url = URL.createObjectURL(file)
  return new Promise<Texture>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const w = Math.min(2048, img.naturalWidth || img.width)
        const h = Math.min(2048, img.naturalHeight || img.height)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const g = canvas.getContext('2d')!
        g.drawImage(img, 0, 0, w, h)
        dilateAlphaCanvas(canvas, 6)
        const texture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = 8
        texture.name = file.name.replace(/\.[^.]+$/, '')
        resolve(texture)
      } catch (err) { reject(err) }
      finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法解码图片贴图')) }
    img.src = url
  })
}

const flip = 'normal *= faceDirection;'

/** Shared global wind uniforms driven by Viewer.animate() for live gentle foliage sway. */
export const foliageWind = {
  uWindTime: { value: 0 },
  uWindStrength: { value: 0 },
}

export interface LeafStyleOptions {
  translucency?: number
  rimLight?: number
  shadowShift?: number
  topWarmth?: number
  /** Base hex color from which a harmonious cool shadow tint is derived */
  shadowFrom?: string
}

/** Derive a rich cool shadow tint from the foliage's inner color so shadows stay
 *  painterly & luminous (cool teal for greens, cool rose-violet for pinks/blossoms). */
function deriveShadowTint(hex?: string) {
  const c = new Color(hex || '#5c7a3c')
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  // pull hue gently toward cool blue-violet (0.68 = ~245 deg) without turning muddy
  const targetH = hsl.h > .15 && hsl.h < .52 ? .52 : .78
  const dh = ((targetH - hsl.h + 1.5) % 1) - .5
  const h = (hsl.h + dh * .32 + 1) % 1
  const s = Math.min(.78, Math.max(.32, hsl.s * 1.05))
  const l = Math.min(.62, Math.max(.36, hsl.l * .95 + .1))
  return new Color().setHSL(h, s, l)
}

/** Double-sided alpha-tested stylized foliage material.
 *  Combines spherized crown normals with backlit subsurface translucency (SSS),
 *  cool shadow hue shift, sunlit silhouette rim, and 3-zone vertical warmth. */
export function makeLeafMaterial(
  map: Texture | undefined,
  alphaCutoff: number,
  spherize: number,
  facing = 0,
  style: LeafStyleOptions = {},
) {
  const material = new MeshStandardMaterial({
    name: map ? 'LeafCards' : 'GrassBlades',
    ...(map ? { map, alphaTest: alphaCutoff } : {}),
    side: DoubleSide, vertexColors: true,
    roughness: map ? .8 : .76, metalness: 0, alphaToCoverage: false,
  })
  const uniforms = {
    uLeafKeepNormal: { value: spherize >= .5 ? 1 : 0 },
    uLeafFacing: { value: facing },
    uLeafSSS: { value: style.translucency ?? .45 },
    uLeafRim: { value: style.rimLight ?? .32 },
    uShadowShift: { value: style.shadowShift ?? .34 },
    uTopWarmth: { value: style.topWarmth ?? .36 },
    uShadowTint: { value: deriveShadowTint(style.shadowFrom) },
  }
  material.userData.leafUniforms = uniforms
  material.customProgramCacheKey = () => map ? 'stylized-foliage-v4' : 'stylized-blade-v4'
  const isBladeMode = !map
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, foliageWind)
    const chunk = ShaderChunk.normal_fragment_begin
    if (!chunk.includes(flip)) console.warn('normal_fragment_begin layout changed; back faces will flip normals')
    shader.fragmentShader =
      `uniform float uLeafKeepNormal;
uniform float uLeafSSS;
uniform float uLeafRim;
uniform float uShadowShift;
uniform float uTopWarmth;
uniform vec3 uShadowTint;
varying vec3 vLeafWorldNormal;
varying vec3 vLeafObjPos;
float leafProcHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float leafProcNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(leafProcHash(i), leafProcHash(i + vec3(1,0,0)), f.x), mix(leafProcHash(i + vec3(0,1,0)), leafProcHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(leafProcHash(i + vec3(0,0,1)), leafProcHash(i + vec3(1,0,1)), f.x), mix(leafProcHash(i + vec3(0,1,1)), leafProcHash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}\n` +
      shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // 3D object-space procedural tonal & micro-grain variation (zero UV tiling repetition)
            float macroN = leafProcNoise(vLeafObjPos * 1.45) * 0.65 + leafProcNoise(vLeafObjPos * 3.8 + vec3(4.1, 2.3, 6.7)) * 0.35;
            ${isBladeMode
              ? `float veinN = leafProcNoise(vec3(vLeafObjPos.x * 28.0, vLeafObjPos.y * 4.5, vLeafObjPos.z * 28.0));
                 diffuseColor.rgb *= (0.91 + 0.18 * macroN) * (0.94 + 0.12 * veinN);`
              : `diffuseColor.rgb *= (0.93 + 0.14 * macroN);`}
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          {
            float rN = leafProcNoise(vLeafObjPos * 3.1 + vec3(1.7, 5.2, 3.9));
            roughnessFactor = clamp(roughnessFactor + (rN - 0.5) * 0.14, 0.48, 0.98);
          }`)
        .replace('#include <normal_fragment_begin>',
          chunk.replace(flip, 'normal *= mix(faceDirection, 1.0, uLeafKeepNormal);'))
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          #if NUM_DIR_LIGHTS > 0
            vec3 leafL = normalize( directionalLights[0].direction );
            float leafNdL = dot( geometryNormal, leafL );
            float leafWrap = clamp( ( leafNdL + 0.45 ) / 1.45, 0.0, 1.0 );
            // Backlit subsurface scattering translucency
            float leafBack = pow( clamp( dot( geometryViewDir, -leafL ), 0.0, 1.0 ), 2.2 ) * 0.55
                           + clamp( ( -leafNdL ) * 0.5 + 0.5, 0.0, 1.0 ) * 0.45;
            reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * leafBack * uLeafSSS * 0.36;
            // Cool shadow hue enrichment instead of muddy gray darkening
            float leafDark = 1.0 - smoothstep( -0.15, 0.55, leafNdL );
            reflectedLight.indirectDiffuse = mix(
              reflectedLight.indirectDiffuse,
              reflectedLight.indirectDiffuse * uShadowTint * 1.55,
              leafDark * uShadowShift
            );
            // Soft sunlit silhouette rim
            float leafRim = pow( 1.0 - clamp( dot( geometryNormal, geometryViewDir ), 0.0, 1.0 ), 2.4 );
            reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * leafRim * ( 0.35 + 0.65 * leafWrap ) * uLeafRim * 0.34;
          #endif
          // Three-zone vertical sunlight gradient (warm crown top -> cool airy underside)
          float leafTop = clamp( normalize( vLeafWorldNormal ).y * 0.5 + 0.5, 0.0, 1.0 );
          vec3 leafTintBias = mix( vec3( 0.94, 0.95, 1.07 ), vec3( 1.08, 1.03, 0.94 ), smoothstep( 0.25, 0.85, leafTop ) );
          reflectedLight.directDiffuse *= mix( vec3( 1.0 ), leafTintBias, uTopWarmth );
          reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), leafTintBias, uTopWarmth * 0.6 );
        `)
    // Camera-facing blend + gentle live breeze sway + world normal & object-pos pass-through.
    shader.vertexShader = 'uniform float uLeafFacing;\nuniform float uWindTime;\nuniform float uWindStrength;\nattribute vec3 leafCenter;\nattribute vec2 leafCorner;\nvarying vec3 vLeafWorldNormal;\nvarying vec3 vLeafObjPos;\n' +
      shader.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vLeafWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
          vLeafObjPos = position;`)
        .replace('#include <project_vertex>', `
          vec3 windPos = transformed;
          if ( uWindStrength > 0.0 ) {
            vec4 wp = modelMatrix * vec4( transformed, 1.0 );
            float swayMask = clamp( wp.y * 0.28, 0.0, 1.6 );
            float wave = sin( uWindTime * 1.55 + wp.x * 1.3 + wp.z * 1.15 )
                       + 0.45 * sin( uWindTime * 2.9 + wp.y * 2.1 + wp.x * 1.9 );
            windPos.x += wave * uWindStrength * swayMask;
            windPos.z += cos( uWindTime * 1.35 + wp.z * 1.4 - wp.x * 0.8 ) * uWindStrength * 0.65 * swayMask;
          }
          vec4 mvPosition = modelViewMatrix * vec4( windPos, 1.0 );
          if ( uLeafFacing > 0.0 ) {
            vec4 mvCenter = modelViewMatrix * vec4( leafCenter + ( windPos - transformed ), 1.0 );
            vec4 facingPosition = mvCenter + vec4( leafCorner, 0.0, 0.0 );
            mvPosition = mix( mvPosition, facingPosition, uLeafFacing );
          }
          gl_Position = projectionMatrix * mvPosition;`)
  }
  return material
}
