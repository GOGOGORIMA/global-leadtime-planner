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
 *
 * Cushioning / clearance ({@link Clearance}): every piece is packed with its EFFECTIVE size —
 * actual length / width + the gap between pieces + twice its own extra margin, actual height +
 * the cushioning between tiers — inside the usable area (inside length / width minus the wall
 * clearance on both sides). Internally the area is widened by one gap so that the half gaps at the
 * outer sides do not eat into the wall clearance: neighbouring pieces end up exactly `gap`
 * (+ their margins) apart and every piece exactly `wall` (+ its margin) away from the walls.
 * Stacking support is measured on the actual footprints (cushioning does not carry a load).
 */
import { specsOfCategory, type ContainerCategory, type ContainerSpec } from '../data/containers'
import type { CargoItem, CushionSettings } from '../types'

/** Tolerance in mm for touching / overlapping faces. */
const EPS = 0.5
/** Share of a stacked piece's base that must rest on pieces below it. */
export const SUPPORT_RATIO = 0.8
/** Simulation cap: more pieces than this are reported as `limit` (keeps the browser responsive). */
export const MAX_PIECES = 1000
/** Upper bound for the number of containers / trucks a suggestion may use. */
const MAX_UNITS = 200

export type UnplacedReason = 'size' | 'door' | 'weight' | 'space' | 'limit'

/** Cushioning / clearance used while loading (mm). */
export interface Clearance {
  /** Cushioning between neighbouring pieces (horizontal: length and width). */
  gap: number
  /** Clearance between the cargo and the side walls, the front wall and the door. */
  wall: number
  /** Cushioning between stacked tiers (0 = pieces stand directly on each other). */
  stack: number
}

export const NO_CLEARANCE: Clearance = { gap: 0, wall: 0, stack: 0 }

/** The clearance a settings panel stands for (`stack` only counts when the tier option is on). */
export function toClearance(settings: CushionSettings): Clearance {
  return { gap: settings.gap, wall: settings.wall, stack: settings.stack ? settings.stackGap : 0 }
}

export function hasClearance(clearance: Clearance): boolean {
  return clearance.gap > 0 || clearance.wall > 0 || clearance.stack > 0
}

export interface Piece {
  /** Index of the cargo row. */
  item: number
  length: number
  width: number
  height: number
  weight: number
  stackable: boolean
  rotatable: boolean
  /** Extra cushioning around this piece only (mm, on all four sides). */
  margin: number
}

export interface Box3 {
  x: number
  y: number
  z: number
  length: number
  width: number
  height: number
}

export interface Placement extends Box3 {
  item: number
  /** Turned 90° on the floor relative to the cargo row's length × width. */
  rotated: boolean
  weight: number
  /**
   * Space taken including cushioning (same coordinates as the piece). Neighbouring occupied
   * boxes touch; with a wall clearance below half a gap they may reach past the walls.
   */
  occupied: Box3
}

export interface PackPiecesResult {
  placements: Placement[]
  unplaced: Array<{ piece: Piece; reason: UnplacedReason }>
}

/** A placed piece in packing coordinates (effective size, see the module comment). */
interface Box {
  x1: number
  y1: number
  z1: number
  x2: number
  y2: number
  z2: number
  /** Distance from the effective box to the actual piece on each horizontal side. */
  inset: number
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

/** Usable length / width (mm) after the wall clearance on both sides. */
export function usableArea(spec: ContainerSpec, clearance: Clearance): { length: number; width: number } {
  return { length: spec.length - 2 * clearance.wall, width: spec.width - 2 * clearance.wall }
}

/** Can the piece (with its own margin) fit inside the usable area in some allowed orientation? */
function fitsInside(spec: ContainerSpec, piece: Piece, clearance: Clearance): boolean {
  if (piece.height > spec.height + EPS) return false
  const { length, width } = usableArea(spec, clearance)
  const l = piece.length + 2 * piece.margin
  const w = piece.width + 2 * piece.margin
  const straight = l <= length + EPS && w <= width + EPS
  const turned = piece.rotatable && w <= length + EPS && l <= width + EPS
  return straight || turned
}

/** Why a single piece can never be loaded into this container / truck (or `null`). */
export function pieceRejection(
  spec: ContainerSpec,
  piece: Piece,
  clearance: Clearance = NO_CLEARANCE,
): 'size' | 'door' | 'weight' | null {
  if (!fitsInside(spec, piece, clearance)) return 'size'
  if (piece.height > spec.doorHeight + EPS) return 'door'
  if (piece.weight > spec.maxPayload) return 'weight'
  return null
}

/** Size a piece takes up including cushioning (mm, not rotated). */
export function occupiedSize(
  piece: { length: number; width: number; height: number; margin: number },
  clearance: Clearance,
): { length: number; width: number; height: number } {
  const extra = clearance.gap + 2 * piece.margin
  return { length: piece.length + extra, width: piece.width + extra, height: piece.height + clearance.stack }
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
export function packPieces(
  spec: ContainerSpec,
  pieces: readonly Piece[],
  clearance: Clearance = NO_CLEARANCE,
): PackPiecesResult {
  const { gap, wall, stack } = clearance
  // Packing area for effective sizes: usable area widened by one gap (half a gap per side), and
  // one tier cushion higher (the top tier needs none above it). See the module comment.
  const L = spec.length - 2 * wall + gap
  const W = spec.width - 2 * wall + gap
  const H = spec.height + stack
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

  /** `l` / `w` are effective (cushioned) sizes; support is checked on the actual footprints. */
  const canPlace = (p: CandidatePoint, l: number, w: number, piece: Piece): boolean => {
    const x1 = p.x
    const y1 = p.y
    const z1 = p.z
    const x2 = x1 + l
    const y2 = y1 + w
    const z2 = z1 + piece.height + stack
    if (x2 > L + EPS || y2 > W + EPS || z2 > H + EPS) return false
    const inset = gap / 2 + piece.margin
    const ax1 = x1 + inset
    const ax2 = x2 - inset
    const ay1 = y1 + inset
    const ay2 = y2 - inset
    let supported = 0
    for (let i = firstBoxNear(x1); i < boxes.length; i++) {
      const b = boxes[i]
      if (b.x1 >= x2 - EPS) break
      if (b.x2 <= x1 + EPS) continue
      const oy = Math.min(y2, b.y2) - Math.max(y1, b.y1)
      if (oy <= EPS) continue
      // The (cushioned) footprints overlap.
      if (b.z1 < z2 - EPS && b.z2 > z1 + EPS) return false // the volumes intersect
      if (b.z2 <= z1 + EPS) {
        if (!b.stackable) return false // never anywhere above a non-stackable piece
        if (Math.abs(b.z2 - z1) <= EPS) {
          if (b.weight + 1e-6 < piece.weight) return false // no heavier piece on a lighter one
          const sx = Math.min(ax2, b.x2 - b.inset) - Math.max(ax1, b.x1 + b.inset)
          const sy = Math.min(ay2, b.y2 - b.inset) - Math.max(ay1, b.y1 + b.inset)
          if (sx > 0 && sy > 0) supported += sx * sy
        }
      } else if (!piece.stackable) {
        return false // a box would end up above this non-stackable piece
      }
    }
    return z1 <= EPS || supported >= SUPPORT_RATIO * (ax2 - ax1) * (ay2 - ay1) - EPS
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
    const inset = gap / 2 + piece.margin
    const box: Box = {
      x1: p.x,
      y1: p.y,
      z1: p.z,
      x2: p.x + l,
      y2: p.y + w,
      z2: p.z + piece.height + stack,
      inset,
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
    // Packing coordinates start half a gap before the usable area (wall clearance).
    const shift = wall - gap / 2
    placements.push({
      item: piece.item,
      x: box.x1 + shift + inset,
      y: box.y1 + shift + inset,
      z: box.z1,
      length: l - 2 * inset,
      width: w - 2 * inset,
      height: piece.height,
      rotated,
      weight: piece.weight,
      occupied: { x: box.x1 + shift, y: box.y1 + shift, z: box.z1, length: l, width: w, height: piece.height + stack },
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
    const extra = gap + 2 * piece.margin
    const options: Array<{ l: number; w: number; rotated: boolean }> = [
      { l: piece.length + extra, w: piece.width + extra, rotated: false },
    ]
    if (piece.rotatable && piece.length !== piece.width) {
      options.push({ l: piece.width + extra, w: piece.length + extra, rotated: true })
    }
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
    const reason = pieceRejection(spec, piece, clearance)
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
        margin: item.margin ?? 0,
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
  clearance: Clearance
  placements: Placement[]
  items: ItemLoadStatus[]
  totalPieces: number
  loadedPieces: number
  /** Net cargo volume (m³, the pieces themselves) of all requested pieces / of the loaded pieces. */
  totalVolume: number
  loadedVolume: number
  /** Gross occupied volume (m³, pieces + cushioning) of all requested pieces / of the loaded pieces. */
  totalGrossVolume: number
  loadedGrossVolume: number
  /** kg of all requested pieces / of the loaded pieces. */
  totalWeight: number
  loadedWeight: number
  /** m² of floor under pieces standing on the floor: net, and including their cushioning. */
  floorArea: number
  grossFloorArea: number
  containerFloorArea: number
  /** Deepest point of the load measured from the front wall (mm). */
  usedLength: number
  /** Usable length / width after the wall clearance (mm). */
  usableLength: number
  usableWidth: number
  /** Net volume / capacity, gross volume / capacity, loaded weight / payload, gross floor share. */
  volumeRatio: number
  grossVolumeRatio: number
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

const grossVolume = (piece: { length: number; width: number; height: number; margin: number }, clearance: Clearance) => {
  const size = occupiedSize(piece, clearance)
  return (size.length * size.width * size.height) / 1e9
}

/** Loads the cargo list into one container / truck and measures the result. */
export function analyzePacking(
  spec: ContainerSpec,
  items: readonly CargoItem[],
  clearance: Clearance = NO_CLEARANCE,
): PackingResult {
  const { pieces, limited } = expandPieces(items)
  const { placements, unplaced } = packPieces(spec, pieces, clearance)

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
  const totalGrossVolume = items.reduce(
    (sum, item) => sum + grossVolume({ ...item, margin: item.margin ?? 0 }, clearance) * item.quantity,
    0,
  )
  const totalWeight = items.reduce((sum, item) => sum + item.weight * item.quantity, 0)
  const loadedVolume = placements.reduce((sum, p) => sum + pieceVolume(p), 0)
  const loadedGrossVolume = placements.reduce((sum, p) => sum + pieceVolume(p.occupied), 0)
  const loadedWeight = placements.reduce((sum, p) => sum + p.weight, 0)
  const onFloor = placements.filter((p) => p.z <= EPS)
  const floorArea = onFloor.reduce((sum, p) => sum + (p.length * p.width) / 1e6, 0)
  const grossFloorArea = onFloor.reduce((sum, p) => sum + (p.occupied.length * p.occupied.width) / 1e6, 0)
  const containerFloorArea = (spec.length * spec.width) / 1e6
  const usedLength = placements.reduce((max, p) => Math.max(max, p.x + p.length), 0)
  const usable = usableArea(spec, clearance)

  const doorBlocked: number[] = []
  const oversize: number[] = []
  items.forEach((item, index) => {
    const reason = pieceRejection(spec, { ...item, margin: item.margin ?? 0, item: index }, clearance)
    if (reason === 'size') oversize.push(index)
    else if (reason === 'door') doorBlocked.push(index)
  })

  return {
    spec,
    clearance,
    placements,
    items: status,
    totalPieces: items.reduce((sum, item) => sum + item.quantity, 0),
    loadedPieces: placements.length,
    totalVolume,
    loadedVolume,
    totalGrossVolume,
    loadedGrossVolume,
    totalWeight,
    loadedWeight,
    floorArea,
    grossFloorArea,
    containerFloorArea,
    usedLength,
    usableLength: usable.length,
    usableWidth: usable.width,
    volumeRatio: loadedVolume / spec.capacity,
    grossVolumeRatio: loadedGrossVolume / spec.capacity,
    weightRatio: loadedWeight / spec.maxPayload,
    floorRatio: Math.min(1, grossFloorArea / containerFloorArea),
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
   * How full a single unit is (largest of gross volume, payload and used length; 0–1).
   * Only meaningful when `units === 1`.
   */
  fill: number
  /**
   * Average use of the units: gross occupied volume (cargo + cushioning) / capacity,
   * weight / payload, load length / inside length.
   */
  volumeRatio: number
  weightRatio: number
  lengthRatio: number
}

/** Number of units of one size needed for all pieces (greedy: fill one, then the next). */
export function planUnits(spec: ContainerSpec, pieces: readonly Piece[], clearance: Clearance = NO_CLEARANCE): UnitPlan {
  const empty = { fill: 0, volumeRatio: 0, weightRatio: 0, lengthRatio: 0 }
  for (const piece of pieces) {
    const reason = pieceRejection(spec, piece, clearance)
    if (reason) return { spec, units: null, blocked: reason, ...empty }
  }
  if (pieces.length === 0) return { spec, units: 0, ...empty }
  const totalVolume = pieces.reduce((sum, p) => sum + grossVolume(p, clearance), 0)
  const totalWeight = pieces.reduce((sum, p) => sum + p.weight, 0)
  let lengthSum = 0
  let remaining = pieces
  for (let units = 1; units <= MAX_UNITS; units++) {
    const { placements, unplaced } = packPieces(spec, remaining, clearance)
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

export function suggestForCategory(
  items: readonly CargoItem[],
  category: ContainerCategory,
  clearance: Clearance = NO_CLEARANCE,
): CategorySuggestion {
  const { pieces } = expandPieces(items)
  const plans = specsOfCategory(category).map((spec) => planUnits(spec, pieces, clearance))
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
  /** Net cargo volume (m³, the packages themselves). */
  totalVolume: number
  /** Gross occupied volume (m³) with the cushioning of the selected container / truck. */
  grossVolume: number
  totalWeight: number
  nonStackablePieces: number
  /** Largest piece by volume. */
  largest: CargoItem | null
  items: readonly CargoItem[]
  /** Cushioning per transport mode (each suggestion uses its own mode's settings). */
  clearance: Record<ContainerCategory, Clearance>
  /** The container / truck selected in the simulator. */
  selected: PackingResult
  sea: CategorySuggestion
  truck: CategorySuggestion
}

/** Everything the English "Packing & Container Summary" needs. */
export function buildPackingSummary(
  items: readonly CargoItem[],
  selected: ContainerSpec,
  clearance: Record<ContainerCategory, Clearance> = { sea: NO_CLEARANCE, truck: NO_CLEARANCE },
): PackingSummary {
  const largest = items.reduce<CargoItem | null>(
    (max, item) => (!max || pieceVolume(item) > pieceVolume(max) ? item : max),
    null,
  )
  const analysis = analyzePacking(selected, items, clearance[selected.category])
  return {
    pieces: analysis.totalPieces,
    types: items.length,
    totalVolume: analysis.totalVolume,
    grossVolume: analysis.totalGrossVolume,
    totalWeight: analysis.totalWeight,
    nonStackablePieces: items.filter((i) => !i.stackable).reduce((sum, i) => sum + i.quantity, 0),
    largest,
    items,
    clearance,
    selected: analysis,
    sea: suggestForCategory(items, 'sea', clearance.sea),
    truck: suggestForCategory(items, 'truck', clearance.truck),
  }
}
