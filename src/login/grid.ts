// The access pages' backdrop: two mirrored perspective grids (floor and ceiling) meeting at a hazy horizon, with towers
// and signal traffic attached to them. Ported from the login-grid prototype (codex/login-grid-prototype).
//
// All geometry is in fixed world coordinates and only the camera moves. Rows keep absolute IDs, so accent colours and
// the objects attached to a row stay with it as it passes; there is no modulo reset or recycled object pool to show a
// seam.

const GRID_SPACING = 2.4
const LANE_SPACING = 1.8
const HIGHLIGHT_INTERVAL = 4
/** Grid drift, world units per second. Signal timing is independent. */
const SPEED = 0.45
/** Cyan traffic relative to the grid, world units per second. */
const SIGNAL_SPEED = 7.2
const NEAR = 1.9
const FAR = 95
const CAMERA_HEIGHT = 1.62
/** Roughly 30 fps is plenty for a backdrop. */
const FRAME_INTERVAL_MS = 33

type Point = [number, number]
type Kind = 'cyan' | 'magenta'

const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const colour = (kind: Kind, alpha: number) =>
  kind === 'magenta' ? `rgba(247,12,221,${alpha})` : `rgba(97,238,255,${alpha})`

/** Paints one frame of the scene at the given camera travel and signal clock. */
function paint(ctx: CanvasRenderingContext2D, width: number, height: number, travel: number, motionTime: number) {
  ctx.clearRect(0, 0, width, height)
  const horizon = height * (width < 950 ? 0.482 : 0.492)
  const centre = width / 2
  const focal = Math.max(width * 0.76, 620)
  // The floor projects below the horizon (direction 1) and the ceiling uses the same geometry above it (-1).
  const project = (x: number, z: number, direction: number): Point => [
    centre + (x * focal) / z,
    horizon + (direction * CAMERA_HEIGHT * focal) / z,
  ]

  // One depth envelope for the grid and everything on it. Its flat ends hide rows entering and leaving.
  const depthFade = (z: number) =>
    smooth(NEAR, NEAR + 4.8, z) * (1 - smooth(58, FAR, z)) * smooth(8, 80, (CAMERA_HEIGHT * focal) / z)
  const firstRow = Math.floor((travel + NEAR) / GRID_SPACING) - 2
  const lastRow = Math.ceil((travel + FAR) / GRID_SPACING) + 2

  function line(a: Point, b: Point) {
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
  }

  function drawTower(row: number, direction: number, intensity: number) {
    const seed = row + (direction < 0 ? 1009 : 0)
    const z = NEAR + row * GRID_SPACING - travel
    const alpha = depthFade(z) * intensity * 0.35
    if (alpha <= 0) return
    // The row's ID fixes the tower's lane, height, and colour.
    const lane = (hash(seed + 1) < 0.5 ? -1 : 1) * (2 + Math.floor(hash(seed + 2) * 7))
    const x = lane * LANE_SPACING
    const h = 0.45 + hash(seed + 3) * 0.85
    const half = 0.14 + hash(seed + 4) * 0.13
    const kind: Kind = hash(seed + 5) > 0.76 ? 'magenta' : 'cyan'
    // Both ends of every vertical edge use the same projection; the footprint is centred on a grid intersection.
    const point = (dx: number, dz: number, y: number): Point => {
      const p = project(x + dx, z + dz, direction)
      p[1] -= (direction * y * focal) / (z + dz)
      return p
    }
    const corners: Point[] = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ]
    const base = corners.map(([dx, dz]) => point(dx, dz, 0))
    const top = corners.map(([dx, dz]) => point(dx, dz, h))
    ctx.fillStyle = colour(kind, alpha * 0.12)
    ctx.strokeStyle = colour(kind, alpha)
    ctx.lineWidth = 0.85
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4
      ctx.beginPath()
      ctx.moveTo(...base[j])
      ctx.lineTo(...base[k])
      ctx.lineTo(...top[k])
      ctx.lineTo(...top[j])
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    // A small grounded cross makes the attachment legible without bloom.
    ctx.beginPath()
    line(project(x - half * 2, z, direction), project(x + half * 2, z, direction))
    line(project(x, z - half * 2, direction), project(x, z + half * 2, direction))
    ctx.stroke()
  }

  function drawSignal(row: number, direction: number, intensity: number, horizontal: boolean, flow: number) {
    const rowZ = NEAR + row * GRID_SPACING
    const seed = row + (direction < 0 ? 2027 : 0) + (flow < 0 ? 4093 : 0)
    const phase = motionTime * 0.825 * flow + hash(seed + 20) * Math.PI * 2
    // Magenta traffic runs along a horizontal row; cyan runs down a fixed lane at its own speed.
    const x = horizontal ? Math.sin(phase) * LANE_SPACING * 7 : (Math.floor(hash(seed + 21) * 13) - 6) * LANE_SPACING
    const worldZ = horizontal ? rowZ : rowZ - motionTime * SIGNAL_SPEED * flow
    const z = worldZ - travel
    const alpha = depthFade(z) * intensity * 0.72
    if (alpha <= 0) return
    const length = 0.18
    const kind: Kind = horizontal ? 'magenta' : 'cyan'
    ctx.beginPath()
    line(
      project(x - (horizontal ? length : 0), z - (horizontal ? 0 : length), direction),
      project(x + (horizontal ? length : 0), z + (horizontal ? 0 : length), direction),
    )
    ctx.strokeStyle = colour(kind, alpha)
    ctx.lineWidth = Math.max(0.8, Math.min(2.2, (focal / z) * 0.035))
    ctx.stroke()
    const [dotX, dotY] = project(x, z, direction)
    ctx.beginPath()
    ctx.arc(dotX, dotY, Math.max(0.9, Math.min(2.6, (focal / z) * 0.0325)), 0, Math.PI * 2)
    ctx.fillStyle = colour(kind, alpha)
    ctx.fill()
  }

  function drawPlane(direction: number, intensity: number) {
    ctx.save()
    ctx.beginPath()
    if (direction > 0) ctx.rect(0, horizon, width, height - horizon)
    else ctx.rect(0, 0, width, horizon)
    ctx.clip()

    // Lines leading into the distance. They do not scroll, and fade towards the shared horizon.
    for (let i = -21; i <= 21; i++) {
      const x = i * LANE_SPACING
      const a = project(x, FAR, direction)
      const b = project(x, NEAR, direction)
      const gradient = ctx.createLinearGradient(a[0], a[1], b[0], b[1])
      const accent = i % 4 === 0
      const rgb = accent ? '51,190,237' : '43,140,193'
      for (let j = 0; j <= 24; j++) {
        const t = j / 24
        const z = 1 / (1 / FAR + t * (1 / NEAR - 1 / FAR))
        gradient.addColorStop(t, `rgba(${rgb},${(accent ? 0.28 : 0.19) * intensity * depthFade(z)})`)
      }
      ctx.beginPath()
      line(a, b)
      ctx.strokeStyle = gradient
      ctx.lineWidth = accent ? 1.1 : 0.8
      ctx.stroke()
    }

    // Cross rows, by absolute ID.
    for (let i = firstRow; i <= lastRow; i++) {
      const z = NEAR + i * GRID_SPACING - travel
      if (z <= NEAR || z >= FAR) continue
      const alpha = Math.min(0.5, 0.07 + 22 / (z + 40)) * depthFade(z) * intensity
      const highlight = i % HIGHLIGHT_INTERVAL === 0
      ctx.beginPath()
      line(project(-44, z, direction), project(44, z, direction))
      ctx.strokeStyle = highlight ? `rgba(102,223,247,${alpha})` : `rgba(70,138,198,${alpha * 0.62})`
      ctx.lineWidth = highlight ? 1.05 : 0.68
      ctx.stroke()
    }

    // Far to near, so nearer tower edges draw over farther ones.
    for (let row = lastRow; row >= firstRow; row--) {
      const tower = direction > 0 ? row % 8 === 0 || row % 16 === 4 : row % 8 === 2 || row % 16 === 6
      if (tower) drawTower(row, direction, intensity * 0.82)
      if (row % 8 === (direction > 0 ? 2 : 6)) drawSignal(row, direction, intensity * 0.78, true, 1)
      if (row % 8 === (direction > 0 ? 4 : 0)) drawSignal(row, direction, intensity * 0.78, true, -1)
    }

    // Cyan streams have their own velocity, so enumerate their IDs from their own travel rather than the grid's.
    for (const flow of [1, -1]) {
      const streamTravel = travel + motionTime * SIGNAL_SPEED * flow
      const streamFirst = Math.floor((streamTravel + NEAR) / GRID_SPACING) - 2
      const streamLast = Math.ceil((streamTravel + FAR) / GRID_SPACING) + 2
      for (let row = streamLast; row >= streamFirst; row--) {
        // Outbound streams can have negative IDs; a positive modulo keeps their spacing across the origin.
        if (((row % 8) + 8) % 8 === (direction > 0 ? 5 : 1)) {
          drawSignal(row, direction, intensity * 0.78, false, flow)
        }
      }
    }
    ctx.restore()
  }

  // The ceiling is dimmer, so the controls in front keep priority.
  drawPlane(-1, 0.72)
  drawPlane(1, 1)

  // A dark haze, not a sunset, binding the two planes together.
  const haze = ctx.createLinearGradient(0, horizon - 116, 0, horizon + 116)
  haze.addColorStop(0, 'rgba(8,23,46,0)')
  haze.addColorStop(0.34, 'rgba(10,36,63,0.08)')
  haze.addColorStop(0.46, 'rgba(11,48,76,0.14)')
  haze.addColorStop(0.5, 'rgba(8,24,42,0.26)')
  haze.addColorStop(0.54, 'rgba(11,48,76,0.14)')
  haze.addColorStop(0.66, 'rgba(10,36,63,0.08)')
  haze.addColorStop(1, 'rgba(8,23,46,0)')
  ctx.fillStyle = haze
  ctx.fillRect(0, horizon - 116, width, 232)
  ctx.beginPath()
  line([0, horizon], [width, horizon])
  ctx.strokeStyle = 'rgba(65,151,196,.08)'
  ctx.lineWidth = 1
  ctx.stroke()
}

/**
 * Animates the scene on `canvas` until the returned function is called. Paints one still frame, and no more, while
 * the tab is hidden or the visitor prefers reduced motion.
 */
export function runGrid(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return () => {}
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let width = 0
  let height = 0
  let raf = 0
  let previous = 0
  let travel = 0
  let motionTime = 0

  const draw = () => paint(ctx, width, height, travel, motionTime)

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  }

  function frame(timestamp: number) {
    if (timestamp - previous >= FRAME_INTERVAL_MS) {
      const elapsed = previous ? Math.min((timestamp - previous) / 1000, 0.08) : 0
      previous = timestamp
      travel += elapsed * SPEED
      motionTime += elapsed
      draw()
    }
    raf = requestAnimationFrame(frame)
  }

  function syncMotion() {
    cancelAnimationFrame(raf)
    previous = 0
    if (!document.hidden && !reduceMotion.matches) raf = requestAnimationFrame(frame)
    else draw()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  document.addEventListener('visibilitychange', syncMotion)
  reduceMotion.addEventListener('change', syncMotion)
  resize()
  syncMotion()

  return () => {
    cancelAnimationFrame(raf)
    observer.disconnect()
    document.removeEventListener('visibilitychange', syncMotion)
    reduceMotion.removeEventListener('change', syncMotion)
  }
}
