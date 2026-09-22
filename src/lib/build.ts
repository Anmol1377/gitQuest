import { GitHub, parseRepo, rawFiles, jsdelivrFiles } from './github.ts'
import { keepFile, pickDistricts, SOURCE_EXT, ext } from './analyze.ts'
import { generate, type Activity, type Facts, type RepoInfo, type World } from './generate.ts'

export type Progress = (step: 0 | 1 | 2, done: number, total: number) => void

const MAX_READ = 300      // source files read for import parsing
const MAX_ACTIVITY = 7    // districts that get a commit-history call

const LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', swift: 'Swift', rb: 'Ruby', php: 'PHP', cs: 'C#',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', vue: 'Vue', svelte: 'Svelte', dart: 'Dart', ex: 'Elixir', scala: 'Scala',
}
const guessLanguage = (files: { path: string; size: number }[]) => {
  const bytes: Record<string, number> = {}
  for (const f of files) { const l = LANG[ext(f.path)]; if (l) bytes[l] = (bytes[l] ?? 0) + f.size }
  return Object.entries(bytes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

export async function buildWorld(input: string, progress: Progress = () => {}, token?: string): Promise<World> {
  const facts = await fetchFacts(input, progress, token)
  progress(2, 0, 1)
  const world = generate(facts)
  progress(2, 1, 1)
  return world
}

// Structure and code come from jsDelivr's GitHub mirror (no API, no limit).
// Commit history, contributors and stars use the GitHub API as optional extras:
// if the visitor's hourly limit is used up, the world still builds without them.
export async function fetchFacts(input: string, progress: Progress = () => {}, token?: string): Promise<Facts> {
  const parsed = parseRepo(input)
  if (!parsed) throw new Error('That doesn’t look like a GitHub repo. Try owner/name or a github.com link.')
  const { owner } = parsed
  const gh = new GitHub(token)

  progress(0, 0, 1)
  let repo: RepoInfo
  let allFiles: { path: string; size: number }[]
  let truncated = false
  const listing = await jsdelivrFiles(owner, parsed.repo)
  if (listing) {
    allFiles = listing.files
    repo = { owner, name: parsed.repo, description: '', stars: 0, branch: listing.branch, language: guessLanguage(allFiles) }
  } else {
    // Unusual default branch, or jsDelivr couldn't mirror it: ask the API (2 calls).
    repo = await gh.repo(owner, parsed.repo)
    const tree = await gh.tree(repo.owner, repo.name, repo.branch)
    allFiles = tree.files
    truncated = tree.truncated
  }
  const files = allFiles.filter(f => keepFile(f.path, f.size))
  if (!files.length) throw new Error('No readable source files in this repository.')
  progress(0, 1, 1)

  // Read source files spread evenly across districts, plus the root manifests.
  const groups = pickDistricts(files.map(f => f.path))
  const queues = groups.map(g => g.files.filter(p => SOURCE_EXT.has(ext(p))))
  const toRead = ['README.md', 'readme.md', 'package.json', 'go.mod'].filter(p => files.some(f => f.path === p))
  for (let i = 0; toRead.length < MAX_READ && queues.some(q => i < q.length); i++)
    for (const q of queues) if (i < q.length && toRead.length < MAX_READ) toRead.push(q[i])

  const busy = groups.filter(g => g.id !== 'root' && g.id !== '*').slice(0, MAX_ACTIVITY)
  let total = toRead.length + busy.length + 2
  let done = 0
  const tick = () => progress(1, ++done, total)

  const activity: Record<string, Activity> = {}
  const optional = <T,>(p: Promise<T>) => p.catch(() => null).finally(tick)
  const [contents, contributors, info] = await Promise.all([
    rawFiles(repo.owner, repo.name, repo.branch, toRead, tick),
    optional(gh.contributors(repo.owner, repo.name)),
    listing ? optional(gh.repo(owner, parsed.repo)) : Promise.resolve(null),
    ...busy.map(g => optional(gh.activity(repo.owner, repo.name, g.path.replace(/\/$/, '')).then(a => { activity[g.id] = a }))),
  ])
  if (info) repo = { ...info, language: info.language || repo.language, branch: repo.branch }
  const facts: Facts = { repo, files, contents, activity, contributors: contributors ?? [], truncated, apiCalls: gh.calls }

  await readBuildings(facts, n => { total += n }, tick)
  return facts
}

// Second pass: every file that became a building gets read, so its questions come from real code.
export async function readBuildings(facts: Facts, onCount: (n: number) => void = () => {}, onEach?: () => void) {
  // Reading changes the rankings a little, so repeat until every shown building has been read.
  let read = 0
  for (let pass = 0; pass < 3; pass++) {
    const missing = generate(facts).districts.flatMap(d => d.buildings)
      .filter(b => !b.more && facts.contents[b.path] == null && facts.files.some(f => f.path === b.path)).map(b => b.path)
    if (!missing.length) break
    onCount(missing.length)
    Object.assign(facts.contents, await rawFiles(facts.repo.owner, facts.repo.name, facts.repo.branch, missing, onEach))
    read += missing.length
  }
  return read
}
