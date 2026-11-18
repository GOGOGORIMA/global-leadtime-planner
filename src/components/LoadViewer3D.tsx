/**
 * Interactive 3D view of a loading plan (three.js, plain WebGLRenderer + OrbitControls).
 *
 * This module is loaded lazily with tab ⑤, so the three.js chunk is only downloaded when the
 * loading simulator is opened. Rendering is on demand (camera moves, data changes, resize).
 */
import { ImageDown, Layers } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  AmbientLight,
  ArrowHelper,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ContainerSpec } from '../data/containers'
import type { CargoItem } from '../types'
import type { Clearance, Placement } from '../utils/binPacking'
import { btn, cx, focusRing } from './classes'

export type CameraView = 'oblique' | 'side' | 'top' | 'door'

/** Text drawn around the 3D image in the saved PNG. */
export interface SnapshotInfo {
  title: string
  subtitle: string
  metrics: string
  items: Array<{ color: string; text: string }>
  warnings: string[]
  footer: string
  fileName: string
}

interface LoadViewer3DProps {
  spec: ContainerSpec
  placements: readonly Placement[]
  items: readonly CargoItem[]
  /** Cushioning / clearance used for the plan (draws the occupied boxes and the usable area). */
  clearance: Clearance
  snapshot: SnapshotInfo
}

const VIEWS: ReadonlyArray<{ id: CameraView; label: string; title: string }> = [
  { id: 'oblique', label: '斜め俯瞰', title: 'ドア側の斜め上から全体を見る' },
  { id: 'side', label: '真横 (側面)', title: '側面から積み高さと奥行きを見る' },
  { id: 'top', label: '真上 (平面)', title: '真上から床面の埋まり具合を見る' },
  { id: 'door', label: '正面 (ドア側)', title: 'ドア側から荷室の中を見る' },
]

const FONT = '"Inter", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif'
const MM = 1 / 1000
/** Gap (mm) left between neighbouring boxes so their outlines stay visible. */
const INSET = 8

/** Rough truck silhouettes (m): cab length & height, cargo floor height, wheel radius, rear axles. */
const TRUCK_SHAPES: Record<string, { cab: number; cabHeight: number; bed: number; wheel: number; rearAxles: number }> = {
  '2t': { cab: 1.55, cabHeight: 2.05, bed: 0.75, wheel: 0.36, rearAxles: 1 },
  '4t': { cab: 1.9, cabHeight: 2.4, bed: 0.95, wheel: 0.45, rearAxles: 1 },
  '10t': { cab: 2.25, cabHeight: 2.85, bed: 1.15, wheel: 0.52, rearAxles: 2 },
}

const formatMm = (mm: number) => Math.round(mm).toLocaleString('en-US')

function disposeTree(root: Object3D) {
  root.traverse((node) => {
    const object = node as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] }
    object.geometry?.dispose()
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
    for (const material of materials) {
      const map = (material as Material & { map?: { dispose: () => void } | null }).map
      map?.dispose()
      material.dispose()
    }
  })
  root.clear()
}

/** A camera-facing text label (sprite with a canvas texture), `height` in metres. */
function makeLabel(text: string, height: number, color = '#0f172a', border = '#cbd5e1'): Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const fontSize = 40
  const font = `600 ${fontSize}px ${FONT}`
  const padX = 22
  const padY = 14
  if (ctx) ctx.font = font
  const textWidth = ctx ? ctx.measureText(text).width : text.length * fontSize
  canvas.width = Math.ceil(textWidth + padX * 2)
  canvas.height = fontSize + padY * 2
  if (ctx) {
    ctx.font = font
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.strokeStyle = border
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(1.5, 1.5, canvas.width - 3, canvas.height - 3, 14)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.fillText(text, padX, canvas.height / 2 + 2)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }))
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1)
  sprite.renderOrder = 10
  return sprite
}

class LoadScene {
  readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(35, 1, 0.05, 500)
  private readonly controls: OrbitControls
  private readonly spaceGroup = new Group()
  private readonly cargoGroup = new Group()
  /** Occupied boxes incl. cushioning + the usable-area outline (toggled by the user). */
  private readonly cushionGroup = new Group()
  private readonly raycaster = new Raycaster()
  private readonly host: HTMLElement
  private readonly observer: ResizeObserver
  private spec: ContainerSpec | null = null
  private frame = 0
  private meshes: Mesh[] = []
  /** Labels / arrow at the door end (hidden in the door view, where they would sit right in front of the camera). */
  private doorMarkers: Object3D[] = []
  /** Scene extents (m) used to frame the camera views. */
  private bounds = { minX: -3, maxX: 3, minY: 0, maxY: 2.5, minZ: -1.2, maxZ: 1.2 }
  /** Called when the user starts orbiting / panning / zooming (with the shown container id). */
  onUserMove: ((specId: string) => void) | null = null

  constructor(canvas: HTMLCanvasElement, host: HTMLElement) {
    this.host = host
    // preserveDrawingBuffer: the canvas can be read back for the PNG export at any time.
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x000000, 0)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.screenSpacePanning = true
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 120
    this.controls.addEventListener('change', this.requestRender)
    this.controls.addEventListener('start', this.handleStart)

    this.scene.add(new AmbientLight(0xffffff, 1.5))
    const sun = new DirectionalLight(0xffffff, 2.2)
    sun.position.set(6, 12, 8)
    const fill = new DirectionalLight(0xffffff, 0.9)
    fill.position.set(-8, 5, -6)
    this.scene.add(sun, fill, this.spaceGroup, this.cargoGroup, this.cushionGroup)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
  }

  private handleStart = () => this.onUserMove?.(this.spec?.id ?? '')

  requestRender = () => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  private resize() {
    const width = this.host.clientWidth
    const height = this.host.clientHeight
    if (!width || !height) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.render()
  }

  /** Builds the container / truck body: floor grid, translucent walls, door, labels, truck cab. */
  setSpace(spec: ContainerSpec) {
    this.spec = spec
    disposeTree(this.spaceGroup)
    const L = spec.length * MM
    const W = spec.width * MM
    const H = spec.height * MM
    const D = spec.doorHeight * MM
    const g = this.spaceGroup

    const floor = new Mesh(new PlaneGeometry(L, W), new MeshBasicMaterial({ color: 0xf1f5f9 }))
    floor.rotation.x = -Math.PI / 2
    g.add(floor)

    // Floor grid every 0.5 m (1 m lines darker).
    const minor: number[] = []
    const major: number[] = []
    for (let i = 1; i * 0.5 < L - 1e-6; i++) {
      const x = -L / 2 + i * 0.5
      ;(i % 2 === 0 ? major : minor).push(x, 0.002, -W / 2, x, 0.002, W / 2)
    }
    for (let i = 1; i * 0.5 < W - 1e-6; i++) {
      const z = -W / 2 + i * 0.5
      ;(i % 2 === 0 ? major : minor).push(-L / 2, 0.002, z, L / 2, 0.002, z)
    }
    for (const [positions, color] of [
      [minor, 0xdbe2ea],
      [major, 0xb8c4d2],
    ] as const) {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      g.add(new LineSegments(geometry, new LineBasicMaterial({ color })))
    }

    // Translucent walls (the door end stays open) and the outline of the cargo space.
    const wall = (width: number, height: number, opacity: number) =>
      new Mesh(
        new PlaneGeometry(width, height),
        new MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity, side: DoubleSide, depthWrite: false }),
      )
    const front = wall(W, H, 0.12)
    front.position.set(-L / 2, H / 2, 0)
    front.rotation.y = Math.PI / 2
    const left = wall(L, H, 0.05)
    left.position.set(0, H / 2, -W / 2)
    const right = wall(L, H, 0.05)
    right.position.set(0, H / 2, W / 2)
    const roof = wall(L, W, 0.035)
    roof.position.set(0, H, 0)
    roof.rotation.x = Math.PI / 2
    g.add(front, left, right, roof)
    const outline = new LineSegments(new EdgesGeometry(new BoxGeometry(L, H, W)), new LineBasicMaterial({ color: 0x475569 }))
    outline.position.y = H / 2
    g.add(outline)

    // Door opening (orange); for sea containers the door header below the roof is shaded.
    const doorPoints = [
      [L / 2, 0, -W / 2],
      [L / 2, D, -W / 2],
      [L / 2, D, W / 2],
      [L / 2, 0, W / 2],
    ].flat()
    const doorGeometry = new BufferGeometry()
    doorGeometry.setAttribute('position', new Float32BufferAttribute(doorPoints, 3))
    g.add(new LineLoop(doorGeometry, new LineBasicMaterial({ color: 0xf97316 })))
    if (D < H - 1e-6) {
      const header = new Mesh(
        new PlaneGeometry(W, H - D),
        new MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.22, side: DoubleSide, depthWrite: false }),
      )
      header.position.set(L / 2, D + (H - D) / 2, 0)
      header.rotation.y = Math.PI / 2
      g.add(header)
    }

    const labelHeight = 0.26 + L * 0.018
    const back = makeLabel('奥（前壁）', labelHeight)
    back.position.set(-L / 2, H + labelHeight * 0.95, 0)
    const door = makeLabel(spec.category === 'sea' ? 'ドア（積込口）' : '後部ドア（積込口）', labelHeight, '#c2410c', '#fdba74')
    door.position.set(L / 2, H + labelHeight * 0.95, 0)
    g.add(back, door)
    this.doorMarkers = [door]
    if (D < H - 1e-6) {
      const opening = makeLabel(`ドア開口高 ${formatMm(spec.doorHeight)} mm`, labelHeight * 0.62, '#c2410c', '#fdba74')
      opening.position.set(L / 2 + 0.08, D + labelHeight * 0.45, W / 2 + 0.05)
      opening.center.set(0, 0.5)
      g.add(opening)
      this.doorMarkers.push(opening)
    }
    // Loading direction: from the door toward the front wall.
    const arrowLength = Math.min(1.4, 0.6 + L * 0.06)
    const arrow = new ArrowHelper(new Vector3(-1, 0, 0), new Vector3(L / 2 + arrowLength + 0.25, 0.02, 0), arrowLength, 0xf97316, arrowLength * 0.32, arrowLength * 0.22)
    g.add(arrow)
    this.doorMarkers.push(arrow)

    let minX = -L / 2
    let minY = 0
    if (spec.category === 'truck') {
      const shape = TRUCK_SHAPES[spec.id] ?? TRUCK_SHAPES['4t']
      minX = this.addTruck(L, W, shape)
      minY = -shape.bed
    }
    this.bounds = {
      minX: minX - 0.2,
      maxX: L / 2 + arrowLength + 0.4,
      minY,
      maxY: H + labelHeight * 1.5,
      minZ: -W / 2 - 0.1,
      maxZ: W / 2 + 0.1,
    }
    this.requestRender()
  }

  /** Simple cab, chassis and wheels in front of / under the cargo body. Returns the front x. */
  private addTruck(L: number, W: number, shape: (typeof TRUCK_SHAPES)[string]): number {
    const g = this.spaceGroup
    const ground = -shape.bed
    const gap = 0.12
    const cabFront = -L / 2 - gap - shape.cab
    const body = new MeshLambertMaterial({ color: 0xe2e8f0 })
    const dark = new MeshLambertMaterial({ color: 0x334155 })

    const cabBottom = ground + shape.wheel * 0.9
    const cab = new Mesh(new BoxGeometry(shape.cab, ground + shape.cabHeight - cabBottom, W * 0.96), body)
    cab.position.set(cabFront + shape.cab / 2, (cabBottom + ground + shape.cabHeight) / 2, 0)
    const cabEdges = new LineSegments(new EdgesGeometry(cab.geometry), new LineBasicMaterial({ color: 0x64748b }))
    cabEdges.position.copy(cab.position)
    const glassHeight = (ground + shape.cabHeight - cabBottom) * 0.38
    const windshield = new Mesh(
      new PlaneGeometry(W * 0.86, glassHeight),
      new MeshBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.75, side: DoubleSide }),
    )
    windshield.position.set(cabFront - 0.005, ground + shape.cabHeight - glassHeight / 2 - 0.12, 0)
    windshield.rotation.y = Math.PI / 2
    const bumper = new Mesh(new BoxGeometry(0.14, 0.22, W * 0.98), dark)
    bumper.position.set(cabFront - 0.04, cabBottom + 0.1, 0)

    const chassisLength = L / 2 - 0.1 - cabFront
    const chassis = new Mesh(new BoxGeometry(chassisLength, 0.2, W * 0.5), dark)
    chassis.position.set(cabFront + chassisLength / 2, ground + shape.wheel + 0.12, 0)
    // Deck slab just below the cargo floor (not coplanar with it, which would flicker).
    const deck = new Mesh(new BoxGeometry(L, 0.08, W), new MeshLambertMaterial({ color: 0x94a3b8 }))
    deck.position.set(0, -0.046, 0)
    g.add(cab, cabEdges, windshield, bumper, chassis, deck)

    const wheelGeometry = new CylinderGeometry(shape.wheel, shape.wheel, 0.3, 24)
    wheelGeometry.rotateX(Math.PI / 2)
    const tyre = new MeshLambertMaterial({ color: 0x1e293b })
    const axles = [cabFront + shape.cab * 0.55]
    if (shape.rearAxles === 1) axles.push(L / 2 - L * 0.28)
    else axles.push(L / 2 - L * 0.3, L / 2 - L * 0.3 - shape.wheel * 2.3)
    for (const x of axles) {
      for (const side of [-1, 1]) {
        const wheel = new Mesh(wheelGeometry, tyre)
        wheel.position.set(x, ground + shape.wheel, side * (W / 2 - 0.2))
        g.add(wheel)
      }
    }
    return cabFront - 0.1
  }

  /** Replaces the cargo boxes (shared geometry per size, one material per cargo row). */
  setCargo(placements: readonly Placement[], items: readonly CargoItem[]) {
    disposeTree(this.cargoGroup)
    this.meshes = []
    const spec = this.spec
    if (!spec) return
    const L = spec.length * MM
    const W = spec.width * MM
    const materials = items.map((item) => new MeshLambertMaterial({ color: new Color(item.color) }))
    const edgeMaterial = new LineBasicMaterial({ color: 0x0f172a })
    const shapes = new Map<string, { box: BoxGeometry; edges: EdgesGeometry }>()
    placements.forEach((p, index) => {
      const key = `${p.length}|${p.width}|${p.height}`
      let shape = shapes.get(key)
      if (!shape) {
        const box = new BoxGeometry(
          Math.max(p.length - INSET, 1) * MM,
          Math.max(p.height - INSET, 1) * MM,
          Math.max(p.width - INSET, 1) * MM,
        )
        shape = { box, edges: new EdgesGeometry(box) }
        shapes.set(key, shape)
      }
      const mesh = new Mesh(shape.box, materials[p.item] ?? materials[0])
      mesh.position.set((p.x + p.length / 2) * MM - L / 2, (p.z + p.height / 2) * MM, (p.y + p.width / 2) * MM - W / 2)
      mesh.userData.index = index
      const edges = new LineSegments(shape.edges, edgeMaterial)
      edges.position.copy(mesh.position)
      this.cargoGroup.add(mesh, edges)
      this.meshes.push(mesh)
    })
    this.requestRender()
  }

  /**
   * Draws the space each piece takes up including cushioning (translucent light-yellow box with a
   * dashed amber outline, clipped to the cargo space) and the usable area inside the wall clearance.
   */
  setCushion(placements: readonly Placement[], clearance: Clearance) {
    disposeTree(this.cushionGroup)
    const spec = this.spec
    if (!spec) return
    const L = spec.length * MM
    const W = spec.width * MM
    const fill = new MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.22, depthWrite: false })
    const outline = new LineDashedMaterial({ color: 0xd97706, dashSize: 0.045, gapSize: 0.03, transparent: true, opacity: 0.9 })
    const shapes = new Map<string, { box: BoxGeometry; edges: EdgesGeometry }>()
    const clip = (start: number, size: number, max: number): [number, number] => [Math.max(0, start), Math.min(max, start + size)]
    for (const p of placements) {
      const o = p.occupied
      if (o.length === p.length && o.width === p.width && o.height === p.height) continue // no cushioning
      const [x1, x2] = clip(o.x, o.length, spec.length)
      const [y1, y2] = clip(o.y, o.width, spec.width)
      const [z1, z2] = clip(o.z, o.height, spec.height)
      const key = `${x2 - x1}|${y2 - y1}|${z2 - z1}`
      let shape = shapes.get(key)
      if (!shape) {
        const box = new BoxGeometry((x2 - x1) * MM, (z2 - z1) * MM, (y2 - y1) * MM)
        shape = { box, edges: new EdgesGeometry(box) }
        shapes.set(key, shape)
      }
      const mesh = new Mesh(shape.box, fill)
      mesh.position.set(((x1 + x2) / 2) * MM - L / 2, ((z1 + z2) / 2) * MM, ((y1 + y2) / 2) * MM - W / 2)
      mesh.renderOrder = 2
      const edges = new LineSegments(shape.edges, outline)
      edges.position.copy(mesh.position)
      edges.computeLineDistances()
      this.cushionGroup.add(mesh, edges)
    }
    if (clearance.wall > 0) {
      // Usable area on the floor (inside the wall clearance), dashed.
      const m = clearance.wall * MM
      const corners = [
        [-L / 2 + m, 0.004, -W / 2 + m],
        [L / 2 - m, 0.004, -W / 2 + m],
        [L / 2 - m, 0.004, W / 2 - m],
        [-L / 2 + m, 0.004, W / 2 - m],
      ].flat()
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(corners, 3))
      const area = new LineLoop(
        geometry,
        new LineDashedMaterial({ color: 0xd97706, dashSize: 0.12, gapSize: 0.07 }),
      )
      area.computeLineDistances()
      this.cushionGroup.add(area)
    }
    this.requestRender()
  }

  setCushionVisible(visible: boolean) {
    this.cushionGroup.visible = visible
    this.requestRender()
  }

  /** Frames one of the preset camera views around the cargo space (and truck). */
  setView(view: CameraView) {
    const b = this.bounds
    const center = new Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2)
    const sizeX = b.maxX - b.minX
    const sizeY = b.maxY - b.minY
    const sizeZ = b.maxZ - b.minZ
    const vfov = (this.camera.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect)
    const fit = (horizontal: number, vertical: number, depth: number) =>
      Math.max(vertical / 2 / Math.tan(vfov / 2), horizontal / 2 / Math.tan(hfov / 2)) * 1.12 + depth / 2
    let direction: Vector3
    let distance: number
    switch (view) {
      case 'side':
        direction = new Vector3(0, 0.1, 1)
        distance = fit(sizeX, sizeY, sizeZ)
        break
      case 'top':
        direction = new Vector3(0, 1, 0.0001)
        distance = fit(sizeX, sizeZ, sizeY)
        break
      case 'door': {
        // Look through the door opening: frame the door end, the far wall is behind it.
        const spec = this.spec
        const L = spec ? spec.length * MM : sizeX
        const H = spec ? spec.height * MM : sizeY
        center.set(0, H / 2, 0)
        direction = new Vector3(1, 0.06, 0)
        distance = fit(sizeZ + 0.5, H + 0.5, 0) + L / 2
        break
      }
      default: {
        direction = new Vector3(0.95, 0.85, 1.3)
        const radius = Math.sqrt(sizeX * sizeX + sizeY * sizeY + sizeZ * sizeZ) / 2
        distance = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.8
      }
    }
    for (const marker of this.doorMarkers) marker.visible = view !== 'door'
    direction.normalize()
    this.camera.position.copy(center).addScaledVector(direction, distance)
    this.camera.near = Math.max(0.01, distance / 200)
    this.camera.far = distance * 20
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.controls.update()
    this.requestRender()
  }

  /**
   * Runs `capture` on a frame rendered at (at least) 2× resolution, for a crisp PNG export
   * even on standard-density screens, then restores the live resolution.
   */
  captureHighResolution<T>(capture: (canvas: HTMLCanvasElement) => T): T {
    const previous = this.renderer.getPixelRatio()
    const ratio = Math.max(2, previous)
    if (ratio !== previous) {
      this.renderer.setPixelRatio(ratio)
      this.resize()
    } else {
      this.render()
    }
    try {
      return capture(this.renderer.domElement)
    } finally {
      if (ratio !== previous) {
        this.renderer.setPixelRatio(previous)
        this.resize()
      }
    }
  }

  /** Index of the placement under the pointer, or -1. */
  pick(clientX: number, clientY: number): number {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return -1
    const pointer = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0]
    return hit ? (hit.object.userData.index as number) : -1
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.controls.removeEventListener('change', this.requestRender)
    this.controls.removeEventListener('start', this.handleStart)
    this.controls.dispose()
    disposeTree(this.spaceGroup)
    disposeTree(this.cargoGroup)
    disposeTree(this.cushionGroup)
    this.renderer.dispose()
  }
}

/** Wraps text to `maxWidth`, preferring breaks after spaces and Japanese separators. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    const next = line + ch
    if (!line || ctx.measureText(next).width <= maxWidth) {
      line = next
      continue
    }
    let cut = -1
    for (let i = line.length - 1; i > line.length * 0.5; i--) {
      if (/[ ・、，,／/）)]/.test(line[i])) {
        cut = i + 1
        break
      }
    }
    if (cut > 0) {
      lines.push(line.slice(0, cut).trimEnd())
      line = (line.slice(cut) + ch).trimStart()
    } else {
      lines.push(line)
      line = ch.trimStart()
    }
  }
  if (line) lines.push(line)
  return lines
}

/** 3D image + title, totals, cargo list and warnings on a white PNG canvas (long lines wrap). */
function composeSnapshot(source: HTMLCanvasElement, info: SnapshotInfo): HTMLCanvasElement {
  const scale = Math.max(1, source.width / Math.max(1, source.clientWidth))
  const width = source.width
  const pad = 20 * scale
  const chip = 12 * scale
  const out = document.createElement('canvas')
  const ctx = out.getContext('2d')
  if (!ctx) return source
  const font = (size: number, weight = 400) => `${weight} ${size * scale}px ${FONT}`

  interface Block {
    lines: string[]
    font: string
    color: string
    lineHeight: number
    indent: number
    chipColor?: string
    gapBefore: number
  }
  const block = (text: string, size: number, weight: number, color: string, gapBefore = 0, chipColor?: string): Block => {
    const indent = chipColor ? chip + 8 * scale : 0
    ctx.font = font(size, weight)
    // Keep numbers and their units together (non-breaking space before the unit).
    const glued = text.replace(/ (mm|kg|m³|m²|個)/g, '\u00a0$1')
    return {
      lines: wrapText(ctx, glued, width - pad * 2 - indent),
      font: font(size, weight),
      color,
      lineHeight: size * 1.5 * scale,
      indent,
      chipColor,
      gapBefore: gapBefore * scale,
    }
  }
  const height = (blocks: Block[]) => blocks.reduce((sum, b) => sum + b.gapBefore + b.lines.length * b.lineHeight, 0)

  const header = [
    block(info.title, 20, 700, '#0f172a'),
    block(info.subtitle, 13, 400, '#475569', 4),
    block(info.metrics, 13, 600, '#0f172a', 2),
  ]
  const list = [
    ...info.items.map((item, i) => block(item.text, 13, 400, '#1e293b', i === 0 ? 0 : 2, item.color)),
    ...info.warnings.map((warning) => block(`警告: ${warning}`, 13, 600, '#be123c', 4)),
    block(info.footer, 11, 400, '#94a3b8', 10),
  ]
  const headerHeight = pad + height(header) + 12 * scale
  out.width = width
  out.height = Math.round(headerHeight + source.height + 14 * scale + height(list) + pad)

  const draw = (blocks: Block[], top: number) => {
    let y = top
    for (const b of blocks) {
      y += b.gapBefore
      ctx.font = b.font
      b.lines.forEach((text, i) => {
        if (b.chipColor && i === 0) {
          ctx.fillStyle = b.chipColor
          ctx.fillRect(pad, y + (b.lineHeight - chip) / 2, chip, chip)
          ctx.strokeStyle = '#0f172a'
          ctx.lineWidth = scale
          ctx.strokeRect(pad, y + (b.lineHeight - chip) / 2, chip, chip)
        }
        ctx.fillStyle = b.color
        ctx.fillText(text, pad + b.indent, y + b.lineHeight / 2)
        y += b.lineHeight
      })
    }
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.textBaseline = 'middle'
  draw(header, pad)
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(0, headerHeight, width, source.height)
  ctx.drawImage(source, 0, headerHeight)
  draw(list, headerHeight + source.height + 14 * scale)
  return out
}

function downloadCanvas(canvas: HTMLCanvasElement, fileName: string) {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, 'image/png')
}

export default function LoadViewer3D({ spec, placements, items, clearance, snapshot }: LoadViewer3DProps) {
  const sceneRef = useRef<LoadScene | null>(null)
  /** Preset applied when the container changes (kept in a ref so the effect does not re-run). */
  const viewRef = useRef<CameraView>('oblique')
  const pickFrame = useRef(0)
  const [view, setView] = useState<CameraView>('oblique')
  /** Container id for which the user moved the camera by hand (no preset button is active then). */
  const [movedFor, setMovedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<{
    index: number
    x: number
    y: number
    maxLeft: number
    placements: readonly Placement[]
  } | null>(null)

  // The WebGL scene lives as long as the canvas element (React 19 ref callback with cleanup).
  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    const host = canvas?.parentElement
    if (!canvas || !host) return
    let scene: LoadScene
    try {
      scene = new LoadScene(canvas, host)
    } catch {
      setError('この環境では 3D 表示（WebGL）を利用できません。積載結果は貨物リストとメーターで確認できます。')
      return
    }
    scene.onUserMove = (specId) => setMovedFor(specId)
    sceneRef.current = scene
    return () => {
      cancelAnimationFrame(pickFrame.current)
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  // New container / truck: rebuild the body and re-frame the last chosen preset view.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setSpace(spec)
    scene.setView(viewRef.current)
  }, [spec])

  useEffect(() => {
    sceneRef.current?.setCargo(placements, items)
  }, [spec, placements, items])

  // Occupied boxes incl. cushioning (ON/OFF toggle; on by default).
  const [showCushion, setShowCushion] = useState(true)
  const hasCushion = placements.some(
    (p) => p.occupied.length !== p.length || p.occupied.width !== p.width || p.occupied.height !== p.height,
  )
  useEffect(() => {
    sceneRef.current?.setCushion(placements, clearance)
  }, [spec, placements, clearance])
  useEffect(() => {
    sceneRef.current?.setCushionVisible(showCushion)
  }, [showCushion])

  const activeView = movedFor === spec.id ? null : view

  const changeView = (next: CameraView) => {
    viewRef.current = next
    setView(next)
    setMovedFor(null)
    sceneRef.current?.setView(next)
  }

  const save = () => {
    const scene = sceneRef.current
    if (!scene) return
    downloadCanvas(scene.captureHighResolution((canvas) => composeSnapshot(canvas, snapshot)), snapshot.fileName)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 0 || e.pointerType === 'touch') {
      if (hover) setHover(null)
      return
    }
    const { clientX, clientY } = e
    const rect = e.currentTarget.getBoundingClientRect()
    cancelAnimationFrame(pickFrame.current)
    pickFrame.current = requestAnimationFrame(() => {
      const index = sceneRef.current?.pick(clientX, clientY) ?? -1
      setHover(
        index >= 0
          ? { index, x: clientX - rect.left, y: clientY - rect.top, maxLeft: rect.width - 268, placements }
          : null,
      )
    })
  }

  // A hover from before the plan changed is ignored (indices refer to the old placements).
  const hovered = hover && hover.placements === placements ? placements[hover.index] : undefined
  const hoveredItem = hovered ? items[hovered.item] : undefined

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="カメラ視点" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              title={v.title}
              aria-pressed={activeView === v.id}
              onClick={() => changeView(v.id)}
              className={cx(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition',
                focusRing,
                activeView === v.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={showCushion}
          disabled={!hasCushion && clearance.wall === 0}
          onClick={() => setShowCushion((v) => !v)}
          title="緩衝材・隙間を含めた占有境界（黄色の半透明ボックスと破線）と、壁面クリアランスの内側（有効積載エリア）を表示"
          className={cx(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition ring-inset disabled:cursor-not-allowed disabled:opacity-40',
            focusRing,
            showCushion ? 'bg-amber-50 text-amber-800 ring-amber-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
          )}
        >
          <Layers size={14} />
          緩衝材を表示 {showCushion ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={cx(btn.primary, 'ml-auto')} onClick={save} disabled={Boolean(error)}>
          <ImageDown size={16} />
          3D画像を保存
        </button>
      </div>
      <div
        className="relative h-[480px] w-full overflow-hidden rounded-xl border border-slate-200 bg-linear-to-b from-white to-slate-100"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none"
          role="img"
          aria-label={`${spec.nameJa} の 3D 積載ビュー（${placements.length} 個）`}
        />
        {hovered && hoveredItem && hover && (
          <div
            className="pointer-events-none absolute z-10 w-64 rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow-lg"
            style={{ left: Math.max(8, Math.min(hover.x + 14, hover.maxLeft)), top: Math.max(8, hover.y - 10) }}
          >
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <span className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-slate-900/30" style={{ backgroundColor: hoveredItem.color }} />
              <span className="truncate">{hoveredItem.name}</span>
            </div>
            <div className="mt-1 text-slate-600 tabular-nums">
              {formatMm(hoveredItem.length)} × {formatMm(hoveredItem.width)} × {formatMm(hoveredItem.height)} mm ・{' '}
              {hoveredItem.weight.toLocaleString('en-US')} kg
            </div>
            <div className="mt-0.5 text-slate-500 tabular-nums">
              奥から {formatMm(hovered.x)} mm ・ 床から {formatMm(hovered.z)} mm
              {hovered.rotated ? ' ・ 90°回転' : ''}
            </div>
            {(hovered.occupied.length !== hovered.length || hovered.occupied.height !== hovered.height) && (
              <div className="mt-0.5 text-amber-700 tabular-nums">
                緩衝材込み {formatMm(hovered.occupied.length)} × {formatMm(hovered.occupied.width)} ×{' '}
                {formatMm(hovered.occupied.height)} mm
                {hoveredItem.margin > 0 ? `（個別 +${formatMm(hoveredItem.margin)} mm）` : ''}
              </div>
            )}
            {!hoveredItem.stackable && <div className="mt-0.5 font-medium text-rose-600">上積み厳禁（この上には積まない）</div>}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-600">{error}</div>
        )}
        {!error && placements.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-slate-500">
            積載された貨物はありません
          </div>
        )}
        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-slate-500">
          ドラッグ: 回転 ／ 右ドラッグ: 移動 ／ ホイール: ズーム
        </p>
      </div>
    </div>
  )
}
