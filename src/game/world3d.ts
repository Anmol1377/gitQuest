// 3D view of the same world.json. Game logic (movement, fights, characters) stays in world2d.ts;
// this only draws it and turns clicks into world positions. Loaded on demand.
import * as THREE from 'three'
import type { Building, World } from '../lib/generate.ts'
import { THEME, CLS_COLOR, bugKey, targetKey, type Game, type Target, type View3D } from './world2d.ts'
import { ROAD_W } from './walk.ts'

const PLOT_Y = 4          // top of the district plots
const TALL = 1.3          // building height per unit of footprint
const GROUND = '#18202b'
const color = (c: string) => new THREE.Color(c)

type BuildingParts = { roof: THREE.MeshLambertMaterial; cap?: THREE.MeshLambertMaterial; flag?: THREE.MeshLambertMaterial }
type BugParts = { live: THREE.Object3D; splat: THREE.Object3D }

export class World3D implements View3D {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, 1, 10, 7000)
  content = new THREE.Group() // everything built from the current world
  world: World | null = null
  parts = new Map<Building, BuildingParts>()
  npcs = new Map<string, THREE.Group>()
  bugs = new Map<number, BugParts>()
  pickables: THREE.Object3D[] = []
  ground!: THREE.Mesh
  player = new THREE.Group()
  arrow: THREE.Mesh
  marker: THREE.Mesh
  sun: THREE.DirectionalLight
  ray = new THREE.Raycaster()
  first = true
  W = 1
  H = 1

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }) // throws without WebGL; the caller falls back to 2D
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene.background = color('#141a24')
    this.scene.fog = new THREE.Fog('#141a24', 1200, 2800)
    this.scene.add(new THREE.HemisphereLight('#dfe6f5', '#1b2230', 1.6))
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    Object.assign(this.sun.shadow.camera, { left: -750, right: 750, top: 750, bottom: -750, near: 10, far: 2600 })
    this.sun.shadow.bias = -0.0004
    this.scene.add(this.sun, this.sun.target, this.content)

    // the player: same amber body and bone head as in 2D
    const body = box(14, 14, 12, '#f0b429'); body.position.y = 7
    const head = box(12, 11, 11, '#ebe6d8'); head.position.y = 19.5
    const eye = box(3, 3, 1, '#141a24'); eye.position.set(2, 21, 5.6)
    this.player.add(body, head, eye)
    this.player.traverse(o => { o.castShadow = true })
    this.scene.add(this.player)

    const cone = new THREE.ConeGeometry(7, 20, 4)
    cone.rotateX(Math.PI / 2) // tip along +z so lookAt() aims it
    this.arrow = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: '#e5533d' }))
    this.marker = new THREE.Mesh(new THREE.TorusGeometry(8, 1.5, 6, 24), new THREE.MeshBasicMaterial({ color: '#f0b429' }))
    this.marker.rotation.x = -Math.PI / 2
    this.scene.add(this.arrow, this.marker)
  }

  resize(w: number, h: number) {
    this.W = Math.max(1, w); this.H = Math.max(1, h)
    this.renderer.setSize(this.W, this.H, false)
    this.camera.aspect = this.W / this.H
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    this.clear()
    this.renderer.dispose()
  }

  clear() {
    this.content.traverse(o => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) { (x as THREE.MeshBasicMaterial).map?.dispose(); x.dispose() }
    })
    this.content.clear()
    this.parts.clear(); this.npcs.clear(); this.bugs.clear()
    this.pickables = []
  }

  build(world: World, game: Game) {
    this.clear()
    this.world = world
    this.first = true
    const add = (o: THREE.Object3D) => { this.content.add(o); return o }

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(world.width + 4000, world.height + 4000), new THREE.MeshLambertMaterial({ color: GROUND }))
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.set(world.width / 2, 0, world.height / 2)
    this.ground.receiveShadow = true
    add(this.ground)

    for (const route of game.roads) for (let i = 1; i < route.length; i++) {
      const [ax, ay] = route[i - 1], [bx, by] = route[i]
      const len = Math.hypot(bx - ax, by - ay) + ROAD_W
      const road = box(ax === bx ? ROAD_W : len, 1, ax === bx ? len : ROAD_W, '#2b3443')
      road.position.set((ax + bx) / 2, 0.5, (ay + by) / 2)
      road.receiveShadow = true
      add(road)
    }

    for (const d of world.districts) {
      const th = THEME[d.theme] ?? THEME.village2
      const edge = box(d.w + 6, PLOT_Y - 1, d.h + 6, d.hot ? '#ff8a3d' : th.edge); edge.position.set(d.x, (PLOT_Y - 1) / 2, d.y)
      const plot = box(d.w, PLOT_Y, d.h, th.fill); plot.position.set(d.x, PLOT_Y / 2, d.y)
      edge.receiveShadow = plot.receiveShadow = true
      add(edge); add(plot)
      const label = textPlane(d.label + (d.hot ? '  ▲ hot' : d.ghost ? '  · abandoned' : ''), `${d.path} · ${d.fileCount} files`, d.ghost ? '#9aa1ad' : '#ebe6d8')
      label.position.set(d.x, PLOT_Y + 90, d.y - d.h / 2) // floats above the back edge, always facing the camera
      add(label)

      for (const b of d.buildings) {
        const g = this.building(b, th, game.cleared.has(b.path))
        add(g)
      }
    }

    for (const n of game.npcs) {
      const g = new THREE.Group()
      const body = box(10, 11, 9, n.color); body.position.y = 5.5
      const head = box(8, 7, 8, n.color); head.position.y = 14.5
      g.add(body, head)
      g.traverse(o => { o.castShadow = true; o.userData.target = { kind: 'char', c: n.char } satisfies Target })
      this.npcs.set(n.login, g)
      this.pickables.push(g)
      add(g)
    }

    for (const bug of world.bugs) {
      const live = new THREE.Group()
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshLambertMaterial({ color: '#e5533d' }))
      shell.scale.set(8, 6, 10); shell.position.y = 6
      const head = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), new THREE.MeshLambertMaterial({ color: '#2a0f0c' }))
      head.position.set(0, 6, -10)
      const stripe = box(1.5, 1, 18, '#2a0f0c'); stripe.position.y = 12
      live.add(shell, head, stripe)
      live.traverse(o => { o.castShadow = true; o.userData.target = { kind: 'bug', bug } satisfies Target })
      live.position.set(bug.x, PLOT_Y, bug.y)
      const splat = new THREE.Mesh(new THREE.CircleGeometry(11, 16), new THREE.MeshLambertMaterial({ color: '#5fc48a', transparent: true, opacity: 0.6 }))
      splat.rotation.x = -Math.PI / 2
      splat.position.set(bug.x, PLOT_Y + 0.3, bug.y)
      this.bugs.set(bug.number, { live, splat })
      this.pickables.push(live)
      add(live); add(splat)
    }

    for (const gate of world.gates) {
      const open = gate.state === 'merged'
      const g = new THREE.Group()
      const l = box(4, 26, 4, '#6b5a45'); l.position.set(-11, 13, 0)
      const r = box(4, 26, 4, '#6b5a45'); r.position.set(11, 13, 0)
      const bar = box(open ? 3 : 22, open ? 16 : 4, 3, open ? CLS_COLOR.cleared : '#e5533d')
      bar.position.set(open ? -11 : 0, open ? 32 : 16, 0)
      g.add(l, r, bar)
      if (!open) { const lock = box(6, 6, 4, '#f0b429'); lock.position.set(0, 12, 1.5); g.add(lock) }
      g.traverse(o => { o.castShadow = true; o.userData.target = { kind: 'gate', gate } satisfies Target })
      g.position.set(gate.x, PLOT_Y, gate.y)
      this.pickables.push(g)
      add(g)
    }
  }

  building(b: Building, th: { roof: string; wall: string }, done: boolean) {
    const g = new THREE.Group()
    const s = b.size, h = Math.round(s * TALL)
    const ghost = b.ghost
    const wallMat = new THREE.MeshLambertMaterial({ color: ghost ? '#4b5160' : th.wall, transparent: ghost, opacity: ghost ? 0.55 : 1 })
    const roof = new THREE.MeshLambertMaterial({ color: ghost ? '#8a909c' : th.roof, transparent: ghost, opacity: ghost ? 0.55 : 1 })
    const parts: BuildingParts = { roof }

    if (b.more) { // hamlet: a cluster of small houses
      for (const [dx, dz, k] of [[-0.25, -0.25, 0.8], [0.25, -0.2, 0.6], [-0.2, 0.25, 0.65], [0.25, 0.25, 0.9]]) {
        const hs = s * 0.42
        const m = new THREE.Mesh(new THREE.BoxGeometry(hs, hs * k, hs), [wallMat, wallMat, roof, wallMat, wallMat, wallMat])
        m.position.set(b.x + s / 2 + dx * s, PLOT_Y + (hs * k) / 2, b.y + s / 2 + dz * s)
        m.castShadow = m.receiveShadow = true
        g.add(m)
      }
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), [wallMat, wallMat, roof, wallMat, wallMat, wallMat])
      m.position.set(b.x + s / 2, PLOT_Y + h / 2, b.y + s / 2)
      m.castShadow = m.receiveShadow = true
      g.add(m)
      const door = box(10, 14, 1, '#1a1f29'); door.position.set(b.x + s / 2, PLOT_Y + 7, b.y + s + 0.6)
      g.add(door)
      if (b.cls !== 'NPC') {
        for (const wx of [8.5, s - 8.5]) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 1), new THREE.MeshBasicMaterial({ color: ghost ? '#2a2e37' : '#ffd88a' }))
          win.position.set(b.x + wx, PLOT_Y + h * 0.62, b.y + s + 0.6)
          g.add(win)
        }
        // rank cap on the roof, like the coloured stripe in 2D
        parts.cap = new THREE.MeshLambertMaterial({ color: ghost ? '#8a909c' : done ? CLS_COLOR.cleared : CLS_COLOR[b.cls] })
        const cap = new THREE.Mesh(new THREE.BoxGeometry(s * 0.72, 4, s * 0.72), parts.cap)
        cap.position.set(b.x + s / 2, PLOT_Y + h + 2, b.y + s / 2)
        cap.castShadow = true
        g.add(cap)
      }
      if (b.cls === 'Boss' || b.cls === 'Mini boss' || b.cls === 'Final boss') {
        const pole = box(2, 30, 2, '#1a1f29'); pole.position.set(b.x + s / 2, PLOT_Y + h + 19, b.y + s / 2)
        parts.flag = new THREE.MeshLambertMaterial({ color: done ? CLS_COLOR.cleared : CLS_COLOR[b.cls], side: THREE.DoubleSide })
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), parts.flag)
        flag.position.set(b.x + s / 2 + 9, PLOT_Y + h + 29, b.y + s / 2)
        g.add(pole, flag)
      }
    }
    g.traverse(o => { o.userData.target = { kind: 'building', b } satisfies Target })
    this.parts.set(b, parts)
    this.pickables.push(g)
    return g
  }

  render(game: Game, t: number) {
    if (game.world !== this.world) this.build(game.world, game)
    const p = game.player
    const bob = Math.abs(Math.sin(p.step)) * 2
    this.player.position.set(p.x, PLOT_Y + bob, p.y)
    this.player.rotation.y = p.dir > 0 ? 0 : Math.PI

    for (const n of game.npcs) this.npcs.get(n.login)?.position.set(n.x, PLOT_Y, n.y)

    // state that changes while you play: cleared buildings, squashed bugs, the boss pulse, the E highlight
    const nearKey = targetKey(game.near)
    for (const [b, parts] of this.parts) {
      const done = game.cleared.has(b.path)
      const rank = done ? CLS_COLOR.cleared : CLS_COLOR[b.cls]
      if (parts.cap && !b.ghost) parts.cap.color.set(rank)
      parts.flag?.color.set(rank)
      const near = nearKey === b.path
      const emissive = near ? '#f0b429' : b.hot ? '#ff6a1a' : b.cls === 'Final boss' && !done ? '#e5533d' : '#000000'
      const glow = near ? 0.35 : b.hot ? 0.25 + 0.15 * Math.sin(t * 8) : b.cls === 'Final boss' && !done ? 0.3 + 0.25 * Math.sin(t * 3) : 0
      parts.roof.emissive.set(emissive); parts.roof.emissiveIntensity = glow
    }
    for (const bug of this.world!.bugs) {
      const parts = this.bugs.get(bug.number)!
      const squashed = game.cleared.has(bugKey(bug))
      parts.live.visible = !squashed
      parts.splat.visible = squashed
      if (!squashed && !game.reduce) parts.live.rotation.y = Math.sin(t * 2 + bug.number) * 0.6
    }

    // quest arrow floats beside the player when the final boss is far away
    const q = game.quest
    const qx = q ? q.x + q.size / 2 : 0, qz = q ? q.y + q.size / 2 : 0
    this.arrow.visible = !!q && Math.hypot(qx - p.x, qz - p.y) > 260
    if (this.arrow.visible) {
      const a = Math.atan2(qz - p.y, qx - p.x)
      this.arrow.position.set(p.x + Math.cos(a) * 40, PLOT_Y + 34, p.y + Math.sin(a) * 40)
      this.arrow.lookAt(qx, PLOT_Y + 34, qz)
    }
    this.marker.visible = !!game.target
    if (game.target) this.marker.position.set(game.target.x, PLOT_Y + 1, game.target.y)

    // camera follows from behind and above; sun (and its shadow box) follows the player
    const want = new THREE.Vector3(p.x, 520, p.y + 470)
    if (this.first || game.reduce) { this.camera.position.copy(want); this.first = false }
    else this.camera.position.lerp(want, 0.08)
    this.camera.lookAt(this.camera.position.x, 0, this.camera.position.z - 470 - 40)
    this.sun.position.set(p.x - 320, 760, p.y + 260)
    this.sun.target.position.set(p.x, 0, p.y)

    this.renderer.render(this.scene, this.camera)
  }

  // Screen point -> world point, plus whatever you clicked on.
  pick(sx: number, sy: number) {
    this.ray.setFromCamera(new THREE.Vector2((sx / this.W) * 2 - 1, -(sy / this.H) * 2 + 1), this.camera)
    const hit = this.ray.intersectObjects(this.pickables, true)[0]
    const t = (hit?.object.userData.target as Target | undefined) ?? null
    const onGround = this.ray.intersectObject(this.ground)[0]
    const at = hit?.point ?? onGround?.point
    return at ? { x: at.x, y: at.z, t } : null
  }
}

function box(w: number, h: number, d: number, c: string) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c }))
}

// District names on a sign that always faces the camera.
function textPlane(title: string, sub: string, fg: string) {
  const scale = 2
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  const titleFont = `700 ${17 * scale}px "Pixelify Sans", monospace`, subFont = `${11 * scale}px "IBM Plex Mono", monospace`
  ctx.font = titleFont
  const pad = 10 * scale
  const w = Math.ceil(Math.max(ctx.measureText(title).width, (ctx.font = subFont, ctx.measureText(sub).width))) + pad * 2
  c.width = w; c.height = 52 * scale
  ctx.fillStyle = 'rgba(15,20,28,.78)'; ctx.beginPath(); ctx.roundRect(0, 0, w, c.height, 6 * scale); ctx.fill()
  ctx.font = titleFont; ctx.fillStyle = fg; ctx.textBaseline = 'top'
  ctx.fillText(title, pad, 6 * scale)
  ctx.font = subFont; ctx.fillStyle = 'rgba(235,230,216,.6)'
  ctx.fillText(sub, pad, 30 * scale)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
  m.scale.set(w / scale, c.height / scale, 1)
  return m
}
