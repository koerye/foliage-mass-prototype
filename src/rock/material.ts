import { Color, MeshStandardMaterial } from 'three'
import type { RockSpec } from './spec'

export type RockViewMode = 'final' | 'clay' | 'wireframe'

export interface RockMaterialUniforms {
  uBaseColor: { value: Color }
  uShadowColor: { value: Color }
  uEdgeColor: { value: Color }
  uTopColor: { value: Color }
  uEdgeWear: { value: number }
  uEdgeBreakup: { value: number }
  uCavityAO: { value: number }
  uFacetVar: { value: number }
  uGrain: { value: number }
  uTopActive: { value: number }
  uTopCoverage: { value: number }
  uTopSoftness: { value: number }
  uStyle: { value: number }      // 0 = painterly, 1 = cel
  uViewMode: { value: number }   // 0 = final, 1 = clay
  uSeedOffset: { value: number }
}

const ROCK_GLSL_HELPERS = /* glsl */ `
float rockHash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float rockNoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(rockHash31(i + vec3(0,0,0)), rockHash31(i + vec3(1,0,0)), f.x),
        mix(rockHash31(i + vec3(0,1,0)), rockHash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(rockHash31(i + vec3(0,0,1)), rockHash31(i + vec3(1,0,1)), f.x),
        mix(rockHash31(i + vec3(0,1,1)), rockHash31(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}
float rockFbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * rockNoise3(p);
    p = p * 2.06 + vec3(13.7, 7.3, 19.1);
    a *= 0.5;
  }
  return v;
}
`

export function makeRockMaterial(spec: RockSpec, viewMode: RockViewMode = 'final'): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    name: 'Mat_Stylized_Rock',
    color: 0xffffff,
    vertexColors: true,
    roughness: spec.shading.roughness,
    metalness: 0.0,
    wireframe: viewMode === 'wireframe',
  })

  const uniforms: RockMaterialUniforms = {
    uBaseColor: { value: new Color(spec.shading.baseColor) },
    uShadowColor: { value: new Color(spec.shading.shadowColor) },
    uEdgeColor: { value: new Color(spec.shading.edgeColor) },
    uTopColor: { value: new Color(spec.top.color) },
    uEdgeWear: { value: spec.shading.edgeWear },
    uEdgeBreakup: { value: spec.shading.edgeBreakup },
    uCavityAO: { value: spec.shading.cavityAO },
    uFacetVar: { value: spec.shading.facetVariation },
    uGrain: { value: spec.shading.grain },
    uTopActive: { value: spec.top.mode === 'none' ? 0 : 1 },
    uTopCoverage: { value: spec.top.coverage },
    uTopSoftness: { value: spec.top.softness },
    uStyle: { value: spec.style === 'cel' ? 1 : 0 },
    uViewMode: { value: viewMode === 'clay' ? 1 : 0 },
    uSeedOffset: { value: (spec.seed % 997) * 0.137 },
  }
  mat.userData.rockUniforms = uniforms

  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 rockData;
varying vec4 vRockData;
varying vec3 vRockObjPos;
varying vec3 vRockWorldNorm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRockData = rockData;
vRockObjPos = position;
vRockWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uBaseColor;
uniform vec3 uShadowColor;
uniform vec3 uEdgeColor;
uniform vec3 uTopColor;
uniform float uEdgeWear;
uniform float uEdgeBreakup;
uniform float uCavityAO;
uniform float uFacetVar;
uniform float uGrain;
uniform float uTopActive;
uniform float uTopCoverage;
uniform float uTopSoftness;
uniform float uStyle;
uniform float uViewMode;
uniform float uSeedOffset;
varying vec4 vRockData;
varying vec3 vRockObjPos;
varying vec3 vRockWorldNorm;
${ROCK_GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float rockEdgeMask = 0.0;
float rockTopMask = 0.0;
float rockPlaneShade = 1.0;
float rockMicroH = 0.5;
if (uViewMode > 0.5) {
  diffuseColor.rgb = vec3(0.49, 0.48, 0.46);
} else {
  vec3 wn0 = normalize(vRockWorldNorm);
  vec3 rp = vRockObjPos + vec3(uSeedOffset * 3.1, uSeedOffset * 1.7, uSeedOffset * 2.3);
  float broadMottle = smoothstep(0.24, 0.64, rockFbm3(rp * vec3(2.0, 2.7, 2.0)));
  float grain = rockNoise3(rp * 7.5 + vec3(4.2, 1.9, 8.7));
  float weathering = rockFbm3(rp * vec3(3.8, 7.8, 4.1) + vec3(grain * 0.55));
  float mineralStain = smoothstep(0.39, 0.61, weathering);
  rockMicroH = mix(grain, rockNoise3(rp * 14.0 + vec3(7.1, 2.8, 5.3)), 0.45);

  float facetTone = (vRockData.w - 0.5) * 2.0;
  rockPlaneShade = 1.0 + facetTone * uFacetVar * 0.24;

  vec3 col = uBaseColor * (rockPlaneShade + uGrain * ((broadMottle - 0.5) * 0.41 + (grain - 0.5) * 0.10));
  col = mix(col, col * vec3(0.69, 0.78, 0.88), mineralStain * uGrain * 0.92);
  col = mix(col, col * vec3(0.91, 0.98, 1.12), (1.0 - broadMottle) * 0.62);

  // Painterly cool shadow in cavities, underside & ground base
  col = mix(col, uShadowColor, vRockData.y * uCavityAO * 0.82);

  // Upward-facing top cap (sand / ochre / moss / snow) flowing organically over top ridges
  if (uTopActive > 0.5 && uTopCoverage > 0.005) {
    float thresh = mix(1.33, 0.55, uTopCoverage);
    float soft = mix(0.045, 0.26, uTopSoftness);
    float deposit = vRockData.z + (broadMottle - 0.5) * 0.13 + (grain - 0.5) * 0.045;
    rockTopMask = smoothstep(thresh - soft, thresh + soft, deposit);
    vec3 topTint = uTopColor * (0.84 + 0.23 * broadMottle - 0.12 * mineralStain);
    col = mix(col, topTint, rockTopMask * 0.78);
  }

  // Sunlit dry-brush edge wear (painterly) / crisp hand-drawn broken ridge strokes (cel)
  float dashNoise = rockNoise3(rp * 4.4 + vec3(2.3, 9.1, 4.7));
  float breakup = mix(1.0, smoothstep(0.20, 0.68, dashNoise), uEdgeBreakup);
  if (uStyle > 0.5) {
    // Crisp slim stroke on the ridge crest with clean hand-drawn gaps & connected 3-way Y-corners
    float crest = smoothstep(0.60, 0.80, vRockData.x);
    float celDash = mix(1.0, smoothstep(0.37, 0.43, dashNoise), uEdgeBreakup);
    float yCorner = smoothstep(0.84, 0.93, vRockData.x);
    rockEdgeMask = crest * max(celDash, yCorner * 0.92) * uEdgeWear * 0.94;
  } else {
    // Upper/sun-facing chamfer ridges catch crisp stone-dust dry-brush wear; dark underside edges stay grounded
    float crestWear = smoothstep(0.32, 0.88, vRockData.x);
    float sunBias = smoothstep(-0.35, 0.45, wn0.y * 0.65 + 0.35) * (1.0 - vRockData.y * 0.48);
    float capDamp = 1.0 - rockTopMask * 0.54;
    rockEdgeMask = clamp(crestWear * sunBias * breakup * capDamp * uEdgeWear * 0.62, 0.0, 0.74);
    col = mix(col, uEdgeColor, rockEdgeMask);
  }

  diffuseColor.rgb = col;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (uViewMode < 0.5 && uStyle < 0.5 && uGrain > 0.01) {
  float bumpAmp = uGrain * 0.045 * (1.0 - rockTopMask * 0.55);
  vec3 dPosX = dFdx(-vViewPosition);
  vec3 dPosY = dFdy(-vViewPosition);
  float dHx = dFdx(rockMicroH);
  float dHy = dFdy(rockMicroH);
  vec3 r1 = cross(dPosY, normal);
  vec3 r2 = cross(normal, dPosX);
  float det = dot(dPosX, r1);
  if (abs(det) > 1e-8) {
    vec3 surfGrad = sign(det) * (dHx * r1 + dHy * r2);
    normal = normalize(abs(det) * normal - surfGrad * bumpAmp);
  }
}`)
      .replace('#include <opaque_fragment>', `
if (uViewMode < 0.5 && uStyle > 0.5) {
  // Crisp 4-band anime cel planes (lit top / mid side / cool slate shadow / deep wedge) + broken pale ridge strokes.
  // Dynamically follows directionalLights[0] direction & color so studio lighting moods visibly drive rock cel shading.
  float ndl;
  vec3 keyTint = vec3(1.0);
  float keyGain = 1.0;
#if NUM_DIR_LIGHTS > 0
  ndl = dot(normalize(normal), normalize(directionalLights[0].direction));
  vec3 rawDirCol = directionalLights[0].color;
  float dirLum = max(dot(rawDirCol, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  keyTint = clamp(rawDirCol / dirLum, vec3(0.65), vec3(1.35));
  keyGain = clamp(dirLum / 2.15, 0.72, 1.32);
#else
  vec3 wn = normalize(vRockWorldNorm);
  ndl = dot(wn, normalize(vec3(0.24, 0.82, 0.52)));
#endif
  float litBand = smoothstep(0.54, 0.60, ndl);
  float midBand = smoothstep(0.14, 0.20, ndl);
  float shadeBand = smoothstep(-0.24, -0.18, ndl);

  vec3 litLight = mix(vec3(1.0), keyTint, 0.72) * mix(1.0, keyGain, 0.55);
  vec3 midLight = mix(vec3(1.0), keyTint, 0.45) * mix(1.0, keyGain, 0.35);
  vec3 shadeLight = mix(vec3(1.0), vec3(1.0) / max(keyTint, vec3(0.55)), 0.18) * mix(1.0, keyGain, 0.20);

  vec3 celLit = uBaseColor * (1.10 * rockPlaneShade) * litLight;
  vec3 celMid = mix(uShadowColor, uBaseColor, 0.64) * rockPlaneShade * midLight;
  vec3 celShade = uShadowColor * (1.02 + 0.08 * (vRockData.w - 0.5)) * shadeLight;
  vec3 celDeep = uShadowColor * 0.66 * shadeLight;

  vec3 celCol = mix(celDeep, celShade, shadeBand);
  celCol = mix(celCol, celMid, midBand);
  celCol = mix(celCol, celLit, litBand);

  if (rockTopMask > 0.01) {
    celCol = mix(celCol, uTopColor * (0.87 + 0.11 * litBand) * mix(midLight, litLight, litBand), rockTopMask * 0.83);
  }

  // Luminous crisp broken ridge strokes sit cleanly on top of cel planes
  celCol = mix(celCol, uEdgeColor * 1.14 * mix(vec3(1.0), litLight, 0.5), rockEdgeMask);
  outgoingLight = celCol;
}
#include <opaque_fragment>`)
  }

  mat.customProgramCacheKey = () => 'stylized-rock-v4'
  return mat
}

export function updateRockMaterialLive(mat: MeshStandardMaterial, spec: RockSpec, viewMode: RockViewMode) {
  const u = mat.userData.rockUniforms as RockMaterialUniforms | undefined
  mat.roughness = spec.shading.roughness
  mat.wireframe = viewMode === 'wireframe'
  if (!u) return
  u.uBaseColor.value.set(spec.shading.baseColor)
  u.uShadowColor.value.set(spec.shading.shadowColor)
  u.uEdgeColor.value.set(spec.shading.edgeColor)
  u.uTopColor.value.set(spec.top.color)
  u.uEdgeWear.value = spec.shading.edgeWear
  u.uEdgeBreakup.value = spec.shading.edgeBreakup
  u.uCavityAO.value = spec.shading.cavityAO
  u.uFacetVar.value = spec.shading.facetVariation
  u.uGrain.value = spec.shading.grain
  u.uTopActive.value = spec.top.mode === 'none' ? 0 : 1
  u.uTopCoverage.value = spec.top.coverage
  u.uTopSoftness.value = spec.top.softness
  u.uStyle.value = spec.style === 'cel' ? 1 : 0
  u.uViewMode.value = viewMode === 'clay' ? 1 : 0
  u.uSeedOffset.value = (spec.seed % 997) * 0.137
}
