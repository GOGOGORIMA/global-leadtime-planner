/**
 * 3D loading (bin packing) for ocean containers and trucks — a practical heuristic, not an
 * optimizer. Pure functions: no DOM, no randomness, same input → same plan.
 *
 * Coordinates are mm inside the cargo space: x runs from the front wall (奥, x = 0) toward the
 * door, y across the width, z up from the floor. Pieces may only turn 90° on the floor
 * (length ⇄ width); they are never tipped over.
 *
 * Algorithm — extreme points + "deepest-bottom-left":
 * 1. Cargo rows are expanded into pieces. Pieces that can never be loaded (larger than the
 *    inside, taller than the door opening, heavier than the payload) are reported up front.
 * 2. Loading order: non-stackable pieces (上積み厳禁) first, then taller, heavier, larger
 *    footprint — they claim the floor at the front wall.
 * 3. Every piece goes to the candidate point that is deepest (smallest x), then lowest (z), then
 *    leftmost (y). The load is therefore built from the front wall toward the door, on the floor
 *    first and stacked upwards where possible ("walls").
 * 4. A position is valid when the piece stays inside, overlaps nothing and — off the floor — at
 *    least {@link SUPPORT_RATIO} of its base rests on the tops of stackable pieces that are at
 *    least as heavy. Nothing is ever placed anywhere above a non-stackable piece.
 * 5. The payload is respected: a piece that would exceed it stays unloaded (reason `weight`).
 */
import { specsOfCategory, type ContainerCategory, type ContainerSpec } from '../data/containers'
import type { CargoItem } from '../types'

/** Tolerance in mm for touching / overlapping faces. */
const EPS = 0.5
/** Share of a stacked piece's base that must rest on pieces below it. */
export const SUPPORT_RATIO = 0.8
/** Simulation cap: more pieces than this are reported as `limit` (keeps the browser responsive). */
export const MAX_PIECES = 1000
/** Upper bound for the number of containers / trucks a suggestion may use. */
const MAX_UNITS = 200

export type UnplacedReason = 'size' | 'door' | 'weight' | 'space' | 'limit'

export interface Piece {
  /** Index of the cargo row. */
  item: number
  length: number
  width: number
  height: number
  weight: number
  stackable: boolean
  rotatable: boolean
}

export interface Placement {
  item: number
  x: number
  y: number
  z: number
  /** Size as placed: `length` along x (toward the door), `width` across the cargo space. */
  length: number
  width: number
  height: number
  /** Turned 90° on the floor relative to the cargo row's length × width. */
  rotated: boolean
  weight: number
}

export interface PackPiecesResult {
  placements: Placement[]
  unplaced: Array<{ piece: Piece; reason: UnplacedReason }>
}

interface Box {
  x1: number
  y1: number
  z1: number
  x2: number
  y2: number
  z2: number
  stackable: boolean
  weight: number
}

interface CandidatePoint {
  x: number
  y: number
  z: number
  /** Cargo row that already failed here (pieces of a row are processed one after another). */
  failedItem: number
}

/** Can the piece physically fit inside the cargo space in some allowed orientation? */
function fitsInside(spec: ContainerSpec, piece: Piece): boolean {
  if (piece.height > spec.height + EPS) return false
  const straight = piece.length <= spec.length + EPS && piece.width <= spec.width + EPS
  const turned = piece.rotatable && piece.width <= spec.length + EPS && piece.length <= spec.width + EPS
  return straight || turned
}

/** Why a single piece can never be loaded into this container / truck (or `null`). */
export function pieceRejection(spec: ContainerSpec, piece: Piece): 'size' | 'door' | 'weight' | null {
  if (!fitsInside(spec, piece)) return 'size'
  if (piece.height > spec.doorHeight + EPS) return 'door'
  if (piece.weight > spec.maxPayload) return 'weight'
  return null
}

/** Loading order: non-stackable first, then taller, heavier, larger footprint, then row order. */
function comparePieces(a: Piece, b: Piece): number {
  if (a.stackable !== b.stackable) return a.stackable ? 1 : -1
  return (
    b.height - a.height ||
    b.weight - a.weight ||
    b.length * b.width - a.length * a.width ||
    a.item - b.item
  )
}

/** Deepest (x), then lowest (z), then leftmost (y). */
function comparePoints(a: CandidatePoint, b: CandidatePoint): number {
  return a.x - b.x || a.z - b.z || a.y - b.y
}

/** Packs pieces into ONE container / truck. */
export function packPieces(spec: ContainerSpec, pieces: readonly Piece[]): PackPiecesResult {
  const L = spec.length
  const W = spec.width
  const H = spec.height
  const placements: Placement[] = []
  const unplaced: PackPiecesResult['unplaced'] = []

  /** Placed boxes sorted by x1 (for x-range queries). */
  const boxes: Box[] = []
  let maxBoxLength = 0
  const points: CandidatePoint[] = [{ x: 0, y: 0, z: 0, failedItem: -1 }]
  const seen = new Set<string>(['0|0|0'])
  let loadedWeight = 0

  /** Index of the first box whose x1 could still reach `x` (boxes are at most maxBoxLength long). */
  const firstBoxNear = (x: number): number => {
    const from = x - maxBoxLength - EPS
    let lo = 0
    let hi = boxes.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (boxes[mid].x1 < from) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const canPlace = (p: CandidatePoint, l: number, w: number, piece: Piece): boolean => {
    const x1 = p.x
    const y1 = p.y
    const z1 = p.z
    const x2 = x1 + l
    const y2 = y1 + w
    const z2 = z1 + piece.height
    if (x2 > L + EPS || y2 > W + EPS || z2 > H + EPS) return false
    let supported = 0
    for (let i = firstBoxNear(x1); i < boxes.length; i++) {
      const b = boxes[i]
      if (b.x1 >= x2 - EPS) break
      if (b.x2 <= x1 + EPS) continue
      const oy = Math.min(y2, b.y2) - Math.max(y1, b.y1)
      if (oy <= EPS) continue
      // The footprints overlap.
      if (b.z1 < z2 - EPS && b.z2 > z1 + EPS) return false // the volumes intersect
      if (b.z2 <= z1 + EPS) {
        if (!b.stackable) return false // never anywhere above a non-stackable piece
        if (Math.abs(b.z2 - z1) <= EPS) {
          if (b.weight + 1e-6 < piece.weight) return false // no heavier piece on a lighter one
          supported += (Math.min(x2, b.x2) - Math.max(x1, b.x1)) * oy
        }
      } else if (!piece.stackable) {
        return false // a box would end up above this non-stackable piece
      }
    }
    return z1 <= EPS || supported >= SUPPORT_RATIO * l * w - EPS
  }

  /** Is the point inside an already placed box (so nothing can start there)? */
  const isOccupied = (p: { x: number; y: number; z: number }): boolean => {
    for (let i = firstBoxNear(p.x); i < boxes.length; i++) {
      const b = boxes[i]
      if (b.x1 > p.x + EPS) break
      if (
        p.x < b.x2 - EPS &&
        p.y >= b.y1 - EPS &&
        p.y < b.y2 - EPS &&
        p.z >= b.z1 - EPS &&
        p.z < b.z2 - EPS
      ) {
        return true
      }
    }
    return false
  }

  // Projections: slide a point toward the front wall / the left wall / the floor until it
  // touches a box face (classic extreme-point construction).
  const projectX = (p: { x: number; y: number; z: number }): number => {
    let x = 0
    for (const b of boxes) {
      if (b.x1 >= p.x) break
      if (b.x2 <= p.x + EPS && b.x2 > x && p.y >= b.y1 - EPS && p.y < b.y2 - EPS && p.z >= b.z1 - EPS && p.z < b.z2 - EPS) {
        x = b.x2
      }
    }
    return x
  }
  const projectY = (p: { x: number; y: number; z: number }): number => {
    let y = 0
    for (let i = firstBoxNear(p.x); i < boxes.length; i++) {
      const b = boxes[i]
      if (b.x1 > p.x + EPS) break
      if (p.x < b.x2 - EPS && b.y2 <= p.y + EPS && b.y2 > y && p.z >= b.z1 - EPS && p.z < b.z2 - EPS) y = b.y2
    }
    return y
  }
  const projectZ = (p: { x: number; y: number; z: number }): number => {
    let z = 0
    for (let i = firstBoxNear(p.x); i < boxes.length; i++) {
      const b = boxes[i]
      if (b.x1 > p.x + EPS) break
      if (p.x < b.x2 - EPS && b.z2 <= p.z + EPS && b.z2 > z && p.y >= b.y1 - EPS && p.y < b.y2 - EPS) z = b.z2
    }
    return z
  }

  const addPoint = (p: { x: number; y: number; z: number }) => {
    if (p.x >= L - EPS || p.y >= W - EPS || p.z >= H - EPS) return
    const key = `${Math.round(p.x)}|${Math.round(p.y)}|${Math.round(p.z)}`
    if (seen.has(key)) return
    seen.add(key)
    if (isOccupied(p)) return
    const point: CandidatePoint = { x: p.x, y: p.y, z: p.z, failedItem: -1 }
    let lo = 0
    let hi = points.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (comparePoints(points[mid], point) <= 0) lo = mid + 1
      else hi = mid
    }
    points.splice(lo, 0, point)
  }

  const place = (piece: Piece, p: CandidatePoint, l: number, w: number, rotated: boolean) => {
    const box: Box = {
      x1: p.x,
      y1: p.y,
      z1: p.z,
      x2: p.x + l,
      y2: p.y + w,
      z2: p.z + piece.height,
      stackable: piece.stackable,
      weight: piece.weight,
    }
    let lo = 0
    let hi = boxes.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (boxes[mid].x1 <= box.x1) lo = mid + 1
      else hi = mid
    }
    boxes.splice(lo, 0, box)
    maxBoxLength = Math.max(maxBoxLength, l)
    loadedWeight += piece.weight
    placements.push({
      item: piece.item,
      x: box.x1,
      y: box.y1,
      z: box.z1,
      length: l,
      width: w,
      height: piece.height,
      rotated,
      weight: piece.weight,
    })

    // Points now inside the new box are gone for good.
    for (let i = points.length - 1; i >= 0; i--) {
      const q = points[i]
      if (
        q.x >= box.x1 - EPS &&
        q.x < box.x2 - EPS &&
        q.y >= box.y1 - EPS &&
        q.y < box.y2 - EPS &&
        q.z >= box.z1 - EPS &&
        q.z < box.z2 - EPS
      ) {
        points.splice(i, 1)
      }
    }

    const c1 = { x: box.x2, y: box.y1, z: box.z1 } // behind it (toward the door)
    const c2 = { x: box.x1, y: box.y2, z: box.z1 } // beside it
    const c3 = { x: box.x1, y: box.y1, z: box.z2 } // on top of it
    const generated = [
      c1,
      c2,
      c3,
      { ...c1, y: projectY(c1) },
      { ...c1, z: projectZ(c1) },
      { ...c2, x: projectX(c2) },
      { ...c2, z: projectZ(c2) },
      { ...c3, x: projectX(c3) },
      { ...c3, y: projectY(c3) },
    ]
    for (const q of generated) {
      addPoint(q)
      // Also offer the point dropped onto the floor / the top below it (gravity).
      const z = projectZ(q)
      if (z < q.z) addPoint({ ...q, z })
    }
  }

  const findPosition = (piece: Piece) => {
    const options: Array<{ l: number; w: number; rotated: boolean }> = [{ l: piece.length, w: piece.width, rotated: false }]
    if (piece.rotatable && piece.length !== piece.width) options.push({ l: piece.width, w: piece.length, rotated: true })
    // At one point, prefer the orientation that uses less depth (the long side across the width).
    options.sort((a, b) => a.l - b.l)
    for (const p of points) {
      if (p.failedItem === piece.item) continue
      for (const o of options) {
        if (canPlace(p, o.l, o.w, piece)) return { point: p, ...o }
      }
      p.failedItem = piece.item
    }
    return null
  }

  const queue: Piece[] = []
  for (const piece of pieces) {
    const reason = pieceRejection(spec, piece)
    if (reason) unplaced.push({ piece, reason })
    else queue.push(piece)
  }
  queue.sort(comparePieces)

  // Pieces of one cargo row are identical and consecutive: once one fails, the rest fail too.
  let failedItem = -1
  let failedReason: UnplacedReason = 'space'
  for (const piece of queue) {
    if (piece.item === failedItem) {
      unplaced.push({ piece, reason: failedReason })
      continue
    }
    if (loadedWeight + piece.weight > spec.maxPayload + 1e-6) {
      unplaced.push({ piece, reason: 'weight' })
      failedItem = piece.item
      failedReason = 'weight'
      continue
    }
    const found = findPosition(piece)
    if (!found) {
      unplaced.push({ piece, reason: 'space' })
      failedItem = piece.item
      failedReason = 'space'
      continue
    }
    place(piece, found.point, found.l, found.w, found.rotated)
  }
  return { placements, unplaced }
}

/** Expands cargo rows into pieces (at most {@link MAX_PIECES}); `limited` counts the rest. */
export function expandPieces(items: readonly CargoItem[]): { pieces: Piece[]; limited: number[] } {
  const pieces: Piece[] = []
  const limited = items.map(() => 0)
  items.forEach((item, index) => {
    for (let n = 0; n < item.quantity; n++) {
      if (pieces.length >= MAX_PIECES) {
        limited[index]++
        continue
      }
      pieces.push({
        item: index,
        length: item.length,
        width: item.width,
        height: item.height,
        weight: item.weight,
        stackable: item.stackable,
        rotatable: item.rotatable,
      })
    }
  })
  return { pieces, limited }
}

export interface ItemLoadStatus {
  loaded: number
  total: number
  /** Unloaded pieces by reason. */
  unplaced: Partial<Record<UnplacedReason, number>>
}

export interface PackingResult {
  spec: ContainerSpec
  placements: Placement[]
  items: ItemLoadStatus[]
  totalPieces: number
  loadedPieces: number
  /** m³ of all requested pieces / of the loaded pieces. */
  totalVolume: number
  loadedVolume: number
  /** kg of all requested pieces / of the loaded pieces. */
  totalWeight: number
  loadedWeight: number
  /** m² of floor covered by pieces standing on the floor, and the floor area of the space. */
  floorArea: number
  containerFloorArea: number
  /** Deepest point of the load measured from the front wall (mm). */
  usedLength: number
  volumeRatio: number
  weightRatio: number
  floorRatio: number
  /** All requested cargo is heavier than the payload. */
  overweight: boolean
  /** Cargo rows (indices) whose pieces are taller than the door opening but fit inside. */
  doorBlocked: number[]
  /** Cargo rows (indices) whose pieces do not fit inside at all. */
  oversize: number[]
  /** Pieces beyond {@link MAX_PIECES} that were not simulated. */
  limitedPieces: number
}

const pieceVolume = (p: { length: number; width: number; height: number }) => (p.length * p.width * p.height) / 1e9

/** Loads the cargo list into one container / truck and measures the result. */
export function analyzePacking(spec: ContainerSpec, items: readonly CargoItem[]): PackingResult {
  const { pieces, limited } = expandPieces(items)
  const { placements, unplaced } = packPieces(spec, pieces)

  const status: ItemLoadStatus[] = items.map((item, index) => ({
    loaded: 0,
    total: item.quantity,
    unplaced: limited[index] ? { limit: limited[index] } : {},
  }))
  for (const p of placements) status[p.item].loaded++
  for (const { piece, reason } of unplaced) {
    const counts = status[piece.item].unplaced
    counts[reason] = (counts[reason] ?? 0) + 1
  }

  const totalVolume = items.reduce((sum, item) => sum + pieceVolume(item) * item.quantity, 0)
  const totalWeight = items.reduce((sum, item) => sum + item.weight * item.quantity, 0)
  const loadedVolume = placements.reduce((sum, p) => sum + pieceVolume(p), 0)
  const loadedWeight = placements.reduce((sum, p) => sum + p.weight, 0)
  const floorArea = placements.filter((p) => p.z <= EPS).reduce((sum, p) => sum + (p.length * p.width) / 1e6, 0)
  const containerFloorArea = (spec.length * spec.width) / 1e6
  const usedLength = placements.reduce((max, p) => Math.max(max, p.x + p.length), 0)

  const doorBlocked: number[] = []
  const oversize: number[] = []
  items.forEach((item, index) => {
    const reason = pieceRejection(spec, { ...item, item: index })
    if (reason === 'size') oversize.push(index)
    else if (reason === 'door') doorBlocked.push(index)
  })

  return {
    spec,
    placements,
    items: status,
    totalPieces: items.reduce((sum, item) => sum + item.quantity, 0),
    loadedPieces: placements.length,
    totalVolume,
    loadedVolume,
    totalWeight,
    loadedWeight,
    floorArea,
    containerFloorArea,
    usedLength,
    volumeRatio: loadedVolume / spec.capacity,
    weightRatio: loadedWeight / spec.maxPayload,
    floorRatio: floorArea / containerFloorArea,
    overweight: totalWeight > spec.maxPayload,
    doorBlocked,
    oversize,
    limitedPieces: limited.reduce((a, b) => a + b, 0),
  }
}

export interface UnitPlan {
  spec: ContainerSpec
  /** Containers / trucks needed for the whole cargo; `null` when this size cannot carry it. */
  units: number | null
  /** Why this size cannot carry the cargo (a piece never fits, or far too many units). */
  blocked?: 'size' | 'door' | 'weight' | 'many'
  /**
   * How full a single unit is (largest of volume, payload and used length; 0–1).
   * Only meaningful when `units === 1`.
   */
  fill: number
  /** Average use of the units: volume / capacity, weight / payload, load length / inside length. */
  volumeRatio: number
  weightRatio: number
  lengthRatio: number
}

/** Number of units of one size needed for all pieces (greedy: fill one, then the next). */
export function planUnits(spec: ContainerSpec, pieces: readonly Piece[]): UnitPlan {
  const empty = { fill: 0, volumeRatio: 0, weightRatio: 0, lengthRatio: 0 }
  for (const piece of pieces) {
    const reason = pieceRejection(spec, piece)
    if (reason) return { spec, units: null, blocked: reason, ...empty }
  }
  if (pieces.length === 0) return { spec, units: 0, ...empty }
  const totalVolume = pieces.reduce((sum, p) => sum + pieceVolume(p), 0)
  const totalWeight = pieces.reduce((sum, p) => sum + p.weight, 0)
  let lengthSum = 0
  let remaining = pieces
  for (let units = 1; units <= MAX_UNITS; units++) {
    const { placements, unplaced } = packPieces(spec, remaining)
    lengthSum += placements.reduce((max, p) => Math.max(max, p.x + p.length), 0)
    if (unplaced.length === 0) {
      const volumeRatio = totalVolume / (units * spec.capacity)
      const weightRatio = totalWeight / (units * spec.maxPayload)
      const lengthRatio = lengthSum / (units * spec.length)
      return {
        spec,
        units,
        fill: units > 1 ? 1 : Math.max(volumeRatio, weightRatio, lengthRatio),
        volumeRatio,
        weightRatio,
        lengthRatio,
      }
    }
    if (placements.length === 0) break // no progress (cannot happen for pieces that fit alone)
    remaining = unplaced.map((u) => u.piece)
  }
  return { spec, units: null, blocked: 'many', ...empty }
}

export interface CategorySuggestion {
  category: ContainerCategory
  /** Fewest units, then the smallest size; `null` when no size of this category can carry it. */
  best: UnitPlan | null
  plans: UnitPlan[]
}

export function suggestForCategory(items: readonly CargoItem[], category: ContainerCategory): CategorySuggestion {
  const { pieces } = expandPieces(items)
  const plans = specsOfCategory(category).map((spec) => planUnits(spec, pieces))
  let best: UnitPlan | null = null
  for (const plan of plans) {
    if (plan.units === null || plan.units === 0) continue
    if (!best || plan.units < (best.units ?? Infinity)) best = plan
  }
  return { category, best, plans }
}

/** 余裕あり / 適正 / ほぼ満載 for a single-unit plan. */
export function fillLevel(fill: number): 'roomy' | 'good' | 'full' {
  if (fill < 0.7) return 'roomy'
  if (fill < 0.9) return 'good'
  return 'full'
}

export interface PackingSummary {
  pieces: number
  types: number
  totalVolume: number
  totalWeight: number
  nonStackablePieces: number
  /** Largest piece by volume. */
  largest: CargoItem | null
  items: readonly CargoItem[]
  /** The container / truck selected in the simulator. */
  selected: PackingResult
  sea: CategorySuggestion
  truck: CategorySuggestion
}

/** Everything the English "Packing & Container Summary" needs. */
export function buildPackingSummary(items: readonly CargoItem[], selected: ContainerSpec): PackingSummary {
  const largest = items.reduce<CargoItem | null>(
    (max, item) => (!max || pieceVolume(item) > pieceVolume(max) ? item : max),
    null,
  )
  const analysis = analyzePacking(selected, items)
  return {
    pieces: analysis.totalPieces,
    types: items.length,
    totalVolume: analysis.totalVolume,
    totalWeight: analysis.totalWeight,
    nonStackablePieces: items.filter((i) => !i.stackable).reduce((sum, i) => sum + i.quantity, 0),
    largest,
    items,
    selected: analysis,
    sea: suggestForCategory(items, 'sea'),
    truck: suggestForCategory(items, 'truck'),
  }
}
