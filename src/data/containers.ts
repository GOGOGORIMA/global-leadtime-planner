/**
 * Ocean containers and Japanese domestic trucks for the loading simulator (タブ⑤ バンニング計算機).
 *
 * All sizes are INSIDE dimensions in mm; `length` runs from the front wall (奥) to the door.
 * Payloads in kg. Capacities are the published nominal values in m³.
 */

export type ContainerCategory = 'sea' | 'truck'

export const CONTAINER_IDS = ['20dc', '40dc', '40hc', '2t', '4t', '10t'] as const
export type ContainerId = (typeof CONTAINER_IDS)[number]

export function isContainerId(value: unknown): value is ContainerId {
  return typeof value === 'string' && (CONTAINER_IDS as readonly string[]).includes(value)
}

export interface ContainerSpec {
  id: ContainerId
  category: ContainerCategory
  /** Short label for buttons and badges, e.g. `20ft Dry`, `4t トラック`. */
  label: string
  /** Japanese full name. */
  nameJa: string
  /** English name used in the e-mail, e.g. `20ft Dry container`. */
  nameEn: string
  length: number
  width: number
  height: number
  /**
   * Door opening height. Pieces taller than this cannot be loaded even if the inside height
   * would allow it. Trucks (aluminium van / wing body) load through the rear door or the opened
   * side wing, so the full inside height is available.
   */
  doorHeight: number
  maxPayload: number
  /** Nominal capacity (m³). */
  capacity: number
  /** Counter word: 本 (containers) / 台 (trucks). */
  unitJa: string
}

export const CONTAINER_SPECS: readonly ContainerSpec[] = [
  {
    id: '20dc',
    category: 'sea',
    label: '20ft Dry',
    nameJa: '20ft ドライコンテナ',
    nameEn: '20ft Dry container',
    length: 5898,
    width: 2352,
    height: 2393,
    doorHeight: 2280,
    maxPayload: 24000,
    capacity: 33.2,
    unitJa: '本',
  },
  {
    id: '40dc',
    category: 'sea',
    label: '40ft Dry',
    nameJa: '40ft ドライコンテナ',
    nameEn: '40ft Dry container',
    length: 12032,
    width: 2352,
    height: 2393,
    doorHeight: 2280,
    maxPayload: 26500,
    capacity: 67.7,
    unitJa: '本',
  },
  {
    id: '40hc',
    category: 'sea',
    label: '40ft HQ',
    nameJa: '40ft ハイキューブ（HQ）',
    nameEn: '40ft High Cube container',
    length: 12032,
    width: 2352,
    height: 2698,
    doorHeight: 2585,
    maxPayload: 26500,
    capacity: 76.4,
    unitJa: '本',
  },
  {
    id: '2t',
    category: 'truck',
    label: '2t トラック',
    nameJa: '2t トラック（標準/ロング）',
    nameEn: '2-ton truck',
    length: 4350,
    width: 1780,
    height: 2100,
    doorHeight: 2100,
    maxPayload: 2000,
    capacity: 16.2,
    unitJa: '台',
  },
  {
    id: '4t',
    category: 'truck',
    label: '4t トラック',
    nameJa: '4t トラック（ワイド・62ボディ）',
    nameEn: '4-ton truck (wide body)',
    length: 6200,
    width: 2380,
    height: 2400,
    doorHeight: 2400,
    maxPayload: 3500,
    capacity: 35.4,
    unitJa: '台',
  },
  {
    id: '10t',
    category: 'truck',
    label: '10t トラック',
    nameJa: '10t トラック（大型・96ボディ）',
    nameEn: '10-ton truck',
    length: 9600,
    width: 2380,
    height: 2500,
    doorHeight: 2500,
    maxPayload: 13000,
    capacity: 57.1,
    unitJa: '台',
  },
]

export const DEFAULT_CONTAINER: ContainerId = '20dc'

export function getContainerSpec(id: ContainerId): ContainerSpec {
  return CONTAINER_SPECS.find((s) => s.id === id) ?? CONTAINER_SPECS[0]
}

export function specsOfCategory(category: ContainerCategory): ContainerSpec[] {
  return CONTAINER_SPECS.filter((s) => s.category === category)
}

export const CATEGORY_LABELS: Record<ContainerCategory, string> = {
  sea: '海上コンテナ',
  truck: '陸路トラック',
}

/** Standard pallet footprints offered as one-click size buttons (length × width, mm). */
export const PALLET_PRESETS: ReadonlyArray<{ id: string; label: string; title: string; length: number; width: number }> = [
  { id: 't11', label: 'T11型 1100×1100', title: 'T11型パレット（JIS 一貫輸送用）1100 × 1100 mm', length: 1100, width: 1100 },
  { id: 'euro', label: 'ユーロ 1200×800', title: 'ユーロパレット（EUR/EPAL）1200 × 800 mm', length: 1200, width: 800 },
  { id: 't12', label: 'T12型 1200×1000', title: 'T12型パレット 1200 × 1000 mm', length: 1200, width: 1000 },
  { id: 'us', label: '北米 1219×1016', title: '北米パレット（48 × 40 in）1219 × 1016 mm', length: 1219, width: 1016 },
]
