import { Vector3 } from 'three'

export const tau = Math.PI * 2
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const up = new Vector3(0, 1, 0)
export type XYZ = [number, number, number]

export function seedFor(seed: number, key: number) {
  let n = (seed ^ Math.imul(key, 0x9e3779b9)) >>> 0
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad)
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97)
  return (n ^ (n >>> 15)) >>> 0
}

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let z = Math.imul(s ^ (s >>> 15), s | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}
