// Procedural 3D object-space & flow-UV wood/bark, stem, and petal materials.
// - Default bark: pure GPU 3D domain-warped fBM bark fissures, lenticels, analytic bump,
//   and procedural roughness modulation.
// - Custom imported bark image: 3D object-space triplanar projection + Voronoi/stochastic non-tiling
//   blending with organic domain warp, OR seamless twist-aligned Flow UV with silky chain-rule analytic bump.
import {
  CanvasTexture, Color, DataTexture, DoubleSide, MeshStandardMaterial,
  RepeatWrapping, RGBAFormat, SRGBColorSpace, Texture, Vector2,
} from 'three'
import { rng } from '../shape'
import { analyzeTextureColor, RECOLOR_GLSL_HELPERS } from './color-recolor'

/** Global 0 ms neutral grey-clay inspection mode shared by all bark materials (for pure geometry volume & collar review). */
export const barkClayView = {
  uBarkClay: { value: 0 },
}

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
  /** Trunk barkColor hex so custom imported/painted bark normalizes vertex AO without crushing brightness */
  baseColor?: string
  /** World-space upward-facing & root-crevice 3D velvety moss coverage (0..1, default 0) */
  moss?: number
  /** World-space 3D moss base hex color (default #5d9132) */
  mossColor?: string
  /** Root-collar contact AO & earth dampness near ground y = 0 (0..1, default 0.25) */
  rootAO?: number
  /** UV mapping mode: 'triplanar' (3D object-space non-tiling) | 'flow' (seamless twist-aligned cylindrical flow UV) */
  uvMode?: 'triplanar' | 'flow'
  /** Automatic micro-wrinkle normal boost when LOD lowers wood mesh subdivision (0..1) */
  lodNormalBoost?: number
  /** Sculpted bark wrinkle intensity hint for flow-aligned fine wood fiber grain (0..1) */
  sculptIntensity?: number
  /** True when geometry carries per-vertex `barkMetric` radius ratio attribute (attenuates Moiré on thin limbs/twigs) */
  hasMetric?: boolean
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

// Smooth periodic flow-bark height evaluator with pixel-coverage anti-aliasing (aaOct2 attenuates fine octave
// smoothly before Nyquist so thin branches & twigs NEVER exhibit zipper-dot Moiré!)
float barkFlowHeightAt(vec2 uv, float bScale, float aaOct2) {
  float ang = uv.x * 6.2831853;
  float fv = uv.y * bScale;
  vec3 fc = vec3(cos(ang) * 1.6 * bScale, fv * 0.95, sin(ang) * 1.6 * bScale);
  float fw = (barkFbm3(fc + vec3(4.1, 1.3, 7.2)) - 0.5) * 0.72;
  float angW = ang + fw;
  vec3 fStr = vec3(cos(angW) * 3.2 * bScale, fv * 0.75, sin(angW) * 3.2 * bScale);
  float r1 = 1.0 - abs(barkFbm3(fStr) * 2.0 - 1.0);
  float h = r1 * r1;
  if (aaOct2 > 0.01) {
    float r2 = 1.0 - abs(barkNoise3(fStr * vec3(1.9, 1.6, 1.9) + vec3(9.1, 3.7, 2.5)) * 2.0 - 1.0);
    h = mix(h, h * 0.74 + r2 * r2 * 0.26, aaOct2);
  }
  return clamp(h, 0.0, 1.0);
}

// Stochastic cell-jittered anti-tiling sampler (inspired by IQ textureNoTile):
// Eliminates visible grid repetition even on non-seamless photos while keeping
// bark grain mostly upright (gentle +-15 deg jitter) and mipmaps artifact-free via textureGrad.
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
        float ang = (h.x - 0.5) * 0.52;
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
  float warp = (barkNoise3(objPos * (1.7 * scale)) - 0.5) * 0.14;
  vec3 p = (objPos + vec3(warp, warp * 0.45, -warp)) * scale;
  vec3 cx = barkSampleNoTile(samp, vec2(p.z, p.y));
  vec3 cy = barkSampleNoTile(samp, vec2(p.x, p.z));
  vec3 cz = barkSampleNoTile(samp, vec2(p.x, p.y));
  vec3 fine = cx * w.x + cy * w.y + cz * w.z;

  vec3 pm = p * 0.41 + vec3(3.7, 1.9, 5.3);
  vec3 mx = barkSampleNoTile(samp, vec2(pm.z, pm.y));
  vec3 my = barkSampleNoTile(samp, vec2(pm.x, pm.z));
  vec3 mz = barkSampleNoTile(samp, vec2(pm.x, pm.y));
  vec3 macro = mx * w.x + my * w.y + mz * w.z;
  return mix(fine, macro, 0.24);
}
`

/** 100% procedural 3D object-space OR twist-aligned Flow-UV bark material.
 *  Supports optional imported/Substance bark image, LOD normal compensation, and 3D world-space moss. */
export function makeBarkMaterial(customMap: Texture | undefined, options: BarkStyleOptions = {}) {
  const isFlow = options.uvMode === 'flow'
  const customNormal = isFlow ? (customMap?.userData?.normalMap as Texture | undefined) : undefined
  const customRoughness = isFlow ? (customMap?.userData?.roughnessMap as Texture | undefined) : undefined
  const detailVal = options.detail ?? .72
  const lodBoost = options.lodNormalBoost ?? 0
  const material = new MeshStandardMaterial({
    name: customMap ? (isFlow ? 'BarkFlowSculpted' : 'BarkProceduralTriplanar') : (isFlow ? 'BarkFlowProcedural' : 'BarkProcedural'),
    vertexColors: true,
    roughness: customRoughness ? 1.0 : (options.roughness ?? .92),
    metalness: 0,
    ...(customNormal ? { normalMap: customNormal, normalScale: new Vector2(0.45 + detailVal * 0.45 + lodBoost * 0.45, 0.45 + detailVal * 0.45 + lodBoost * 0.45) } : {}),
    ...(customRoughness ? { roughnessMap: customRoughness } : {}),
  })
  const hasMap = Boolean(customMap)
  const barkTexStats = analyzeTextureColor(customMap, 'bark')
  const baseCol = new Color(options.baseColor || '#5b4636')
  const baseLum = Math.max(.03, baseCol.r * .2126 + baseCol.g * .7152 + baseCol.b * .0722)
  const mossCol = new Color(options.mossColor || '#5d9132')
  const uniforms = {
    uBarkMap: { value: customMap ?? getDummyBarkTex() },
    uUseBarkMap: { value: hasMap ? 1 : 0 },
    uBarkScale: { value: options.scale ?? 1.0 },
    uBarkDetail: { value: detailVal },
    uBarkTint: { value: options.tint ?? .45 },
    uBarkTargetColor: { value: baseCol },
    uBarkTexMeanH: { value: barkTexStats.meanH },
    uBarkTexMeanS: { value: barkTexStats.meanS },
    uBarkTexMeanL: { value: barkTexStats.meanL },
    uBarkShadowShift: { value: options.shadowShift ?? .24 },
    uBarkBaseLum: { value: baseLum },
    uBarkMoss: { value: options.moss ?? 0 },
    uBarkMossColor: { value: mossCol },
    uBarkRootAO: { value: options.rootAO ?? .25 },
    uBarkUvMode: { value: isFlow ? 1 : 0 },
    uBarkLodBoost: { value: lodBoost },
    uBarkSculpt: { value: options.sculptIntensity ?? 0 },
    uHasBarkMetric: { value: options.hasMetric ? 1 : 0 },
    uHasCustomNormal: { value: customNormal ? 1 : 0 },
    uBarkClay: barkClayView.uBarkClay,
  }
  material.userData.barkUniforms = uniforms
  if (customMap) material.userData.barkMap = customMap
  material.customProgramCacheKey = () => 'procedural-bark-v7'
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float barkMetric;
varying vec3 vBarkObjPos;
varying vec3 vBarkObjNorm;
varying vec3 vBarkWorldNorm;
varying vec2 vBarkFlowUv;
varying float vBarkMetric;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBarkObjPos = position;
vBarkObjNorm = normalize(normal);
vBarkWorldNorm = normalize(mat3(modelMatrix) * normal);
vBarkFlowUv = uv;
vBarkMetric = barkMetric;`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uBarkMap;
uniform float uUseBarkMap;
uniform float uBarkScale;
uniform float uBarkDetail;
uniform float uBarkTint;
uniform vec3 uBarkTargetColor;
uniform float uBarkTexMeanH;
uniform float uBarkTexMeanS;
uniform float uBarkTexMeanL;
uniform float uBarkShadowShift;
uniform float uBarkBaseLum;
uniform float uBarkMoss;
uniform vec3 uBarkMossColor;
uniform float uBarkRootAO;
uniform float uBarkUvMode;
uniform float uBarkLodBoost;
uniform float uBarkSculpt;
uniform float uHasBarkMetric;
uniform float uHasCustomNormal;
uniform float uBarkClay;
varying vec3 vBarkObjPos;
varying vec3 vBarkObjNorm;
varying vec3 vBarkWorldNorm;
varying vec2 vBarkFlowUv;
varying float vBarkMetric;
${RECOLOR_GLSL_HELPERS}
${BARK_GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float barkHeightVal = 0.5;
float barkRoughMod = 0.0;
vec2 barkFlowGrad = vec2(0.0);
float barkAA = 1.0;
if (uBarkClay > 0.5) {
  // Pure neutral matte clay mode: strips texture, procedural grain, bump & moss for honest 3D volume inspection
  diffuseColor.rgb = vec3(0.46, 0.43, 0.40);
  barkRoughMod = -0.06;
  barkAA = 0.0;
} else {
  float bScale = max(0.15, uBarkScale);
  float uTile = max(1.0, floor(bScale + 0.5)); // Matches CPU barkFlowTileU() integer repeat!
  float metricW = uHasBarkMetric > 0.5 ? clamp(vBarkMetric, 0.08, 1.35) : 1.0;
  float branchAtten = smoothstep(0.09, 0.42, metricW);
  vec2 duvX_aa = dFdx(vBarkFlowUv);
  vec2 duvY_aa = dFdy(vBarkFlowUv);
  float pxCov = max(
    max(abs(duvX_aa.x), abs(duvY_aa.x)) * uTile,
    max(abs(duvX_aa.y), abs(duvY_aa.y)) * bScale * 0.85
  );
  float aaOct1 = 1.0 - smoothstep(0.045, 0.20, pxCov);
  float aaOct2 = 1.0 - smoothstep(0.014, 0.075, pxCov);
  barkAA = (uBarkUvMode > 0.5 ? (aaOct1 * branchAtten) : 1.0);

  vec3 bp = vBarkObjPos * bScale;
  vec3 warpVec = vec3(
    barkNoise3(bp * 1.85 + vec3(2.1, 0.0, 5.4)) - 0.5,
    barkNoise3(bp * 1.05 + vec3(7.3, 4.2, 1.8)) - 0.5,
    barkNoise3(bp * 1.85 + vec3(9.1, 3.3, 6.7)) - 0.5
  );
  vec3 fiberCoord = vec3(bp.x * 6.8, bp.y * 1.35, bp.z * 6.8) + warpVec * 1.25;
  float ridges = barkFbm3(fiberCoord);
  float fineGrain = barkNoise3(fiberCoord * 2.4);
  float lenticelMask = smoothstep(0.76, 0.92, barkNoise3(vec3(bp.x * 8.5, bp.y * 26.0, bp.z * 8.5) + warpVec * 0.45));

  // Flow-UV anti-aliased fibrous grain + true CENTERED difference gradient (zero pixel-quad aliasing & zero thin-twig Moiré!)
  if (uBarkUvMode > 0.5) {
    float effScale = bScale * (0.45 + 0.55 * branchAtten);
    float flowH = barkFlowHeightAt(vBarkFlowUv, effScale, aaOct2 * branchAtten);
    float epsU = 0.0055;
    float epsV = 0.0055;
    if (barkAA > 0.01) {
      float huP = barkFlowHeightAt(vBarkFlowUv + vec2(epsU, 0.0), effScale, aaOct2 * branchAtten);
      float huM = barkFlowHeightAt(vBarkFlowUv - vec2(epsU, 0.0), effScale, aaOct2 * branchAtten);
      float hvP = barkFlowHeightAt(vBarkFlowUv + vec2(0.0, epsV), effScale, aaOct2 * branchAtten);
      float hvM = barkFlowHeightAt(vBarkFlowUv - vec2(0.0, epsV), effScale, aaOct2 * branchAtten);
      barkFlowGrad = vec2((huP - huM) / (2.0 * epsU), (hvP - hvM) / (2.0 * epsV)) * barkAA;
    }
    ridges = mix(0.5, flowH, 0.85 * aaOct1 * branchAtten);
    fineGrain = mix(0.5, flowH, aaOct2 * branchAtten);
  }
  float fissure = smoothstep(0.22, 0.78, ridges);

  if (uUseBarkMap > 0.5) {
    vec3 texSample;
    if (uBarkUvMode > 0.5) {
      float vTile = bScale * 0.85;
      vec2 fuv = vec2(vBarkFlowUv.x * uTile, vBarkFlowUv.y * vTile);
      texSample = texture2D(uBarkMap, fuv).rgb;
      if (barkAA > 0.01) {
        float tU1 = dot(texture2D(uBarkMap, fuv + vec2(0.003, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
        float tU0 = dot(texture2D(uBarkMap, fuv - vec2(0.003, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
        float tV1 = dot(texture2D(uBarkMap, fuv + vec2(0.0, 0.003)).rgb, vec3(0.299, 0.587, 0.114));
        float tV0 = dot(texture2D(uBarkMap, fuv - vec2(0.0, 0.003)).rgb, vec3(0.299, 0.587, 0.114));
        barkFlowGrad = mix(barkFlowGrad, vec2((tU1 - tU0) / 0.006 * uTile, (tV1 - tV0) / 0.006 * vTile) * barkAA, 0.82);
      }
    } else {
      texSample = barkSampleTriplanar(uBarkMap, vBarkObjPos, vBarkObjNorm, bScale * 0.85);
    }
    float vLum = max(0.015, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
    float relAo = clamp(vLum / max(0.03, uBarkBaseLum), 0.18, 1.55);
    float aoShade = mix(0.46, 1.18, smoothstep(0.22, 1.18, relAo));
    vec3 neutralTex = texSample * aoShade;
    vec3 recoloredTex = recTransferColor(texSample, uBarkTargetColor, uBarkTexMeanH, uBarkTexMeanS, uBarkTexMeanL, 0.55) * aoShade;
    diffuseColor.rgb = mix(neutralTex, recoloredTex, clamp(uBarkTint, 0.0, 1.0));
    float texLum = dot(texSample, vec3(0.299, 0.587, 0.114));
    barkHeightVal = mix(ridges, texLum, 0.74);
    barkRoughMod = (0.5 - texLum) * 0.22 * clamp(uBarkDetail, 0.0, 1.5) * barkAA;
  } else {
    // When geometric sculpt is active, keep procedural albedo subtle so macro sculpted ribs & crevices read clearly!
    float det = clamp(uBarkDetail + uBarkLodBoost * 0.25, 0.0, 1.5);
    float sculptW = clamp(uBarkSculpt, 0.0, 1.0);
    float grainAmt = min(1.0, det * (uBarkUvMode > 0.5 ? mix(0.75, 0.44, sculptW) : 0.84)) * (uBarkUvMode > 0.5 ? (0.18 + 0.82 * barkAA) : 1.0);
    float pattern = mix(1.0, 0.85 + 0.26 * fissure + (fineGrain - 0.5) * 0.08 - lenticelMask * 0.025 * (1.0 - sculptW * 0.7), grainAmt);
    vec3 warmRidge = diffuseColor.rgb * mix(vec3(1.05, 1.03, 1.00), vec3(1.07, 1.05, 1.03), sculptW);
    vec3 coolCrevice = diffuseColor.rgb * mix(vec3(0.80, 0.78, 0.82), vec3(0.72, 0.70, 0.76), clamp(uBarkShadowShift, 0.0, 1.0));
    diffuseColor.rgb = mix(coolCrevice, warmRidge, mix(0.5, fissure, grainAmt)) * pattern;
    barkHeightVal = ridges * 0.78 + fineGrain * 0.18 - lenticelMask * 0.03;
    barkRoughMod = (0.52 - fissure) * 0.16 * det * barkAA;
  }

  // Root-base earthy contact grounding shadow near y = 0 (grounds flared roots into terrain)
  float rootAoAmt = clamp(uBarkRootAO, 0.0, 1.0);
  if (rootAoAmt > 0.001) {
    float rootLift = smoothstep(0.0, 1.35, vBarkObjPos.y);
    float rootShade = mix(1.0 - rootAoAmt * 0.34, 1.0, rootLift);
    vec3 earthTint = mix(vec3(0.86, 0.90, 0.84), vec3(1.0), rootLift);
    diffuseColor.rgb *= rootShade * earthTint;
  }

  // 3D World-Space Upward-Facing & Root-Crevice Stylized Moss (dappled velvety moss + exposed driftwood ridge crests!)
  float mossAmt = clamp(uBarkMoss, 0.0, 1.0);
  if (mossAmt > 0.001) {
    vec3 wn = normalize(vBarkWorldNorm);
    float upSun = smoothstep(0.22, 0.78, wn.y);
    float crevBias = 1.0 - smoothstep(0.24, 0.76, barkHeightVal);
    float rootDamp = (1.0 - smoothstep(0.04, 1.55, vBarkObjPos.y)) * smoothstep(-0.18, 0.34, wn.y) * (0.35 + 0.65 * crevBias);
    float macroPatch = barkFbm3(vBarkObjPos * vec3(1.85, 1.35, 1.85) + vec3(4.1, 1.7, 8.3));
    float tuft = barkFbm3(vBarkObjPos * 5.8 + vec3(1.3, 5.1, 2.7));
    float fineBrush = barkNoise3(vBarkObjPos * vec3(14.0, 7.5, 14.0));
    float mField = upSun * 0.48 + rootDamp * 0.28 + crevBias * 0.26 + (macroPatch - 0.50) * 0.72 + (tuft - 0.50) * 0.30 + (fineBrush - 0.50) * 0.12;
    float mThresh = mix(1.06, 0.24, mossAmt);
    float mossMask = smoothstep(mThresh - 0.065, mThresh + 0.075, mField);
    float aoRim = smoothstep(mThresh - 0.16, mThresh - 0.015, mField) * (1.0 - mossMask);
    diffuseColor.rgb *= (1.0 - aoRim * 0.22);
    vec3 mossHi = uBarkMossColor * vec3(1.36, 1.24, 0.68);
    vec3 mossMid = uBarkMossColor * vec3(0.84, 0.94, 0.68);
    vec3 mossLo = uBarkMossColor * vec3(0.32, 0.50, 0.44);
    float ml = clamp(0.18 + upSun * 0.44 + (macroPatch - 0.35) * 0.36 + (tuft - 0.45) * 0.48, 0.0, 1.0);
    float mq = floor(ml * 5.0);
    float mf = smoothstep(0.20, 0.80, ml * 5.0 - mq);
    float mt = (mq + mf) * 0.20;
    vec3 mossCol = mt < 0.5 ? mix(mossLo, mossMid, mt * 2.0) : mix(mossMid, mossHi, (mt - 0.5) * 2.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, mossMask * (0.80 + 0.14 * smoothstep(0.3, 0.9, mossMask)));
    barkRoughMod = mix(barkRoughMod, 0.14, mossMask);
    barkHeightVal = mix(barkHeightVal, 0.54 + tuft * 0.22, mossMask * 0.68);
  }
}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
if (uBarkClay < 0.5) {
  float rScale = max(0.15, uBarkScale);
  vec2 rUv = uBarkUvMode > 0.5
    ? vec2(vBarkFlowUv.x * max(1.0, floor(rScale + 0.5)), vBarkFlowUv.y * (rScale * 0.85))
    : vRoughnessMapUv;
  roughnessFactor *= texture2D( roughnessMap, rUv ).g;
}
#endif
roughnessFactor = clamp(roughnessFactor + barkRoughMod, 0.58, 0.99);`)
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP_TANGENTSPACE
if (uBarkClay < 0.5) {
  float nScale = max(0.15, uBarkScale);
  vec2 nUv = uBarkUvMode > 0.5
    ? vec2(vBarkFlowUv.x * max(1.0, floor(nScale + 0.5)), vBarkFlowUv.y * (nScale * 0.85))
    : vNormalMapUv;
  vec3 mapN = texture2D( normalMap, nUv ).xyz * 2.0 - 1.0;
  #if defined( USE_PACKED_NORMALMAP )
    mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
  #endif
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
}
#endif
{
  // Smooth anti-aliased chain-rule bump mapping (attenuated when real tangent normalMap is bound & disabled in clay mode!)
  float customNormAtten = uHasCustomNormal > 0.5 ? 0.18 : 1.0;
  float bumpStrength = (clamp(uBarkDetail, 0.0, 1.5) * (uUseBarkMap > 0.5 ? 0.30 * customNormAtten : (uBarkUvMode > 0.5 ? 0.14 : 0.22)) + uBarkLodBoost * 0.16) * barkAA;
  if (uBarkClay < 0.5 && bumpStrength > 0.001) {
    vec3 dPosX = dFdx(-vViewPosition);
    vec3 dPosY = dFdy(-vViewPosition);
    vec3 r1 = cross(dPosY, normal);
    vec3 r2 = cross(normal, dPosX);
    float det = dot(dPosX, r1);
    if (abs(det) > 1e-7) {
      float dHx, dHy;
      if (uBarkUvMode > 0.5) {
        vec2 duvX = dFdx(vBarkFlowUv);
        vec2 duvY = dFdy(vBarkFlowUv);
        dHx = clamp(dot(barkFlowGrad, duvX), -0.28, 0.28);
        dHy = clamp(dot(barkFlowGrad, duvY), -0.28, 0.28);
      } else {
        dHx = clamp(dFdx(barkHeightVal), -0.22, 0.22);
        dHy = clamp(dFdy(barkHeightVal), -0.22, 0.22);
      }
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

/** Loads a user-selected bark image (PNG/JPG/WebP) configured for 3D triplanar / Flow-UV projection. */
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
