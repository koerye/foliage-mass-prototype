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
  uCracks: { value: number }
  uTopActive: { value: number }
  uTopCoverage: { value: number }
  uTopSoftness: { value: number }
  uStyle: { value: number }      // 0 = painterly, 1 = cel, 2 = handpainted
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

function styleToUniform(style: RockSpec['style']): number {
  return style === 'handpainted' ? 2 : style === 'cel' ? 1 : 0
}

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
    uCracks: { value: spec.detail.cracks },
    uTopActive: { value: spec.top.mode === 'none' ? 0 : 1 },
    uTopCoverage: { value: spec.top.coverage },
    uTopSoftness: { value: spec.top.softness },
    uStyle: { value: styleToUniform(spec.style) },
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
uniform float uCracks;
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
float rockBroadBrush = 0.5;
if (uViewMode > 0.5) {
  diffuseColor.rgb = vec3(0.49, 0.48, 0.46);
} else {
  vec3 wn0 = normalize(vRockWorldNorm);
  vec3 rp = vRockObjPos + vec3(uSeedOffset * 3.1, uSeedOffset * 1.7, uSeedOffset * 2.3);
  float broadMottle = smoothstep(0.24, 0.64, rockFbm3(rp * vec3(2.0, 2.7, 2.0)));
  rockBroadBrush = broadMottle;
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

  // Sunlit dry-brush edge wear (painterly) / crisp hand-drawn broken ridge strokes (cel / handpainted)
  float dashNoise = rockNoise3(rp * 4.4 + vec3(2.3, 9.1, 4.7));
  float breakup = mix(1.0, smoothstep(0.20, 0.68, dashNoise), uEdgeBreakup);
  if (uStyle > 1.5) {
    // Soft-turned painterly bevel highlight: broader painterly brushstroke along convex crests & Y-corners (never CAD wireframe!)
    float crest = smoothstep(0.30, 0.86, vRockData.x);
    float yCorner = smoothstep(0.76, 0.94, vRockData.x);
    float hpBreak = mix(1.0, smoothstep(0.24, 0.72, dashNoise), uEdgeBreakup);
    rockEdgeMask = clamp(crest * max(hpBreak, yCorner * 0.88) * uEdgeWear, 0.0, 1.0);
  } else if (uStyle > 0.5) {
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
if (uViewMode < 0.5 && uStyle > 1.5) {
  // Hand-painted concept-art stylized rock:
  // Sculptural 3/4 cross-lit warm sandstone planes (4 rich values: sunlit biscuit -> taupe mid ->
  // chocolate umber shadow -> deep espresso crevice) + razor-thin fwidth-AA angular cleavage cracks
  // with crisp paired sunlit lips + warm painterly bevel crest highlights.
  vec3 wn = normalize(vRockWorldNorm);
  vec3 keyTint = vec3(1.0);
  float keyGain = 1.0;
  vec3 rawKeyWorld = normalize(vec3(0.36, 0.81, 0.46));
#if NUM_DIR_LIGHTS > 0
  vec3 viewDirL = normalize(directionalLights[0].direction);
  rawKeyWorld = normalize((vec4(viewDirL, 0.0) * viewMatrix).xyz);
  vec3 rawDirCol = directionalLights[0].color;
  float dirLum = max(dot(rawDirCol, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  keyTint = clamp(rawDirCol / dirLum, vec3(0.76), vec3(1.24));
  keyGain = clamp(dirLum / 2.15, 0.78, 1.24);
#endif
  // Rotate world key azimuth ~+72 deg & soften elevation for classic sculptural upper-left 3/4 cross-lighting
  // (stays 100% world-space locked as camera orbits, keeping ~65% lit/mid planes and ~35% rich warm umber shadow).
  vec3 keyWorld = normalize(vec3(
    rawKeyWorld.x * 0.309 - rawKeyWorld.z * 0.951,
    rawKeyWorld.y * 0.72,
    rawKeyWorld.x * 0.951 + rawKeyWorld.z * 0.309
  ));
  float ndl = dot(wn, keyWorld);

  // Crisp painterly 4-value bands with rich light-to-shadow separation and luminous readable shadows
  float litBand = smoothstep(0.42, 0.56, ndl);
  float midBand = smoothstep(0.06, 0.22, ndl);
  float shadeBand = smoothstep(-0.34, -0.14, ndl);

  // Subtle within-plane painterly gradient: warmer/brighter near upper sunlit face, grounded darker toward base
  float brushWash = 1.0 + (rockBroadBrush - 0.5) * (0.06 + uGrain * 0.13);
  float heightFactor = smoothstep(0.0, 1.15, vRockObjPos.y);
  float heightGrad = mix(0.87, 1.08, heightFactor);
  float planeSlope = mix(0.93, 1.07, clamp(ndl * 0.5 + 0.5, 0.0, 1.0));

  vec3 litLight = mix(vec3(1.0), keyTint, 0.48) * mix(1.0, keyGain, 0.34);
  vec3 midLight = mix(vec3(1.0), keyTint, 0.24) * mix(1.0, keyGain, 0.20);
  vec3 shadeLight = mix(vec3(1.0), vec3(0.94, 0.96, 1.05), 0.14) * mix(1.0, keyGain, 0.12);

  vec3 hpLit = uBaseColor * (1.13 * rockPlaneShade * brushWash * heightGrad * planeSlope) * litLight;
  vec3 hpMid = mix(uShadowColor, uBaseColor, 0.60) * (rockPlaneShade * brushWash * mix(0.90, 1.04, heightFactor)) * midLight;
  vec3 hpShade = uShadowColor * (1.06 + 0.12 * (vRockData.w - 0.5)) * mix(0.90, 1.05, heightFactor) * shadeLight;
  vec3 hpDeep = uShadowColor * (0.72 + 0.08 * (vRockData.w - 0.5)) * shadeLight;

  vec3 hpCol = mix(hpDeep, hpShade, shadeBand);
  hpCol = mix(hpCol, hpMid, midBand);
  hpCol = mix(hpCol, hpLit, litBand);

  // Delicate cool-warm bounce on grazing lower shadow planes so shadows stay luminous & painterly
  float bounce = smoothstep(-0.55, 0.22, -wn.y) * (1.0 - midBand) * 0.16;
  hpCol += uShadowColor * vec3(0.24, 0.20, 0.27) * bounce;

  // Grounded contact AO & concave crevice darkening (sharp dark V-clefts between interlocking slabs!)
  float cavDark = vRockData.y * uCavityAO * 0.68;
  hpCol = mix(hpCol, uShadowColor * 0.52, cavDark);

  // Optional top deposit (sand / moss / snow)
  if (rockTopMask > 0.01) {
    hpCol = mix(hpCol, uTopColor * (0.88 + 0.14 * litBand) * mix(midLight, litLight, litBand), rockTopMask * 0.80);
  }

  // Crisp straight-segmented angular cleavage cracks + incised groove shading + paired luminous sunlit cream lip
  // (2-4 bold hand-painted diagonal stone fractures per rock, leaving 85% clean smooth painted planes!)
  if (uCracks > 0.01) {
    vec3 rp = vRockObjPos + vec3(uSeedOffset * 1.9, uSeedOffset * 1.1, uSeedOffset * 2.7);
    float sAng = fract(uSeedOffset * 0.73) * 6.28318;
    float cs = cos(sAng), sn = sin(sAng);
    vec3 dirA = normalize(vec3(0.38 * cs - 0.26 * sn, 0.88, 0.38 * sn + 0.26 * cs));
    vec3 dirB = normalize(vec3(-0.66 * cs - 0.34 * sn, 0.58, -0.66 * sn + 0.34 * cs));

    // Low-amplitude piecewise-angular kinks -> straight-segmented chiseled rock fractures (zero curly squiggles!)
    float rA1 = abs(rockNoise3(rp * 1.35 + vec3(2.1, 5.7, 3.3)) - 0.5) * 2.0;
    float rA2 = abs(rockNoise3(rp * 3.10 + vec3(7.4, 1.2, 6.8)) - 0.5) * 2.0;
    float kinkA = (rA1 - 0.5) * 0.22 + (rA2 - 0.5) * 0.06;

    float rB1 = abs(rockNoise3(rp * 1.55 + vec3(6.3, 2.9, 8.1)) - 0.5) * 2.0;
    float rB2 = abs(rockNoise3(rp * 3.50 + vec3(1.5, 7.6, 4.2)) - 0.5) * 2.0;
    float kinkB = (rB1 - 0.5) * 0.20 + (rB2 - 0.5) * 0.05;

    float coordA = dot(rp, dirA) * 0.96 + kinkA;
    float coordB = dot(rp, dirB) * 1.18 + kinkB + 0.34;

    // Continuous fwidth before fract() -> clean 2-3 px screen-crisp painted fracture lines!
    float fwA = clamp(fwidth(coordA), 0.0030, 0.036);
    float fwB = clamp(fwidth(coordB), 0.0030, 0.036);

    float signedA = fract(coordA) - 0.5;
    float signedB = fract(coordB) - 0.5;
    float distA = abs(signedA);
    float distB = abs(signedB);

    // Localized taper masks: bold diagonal cracks sweep cleanly across faces and taper to sharp tips
    float gateA = smoothstep(0.30, 0.66, rockFbm3(rp * 0.92 + vec3(4.2, 1.8, 7.3)));
    float gateB = smoothstep(0.45, 0.76, rockFbm3(rp * 1.28 + vec3(8.6, 5.4, 2.1)));
    float taperA = gateA * smoothstep(0.06, 0.60, uCracks);
    float taperB = gateB * smoothstep(0.18, 0.80, uCracks);

    float hwA = (fwA * mix(0.85, 1.75, uCracks) + 0.0052) * taperA;
    float hwB = (fwB * mix(0.68, 1.35, uCracks) + 0.0038) * taperB;

    float lineA = (1.0 - smoothstep(hwA * 0.25, hwA * 1.12, distA)) * step(0.05, taperA);
    float lineB = (1.0 - smoothstep(hwB * 0.25, hwB * 1.12, distB)) * step(0.05, taperB) * 0.82;
    float crackCore = clamp(max(lineA, lineB), 0.0, 1.0);

    // Subtle incised shadow lip on the shaded edge + luminous warm cream catchlight on the sunlit lip!
    float sunSignA = dot(dirA, keyWorld) >= 0.0 ? -1.0 : 1.0;
    float sunSignB = dot(dirB, keyWorld) >= 0.0 ? -1.0 : 1.0;
    float sA = signedA * sunSignA;
    float sB = signedB * sunSignB;
    float lipA = smoothstep(hwA * 0.75, hwA * 1.25, sA) * (1.0 - smoothstep(hwA * 1.65, hwA * 3.10, sA)) * step(0.08, taperA);
    float lipB = smoothstep(hwB * 0.75, hwB * 1.25, sB) * (1.0 - smoothstep(hwB * 1.60, hwB * 2.90, sB)) * step(0.08, taperB) * 0.76;
    float lipCore = clamp(max(lipA, lipB), 0.0, 1.0) * (1.0 - crackCore);
    float lipSun = smoothstep(-0.14, 0.44, ndl + 0.20);

    float grooveAO = max(
      (1.0 - smoothstep(hwA, hwA * 4.5, distA)) * step(0.08, taperA) * step(0.0, -sA),
      (1.0 - smoothstep(hwB, hwB * 4.0, distB)) * step(0.08, taperB) * step(0.0, -sB) * 0.7
    );

    vec3 crackCol = uShadowColor * mix(0.42, 0.56, midBand);
    hpCol = mix(hpCol, uShadowColor * 0.74, grooveAO * 0.18 * uCracks);
    hpCol = mix(hpCol, uEdgeColor * 1.06 * litLight, lipCore * lipSun * uEdgeWear * 0.78);
    hpCol = mix(hpCol, crackCol, crackCore * (0.76 + 0.18 * uCracks));
  }

  // Lush painterly warm-cream ridge highlights along sunlit & mid turning bevels (soft subtle glint in shadow)
  float sunRidge = mix(0.10, 1.0, smoothstep(-0.08, 0.48, ndl * 0.72 + wn.y * 0.34));
  float crestAmt = rockEdgeMask * sunRidge * (1.0 - vRockData.y * 0.42);
  hpCol = mix(hpCol, uEdgeColor * 1.06 * mix(vec3(1.0), litLight, 0.45), clamp(crestAmt * 0.84, 0.0, 0.84));

  outgoingLight = hpCol;
} else if (uViewMode < 0.5 && uStyle > 0.5) {
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

  mat.customProgramCacheKey = () => 'stylized-rock-v5'
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
  u.uCracks.value = spec.detail.cracks
  u.uTopActive.value = spec.top.mode === 'none' ? 0 : 1
  u.uTopCoverage.value = spec.top.coverage
  u.uTopSoftness.value = spec.top.softness
  u.uStyle.value = styleToUniform(spec.style)
  u.uViewMode.value = viewMode === 'clay' ? 1 : 0
  u.uSeedOffset.value = (spec.seed % 997) * 0.137
}
