import { GitHub, parseRepo, rawFiles, jsdelivrFiles } from './github.ts'
import { keepFile, pickDistricts, SOURCE_EXT, ext } from './analyze.ts'
import { generate, type Facts, type RepoInfo, type World } from './generate.ts'

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
// History, contributors, stars, issues and PRs use the GitHub API as optional extras:
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

  let total = toRead.length
  let done = 0
  const tick = () => progress(1, ++done, total)
  const grow = (n: number) => { total += n }

  const contents = await rawFiles(repo.owner, repo.name, repo.branch, toRead, tick)
  const facts: Facts = { repo, files, contents, activity: {}, contributors: [], truncated, apiCalls: gh.calls }
  await readBuildings(facts, grow, tick)
  await enrich(facts, gh, grow, tick, !listing)
  return facts
}

// Every file that became a building gets read, so its questions come from real code.
// Reading changes the rankings a little, so repeat until every shown building has been read.
export async function readBuildings(facts: Facts, onCount: (n: number) => void = () => {}, onEach?: () => void) {
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

// Optional GitHub API extras. Fetches only what's missing, so cached facts can be topped up cheaply.
// Any call that fails (usually the hourly limit) is skipped and retried next time.
export async function enrich(facts: Facts, gh = new GitHub(), onCount: (n: number) => void = () => {}, onEach?: () => void, haveRepoInfo = false) {
  const { owner, name } = facts.repo
  const world = generate(facts)
  const busy = world.districts.filter(d => d.id !== 'root' && d.id !== '*').slice(0, MAX_ACTIVITY).filter(d => !facts.activity[d.id])
  const bosses = world.districts.flatMap(d => d.buildings)
    .filter(b => (b.cls === 'Boss' || b.cls === 'Final boss') && !facts.fileActivity?.[b.path])
  const jobs: (() => Promise<unknown>)[] = [
    ...(!haveRepoInfo && !facts.repo.stars ? [() => gh.repo(owner, name).then(r => { facts.repo = { ...r, language: r.language || facts.repo.language, branch: facts.repo.branch } })] : []),
    ...(!facts.contributors.length ? [() => gh.contributors(owner, name).then(c => { facts.contributors = c })] : []),
    ...(!facts.issues ? [() => gh.issues(owner, name).then(i => { facts.issues = i })] : []),
    ...(!facts.pulls ? [() => gh.pulls(owner, name).then(p => { facts.pulls = p })] : []),
    ...busy.map(d => () => gh.activity(owner, name, d.path.replace(/\/$/, '')).then(a => { facts.activity[d.id] = a })),
    ...bosses.map(b => () => gh.activity(owner, name, b.path).then(a => { (facts.fileActivity ??= {})[b.path] = a })),
  ]
  onCount(jobs.length)
  const before = gh.calls
  await Promise.all(jobs.map(j => j().catch(() => {}).finally(() => onEach?.())))
  facts.apiCalls += gh.calls - before
  return jobs.length
}
