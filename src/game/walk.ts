// Where the player can walk: district plots and roads, minus buildings. Pure, no DOM.
import type { World } from '../lib/generate.ts'

export const CELL = 16 // grid resolution in world px
export const ROAD_W = 34
type Pt = { x: number; y: number }
export type Grid = { cells: Uint8Array; w: number; h: number }

// Parent-to-child roads as L-shaped polylines, plus the road down to the spawn point.
export function roadsOf(world: World): number[][][] {
  const byId = new Map(world.districts.map(d => [d.id, d]))
  const routes = world.roads.map(([a, b]) => {
    const A = byId.get(a)!, B = byId.get(b)!
    const mid = (A.y - A.h / 2 + B.y + B.h / 2) / 2
    return A.y > B.y ? [[A.x, A.y], [A.x, mid], [B.x, mid], [B.x, B.y]] : [[A.x, A.y], [B.x, A.y], [B.x, B.y]]
  })
  const root = world.districts[0]
  routes.push([[root.x, root.y], [root.x, world.height]])
  return routes
}

export function gridOf(world: World, roads: number[][][]): Grid {
  const w = Math.ceil(world.width / CELL), h = Math.ceil(world.height / CELL)
  const cells = new Uint8Array(w * h)
  const segs = roads.flatMap(r => r.slice(1).map((q, i) => [r[i], q]))
  const buildings = world.districts.flatMap(d => d.buildings)
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2
    const open = world.districts.some(d => Math.abs(x - d.x) < d.w / 2 - 6 && Math.abs(y - d.y) < d.h / 2 - 6)
      || segs.some(([a, b]) => Math.hypot(x - clamp(x, a[0], b[0]), y - clamp(y, a[1], b[1])) <= ROAD_W / 2)
    const building = buildings.some(b => x > b.x - 8 && x < b.x + b.size + 8 && y > b.y - 4 && y < b.y + b.size + 6)
    cells[cy * w + cx] = open && !building ? 1 : 0
  }
  return { cells, w, h }
}
const clamp = (v: number, a: number, b: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v))

export const walkableCell = (g: Grid, cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < g.w && cy < g.h && g.cells[cy * g.w + cx] === 1
export const walkableAt = (g: Grid, x: number, y: number) => walkableCell(g, Math.floor(x / CELL), Math.floor(y / CELL))

function nearestCell(g: Grid, cx: number, cy: number) {
  for (let r = 0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if ((Math.abs(dx) === r || Math.abs(dy) === r) && walkableCell(g, cx + dx, cy + dy)) return [cx + dx, cy + dy]
  return null
}

function lineClear(g: Grid, a: Pt, b: Pt) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6)
  for (let k = 1; k <= n; k++) if (!walkableAt(g, a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n)) return false
  return true
}

// Breadth-first search over the grid, then drop waypoints you can see past.
// Returns waypoints ending at the target (or the nearest walkable spot to it), or null if unreachable.
export function findPath(g: Grid, from: Pt, to: Pt): Pt[] | null {
  const cell = (v: number) => Math.floor(v / CELL)
  const start = nearestCell(g, cell(from.x), cell(from.y))
  const goal = nearestCell(g, cell(to.x), cell(to.y))
  if (!start || !goal) return null
  const si = start[1] * g.w + start[0], gi = goal[1] * g.w + goal[0]
  const prev = new Int32Array(g.w * g.h).fill(-1)
  prev[si] = si
  const queue = [si]
  for (let qi = 0; qi < queue.length && prev[gi] < 0; qi++) {
    const i = queue[qi], cx = i % g.w, cy = (i / g.w) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy, ni = ny * g.w + nx
      if (!walkableCell(g, nx, ny) || prev[ni] >= 0) continue
      if (dx && dy && (!walkableCell(g, cx + dx, cy) || !walkableCell(g, cx, cy + dy))) continue // no corner cutting
      prev[ni] = i
      queue.push(ni)
    }
  }
  if (prev[gi] < 0) return null
  const pts: Pt[] = []
  for (let i = gi; i !== si; i = prev[i]) pts.push({ x: (i % g.w) * CELL + CELL / 2, y: ((i / g.w) | 0) * CELL + CELL / 2 })
  pts.reverse()
  if (walkableAt(g, to.x, to.y)) pts.push({ x: to.x, y: to.y })
  if (!pts.length) return [{ x: from.x, y: from.y }]
  const route: Pt[] = []
  let at = from
  for (let i = 0; i < pts.length;) {
    let j = pts.length - 1
    while (j > i && !lineClear(g, at, pts[j])) j--
    route.push(pts[j]); at = pts[j]; i = j + 1
  }
  return route
}
