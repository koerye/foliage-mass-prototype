// Procedural 3D object-space wood/bark, stem, and petal materials (zero standard UV tiling).
// - Default bark: pure GPU 3D domain-warped fBM bark fissures, lenticels, analytic derivative bump,
//   and procedural roughness modulation.
// - Custom imported bark image: 3D object-space triplanar projection + Voronoi/stochastic non-tiling
//   blending with organic domain warp, automatic luminance bump normals, and zero UV seams.
import {
  CanvasTexture, Color, DataTexture, DoubleSide, MeshStandardMaterial,
  RepeatWrapping, RGBAFormat, SRGBColorSpace, Texture,
} from 'three'
import { rng } from '../shape'

// 1x1 neutral placeholder texture bound to uBarkMap when running pure procedural mode
// so WebGL2 sampler2D always has a valid bound texture unit with zero extra memory.
let dummyWhiteTex: DataTexture | undefined
function getDummyBarkTex(): DataTexture {
  if (!dummyWhiteTex) {
    dummyWhiteTex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat)
    dummyWhiteTex.needsUpdate = true
  }
  return dummyWhiteTex
}

export interface BarkStyleOptions {
  /** 3D procedural / triplanar projection density (0.25..4, default 1.0) */
  scale?: number
  /** Relief bump & procedural grain strength (0..1.5, default 0.72) */
  detail?: number
  /** How strongly vertex/barkColor tints an imported bark image (0..1, default 0.45) */
  tint?: number
  /** Subtle cool shadow hue harmony (0..1, default 0.25) */
  shadowShift?: number
  /** Roughness baseline (default 0.92) */
  roughness?: number
}

const BARK_GLSL_HELPERS = /* glsl */ `
float barkHash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec2 barkHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float barkNoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(barkHash31(i + vec3(0.0, 0.0, 0.0)), barkHash31(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(barkHash31(i + vec3(0.0, 1.0, 0.0)), barkHash31(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(barkHash31(i + vec3(0.0, 0.0, 1.0)), barkHash31(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(barkHash31(i + vec3(0.0, 1.0, 1.0)), barkHash31(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}
float barkFbm3(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  for (int i = 0; i < 4; i++) {
    v += a * barkNoise3(p);
    p = p * 2.03 + vec3(17.1, 31.7, 11.3);
    a *= 0.5;
  }
  return v;
}

// Stochastic cell-jittered anti-tiling sampler (inspired by IQ textureNoTile):
// Eliminates visible grid repetition even on non-seamless photos while keeping
// bark grain mostly upright (gentle +-16 deg jitter) and mipmaps artifact-free via textureGrad.
vec3 barkSampleNoTile(sampler2D samp, vec2 uv) {
  vec2 iuv = floor(uv);
  vec2 fuv = fract(uv);
  vec2 ddx = dFdx(uv);
  vec2 ddy = dFdy(uv);

  vec4 sum = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = iuv + vec2(float(i), float(j));
      vec2 h = barkHash22(cell);
      vec2 center = vec2(float(i), float(j)) + 0.15 + 0.70 * h;
      vec2 diff = fuv - center;
      float w = max(0.0, 1.0 - dot(diff, diff) * 1.15);
      w = w * w * w;
      if (w > 1e-4) {
        float ang = (h.x - 0.5) * 0.52; // subtle +-15 deg variation preserves vertical bark flow
        float ca = cos(ang), sa = sin(ang);
        mat2 rot = mat2(ca, -sa, sa, ca);
        vec2 off = barkHash22(cell + 19.37);
        vec2 suv = rot * (uv - cell - 0.5) * (0.90 + 0.20 * h.y) + off;
        vec2 rdx = rot * ddx;
        vec2 rdy = rot * ddy;
        vec3 col = textureGrad(samp, suv, rdx, rdy).rgb;
        col *= 0.94 + 0.12 * fract(h.x * 13.7 + h.y * 7.3);
        sum += vec4(col * w, w);
      }
    }
  }
  return sum.rgb / max(sum.w, 1e-4);
}

vec3 barkSampleTriplanar(sampler2D samp, vec3 objPos, vec3 objNorm, float scale) {
  vec3 n = abs(normalize(objNorm));
  vec3 w = pow(n, vec3(4.5));
  w /= max(w.x + w.y + w.z, 1e-5);
  // Gentle 3D domain warp breaks straight projection lines around curved limbs
  float warp = (barkNoise3(objPos * (1.7 * scale)) - 0.5) * 0.14;
  vec3 p = (objPos + vec3(warp, warp * 0.45, -warp)) * scale;
  // Project so V always follows vertical trunk growth (Y) on side faces
  vec3 cx = barkSampleNoTile(samp, vec2(p.z, p.y));
  vec3 cy = barkSampleNoTile(samp, vec2(p.x, p.z));
  vec3 cz = barkSampleNoTile(samp, vec2(p.x, p.y));
  vec3 fine = cx * w.x + cy * w.y + cz * w.z;

  // Low-frequency macro octave blended subtly to kill any macro periodicity
  vec3 pm = p * 0.41 + vec3(3.7, 1.9, 5.3);
  vec3 mx = barkSampleNoTile(samp, vec2(pm.z, pm.y));
  vec3 my = barkSampleNoTile(samp, vec2(pm.x, pm.z));
  vec3 mz = barkSampleNoTile(samp, vec2(pm.x, pm.y));
  vec3 macro = mx * w.x + my * w.y + mz * w.z;
  return mix(fine, macro, 0.24);
}
`

/** 100% procedural 3D object-space bark material (zero UV tiling).
 *  Supports optional imported bark image projected via stochastic non-tiling triplanar mapping. */
export function makeBarkMaterial(customMap: Texture | undefined, options: BarkStyleOptions = {}) {
  const material = new MeshStandardMaterial({
    name: customMap ? 'BarkProceduralTriplanar' : 'BarkProcedural',
    vertexColors: true,
    roughness: options.roughness ?? .92,
    metalness: 0,
  })
  const hasMap = Boolean(customMap)
  const uniforms = {
    uBarkMap: { value: customMap ?? getDummyBarkTex() },
    uUseBarkMap: { value: hasMap ? 1 : 0 },
    uBarkScale: { value: options.scale ?? 1.0 },
    uBarkDetail: { value: options.detail ?? .72 },
    uBarkTint: { value: options.tint ?? .45 },
    uBarkShadowShift: { value: options.shadowShift ?? .24 },
  }
  material.userData.barkUniforms = uniforms
  if (customMap) material.userData.barkMap = customMap
  material.customProgramCacheKey = () => 'procedural-bark-v1'
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vBarkObjPos;
varying vec3 vBarkObjNorm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBarkObjPos = position;
vBarkObjNorm = normalize(normal);`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uBarkMap;
uniform float uUseBarkMap;
uniform float uBarkScale;
uniform float uBarkDetail;
uniform float uBarkTint;
uniform float uBarkShadowShift;
varying vec3 vBarkObjPos;
varying vec3 vBarkObjNorm;
${BARK_GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float barkHeightVal = 0.5;
float barkRoughMod = 0.0;
{
  vec3 bp = vBarkObjPos * max(0.15, uBarkScale);
  // 3D domain-warped organic vertical bark ridges + subtle fine lenticel flecks
  vec3 warpVec = vec3(
    barkNoise3(bp * 1.85 + vec3(2.1, 0.0, 5.4)) - 0.5,
    barkNoise3(bp * 1.05 + vec3(7.3, 4.2, 1.8)) - 0.5,
    barkNoise3(bp * 1.85 + vec3(9.1, 3.3, 6.7)) - 0.5
  );
  vec3 fiberCoord = vec3(bp.x * 6.8, bp.y * 1.35, bp.z * 6.8) + warpVec * 1.25;
  float ridges = barkFbm3(fiberCoord);
  float fineGrain = barkNoise3(fiberCoord * 3.2);
  float lenticelMask = smoothstep(0.76, 0.92, barkNoise3(vec3(bp.x * 8.5, bp.y * 26.0, bp.z * 8.5) + warpVec * 0.45));
  float fissure = smoothstep(0.26, 0.70, ridges);

  if (uUseBarkMap > 0.5) {
    vec3 triTex = barkSampleTriplanar(uBarkMap, vBarkObjPos, vBarkObjNorm, max(0.15, uBarkScale) * 0.85);
    // Preserve baked vertex crevice AO & height gradient while letting the imported bark shine
    float vLum = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.06, 1.0);
    float aoShade = mix(0.55, 1.18, smoothstep(0.05, 0.65, vLum));
    vec3 neutralTex = triTex * aoShade;
    vec3 tintedTex = triTex * diffuseColor.rgb * 1.85;
    diffuseColor.rgb = mix(neutralTex, tintedTex, clamp(uBarkTint, 0.0, 1.0));
    float texLum = dot(triTex, vec3(0.299, 0.587, 0.114));
    barkHeightVal = mix(ridges, texLum, 0.78);
    barkRoughMod = (0.5 - texLum) * 0.22 * clamp(uBarkDetail, 0.0, 1.5);
  } else {
    float det = clamp(uBarkDetail, 0.0, 1.5);
    float pattern = mix(1.0, 0.82 + 0.30 * fissure + (fineGrain - 0.5) * 0.12 - lenticelMask * 0.05, min(1.0, det * 0.85));
    vec3 warmRidge = diffuseColor.rgb * vec3(1.06, 1.03, 1.00);
    vec3 coolCrevice = diffuseColor.rgb * mix(vec3(0.80, 0.78, 0.82), vec3(0.68, 0.64, 0.76), clamp(uBarkShadowShift, 0.0, 1.0));
    diffuseColor.rgb = mix(coolCrevice, warmRidge, mix(0.5, fissure, min(1.0, det * 0.82))) * pattern;
    barkHeightVal = ridges * 0.74 + fineGrain * 0.20 - lenticelMask * 0.04;
    barkRoughMod = (0.52 - fissure) * 0.18 * det;
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + barkRoughMod, 0.62, 0.99);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // Analytic screen-space derivative bump mapping in view space (no UV tangents required!)
  float bumpStrength = clamp(uBarkDetail, 0.0, 1.5) * (uUseBarkMap > 0.5 ? 0.42 : 0.24);
  if (bumpStrength > 0.001) {
    vec3 dPosX = dFdx(vViewPosition);
    vec3 dPosY = dFdy(vViewPosition);
    vec3 r1 = cross(dPosY, normal);
    vec3 r2 = cross(normal, dPosX);
    float det = dot(dPosX, r1);
    if (abs(det) > 1e-7) {
      float dHx = dFdx(barkHeightVal);
      float dHy = dFdy(barkHeightVal);
      vec3 surfGrad = sign(det) * (dHx * r1 + dHy * r2);
      normal = normalize(abs(det) * normal - bumpStrength * surfGrad);
    }
  }
}`)
  }
  return material
}

/** 3D procedural plant stem material (zero UV tiling) for flowerbeds. */
export function makeStemMaterial() {
  const material = new MeshStandardMaterial({
    name: 'FlowerStems',
    vertexColors: true,
    roughness: .84,
    metalness: 0,
    side: DoubleSide,
  })
  material.userData.procUniforms = { kind: 'stem' }
  material.customProgramCacheKey = () => 'procedural-stem-v1'
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vStemObjPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vStemObjPos = position;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vStemObjPos;
float stemHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float stemNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(stemHash(i), stemHash(i + vec3(1,0,0)), f.x), mix(stemHash(i + vec3(0,1,0)), stemHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(stemHash(i + vec3(0,0,1)), stemHash(i + vec3(1,0,1)), f.x), mix(stemHash(i + vec3(0,1,1)), stemHash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float fiber = stemNoise(vec3(vStemObjPos.x * 26.0, vStemObjPos.y * 5.0, vStemObjPos.z * 26.0));
  diffuseColor.rgb *= 0.90 + 0.20 * fiber;
}`)
  }
  return material
}

/** 3D procedural translucent petal material (zero UV tiling) for drifting ambient petals. */
export function makePetalMaterial() {
  const material = new MeshStandardMaterial({
    name: 'AmbientPetals',
    vertexColors: true,
    roughness: .56,
    metalness: 0,
    side: DoubleSide,
  })
  material.userData.procUniforms = { kind: 'petal' }
  material.customProgramCacheKey = () => 'procedural-petal-v1'
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vPetalObjPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vPetalObjPos = position;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vPetalObjPos;`)
      .replace('#include <dithering_fragment>', `
{
  float glow = 0.5 + 0.5 * sin(vPetalObjPos.x * 7.0 + vPetalObjPos.y * 5.0 + vPetalObjPos.z * 6.0);
  gl_FragColor.rgb += diffuseColor.rgb * (0.14 + 0.10 * glow);
}
#include <dithering_fragment>`)
  }
  return material
}

/** Small 128x128 swatch shown ONLY in the inspector thumbnail when default GPU procedural bark is active. */
export function makeProceduralBarkPreview(size = 128): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const r = rng(20261120)
  const grad = g.createLinearGradient(0, 0, size, 0)
  grad.addColorStop(0, '#4f3d33')
  grad.addColorStop(.35, '#6d5648')
  grad.addColorStop(.68, '#554137')
  grad.addColorStop(1, '#4f3d33')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  // Flowing organic vertical bark grooves + subtle horizontal lenticels
  for (let i = 0; i < 42; i++) {
    const x0 = r() * size
    g.strokeStyle = i % 3 === 0 ? 'rgba(32, 22, 18, 0.45)' : 'rgba(155, 132, 114, 0.28)'
    g.lineWidth = 1.2 + r() * 2.6
    g.beginPath()
    g.moveTo(x0, 0)
    const swing = (r() - .5) * 18
    g.bezierCurveTo(x0 + swing, size * .33, x0 - swing * .7, size * .66, x0 + (r() - .5) * 8, size)
    g.stroke()
  }
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = 'rgba(28, 18, 16, 0.35)'
    g.lineWidth = 1.2
    const x = r() * size, y = r() * size, w = 8 + r() * 14
    g.beginPath()
    g.moveTo(x - w * .5, y)
    g.lineTo(x + w * .5, y + (r() - .5) * 2)
    g.stroke()
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.name = 'procedural_bark_3d'
  return tex
}

/** Loads a user-selected bark image (PNG/JPG/WebP) configured for 3D triplanar anti-tiling projection. */
export function loadBarkTexture(file: File): Promise<Texture> {
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
        g.fillStyle = '#5b4636'
        g.fillRect(0, 0, w, h)
        g.drawImage(img, 0, 0, w, h)
        const texture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        texture.wrapS = RepeatWrapping
        texture.wrapT = RepeatWrapping
        texture.anisotropy = 8
        texture.generateMipmaps = true
        texture.name = file.name.replace(/\.[^.]+$/, '')
        resolve(texture)
      } catch (err) { reject(err) }
      finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法解码树干贴图')) }
    img.src = url
  })
}
