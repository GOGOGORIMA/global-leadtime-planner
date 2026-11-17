import { describe, expect, it } from 'vitest'
import { CONTAINER_SPECS, getContainerSpec, type ContainerSpec } from '../data/containers'
import { SAMPLE_CARGO, instantiateCargo } from '../state/defaults'
import type { CargoItem } from '../types'
import {
  MAX_PIECES,
  SUPPORT_RATIO,
  analyzePacking,
  buildPackingSummary,
  expandPieces,
  fillLevel,
  packPieces,
  suggestForCategory,
  type Placement,
} from './binPacking'

const EPS = 0.5

function cargo(fields: Partial<CargoItem> & Pick<CargoItem, 'length' | 'width' | 'height'>): CargoItem {
  return { id: 'c', name: 'Case', weight: 100, quantity: 1, stackable: true, rotatable: true, color: '#6366f1', ...fields }
}

/** Checks every physical rule of a loading plan. */
function expectValidPlan(spec: ContainerSpec, items: readonly CargoItem[], placements: readonly Placement[]) {
  const total = placements.reduce((sum, p) => sum + p.weight, 0)
  expect(total).toBeLessThanOrEqual(spec.maxPayload + 1e-6)
  for (const [i, p] of placements.entries()) {
    const item = items[p.item]
    // Inside the cargo space, never taller than the door, only turned on the floor.
    expect(p.x).toBeGreaterThanOrEqual(-EPS)
    expect(p.y).toBeGreaterThanOrEqual(-EPS)
    expect(p.z).toBeGreaterThanOrEqual(-EPS)
    expect(p.x + p.length).toBeLessThanOrEqual(spec.length + EPS)
    expect(p.y + p.width).toBeLessThanOrEqual(spec.width + EPS)
    expect(p.z + p.height).toBeLessThanOrEqual(spec.height + EPS)
    expect(p.height).toBe(item.height)
    expect(p.height).toBeLessThanOrEqual(spec.doorHeight)
    expect(p.rotated ? [p.width, p.length] : [p.length, p.width]).toEqual([item.length, item.width])
    if (p.rotated) expect(item.rotatable).toBe(true)

    let supported = 0
    for (const [j, q] of placements.entries()) {
      if (i === j) continue
      const ox = Math.min(p.x + p.length, q.x + q.length) - Math.max(p.x, q.x)
      const oy = Math.min(p.y + p.width, q.y + q.width) - Math.max(p.y, q.y)
      const oz = Math.min(p.z + p.height, q.z + q.height) - Math.max(p.z, q.z)
      expect(ox > EPS && oy > EPS && oz > EPS, `pieces ${i} and ${j} overlap`).toBe(false)
      if (ox > EPS && oy > EPS && q.z + q.height <= p.z + EPS) {
        // q is somewhere below p: it must allow stacking.
        expect(items[q.item].stackable, `piece ${i} is above non-stackable piece ${j}`).toBe(true)
        if (Math.abs(q.z + q.height - p.z) <= EPS) {
          expect(q.weight).toBeGreaterThanOrEqual(p.weight) // no heavier piece on a lighter one
          supported += ox * oy
        }
      }
    }
    if (p.z > EPS) expect(supported).toBeGreaterThanOrEqual(SUPPORT_RATIO * p.length * p.width - EPS)
  }
}

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('container catalog', () => {
  it('has the published inside sizes, door heights, payloads and capacities', () => {
    expect(
      CONTAINER_SPECS.map((s) => [s.id, s.length, s.width, s.height, s.doorHeight, s.maxPayload, s.capacity]),
    ).toEqual([
      ['20dc', 5898, 2352, 2393, 2280, 24000, 33.2],
      ['40dc', 12032, 2352, 2393, 2280, 26500, 67.7],
      ['40hc', 12032, 2352, 2698, 2585, 26500, 76.4],
      ['2t', 4350, 1780, 2100, 2100, 2000, 16.2],
      ['4t', 6200, 2380, 2400, 2400, 3500, 35.4],
      ['10t', 9600, 2380, 2500, 2500, 13000, 57.1],
    ])
    for (const spec of CONTAINER_SPECS) {
      // The nominal capacity matches the inside dimensions (within rounding).
      expect(Math.abs((spec.length * spec.width * spec.height) / 1e9 - spec.capacity)).toBeLessThan(0.1)
    }
  })
})

describe('packPieces / analyzePacking', () => {
  const c20 = getContainerSpec('20dc')

  it('fills the floor of a 20ft with non-stackable T11 pallets (5 × 2) and nothing on top', () => {
    const items = [cargo({ length: 1100, width: 1100, height: 1000, quantity: 12, stackable: false })]
    const result = analyzePacking(c20, items)
    expect(result.loadedPieces).toBe(10)
    expect(result.items[0]).toEqual({ loaded: 10, total: 12, unplaced: { space: 2 } })
    expect(result.placements.every((p) => p.z === 0)).toBe(true)
    expect(result.floorRatio).toBeCloseTo((10 * 1.21) / ((5.898 * 2.352)), 5)
    expectValidPlan(c20, items, result.placements)
  })

  it('stacks stackable pallets two high and loads from the front wall toward the door', () => {
    const items = [cargo({ length: 1100, width: 1100, height: 1000, quantity: 24, weight: 300 })]
    const result = analyzePacking(c20, items)
    expect(result.loadedPieces).toBe(20)
    expect(result.items[0].unplaced).toEqual({ space: 4 })
    // The first pieces fill the front wall: floor first, then the second tier.
    expect(result.placements.slice(0, 4).map((p) => [p.x, p.y, p.z])).toEqual([
      [0, 0, 0],
      [0, 1100, 0],
      [0, 0, 1000],
      [0, 1100, 1000],
    ])
    expect(result.loadedVolume).toBeCloseTo(24.2, 5)
    expect(result.volumeRatio).toBeCloseTo(24.2 / 33.2, 5)
    expectValidPlan(c20, items, result.placements)
  })

  it('turns pieces 90° only when allowed', () => {
    const turned = analyzePacking(getContainerSpec('2t'), [cargo({ length: 1700, width: 2000, height: 500 })])
    expect(turned.placements[0]).toMatchObject({ length: 2000, width: 1700, rotated: true })
    const fixed = analyzePacking(getContainerSpec('2t'), [cargo({ length: 1700, width: 2000, height: 500, rotatable: false })])
    expect(fixed.loadedPieces).toBe(0)
    expect(fixed.oversize).toEqual([0]) // 2,000 mm across does not fit the 1,780 mm wide body
    expect(fixed.items[0].unplaced).toEqual({ size: 1 })
  })

  it('rejects pieces taller than the door opening even when the inside is high enough', () => {
    const items = [cargo({ length: 1200, width: 1000, height: 2300 })]
    const dry = analyzePacking(c20, items)
    expect(dry.loadedPieces).toBe(0)
    expect(dry.doorBlocked).toEqual([0])
    expect(dry.items[0].unplaced).toEqual({ door: 1 })
    const hq = analyzePacking(getContainerSpec('40hc'), items)
    expect(hq.loadedPieces).toBe(1)
    expect(hq.doorBlocked).toEqual([])
  })

  it('keeps to the payload and flags overweight cargo', () => {
    const truck = getContainerSpec('2t')
    const result = analyzePacking(truck, [cargo({ length: 1000, width: 1000, height: 1000, weight: 600, quantity: 4 })])
    expect(result.loadedPieces).toBe(3)
    expect(result.loadedWeight).toBe(1800)
    expect(result.items[0].unplaced).toEqual({ weight: 1 })
    expect(result.overweight).toBe(true)
    expect(result.weightRatio).toBeCloseTo(0.9, 5)
  })

  it('never stacks a heavier piece on a lighter one or anything on a non-stackable piece', () => {
    // Two 1,700 mm squares cover the floor of the 4,350 × 1,780 mm body and are too tall (1,100 mm)
    // to stack on each other under the 2,100 mm roof, so the next piece can only go on top of them.
    const truck = getContainerSpec('2t')
    const light = cargo({ length: 1700, width: 1700, height: 1100, weight: 10, quantity: 2 })
    const heavy = cargo({ length: 1700, width: 1700, height: 800, weight: 500 })
    expect(analyzePacking(truck, [light, heavy]).items[1].unplaced).toEqual({ space: 1 })
    const lighter = { ...heavy, weight: 5 }
    expect(analyzePacking(truck, [light, lighter]).items[1].loaded).toBe(1)
    const fragile = { ...light, stackable: false, weight: 800 }
    expect(analyzePacking(truck, [fragile, lighter]).items[1].unplaced).toEqual({ space: 1 })
  })

  it('places non-stackable and tall pieces first, at the front wall', () => {
    const items = [
      cargo({ length: 600, width: 400, height: 400, weight: 15, quantity: 10 }),
      cargo({ length: 2200, width: 1500, height: 1800, weight: 1000, stackable: false }),
    ]
    const result = analyzePacking(c20, items)
    expect(result.placements[0]).toMatchObject({ item: 1, x: 0, y: 0, z: 0, length: 1500, width: 2200 })
    expect(result.loadedPieces).toBe(11)
    expectValidPlan(c20, items, result.placements)
  })

  it('keeps every rule on random shipments in every container and truck', () => {
    const next = random(20261117)
    for (let round = 0; round < 24; round++) {
      const spec = CONTAINER_SPECS[round % CONTAINER_SPECS.length]
      const rows = 1 + Math.floor(next() * 5)
      const items = Array.from({ length: rows }, (_, i) =>
        cargo({
          id: String(i),
          length: 300 + Math.round(next() * 2000),
          width: 300 + Math.round(next() * 1500),
          height: 200 + Math.round(next() * 1600),
          weight: Math.round(5 + next() * 800),
          quantity: 1 + Math.floor(next() * 25),
          stackable: next() > 0.25,
          rotatable: next() > 0.2,
        }),
      )
      const result = analyzePacking(spec, items)
      expectValidPlan(spec, items, result.placements)
      const accounted = result.items.reduce(
        (sum, s) => sum + s.loaded + Object.values(s.unplaced).reduce((a, b) => a + (b ?? 0), 0),
        0,
      )
      expect(accounted).toBe(result.totalPieces)
    }
  })

  it('simulates at most MAX_PIECES pieces', () => {
    const { pieces, limited } = expandPieces([cargo({ length: 100, width: 100, height: 100, quantity: 999 }), cargo({ length: 100, width: 100, height: 100, quantity: 200 })])
    expect(pieces).toHaveLength(MAX_PIECES)
    expect(limited).toEqual([0, 199])
  })

  it('packs a 1,000-carton shipment quickly and densely', () => {
    const spec = getContainerSpec('40hc')
    const items = [
      cargo({ length: 600, width: 400, height: 400, weight: 12, quantity: 600 }),
      cargo({ length: 500, width: 300, height: 300, weight: 8, quantity: 400 }),
    ]
    const started = performance.now()
    const result = analyzePacking(spec, items)
    expect(performance.now() - started).toBeLessThan(3000)
    // 75.6 m³ requested for a 76.4 m³ box: everything cannot fit, but most of the space is used.
    expect(result.volumeRatio).toBeGreaterThan(0.75)
    expectValidPlan(spec, items, result.placements)
  })

  it('packs the 20ft door height exactly at the limit', () => {
    const result = analyzePacking(c20, [cargo({ length: 1000, width: 1000, height: 2280 })])
    expect(result.loadedPieces).toBe(1)
  })

  it('returns an empty plan for an empty cargo list', () => {
    const result = analyzePacking(c20, [])
    expect(result).toMatchObject({ loadedPieces: 0, totalPieces: 0, totalVolume: 0, volumeRatio: 0 })
    expect(packPieces(c20, []).placements).toEqual([])
  })
})

describe('container / truck suggestions', () => {
  const sample = instantiateCargo(SAMPLE_CARGO)

  it('suggests one 20ft (roomy) and one 4t truck for the sample shipment', () => {
    const sea = suggestForCategory(sample, 'sea')
    expect(sea.best?.spec.id).toBe('20dc')
    expect(sea.best?.units).toBe(1)
    expect(fillLevel(sea.best?.fill ?? 1)).toBe('roomy')
    const truck = suggestForCategory(sample, 'truck')
    // 3,160 kg is too heavy for one 2t truck (2 needed) but fits one 4t truck.
    expect(truck.plans.map((p) => [p.spec.id, p.units])).toEqual([
      ['2t', 2],
      ['4t', 1],
      ['10t', 1],
    ])
    expect(truck.best?.spec.id).toBe('4t')
  })

  it('prefers fewer units, then the smaller size', () => {
    const pallets = [cargo({ length: 1100, width: 1100, height: 1000, weight: 300, quantity: 40, stackable: false })]
    const sea = suggestForCategory(pallets, 'sea')
    expect(sea.plans.map((p) => [p.spec.id, p.units])).toEqual([
      ['20dc', 4],
      ['40dc', 2],
      ['40hc', 2],
    ])
    expect(sea.best?.spec.id).toBe('40dc')
    const truck = suggestForCategory(pallets, 'truck')
    expect(truck.plans.map((p) => [p.spec.id, p.units])).toEqual([
      ['2t', 14],
      ['4t', 4],
      ['10t', 3],
    ])
    expect(truck.best?.spec.id).toBe('10t')
  })

  it('reports when no size can carry a piece', () => {
    const tall = [cargo({ length: 1200, width: 1000, height: 2600 })]
    const sea = suggestForCategory(tall, 'sea')
    expect(sea.best).toBeNull()
    expect(sea.plans.map((p) => p.blocked)).toEqual(['size', 'size', 'door'])
    expect(suggestForCategory(tall, 'truck').plans.map((p) => p.blocked)).toEqual(['size', 'size', 'size'])
  })

  it('summarizes the shipment for the English e-mail', () => {
    const summary = buildPackingSummary(sample, getContainerSpec('20dc'))
    expect(summary).toMatchObject({ pieces: 31, types: 3, totalWeight: 3160, nonStackablePieces: 1 })
    expect(summary.totalVolume).toBeCloseTo(15.504, 6)
    expect(summary.largest?.name).toBe('Case #1 Main Unit (Crate)')
    expect(summary.selected.loadedPieces).toBe(31)
    expect(summary.sea.best?.spec.id).toBe('20dc')
    expect(summary.truck.best?.spec.id).toBe('4t')
  })
})
