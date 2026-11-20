import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { defaults, seeds, speciesList } from '../src/broadleaf/config'
import { buildGrowth } from '../src/broadleaf/growth'
import {
  defaultLeafParams, envelopeNormal, envelopeRadius, generateLeafCards, leafRules, parseLeafParams,
} from '../src/broadleaf/leaves'

const growthOf = (species: typeof speciesList[number], seed = seeds[species][0]) => buildGrowth(defaults(species, seed))

describe('leaf card distribution', () => {
  it.each(speciesList)('is deterministic for %s and changes with the leaf seed', species => {
    const growth = growthOf(species)
    const a = generateLeafCards(growth, defaultLeafParams)
    const b = generateLeafCards(growth, defaultLeafParams)
    expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(Array.from(b.geometry.getAttribute('position').array))
    const c = generateLeafCards(growth, { ...defaultLeafParams, leafSeed: 77 })
    expect(c.cards[0].position.equals(a.cards[0].position)).toBe(false)
  })

  it.each(speciesList)('produces a dense but bounded %s crown with valid attributes', species => {
    for (const seed of seeds[species]) {
      const { cards, twigs, geometry } = generateLeafCards(growthOf(species, seed), defaultLeafParams)
      expect(twigs.length).toBeGreaterThan(40)
      expect(cards.length).toBeGreaterThan(400)
      expect(cards.length).toBeLessThan(12000)
      const normals = geometry.getAttribute('normal').array
      for (let i = 0; i < normals.length; i += 3) {
        expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 4)
      }
      const uv = geometry.getAttribute('uv').array
      for (const value of uv) expect(value).toBeGreaterThanOrEqual(0), expect(value).toBeLessThanOrEqual(1)
      for (const value of geometry.getAttribute('position').array) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('scales leaf count with frequency controls and prunes against the envelope', () => {
    const growth = growthOf('round')
    const noFill = { ...defaultLeafParams, clumpFill: 0 }
    const base = generateLeafCards(growth, noFill).cards.length
    const more = generateLeafCards(growth, { ...noFill, leavesPerTwig: 14 }).cards.length
    const none = generateLeafCards(growth, { ...defaultLeafParams, twigFrequency: 0, limbLeafFrequency: 0, tipLeaves: 0, clumpFill: 0 })
    expect(more).toBeGreaterThan(base * 1.5)
    expect(none.cards).toHaveLength(0)
    const fillOnly = generateLeafCards(growth, { ...defaultLeafParams, twigFrequency: 0, limbLeafFrequency: 0, tipLeaves: 0, clumpFill: 8 })
    expect(fillOnly.cards.length).toBeGreaterThan(100)
    const tight = generateLeafCards(growth, { ...defaultLeafParams, pruneOuter: .8, pruneInner: .5 })
    for (const card of tight.cards) {
      const rho = envelopeRadius(tight.envelope, card.position)
      expect(rho).toBeLessThanOrEqual(.8 + 1e-9)
      expect(rho).toBeGreaterThanOrEqual(.5 - 1e-9)
    }
  })

  it('faces cards outward and spherizes normals toward the crown field', () => {
    const growth = growthOf('round')
    const p = { ...defaultLeafParams, faceOutward: 1, upAlign: 0, randomTilt: 0, normalSpherize: 1, normalSource: 'crown' as const }
    const { cards, envelope, geometry } = generateLeafCards(growth, p)
    for (const card of cards.slice(0, 200)) {
      expect(card.normal.dot(envelopeNormal(envelope, card.position, 'crown'))).toBeGreaterThan(.99)
      expect(Math.abs(card.right.dot(card.up))).toBeLessThan(1e-6)
    }
    const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal')
    const point = new Vector3(), n = new Vector3()
    for (let i = 0; i < Math.min(pos.count, 500); i++) {
      point.fromBufferAttribute(pos, i)
      n.fromBufferAttribute(nor, i)
      expect(n.dot(envelopeNormal(envelope, point, 'crown'))).toBeGreaterThan(.999)
    }
  })

  it('validates parameters and fills defaults for partial input', () => {
    expect(parseLeafParams(undefined)).toEqual(defaultLeafParams)
    expect(parseLeafParams({ leafSize: 1.2 }).leafSize).toBe(1.2)
    expect(() => parseLeafParams({ leafSize: 99 })).toThrow()
    expect(() => parseLeafParams({ atlasCols: 1.5 })).toThrow()
    expect(() => parseLeafParams({ tintInner: 'green' })).toThrow()
    expect(() => parseLeafParams({ twigStart: .8, twigEnd: .2 })).toThrow()
    for (const [key, [min, max]] of Object.entries(leafRules)) {
      const value = defaultLeafParams[key as keyof typeof leafRules]
      expect(value).toBeGreaterThanOrEqual(min)
      expect(value).toBeLessThanOrEqual(max)
    }
  })

  it('assigns atlas cells within the configured grid', () => {
    const { geometry, cards } = generateLeafCards(growthOf('open'), { ...defaultLeafParams, atlasCols: 2, atlasRows: 2 })
    expect(new Set(cards.map(card => card.cell)).size).toBe(4)
    for (const value of geometry.getAttribute('uv').array) expect(value).toBeLessThanOrEqual(1)
  })
})
