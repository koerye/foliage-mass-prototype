import preset from '../presets/painterly_conifer.json'

export interface Palette { light: string; middle: string; shade: string; wood: string }
export interface TreeMassConfig {
  schemaVersion: 1
  preset: 'painterly_conifer'
  seed: number
  totalHeight: number
  crownStart: number
  crownHeight: number
  maxCrownRadius: number
  tierCount: number
  massesPerTier: number
  tierOverlap: number
  asymmetry: number
  droop: number
  macroLobeWidth: number
  macroEnabled: boolean
  mesoEnabled: boolean
  microEnabled: boolean
  palette: Palette
}

export const defaults = (): TreeMassConfig => structuredClone(preset) as TreeMassConfig
type Rule = { min: number; max: number; step: number; integer?: boolean }
const number = (min: number, max: number, step = .01): Rule => ({ min, max, step })
const integer = (min: number, max: number): Rule => ({ min, max, step: 1, integer: true })
export const rules = {
  seed: integer(0, 0xffffffff), totalHeight: number(3, 14, .1), crownStart: number(.25, 3.6),
  crownHeight: number(2.1, 13.75), maxCrownRadius: number(.85, 5.2),
  tierCount: integer(6, 8), massesPerTier: integer(3, 5), tierOverlap: number(.25, .40),
  asymmetry: number(0, 1), droop: number(0, 1), macroLobeWidth: number(.38, .95),
}
export const levels = ['macroEnabled', 'mesoEnabled', 'microEnabled'] as const

function record(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('配置需要 JSON 对象')
  return value as Record<string, unknown>
}

export function parseConfig(input: unknown): TreeMassConfig {
  const source = record(input)
  const config = defaults()
  for (const key of Object.keys(source)) if (!Object.hasOwn(config, key)) throw new Error(`未知配置字段 ${key}`)
  if (source.schemaVersion !== undefined && source.schemaVersion !== 1) throw new Error('schemaVersion 需要为 1')
  if (source.preset !== undefined && source.preset !== 'painterly_conifer') throw new Error('未知树形预设')
  for (const [key, rule] of Object.entries(rules)) {
    const field = key as keyof typeof rules
    const value = source[field]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max || (rule.integer && !Number.isInteger(value))) {
      throw new Error(`${field} 需要 ${rule.min}–${rule.max} 之间的${rule.integer ? '整数' : '数字'}`)
    }
    config[field] = value
  }
  for (const field of levels) {
    const value = source[field]
    if (value === undefined) continue
    if (typeof value !== 'boolean') throw new Error(`${field} 需要为布尔值`)
    config[field] = value
  }
  if (source.palette !== undefined) {
    for (const [key, value] of Object.entries(record(source.palette))) {
      if (!Object.hasOwn(config.palette, key) || typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`调色板字段无效 ${key}`)
      config.palette[key as keyof Palette] = value
    }
  }
  if (source.totalHeight !== undefined) {
    const ratio = config.totalHeight / preset.totalHeight
    if (source.crownStart === undefined) config.crownStart = preset.crownStart * ratio
    if (source.crownHeight === undefined) config.crownHeight = preset.crownHeight * ratio
  }
  if (config.crownStart + config.crownHeight > config.totalHeight + 1e-7) throw new Error('树冠起点与树冠高度之和不得超过总树高')
  if (config.crownHeight < rules.crownHeight.min || config.crownStart < rules.crownStart.min) throw new Error('树冠尺寸超出有效范围')
  return config
}

export const saveConfig = (input: unknown) => JSON.stringify(parseConfig(input), null, 2) + '\n'

