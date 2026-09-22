// Runs the game (movement, interactions, characters) and draws a world.json on a 2D canvas.
// An optional 3D view can take over the drawing; the game logic stays here either way.
import type { World, Building, District, Character, Bug, Gate } from '../lib/generate.ts'
import { hash } from '../lib/generate.ts'
import { findPath, gridOf, roadsOf, walkableAt, ROAD_W, type Grid } from './walk.ts'

type Palette = { fill: string; edge: string; roof: string; wall: string }
export const THEME: Record<string, Palette> = {
  village: { fill: '#2c4533', edge: '#3d5c45', roof: '#b7a37e', wall: '#7a6a4f' },
  village2: { fill: '#46392a', edge: '#5d4c37', roof: '#c9a36a', wall: '#806441' },
  castle: { fill: '#353c4a', edge: '#4a5364', roof: '#9aa3b5', wall: '#5d6679' },
  lab: { fill: '#21403c', edge: '#2f5a54', roof: '#8ed0c3', wall: '#4d8078' },
  depths: { fill: '#302846', edge: '#43395f', roof: '#9e8cd0', wall: '#5c4e85' },
  dungeon: { fill: '#45262a', edge: '#613539', roof: '#b56a5f', wall: '#6e3a36' },
  keep: { fill: '#273752', edge: '#36496b', roof: '#8fa9d6', wall: '#4f6591' },
  library: { fill: '#3b3326', edge: '#54482f', roof: '#d2b27a', wall: '#8a6f45' },
  forge: { fill: '#3a2d28', edge: '#55423a', roof: '#c58b5c', wall: '#6d4a33' },
  citadel: { fill: '#2b3440', edge: '#3f4b5c', roof: '#b8c4d6', wall: '#667790' },
}
export const CLS_COLOR: Record<string, string> = {
  NPC: '#c9c2ae', Enemy: '#8a93a6', 'Mini boss': '#f0b429', Boss: '#e5533d', 'Final boss': '#e5533d', cleared: '#5fc48a',
}

// Anything the player can walk up to and press E on.
export type Target =
  | { kind: 'building'; b: Building }
  | { kind: 'char'; c: Character }
  | { kind: 'bug'; bug: Bug }
  | { kind: 'gate'; gate: Gate }
export const targetKey = (t: Target | null) => !t ? '' : t.kind === 'building' ? t.b.path : t.kind === 'char' ? '@' + t.c.login : t.kind === 'bug' ? 'bug#' + t.bug.number : 'pr#' + t.gate.number
export const bugKey = (b: Bug) => 'bug#' + b.number

export type Hooks = {
  near: (t: Target | null) => void
  open: (t: Target | null) => void
  zone: (d: District | null) => void
  fullscreen: () => void
}
// The 3D view implements this; loaded on demand so 2D players never download three.js.
export type View3D = {
  render: (g: Game, t: number) => void
  pick: (sx: number, sy: number) => { x: number; y: number; t: Target | null } | null
  resize: (w: number, h: number) => void
  dispose: () => void
}
export type Npc = { char: Character; login: string; role: string; commits: number; homes: District[]; color: string; x: number; y: number; tx: number; ty: number }

const SPEED = 240
const MAP_MAX = 170
const REACH = 46 // how close you need to be to press E

export class Game {
  cv: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  hooks: Hooks
  world!: World
  districtOf = new Map<Building, District>()
  buildings: Building[] = []
  cleared = new Set<string>()
  player = { x: 0, y: 0, dir: 1, step: 0 }
  cam = { x: 0, y: 0 }
  target: { x: number; y: number } | null = null
  route: { x: number; y: number }[] = []
  roads: number[][][] = []
  grid: Grid = { cells: new Uint8Array(0), w: 0, h: 0 }
  pending: Target | null = null // open this when the walk ends
  near: Target | null = null
  talking: string | null = null // login of the character you're talking to; they stand still
  quest: Building | null = null
  zoneD: District | null | undefined = undefined
  active = false
  keys: Record<string, boolean> = {}
  particles: { x: number; y: number; life: number }[] = []
  npcs: Npc[] = []
  view3d: View3D | null = null
  W = 0
  H = 0
  map = { x: 0, y: 0, w: 0, h: 0, s: 1 }
  raf = 0
  last = 0
  reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  cleanup: (() => void)[] = []

  constructor(cv: HTMLCanvasElement, hooks: Hooks) {
    this.cv = cv
    this.ctx = cv.getContext('2d')!
    this.hooks = hooks
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void) => {
      addEventListener(t, f); this.cleanup.push(() => removeEventListener(t, f))
    }
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(cv)
    this.cleanup.push(() => ro.disconnect())
    on('keydown', e => {
      const el = e.target as HTMLElement
      if (!this.active || el.tagName === 'INPUT' || el.tagName === 'BUTTON' || el.closest?.('[data-nokeys]')) return
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
      this.keys[k] = true
      if (k === 'e' && this.near) this.hooks.open(this.near)
      if (k === 'escape') this.hooks.open(null)
      if (k === 'f' && !e.metaKey && !e.ctrlKey) this.hooks.fullscreen()
    })
    on('keyup', e => { this.keys[e.key.toLowerCase()] = false })
    on('blur', () => { this.keys = {} })
    on('pointerdown', e => { this.active = cv.parentElement!.contains(e.target as Node) })
    cv.addEventListener('pointerdown', e => this.click(e))
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.cleanup.forEach(f => f())
    this.view3d?.dispose()
  }

  focus() { this.active = true; this.cv.focus({ preventScroll: true }) }

  setView3D(v: View3D | null) {
    this.view3d?.dispose()
    this.view3d = v
    v?.resize(this.W, this.H)
  }

  respawn() {
    this.player.x = this.world.spawn.x
    this.player.y = this.world.spawn.y
    this.target = this.pending = null
    this.route = []
    this.keys = {}
  }

  setWorld(w: World) {
    this.world = w
    this.districtOf.clear()
    for (const d of w.districts) for (const b of d.buildings) this.districtOf.set(b, d)
    this.buildings = [...this.districtOf.keys()]
    this.roads = roadsOf(w)
    this.grid = gridOf(w, this.roads)
    this.player = { x: w.spawn.x, y: w.spawn.y, dir: 1, step: 0 }
    this.target = this.pending = this.near = null
    this.route = []
    this.particles = []
    this.zoneD = undefined
    const byId = new Map(w.districts.map(d => [d.id, d]))
    this.npcs = w.characters.map(c => {
      const homes = c.homes.map(id => byId.get(id)!).filter(Boolean)
      const d = homes[0] ?? w.districts[0]
      const h = hash(c.login)
      return { ...c, char: c, homes: homes.length ? homes : [d], color: `hsl(${h % 360} 70% 72%)`,
        x: d.x - d.w / 2 + 30 + (h % Math.max(1, d.w - 60)), y: d.y + d.h / 2 - 16, tx: d.x, ty: d.y + d.h / 2 - 16 }
    })
    this.resize()
    this.cam.x = this.clampX(this.player.x)
    this.cam.y = this.clampY(this.player.y)
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), r = this.cv.getBoundingClientRect()
    this.W = r.width; this.H = r.height
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.view3d?.resize(this.W, this.H)
    if (!this.world) return
    const s = Math.min(MAP_MAX / this.world.width, MAP_MAX / this.world.height, (this.W * 0.3) / this.world.width)
    this.map = { s, w: this.world.width * s, h: this.world.height * s, x: this.W - this.world.width * s - 12, y: this.H - this.world.height * s - 12 }
  }

  clampX(x: number) { return this.world.width < this.W ? this.world.width / 2 : Math.max(this.W / 2, Math.min(this.world.width - this.W / 2, x)) }
  clampY(y: number) { return this.world.height < this.H ? this.world.height / 2 : Math.max(this.H / 2, Math.min(this.world.height - this.H / 2, y)) }

  // Where to stand to interact with a target.
  spotFor(t: Target) {
    if (t.kind === 'building') return { x: t.b.x + t.b.size / 2, y: t.b.y + t.b.size + 18 }
    if (t.kind === 'char') { const n = this.npcs.find(n => n.char === t.c)!; return { x: n.x, y: n.y + 14 } }
    const p = t.kind === 'bug' ? t.bug : t.gate
    return { x: p.x, y: p.y + 10 }
  }

  // 2D hit test: what's under this world point?
  hit(wx: number, wy: number): Target | null {
    const n = this.npcs.find(n => Math.abs(wx - n.x) < 12 && wy > n.y - 24 && wy < n.y + 6)
    if (n) return { kind: 'char', c: n.char }
    const bug = this.world.bugs.find(b => Math.abs(wx - b.x) < 13 && Math.abs(wy - b.y) < 11)
    if (bug) return { kind: 'bug', bug }
    const gate = this.world.gates.find(g => Math.abs(wx - g.x) < 15 && wy > g.y - 26 && wy < g.y + 4)
    if (gate) return { kind: 'gate', gate }
    const b = this.buildings.find(b => wx >= b.x && wx <= b.x + b.size && wy >= b.y - b.size * 0.5 && wy <= b.y + b.size)
    return b ? { kind: 'building', b } : null
  }

  click(e: PointerEvent) {
    if (!this.world) return
    this.focus()
    const r = this.cv.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    const m = this.map
    if (this.mapShown() && sx >= m.x && sx <= m.x + m.w && sy >= m.y && sy <= m.y + m.h) {
      // fast travel: the district nearest the point you clicked on the map
      const wx = (sx - m.x) / m.s, wy = (sy - m.y) / m.s
      const d = this.world.districts.reduce((a, b) => Math.hypot(b.x - wx, b.y - wy) < Math.hypot(a.x - wx, a.y - wy) ? b : a)
      this.travelTo(d.id)
      return
    }
    let wx: number, wy: number, t: Target | null
    if (this.view3d) {
      const p = this.view3d.pick(sx, sy)
      if (!p) return
      ;({ x: wx, y: wy, t } = p)
    } else {
      wx = sx - this.W / 2 + this.cam.x; wy = sy - this.H / 2 + this.cam.y
      t = this.hit(wx, wy)
    }
    this.pending = t
    const spot = t ? this.spotFor(t) : { x: wx, y: wy }
    this.walkTo(spot.x, spot.y)
  }

  travelTo(id: string) {
    const d = this.world.districts.find(x => x.id === id)
    if (!d) return
    this.player.x = d.x; this.player.y = d.y + d.h / 2 - 14
    this.target = this.pending = null
    this.route = []
  }

  walkTo(x: number, y: number) {
    const route = findPath(this.grid, this.player, { x, y })
    if (!route) return
    this.route = route
    this.target = route[route.length - 1]
  }

  blocked(x: number, y: number) { return !walkableAt(this.grid, x, y) }

  arrive() {
    this.target = null
    this.route = []
    if (this.pending) { this.hooks.open(this.pending); this.pending = null }
  }

  update(dt: number) {
    const k = this.keys, p = this.player
    let dx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0)
    let dy = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0)
    if (dx || dy) { this.target = this.pending = null; this.route = [] }
    else if (this.route.length) {
      const w = this.route[0], tx = w.x - p.x, ty = w.y - p.y, dist = Math.hypot(tx, ty)
      if (dist < 6) { this.route.shift(); if (!this.route.length) this.arrive() }
      else { dx = tx / dist; dy = ty / dist }
    }
    const len = Math.hypot(dx, dy)
    if (len) {
      const sp = SPEED * dt / len, nx = p.x + dx * sp, ny = p.y + dy * sp
      const bx = this.blocked(nx, p.y), by = this.blocked(p.x, ny)
      if (!bx) p.x = nx
      if (!by) p.y = ny
      if (bx && by && this.route.length) { this.route.shift(); if (!this.route.length) this.arrive() }
      if (dx) p.dir = Math.sign(dx)
      p.step += dt * 10
    }
    const ease = this.reduce ? 1 : Math.min(1, dt * 6)
    this.cam.x += (this.clampX(p.x) - this.cam.x) * ease
    this.cam.y += (this.clampY(p.y) - this.cam.y) * ease

    // whatever is closest within reach gets the E prompt
    let near: Target | null = null, best = REACH
    const consider = (t: Target, d: number) => { if (d < best) { best = d; near = t } }
    for (const b of this.buildings) {
      const cx = Math.max(b.x, Math.min(p.x, b.x + b.size)), cy = Math.max(b.y, Math.min(p.y, b.y + b.size))
      consider({ kind: 'building', b }, Math.hypot(p.x - cx, p.y - cy))
    }
    for (const n of this.npcs) consider({ kind: 'char', c: n.char }, Math.hypot(p.x - n.x, p.y - n.y) - 2)
    for (const bug of this.world.bugs) consider({ kind: 'bug', bug }, Math.hypot(p.x - bug.x, p.y - bug.y) - 4)
    for (const gate of this.world.gates) consider({ kind: 'gate', gate }, Math.hypot(p.x - gate.x, p.y - gate.y) - 4)
    if (targetKey(near) !== targetKey(this.near)) { this.near = near; this.hooks.near(near) }

    const zone = this.world.districts.find(d => Math.abs(p.x - d.x) < d.w / 2 && Math.abs(p.y - d.y) < d.h / 2) ?? null
    if (zone !== this.zoneD) { this.zoneD = zone; this.hooks.zone(zone) }

    for (const n of this.npcs) {
      if (n.login === this.talking) continue
      const d = Math.hypot(n.tx - n.x, n.ty - n.y)
      if (d < 4) {
        const home = n.homes[Math.floor(Math.random() * n.homes.length)]
        n.tx = home.x + (Math.random() - 0.5) * (home.w - 60)
        n.ty = home.y + home.h / 2 - 12 - Math.random() * 10
      } else { n.x += (n.tx - n.x) / d * 45 * dt; n.y += (n.ty - n.y) / d * 45 * dt }
    }
    if (!this.reduce && !this.view3d) {
      for (const b of this.buildings) if (b.hot && Math.random() < dt * 14)
        this.particles.push({ x: b.x + Math.random() * b.size, y: b.y - b.size * 0.5 + Math.random() * b.size * 0.5, life: 1 })
      for (const q of this.particles) { q.y -= 30 * dt; q.x += Math.sin(q.y / 8) * 0.3; q.life -= dt * 1.1 }
      this.particles = this.particles.filter(q => q.life > 0)
    }
  }

  loop(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000)
    this.last = now
    if (this.world && this.W) {
      this.update(dt)
      if (this.view3d) {
        // 3D draws the world; this canvas stays on top as a transparent layer for the minimap and clicks
        this.ctx.clearRect(0, 0, this.W, this.H)
        this.view3d.render(this, now / 1000)
        this.drawMap()
      } else this.draw(now / 1000)
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  isNear(t: Target) { return targetKey(this.near) === targetKey(t) }

  // ---------- 2D drawing ----------
  draw(t: number) {
    const { ctx, W, H, world } = this
    ctx.fillStyle = '#18202b'
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    const ox = Math.round(W / 2 - this.cam.x), oy = Math.round(H / 2 - this.cam.y)
    ctx.translate(ox, oy)

    // ground speckle, only what's on screen
    ctx.fillStyle = '#1d2632'
    for (let gx = Math.max(0, Math.floor(-ox / 40) * 40); gx < Math.min(world.width, -ox + W); gx += 40)
      for (let gy = Math.max(0, Math.floor(-oy / 40) * 40); gy < Math.min(world.height, -oy + H); gy += 40)
        if ((gx * 7 + gy * 13) % 9 === 0) ctx.fillRect(gx, gy, 3, 3)

    this.drawRoads()
    for (const d of world.districts) this.drawDistrict(d)

    const ents: { y: number; f: () => void }[] = [
      ...this.buildings.map(b => ({ y: b.y + b.size, f: () => this.drawBuilding(b, t) })),
      ...this.npcs.map(n => ({ y: n.y, f: () => this.drawNpc(n) })),
      ...world.bugs.map(b => ({ y: b.y, f: () => this.drawBug(b, t) })),
      ...world.gates.map(g => ({ y: g.y, f: () => this.drawGate(g) })),
      { y: this.player.y, f: () => this.drawPlayer() },
    ]
    ents.sort((a, b) => a.y - b.y).forEach(e => e.f())

    for (const q of this.particles) {
      ctx.fillStyle = `rgba(255,${(120 + q.life * 80) | 0},61,${q.life})`
      ctx.fillRect(q.x, q.y, 3, 3)
    }
    if (this.target) {
      ctx.strokeStyle = 'rgba(240,180,41,.7)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(this.target.x, this.target.y, 6 + Math.sin(t * 6) * 2, 0, 7); ctx.stroke()
    }
    ctx.restore()
    this.drawQuestArrow(t)
    this.drawMap()
  }

  // A pointer orbiting the player toward the quest target, hidden once it's on screen.
  drawQuestArrow(t: number) {
    const q = this.quest
    if (!q) return
    const { ctx, W, H } = this
    const qx = q.x + q.size / 2, qy = q.y
    const sx = qx - this.cam.x + W / 2, sy = qy - this.cam.y + H / 2
    if (sx > 0 && sx < W && sy > 0 && sy < H) return
    const px = this.player.x - this.cam.x + W / 2, py = this.player.y - 12 - this.cam.y + H / 2
    const a = Math.atan2(qy - this.player.y, qx - this.player.x)
    const r = 46 + (this.reduce ? 0 : Math.sin(t * 5) * 3)
    ctx.save()
    ctx.translate(px + Math.cos(a) * r, py + Math.sin(a) * r); ctx.rotate(a)
    ctx.fillStyle = '#e5533d'
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.fill()
    ctx.restore()
    const dist = Math.round(Math.hypot(qx - this.player.x, qy - this.player.y) / 10)
    ctx.font = '700 12px "Pixelify Sans", monospace'; ctx.fillStyle = '#e5533d'; ctx.textAlign = 'center'
    ctx.fillText(`FINAL BOSS ${dist}m`, px + Math.cos(a) * (r + 30), py + Math.sin(a) * (r + 24) + 4)
  }

  drawRoads() {
    const { ctx } = this
    const path = (pts: number[][]) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]) }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const r of this.roads) { ctx.strokeStyle = '#2b3443'; ctx.lineWidth = ROAD_W; path(r); ctx.stroke() }
    ctx.strokeStyle = '#3a4455'; ctx.lineWidth = 2; ctx.setLineDash([10, 12])
    for (const r of this.roads) { path(r); ctx.stroke() }
    ctx.setLineDash([])
  }

  drawDistrict(d: District) {
    const { ctx } = this
    const th = THEME[d.theme] ?? THEME.village2
    ctx.beginPath(); ctx.roundRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h, 10)
    ctx.fillStyle = th.fill; ctx.fill()
    ctx.strokeStyle = d.hot ? '#ff8a3d' : th.edge; ctx.lineWidth = 3; ctx.stroke()
    const left = d.x - d.w / 2 + 14, top = d.y - d.h / 2
    ctx.textAlign = 'left'
    ctx.font = '700 17px "Pixelify Sans", monospace'; ctx.fillStyle = d.ghost ? '#9aa1ad' : '#ebe6d8'
    ctx.fillText(d.label + (d.hot ? '  ▲ hot' : d.ghost ? '  · abandoned' : ''), left, top + 24)
    ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(235,230,216,.55)'
    const meta = [d.path, `${d.fileCount} files`]
    if (d.commits != null) meta.push(`${d.commits >= 100 ? '~' : ''}${d.commits} commits`)
    ctx.fillText(meta.join(' · '), left, top + 40)
  }

  drawBuilding(b: Building, t: number) {
    const { ctx } = this
    const th = THEME[this.districtOf.get(b)!.theme] ?? THEME.village2
    const s = b.size, H2 = Math.round(s * 0.5), x = b.x, y = b.y
    const done = this.cleared.has(b.path)
    ctx.save()
    if (b.ghost) ctx.globalAlpha = 0.55
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 4, y + s - 4, s, 8)
    ctx.fillStyle = b.ghost ? '#4b5160' : th.wall; ctx.fillRect(x, y + s - H2, s, H2)
    ctx.fillStyle = b.ghost ? '#8a909c' : th.roof; ctx.fillRect(x, y - H2, s, s)
    ctx.fillStyle = b.cls === 'NPC' || b.ghost ? 'rgba(255,255,255,.12)' : done ? CLS_COLOR.cleared : CLS_COLOR[b.cls]
    ctx.fillRect(x, y - H2, s, b.cls === 'NPC' ? 3 : 5)
    if (b.more) { // hamlet: a cluster of small roofs
      ctx.fillStyle = 'rgba(0,0,0,.18)'
      ctx.fillRect(x + s / 2 - 1, y - H2, 2, s); ctx.fillRect(x, y - H2 + s / 2 - 1, s, 2)
    }
    ctx.fillStyle = '#1a1f29'; ctx.fillRect(x + s / 2 - 5, y + s - 13, 10, 13)
    if (b.cls !== 'NPC') {
      ctx.fillStyle = b.ghost ? '#2a2e37' : '#ffd88a'
      ctx.fillRect(x + 6, y + s - H2 + 6, 5, 5); ctx.fillRect(x + s - 11, y + s - H2 + 6, 5, 5)
    }
    if (b.ghost) {
      ctx.strokeStyle = 'rgba(220,225,235,.6)'; ctx.lineWidth = 1; ctx.beginPath()
      ctx.moveTo(x, y - H2 + 14); ctx.lineTo(x + 14, y - H2); ctx.moveTo(x, y - H2); ctx.lineTo(x + 9, y - H2 + 9); ctx.stroke()
    }
    if (b.cls === 'Boss' || b.cls === 'Mini boss' || b.cls === 'Final boss') {
      const px = x + s / 2, py = y - H2 + s / 2
      ctx.strokeStyle = '#1a1f29'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 26); ctx.stroke()
      ctx.fillStyle = done ? CLS_COLOR.cleared : CLS_COLOR[b.cls]
      ctx.beginPath(); ctx.moveTo(px + 1, py - 26); ctx.lineTo(px + 16, py - 21); ctx.lineTo(px + 1, py - 16); ctx.fill()
      if (b.cls === 'Final boss' && !done) {
        ctx.strokeStyle = `rgba(229,83,61,${0.45 + 0.35 * Math.sin(t * 3)})`; ctx.lineWidth = 3
        ctx.strokeRect(x - 5, y - H2 - 5, s + 10, s + 10)
      }
    } else if (done) {
      ctx.fillStyle = CLS_COLOR.cleared; ctx.beginPath(); ctx.arc(x + s - 6, y - H2 + 6, 5, 0, 7); ctx.fill()
    }
    if (this.isNear({ kind: 'building', b })) { ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 2; ctx.strokeRect(x - 3, y - H2 - 3, s + 6, s + 6) }
    ctx.restore()
    ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'
    ctx.fillStyle = b.ghost ? '#7c8494' : '#d8d2c2'
    const fit = Math.floor((s + 34) / 6.6) // chars that fit in the building's slot (11px mono)
    const label = b.label.length <= fit ? b.label : b.label.includes('/') ? '…' + b.label.slice(-(fit - 1)) : b.label.slice(0, fit - 1) + '…'
    ctx.fillText(label, x + s / 2, y + s + 16)
  }

  drawBug(b: Bug, t: number) {
    const { ctx } = this
    const squashed = this.cleared.has(bugKey(b))
    ctx.save()
    ctx.translate(b.x, b.y)
    if (squashed) {
      ctx.fillStyle = 'rgba(95,196,138,.55)'
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 5, 0, 0, 7); ctx.fill()
      ctx.restore()
      return
    }
    const wig = this.reduce ? 0 : Math.sin(t * 9 + b.number) * 1.5
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, 3, 10, 4, 0, 0, 7); ctx.fill()
    ctx.strokeStyle = '#2a0f0c'; ctx.lineWidth = 1.5
    for (const side of [-1, 1]) for (const k of [-4, 0, 4]) {
      ctx.beginPath(); ctx.moveTo(side * 5, k - 2); ctx.lineTo(side * 11, k - 4 + (side * k > 0 ? wig : -wig)); ctx.stroke()
    }
    ctx.fillStyle = '#e5533d'; ctx.beginPath(); ctx.ellipse(0, -2, 7, 9, 0, 0, 7); ctx.fill()
    ctx.fillStyle = '#2a0f0c'; ctx.fillRect(-0.75, -10, 1.5, 17)
    ctx.beginPath(); ctx.arc(0, -11, 3.5, 0, 7); ctx.fill()
    if (this.isNear({ kind: 'bug', bug: b })) {
      ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 3, 14, 6, 0, 0, 7); ctx.stroke()
    }
    ctx.restore()
    ctx.font = '700 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff9c8f'
    ctx.fillText(`#${b.number}`, b.x, b.y - 16)
  }

  drawGate(g: Gate) {
    const { ctx } = this
    const open = g.state === 'merged'
    const col = open ? '#5fc48a' : '#e5533d'
    ctx.save()
    ctx.translate(g.x, g.y)
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-13, 1, 28, 4)
    ctx.fillStyle = '#6b5a45'; ctx.fillRect(-13, -22, 4, 23); ctx.fillRect(9, -22, 4, 23)
    ctx.fillStyle = col
    if (open) { ctx.fillRect(-12, -30, 3, 10) } // bar raised
    else {
      ctx.fillRect(-11, -15, 22, 4)
      ctx.fillStyle = '#f0b429'; ctx.fillRect(-3, -12, 6, 5); ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(0, -12, 2.5, Math.PI, 0); ctx.stroke()
    }
    if (this.isNear({ kind: 'gate', gate: g })) { ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 2; ctx.strokeRect(-17, -27, 34, 32) }
    ctx.restore()
    ctx.font = '700 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = col
    ctx.fillText(`#${g.number}`, g.x, g.y - 32)
  }

  drawPlayer() {
    const { ctx } = this, { x, y } = this.player, bob = Math.sin(this.player.step) * 1.5
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 9, 4, 0, 0, 7); ctx.fill()
    ctx.fillStyle = '#f0b429'; ctx.fillRect(x - 7, y - 16 + bob, 14, 14)
    ctx.fillStyle = '#ebe6d8'; ctx.fillRect(x - 6, y - 27 + bob, 12, 11)
    ctx.fillStyle = '#141a24'; ctx.fillRect(x + (this.player.dir > 0 ? 1 : -4), y - 24 + bob, 3, 3)
  }

  closestNpc() {
    let best: Npc | null = null, bd = Infinity
    for (const n of this.npcs) { const d = Math.hypot(n.x - this.player.x, n.y - this.player.y); if (d < bd) { bd = d; best = n } }
    return best
  }

  drawNpc(n: Npc) {
    const { ctx } = this
    const d = Math.hypot(n.x - this.player.x, n.y - this.player.y)
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(n.x, n.y + 2, 7, 3, 0, 0, 7); ctx.fill()
    ctx.fillStyle = n.color; ctx.fillRect(n.x - 5, n.y - 12, 10, 11); ctx.fillRect(n.x - 4, n.y - 20, 8, 7)
    ctx.textAlign = 'center'
    if (this.isNear({ kind: 'char', c: n.char })) {
      ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.ellipse(n.x, n.y + 2, 11, 5, 0, 0, 7); ctx.stroke()
    }
    if (d > 110 || n !== this.closestNpc()) return
    ctx.font = '700 12px "Pixelify Sans", monospace'; ctx.fillStyle = n.color; ctx.fillText(n.login, n.x, n.y - 26)
    if (d < 70) {
      ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = '#ebe6d8'
      ctx.fillText(`${n.role} · ${n.commits} commits`, n.x, n.y - 40)
    }
  }

  mapShown() { return this.world.width > this.W || this.world.height > this.H || !!this.view3d }

  drawMap() {
    const { ctx, map: m, world } = this
    if (!this.mapShown()) return
    ctx.fillStyle = '#0f141c'; ctx.fillRect(m.x - 4, m.y - 4, m.w + 8, m.h + 8)
    ctx.strokeStyle = '#2b3443'; ctx.lineWidth = Math.max(1.5, ROAD_W * m.s)
    for (const r of this.roads) { ctx.beginPath(); r.forEach(([x, y], i) => i ? ctx.lineTo(m.x + x * m.s, m.y + y * m.s) : ctx.moveTo(m.x + x * m.s, m.y + y * m.s)); ctx.stroke() }
    ctx.strokeStyle = '#2e394c'; ctx.lineWidth = 1; ctx.strokeRect(m.x - 4.5, m.y - 4.5, m.w + 9, m.h + 9)
    for (const d of world.districts) {
      ctx.fillStyle = (THEME[d.theme] ?? THEME.village2).edge
      ctx.fillRect(m.x + (d.x - d.w / 2) * m.s, m.y + (d.y - d.h / 2) * m.s, d.w * m.s, d.h * m.s)
    }
    for (const b of this.buildings) if (b.cls === 'Final boss' || b.cls === 'Boss') {
      ctx.fillStyle = this.cleared.has(b.path) ? CLS_COLOR.cleared : CLS_COLOR.Boss
      ctx.fillRect(m.x + b.x * m.s - 1, m.y + b.y * m.s - 1, 3, 3)
    }
    if (!this.view3d) {
      ctx.strokeStyle = 'rgba(235,230,216,.5)'
      ctx.strokeRect(m.x + (this.cam.x - this.W / 2) * m.s, m.y + (this.cam.y - this.H / 2) * m.s, this.W * m.s, this.H * m.s)
    }
    ctx.fillStyle = '#f0b429'; ctx.fillRect(m.x + this.player.x * m.s - 2, m.y + this.player.y * m.s - 2, 5, 5)
  }
}
