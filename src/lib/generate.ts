// Repo facts -> world.json. Deterministic: the same repo always builds the same world.
import { SIDELINE, pickDistricts, parseImports, resolveImport, externalPackages, SOURCE_EXT, ext, dirOf, baseName } from './analyze.ts'

export type Activity = { commits: number; lastDays: number | null; authors: Record<string, number> }
export type RepoInfo = { owner: string; name: string; description: string; stars: number; branch: string; language: string }
export type Facts = {
  repo: RepoInfo
  files: { path: string; size: number }[]
  contents: Record<string, string>
  activity: Record<string, Activity>
  contributors: { login: string; commits: number }[]
  truncated: boolean
  apiCalls: number
}

export type Cls = 'NPC' | 'Enemy' | 'Mini boss' | 'Boss' | 'Final boss'
export type Quiz = { q: string; options: string[]; answer: number; source: string }
export type Building = {
  path: string; name: string; label: string; title: string; cls: Cls; hp: number
  deps: number; lines: number; imports: string[]; abilities: string[]
  hot: boolean; ghost: boolean; x: number; y: number; size: number
  talk?: string; quizzes?: Quiz[]; more?: number
}
export type District = {
  id: string; label: string; path: string; theme: string
  x: number; y: number; w: number; h: number
  fileCount: number; commits: number | null; lastDays: number | null
  hot: boolean; ghost: boolean; buildings: Building[]
}
export type Character = { login: string; role: string; commits: number; homes: string[] }
export type World = {
  version: 2
  repo: RepoInfo
  districts: District[]
  roads: [string, string][]
  characters: Character[]
  width: number; height: number; spawn: { x: number; y: number }
  stats: { files: number; readFiles: number; links: number; apiCalls: number; truncated: boolean }
  generatedAt: string
}

const THEMES: [RegExp, string, string][] = [
  [/auth|login|security|session|identity|permission/, 'castle', 'Castle'],
  [/user|account|profile|member|team/, 'village2', 'Village'],
  [/pay|billing|stripe|checkout|invoice|order|cart/, 'dungeon', 'Dungeon'],
  [/^db$|database|model|schema|store|storage|migration|prisma|orm|data/, 'depths', 'Depths'],
  [/test|spec|e2e|fixture|bench/, 'lab', 'Lab'],
  [/ui|component|page|view|app|web|client|front|dashboard|screen|style|public|static|asset/, 'keep', 'Keep'],
  [/doc|example|guide|demo|sample|tutorial/, 'library', 'Library'],
  [/github|^ci$|script|tool|infra|deploy|docker|config|build/, 'forge', 'Forge'],
  [/api|server|route|controller|handler|service|core|lib|src|pkg|internal|cmd|packages/, 'citadel', 'Citadel'],
]
const ROLE: Record<string, string> = {
  castle: 'Security Paladin', dungeon: 'Payments Rogue', depths: 'Data Sorcerer', lab: 'Test Alchemist',
  keep: 'Frontend Knight', library: 'Lore Keeper', forge: 'Ops Blacksmith', citadel: 'Backend Mage',
  village: 'Wandering Bard', village2: 'Wandering Bard',
}
const TITLES: Record<Cls, string[]> = {
  'Final boss': ['The {} Monolith', 'The {} Overlord', 'The {} Leviathan'],
  Boss: ['The {} Warden', 'The {} Colossus', 'The {} Hydra', 'The {} Tyrant'],
  'Mini boss': ['{} Guardian', '{} Sentinel', '{} Knight', '{} Warlock'],
  Enemy: ['{} Grunt', '{} Goblin', '{} Slime', '{} Imp', '{} Bandit'],
  NPC: ['{} Keeper', '{} Clerk', '{} Villager', '{} Scribe'],
}
const VERBS = ['Strike', 'Shield', 'Surge', 'Curse', 'Storm', 'Grip']
const DOC_EXT = new Set(['md', 'mdx', 'json', 'yml', 'yaml', 'toml', 'css', 'scss', 'html'])

export function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
export const titleCase = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[-_.\s/]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
export const ago = (d: number | null) =>
  d == null ? 'unknown' : d < 1 ? 'today' : d < 30 ? `${d}d ago` : d < 365 ? `${Math.round(d / 30)}mo ago` : `${(d / 365).toFixed(1)}y ago`

const pick = <T,>(arr: T[], seed: string) => arr[hash(seed) % arr.length]
const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const SHOWN = 9 // buildings per district; the rest become one hamlet
const PER_ROW = 5
const GAP = 36
const SIZE: Record<Cls, number> = { NPC: 32, Enemy: 42, 'Mini boss': 54, Boss: 66, 'Final boss': 84 }
const ROUNDS: Record<Cls, number> = { NPC: 0, Enemy: 1, 'Mini boss': 2, Boss: 3, 'Final boss': 4 }
const ROAD = 150

export function generate(f: Facts): World {
  const paths = f.files.map(x => x.path)
  const fileSet = new Set(paths)
  const bytes = new Map(f.files.map(x => [x.path, x.size]))
  const goModule = f.contents['go.mod']?.match(/^module\s+(\S+)/m)?.[1] ?? ''
  const groups = pickDistricts(paths)
  const districtOf = new Map<string, string>()
  for (const g of groups) for (const p of g.files) districtOf.set(p, g.id)

  // dependency graph
  const imports = new Map<string, string[]>()
  const externals = new Map<string, string[]>()
  const dependents = new Map<string, number>()
  const importers = new Map<string, string[]>()
  let links = 0
  for (const [p, text] of Object.entries(f.contents)) {
    if (!SOURCE_EXT.has(ext(p)) || !fileSet.has(p)) continue
    const specs = parseImports(p, text)
    const targets = [...new Set(specs.flatMap(s => resolveImport(p, s, fileSet, goModule)))].filter(t => t !== p)
    imports.set(p, targets)
    externals.set(p, externalPackages(p, specs))
    for (const t of targets) {
      dependents.set(t, (dependents.get(t) ?? 0) + 1)
      importers.get(t)?.push(p) ?? importers.set(t, [p])
    }
    links += targets.length
  }

  const lines = (p: string) => f.contents[p] != null ? f.contents[p].split('\n').length : Math.max(1, Math.round((bytes.get(p) ?? 0) / 35))
  const estimated = (p: string) => f.contents[p] == null
  const heat = (p: string) => Math.log2(1 + (f.activity[districtOf.get(p)!]?.commits ?? 0))
  const special = (p: string) => /^(readme\.md|package\.json)$/i.test(p)
  // Architecture matters more than size: tests, examples and docs can't become the big bosses.
  const score = new Map(paths.map(p => {
    const s = (dependents.get(p) ?? 0) * 3 + Math.min(6, Math.sqrt(lines(p)) / 4) + heat(p) * 0.5
    return [p, DOC_EXT.has(ext(p)) ? Math.min(3, s * 0.3) : SIDELINE.test(p) ? s * 0.3 : s]
  }))

  const ranked = paths.filter(p => !special(p)).sort((a, b) => score.get(b)! - score.get(a)! || a.localeCompare(b))
  const n = ranked.length
  const cls = new Map<string, Cls>(paths.filter(special).map(p => [p, 'NPC']))
  const bossN = Math.min(10, Math.max(3, n * 0.03)), miniN = Math.min(30, Math.max(6, n * 0.12)), enemyN = Math.max(10, n * 0.5)
  ranked.forEach((p, i) => {
    const s = score.get(p)!
    cls.set(p, i === 0 ? 'Final boss'
      : i < bossN && s >= 8 ? 'Boss'
      : i < miniN && s >= 4 ? 'Mini boss'
      : i < enemyN && s >= 1.5 ? 'Enemy' : 'NPC')
  })
  const maxScore = Math.max(1, score.get(ranked[0]) ?? 1)
  const finalPath = ranked[0]

  const shortName = (p: string) => p.split('/').slice(-2).join('/')
  const titleOf = (p: string, c: Cls) => {
    let base = baseName(p).replace(/\.[^.]+$/, '')
    if (/^(index|main|mod|__init__|init|app)$/i.test(base)) base = baseName(dirOf(p).slice(0, -1)) || f.repo.name
    return pick(TITLES[c], p).replace('{}', titleCase(base))
  }
  const abilitiesOf = (p: string) => {
    const ext_ = (externals.get(p) ?? []).map(pkg => `${titleCase(pkg)} ${pick(VERBS, pkg + p)}`)
    const int_ = (imports.get(p) ?? []).map(t => `${titleCase(baseName(t).replace(/\.[^.]+$/, ''))} Summon`)
    return [...new Set([...ext_, ...int_])].slice(0, 3)
  }
  const allPackages = [...new Set([...externals.values()].flat())]
  const choice = (q: string, right: string, pool: string[], h: number, source: string): Quiz | null => {
    const decoys = [...new Set(pool)].filter(x => x !== right)
    if (decoys.length < 2) return null
    const d1 = decoys[h % decoys.length]
    const d2 = decoys[(h % decoys.length + 1 + (h >>> 4) % (decoys.length - 1)) % decoys.length]
    const options = [d1, d2]
    const answer = h % 3
    options.splice(answer, 0, right)
    return { q, options, answer, source }
  }
  const numeric = (q: string, n: number, h: number, source: string): Quiz => {
    const opts = [...new Set([n, n + 2 + (h % 4), Math.max(0, n - 1 - (h % 3))])]
    while (opts.length < 3) opts.push(n + 6 + opts.length)
    opts.sort((a, b) => a - b)
    return { q, options: opts.map(String), answer: opts.indexOf(n), source }
  }
  // Several different questions per fighter, all answerable from the code, none from the panel.
  const quizzesOf = (p: string, count: number): Quiz[] => {
    const h = hash(p)
    const name = /^(index|main|mod|__init__|init|app)\./i.test(baseName(p)) ? shortName(p) : baseName(p)
    const own = imports.get(p) ?? []
    const users = importers.get(p) ?? []
    const pkgs = externals.get(p) ?? []
    const deps = dependents.get(p) ?? 0
    const src = ranked.filter(x => x !== p && SOURCE_EXT.has(ext(x)))
    const graph = 'Built from the import graph'
    const makers: (() => Quiz | null)[] = [
      () => own.length ? choice(`Which of these files does ${name} import?`, shortName(own[h % own.length]), src.filter(x => !own.includes(x)).map(shortName), h, graph) : null,
      () => users.length ? choice(`Which of these files imports ${name}?`, shortName(users[h % users.length]), src.filter(x => !users.includes(x)).map(shortName), h >>> 3, graph) : null,
      () => pkgs.length ? choice(`Which package does ${name} use?`, pkgs[h % pkgs.length], allPackages.filter(x => !pkgs.includes(x)), h >>> 5, 'Built from its imports') : null,
      () => deps ? numeric(`How many files in this repo import ${name}?`, deps, h, graph) : null,
      () => own.length ? numeric(`How many files from this repo does ${name} import?`, own.length, h >>> 2, graph) : null,
      () => {
        const l = lines(p)
        return { q: `Roughly how long is ${name}?`, options: ['Under 100 lines', '100 to 400 lines', 'Over 400 lines'],
          answer: l < 100 ? 0 : l <= 400 ? 1 : 2, source: estimated(p) ? 'Estimated from file size' : 'Counted from the file' }
      },
    ]
    const start = h % makers.length
    const out: Quiz[] = []
    for (let i = 0; i < makers.length && out.length < count; i++) {
      const q = makers[(start + i) % makers.length]()
      if (q) out.push(q)
    }
    return out
  }

  // districts and buildings
  const districts: District[] = groups.map(g => {
    const seg = g.path.split('/').filter(Boolean).pop() ?? ''
    const [, theme, suffix] = g.id === 'root' ? [null, 'village', ''] : g.id === '*' ? [null, 'village2', ''] : THEMES.find(([re]) => re.test(seg.toLowerCase())) ?? [null, 'village2', 'Village']
    const label = g.id === 'root' ? 'README Village' : g.id === '*' ? 'The Outskirts' : `${titleCase(seg)} ${suffix}`
    const a = f.activity[g.id]
    const hot = !!a && a.lastDays != null && a.lastDays <= 14 && a.commits >= 20
    const ghost = !!a && a.lastDays != null && a.lastDays > 365
    const sorted = [...g.files].sort((x, y) => score.get(y)! - score.get(x)! || x.localeCompare(y))
    const shown = sorted.length > SHOWN + 1 ? sorted.slice(0, SHOWN) : sorted
    const rest = sorted.slice(shown.length)

    const names = shown.map(baseName)
    const buildings: Building[] = shown.map((p, i) => {
      const c = cls.get(p)!
      const s = score.get(p)!
      const dup = names.filter(x => x === baseName(p)).length > 1
      const b: Building = {
        path: p, name: baseName(p), label: dup ? shortName(p) : baseName(p), title: titleOf(p, c), cls: c, hp: Math.max(100, Math.round(s * 100)),
        deps: dependents.get(p) ?? 0, lines: lines(p), imports: imports.get(p) ?? [], abilities: c === 'NPC' ? [] : abilitiesOf(p),
        hot: hot && i < 2 && c !== 'NPC', ghost, x: 0, y: 0, size: SIZE[c] + Math.round(4 * Math.min(1, s / maxScore)),
      }
      if (c === 'NPC') b.talk = talkOf(p, b)
      else b.quizzes = quizzesOf(p, ROUNDS[c])
      return b
    })
    if (rest.length) buildings.push({
      path: g.path + '…', name: `+${rest.length} more files`, label: `+${rest.length} more`, title: 'The Hamlet', cls: 'NPC', hp: 0,
      deps: rest.reduce((t, p) => t + (dependents.get(p) ?? 0), 0), lines: rest.reduce((t, p) => t + lines(p), 0),
      imports: [], abilities: [], hot: false, ghost, x: 0, y: 0, size: 40, more: rest.length,
      talk: `${rest.length} smaller files live here, like ${rest.slice(0, 3).map(baseName).join(', ')}.`,
    })

    // place buildings in rows inside the plot
    const rows: Building[][] = []
    for (let i = 0; i < buildings.length; i += PER_ROW) rows.push(buildings.slice(i, i + PER_ROW))
    const rowW = (r: Building[]) => r.reduce((t, b) => t + b.size, 0) + GAP * (r.length - 1)
    // each row is tall enough for its biggest roof (1.5x size) plus the name label
    const roof = (r: Building[]) => Math.max(...r.map(b => b.size)) * 1.5
    const w = Math.max(320, ...rows.map(r => rowW(r) + 80))
    const h = 62 + rows.reduce((t, r) => t + roof(r) + 34, 0)
    let top = -h / 2 + 58
    for (const r of rows) {
      let x = -rowW(r) / 2
      const base = top + roof(r)
      for (const b of r) { b.x = x; b.y = base - b.size; x += b.size + GAP }
      top = base + 34
    }
    return { id: g.id, label, path: g.path || (g.id === 'root' ? '/' : 'everything else'), theme, x: 0, y: 0, w, h,
      fileCount: g.files.length, commits: a?.commits ?? null, lastDays: a?.lastDays ?? null, hot, ghost, buildings }
  })

  function talkOf(p: string, b: Building): string {
    if (/^readme\.md$/i.test(p))
      return `Welcome to ${f.repo.owner}/${f.repo.name}. ${paths.length} files across ${groups.length} districts. ${titleOf(finalPath, 'Final boss')} waits in ${finalPath}.`
    if (p === 'package.json') {
      try {
        const pkg = JSON.parse(f.contents[p])
        const d = Object.keys(pkg.dependencies ?? {}).length, dd = Object.keys(pkg.devDependencies ?? {}).length
        return `The Item Shop. ${d} dependencies and ${dd} dev tools in stock. Take what you need.`
      } catch { return 'The Item Shop. The price list is unreadable today.' }
    }
    return pick([
      b.deps ? `${b.deps} file${b.deps > 1 ? 's' : ''} lean on me. Don't tell the boss.` : `I'm ${b.lines} lines and nobody imports me. It's peaceful.`,
      `I've been here since before the last refactor.`,
      `Keep walking. The real trouble is up the road.`,
    ], p)
  }

  // roads: maximum spanning tree over cross-district imports, rooted at the village
  const ids = districts.map(d => d.id)
  const weight = new Map<string, number>()
  for (const [p, ts] of imports) for (const t of ts) {
    const a = districtOf.get(p)!, b = districtOf.get(t)!
    if (a !== b) weight.set(edgeKey(a, b), (weight.get(edgeKey(a, b)) ?? 0) + 1)
  }
  const start = ids[0]
  const parent = new Map<string, string>()
  const order = [start]
  const inTree = new Set([start])
  while (inTree.size < ids.length) {
    let best: [string, string, number] | null = null
    for (const a of order) for (const b of ids) {
      if (inTree.has(b)) continue
      const x = weight.get(edgeKey(a, b)) ?? 0
      if (!best || x > best[2]) best = [a, b, x]
    }
    const [a, b, x] = best!
    parent.set(b, x > 0 ? a : start)
    inTree.add(b)
    order.push(b)
  }

  // layout: root at the bottom, each tree level a band above its parent, max 4 districts per band
  const byId = new Map(districts.map(d => [d.id, d]))
  const depth = new Map<string, number>([[start, 0]])
  for (const id of order.slice(1)) depth.set(id, depth.get(parent.get(id)!)! + 1)
  const levels: string[][] = []
  for (const id of order) (levels[depth.get(id)!] ??= []).push(id)
  let bottom = 0
  for (const level of levels) {
    level.sort((a, b) => (byId.get(parent.get(a)!)?.x ?? 0) - (byId.get(parent.get(b)!)?.x ?? 0))
    for (let i = 0; i < level.length; i += 4) {
      const band = level.slice(i, i + 4).map(id => byId.get(id)!)
      const bandH = Math.max(...band.map(d => d.h))
      const total = band.reduce((t, d) => t + d.w, 0) + ROAD * (band.length - 1)
      let x = -total / 2
      for (const d of band) { d.x = x + d.w / 2; d.y = bottom - bandH / 2; x += d.w + ROAD }
      bottom -= bandH + ROAD
    }
  }
  const M = 140
  const minX = Math.min(...districts.map(d => d.x - d.w / 2)), maxX = Math.max(...districts.map(d => d.x + d.w / 2))
  const minY = Math.min(...districts.map(d => d.y - d.h / 2)), maxY = Math.max(...districts.map(d => d.y + d.h / 2))
  for (const d of districts) {
    d.x = Math.round(d.x - minX + M); d.y = Math.round(d.y - minY + M)
    for (const b of d.buildings) { b.x = Math.round(b.x + d.x); b.y = Math.round(b.y + d.y) }
  }
  const root = districts[0]

  const characters: Character[] = f.contributors.slice(0, 8).map(c => {
    const homes = Object.entries(f.activity)
      .map(([id, a]) => [id, a.authors[c.login] ?? 0] as const)
      .filter(([id, k]) => k > 0 && byId.has(id))
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)
    const hs = homes.length ? homes : [start]
    return { login: c.login, commits: c.commits, homes: hs, role: ROLE[byId.get(hs[0])!.theme] }
  })

  return {
    version: 2,
    repo: f.repo,
    districts,
    roads: [...parent].map(([b, a]) => [a, b]),
    characters,
    width: Math.round(maxX - minX + 2 * M),
    height: Math.round(maxY - minY + 2 * M + 160),
    spawn: { x: root.x, y: root.y + root.h / 2 + 110 },
    stats: { files: paths.length, readFiles: Object.keys(f.contents).length, links, apiCalls: f.apiCalls, truncated: f.truncated },
    generatedAt: new Date().toISOString(),
  }
}
