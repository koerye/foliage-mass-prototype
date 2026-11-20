import { Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { createBranchTemplates } from './study'
import { arrange, captureTrees, stemX, stemZ, tree, trunkGeometry, type Placement } from './tree-study'

type Style = {
  height: readonly number[]
  scale: readonly number[]
  cap: readonly number[]
  pitch: readonly number[]
  trunkRadius: number
  asymmetry: number
  droop: number
  bend: number
  stagger: number
  phase: number
}

const styles = {
  standard: {
    height: [.84, 1.04, 1.34, 1.56, 1.858, 2.032, 2.155],
    scale: [.307, .282, .245, .224, .182, .126, .074],
    cap: [1.27, 1.21, 1.05, .98, .82, .57, .33],
    pitch: [-.21, -.15, -.27, -.14, -.26, .03, .52],
    trunkRadius: .086, asymmetry: .062, droop: .075, bend: 0, stagger: 1.27, phase: 0,
  },
  dense: {
    height: [.57, .77, 1.01, 1.26, 1.47, 1.68, 1.79],
    scale: [.226, .243, .230, .225, .191, .134, .070],
    cap: [.95, 1.04, .98, .92, .83, .60, .32],
    pitch: [-.19, -.27, -.23, -.27, -.22, .015, .46],
    trunkRadius: .092, asymmetry: .048, droop: .058, bend: 0, stagger: 1.45, phase: .55,
  },
  ancient: {
    height: [.79, 1.04, 1.37, 1.55, 1.85, 2.02, 2.12],
    scale: [.297, .269, .255, .209, .166, .117, .064],
    cap: [1.22, 1.17, 1.10, .93, .73, .54, .31],
    pitch: [-.28, -.10, -.34, -.12, -.27, .07, .60],
    trunkRadius: .113, asymmetry: .34, droop: .24, bend: 1, stagger: 1.67, phase: -.45,
  },
} satisfies Record<string, Style>

export type PineProfile = keyof typeof styles
export const pineProfiles = Object.keys(styles) as PineProfile[]

function branchRadius(branch: Group) {
  branch.updateMatrixWorld(true)
  const point = new Vector3()
  let max = 0
  branch.traverse(node => {
    if (!(node instanceof Mesh)) return
    const positions = node.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld)
      max = Math.max(max, point.lengthSq())
    }
  })
  return Math.sqrt(max)
}

function compose(style: Style, measure: number) {
  const placement: Placement[] = []
  const crown = style.height.at(-1)!
  const stemHeight = crown + .040
  const atX = (y: number) => {
    const t = Math.min(1, Math.max(0, y / stemHeight))
    return stemX(y) + style.bend * (.54 * t ** 1.84 - .35 * Math.sin(Math.PI * t) ** 2)
  }
  const atZ = (y: number) => {
    const t = Math.min(1, Math.max(0, y / stemHeight))
    return stemZ(y) + style.bend * (.21 * t ** 2 - .16 * Math.sin(Math.PI * t * 1.24))
  }
  let limited = 0
  let exceedance = 0
  style.height.forEach((y, tier) => {
    const top = tier === 6
    const rhythm = [.12, .73, 1.11, 1.90, 2.19, 3.10, 3.66][tier] + style.phase * (1 + .36 * (tier % 2))
    for (let slot = 0; slot < 4; slot++) {
      const azimuth = rhythm + Math.PI * .5 * slot
        + Math.sin(slot * 1.94 + tier * .94) * .17 + Math.cos(slot * 2.12 - tier * 1.66) * .13
      const facing = Math.cos(azimuth - .30 - .19 * tier)
      const broad = 1 + style.asymmetry * facing
      const shoulder = tier === 5 && (slot === 0 || slot === 2)
      const shortOldLimb = style.bend > 0 && tier < 4 && slot === (tier + 1) % 4
      const size = top ? [.80, .90, 1.07, 1.04][slot] : [.94, 1.07, 1.05, .87][slot]
      const request = style.scale[tier] * broad * size * (shoulder ? .84 : shortOldLimb ? .69 : 1)
      const cap = style.cap[tier] * (1 + style.asymmetry * (top ? .30 : .72) * facing)
      const scale = Math.min(request, cap / measure)
      if (scale < request) limited++
      exceedance = Math.max(exceedance, scale * measure - cap)
      const offset = top ? [.016, -.014, -.055, -.067][slot]
        : [.037, -.054, .017, -.035][(slot + tier) % 4] * style.stagger
      const anchor = y + offset
      const swing = Math.sin(slot * 1.43 + tier * 2.3)
      const bridgePitch = tier === 4 && slot % 2 === 1 ? .16 : 0
      const pitch = top ? style.pitch[tier] + [.51, .29, -.10, -.08][slot]
        : style.pitch[tier] + swing * style.droop + (shoulder ? .40 : bridgePitch)
      placement.push({ tier, x: atX(anchor), y: anchor, z: atZ(anchor), azimuth, pitch, scale,
        roll: Math.sin(slot * 2.03 + tier * 1.27) * (top ? .14 : .24) })
    }
  })
  return { placement, stemHeight, height: crown + .25, atX, atZ, limited, exceedance }
}

// The material instance on the underside is separate from the template and its painted top.
function shadeUndersides(group: Group, shades: Map<MeshStandardMaterial, MeshStandardMaterial>) {
  group.traverse(node => {
    if (!(node instanceof Mesh) || !Array.isArray(node.material)) return
    const [top, base] = node.material as MeshStandardMaterial[]
    if (!shades.has(base)) {
      const local = base.clone()
      local.color.multiply(new Color('#afc8bb'))
      shades.set(base, local)
    }
    node.material = [top, shades.get(base)!]
  })
}

function buildProfile(key: PineProfile, templates: ReturnType<typeof createBranchTemplates>, measure: number,
  bark: MeshStandardMaterial, shades: Map<MeshStandardMaterial, MeshStandardMaterial>) {
  const profile = styles[key]
  const plan = compose(profile, measure)
  const trunk = trunkGeometry(plan.stemHeight, profile.trunkRadius, plan.atX, plan.atZ)
  const model = tree('B', plan, templates, trunk, bark)
  shadeUndersides(model, shades)
  return { key, plan, trunk, model, sculptedLight: true }
}

export function assembleBPine(key: PineProfile) {
  const templates = createBranchTemplates()
  const bark = new MeshStandardMaterial({ color: '#796044', roughness: .95 })
  const shades = new Map<MeshStandardMaterial, MeshStandardMaterial>()
  const { plan, trunk, model } = buildProfile(key, templates, branchRadius(templates.clone('B')), bark, shades)
  return {
    group: model, branches: plan.placement.length, tiers: styles[key].height.length,
    dispose() {
      trunk.dispose()
      shades.forEach(material => material.dispose())
      bark.dispose()
      templates.dispose()
    },
  }
}

export function renderBStudy() {
  const base = arrange(7)
  const templates = createBranchTemplates()
  const measure = branchRadius(templates.clone('B'))
  const bark = new MeshStandardMaterial({ color: '#796044', roughness: .95 })
  const shades = new Map<MeshStandardMaterial, MeshStandardMaterial>()
  const jobs = pineProfiles.map(key => buildProfile(key, templates, measure, bark, shades))
  const oldTrunk = trunkGeometry(base.stemHeight, .088)
  const baseline = tree('B', base, templates, oldTrunk, bark)
  try {
    return {
      files: captureTrees([{ key: 'baseline', model: baseline }, ...jobs], base.height),
      diagnostics: jobs.map(({ key, plan }) => ({
        style: key, branches: plan.placement.length, limited: plan.limited, exceedance: plan.exceedance,
      })),
    }
  } finally {
    oldTrunk.dispose()
    jobs.forEach(({ trunk }) => trunk.dispose())
    shades.forEach(material => material.dispose())
    bark.dispose()
    templates.dispose()
  }
}

declare global { interface Window { renderBStudy: typeof renderBStudy } }
window.renderBStudy = renderBStudy

