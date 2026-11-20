import round from '../../presets/broadleaf/round.json'
import open from '../../presets/broadleaf/open.json'

export const speciesList = ['round', 'open'] as const
export type Species = typeof speciesList[number]
export const crownShapes = ['round', 'wide', 'irregular'] as const
export type CrownShape = typeof crownShapes[number]

export interface PrimaryBranchRule {
  yaw?: number
  angle?: number
  length?: number
  curvature?: number
  thickness?: number
  children?: number
  droop?: number
}

export interface BroadleafTreeConfig {
  schemaVersion: 1
  species: Species
  treeHeight: number
  trunkHeight: number
  trunkRadius: number
  trunkCurvature: number
  primaryBranchCount: number
  primaryBranchAngle: number
  branchSpread: number
  branchCurvature: number
  crownShape: CrownShape
  crownWidth: number
  crownHeight: number
  crownDepth: number
  crownClusterCount: number
  crownClusterSize: number
  crownIrregularity: number
  foliageDensity: number
  foliageScale: number
  seed: number
  primaryBranches?: PrimaryBranchRule[]
}

export const rules = {
  treeHeight: [3.2, 12, .05],
  trunkHeight: [.7, 6, .05],
  trunkRadius: [.07, .63, .005],
  trunkCurvature: [0, .9, .01],
  primaryBranchCount: [3, 10, 1],
  primaryBranchAngle: [19, 76, 1],
  branchSpread: [.55, 1.35, .01],
  branchCurvature: [0, 1, .01],
  crownWidth: [2.5, 13, .05],
  crownHeight: [1.25, 8, .05],
  crownDepth: [2.5, 13, .05],
  crownClusterCount: [4, 36, 1],
  crownClusterSize: [.55, 1.5, .01],
  crownIrregularity: [0, 1, .01],
  foliageDensity: [.55, 1.4, .01],
  foliageScale: [.6, 1.35, .01],
  seed: [0, 4294967295, 1],
} as const

const overrides = {
  yaw: [-360, 360, .01], angle: [16, 82, .01], length: [.48, 1.5, .01],
  curvature: [-1, 1, .01], thickness: [.35, 1.5, .01], children: [1, 5, 1], droop: [0, 1, .01],
} as const
type Range = readonly [min: number, max: number, step: number]

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(name + ' 必须是对象')
  return value as Record<string, unknown>
}

function within(value: unknown, key: string, [min, max, step]: Range) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
    (step === 1 && !Number.isInteger(value))) throw new Error(key + ' 必须在 ' + min + '–' + max + ' 范围内')
  return value
}

export function parseBroadleafConfig(value: unknown): BroadleafTreeConfig {
  const data = record(value, '树形配置')
  if (data.schemaVersion !== 1) throw new Error('配置版本必须为 1')
  if (!speciesList.some(species => species === data.species)) throw new Error('未知树型')
  if (!crownShapes.some(shape => shape === data.crownShape)) throw new Error('未知树冠形状')
  const pairs = Object.entries(rules).map(([key, range]) => [key, within(data[key], key, range)])
  const numbers = Object.fromEntries(pairs) as Pick<BroadleafTreeConfig, keyof typeof rules>
  if (numbers.trunkHeight > numbers.treeHeight * .65) throw new Error('主干分叉起始高度最多为全树的 65%')
  if (numbers.crownHeight > numbers.treeHeight - .4) throw new Error('树冠底部至少离地 0.4 m')
  if (numbers.crownClusterCount < numbers.primaryBranchCount) throw new Error('树冠簇数至少与主枝数相同')
  const config: BroadleafTreeConfig = { schemaVersion: 1, species: data.species as Species, crownShape: data.crownShape as CrownShape, ...numbers }
  if (data.primaryBranches !== undefined) {
    if (!Array.isArray(data.primaryBranches) || data.primaryBranches.length > numbers.primaryBranchCount)
      throw new Error('主枝自定义项目数不能大于主枝总数')
    config.primaryBranches = data.primaryBranches.map((item, index) => {
      const branch = record(item, '主枝 ' + (index + 1))
      const pairs = Object.entries(branch).map(([key, value]) => {
        if (!Object.hasOwn(overrides, key)) throw new Error('未知主枝参数 ' + key)
        return [key, within(value, key, overrides[key as keyof PrimaryBranchRule])]
      })
      return Object.fromEntries(pairs)
    })
  }
  return config
}

export const seeds: Record<Species, readonly number[]> = { round: [4217, 10429, 27803], open: [7123, 19277, 31601] }
export const defaults = (species: Species, seed = seeds[species][0]) =>
  parseBroadleafConfig({ ...(species === 'round' ? round : open), seed })

