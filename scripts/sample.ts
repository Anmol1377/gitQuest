// Pre-generate demo worlds so the demo buttons never touch the GitHub API.
// Usage: npm run sample -- facebook/react expressjs/express
// Fetched facts are cached in scripts/.cache, so re-running after tweaking the generator costs no API calls.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { fetchFacts, readBuildings } from '../src/lib/build.ts'
import { generate, type Facts } from '../src/lib/generate.ts'

const dir = new URL('../public/samples/', import.meta.url)
const cache = new URL('./.cache/', import.meta.url)
mkdirSync(cache, { recursive: true })
const indexFile = new URL('index.json', dir)
const index: { slug: string; label: string; language: string }[] = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : []

for (const repo of process.argv.slice(2)) {
  const cached = new URL(`${repo.replace('/', '__').toLowerCase()}.json`, cache)
  let facts: Facts
  if (existsSync(cached)) {
    facts = JSON.parse(readFileSync(cached, 'utf8'))
    if (await readBuildings(facts)) writeFileSync(cached, JSON.stringify(facts)) // top up without touching the API
  } else {
    facts = await fetchFacts(repo, (step, done, total) => process.stdout.write(`\r${repo}  step ${step + 1}/2  ${done}/${total}   `), process.env.GITHUB_TOKEN)
    writeFileSync(cached, JSON.stringify(facts))
  }
  const world = generate(facts)
  const slug = `${world.repo.owner}__${world.repo.name}`.toLowerCase()
  writeFileSync(new URL(`${slug}.json`, dir), JSON.stringify(world))
  const entry = { slug, label: `${world.repo.owner}/${world.repo.name}`, language: world.repo.language }
  const i = index.findIndex(e => e.slug === slug)
  if (i >= 0) index[i] = entry
  else index.push(entry)
  const all = world.districts.flatMap(d => d.buildings)
  console.log(`\n${entry.label}: ${world.districts.length} districts, ${world.stats.files} files, ${world.stats.links} import links, ${world.stats.apiCalls} API calls`)
  for (const d of world.districts) console.log(`  ${d.label.padEnd(26)} ${String(d.fileCount).padStart(5)} files  ${d.buildings.map(b => b.cls[0]).join('')}`)
  console.log(`  bosses: ${all.filter(b => b.cls.includes('oss')).map(b => `${b.name} (${b.deps})`).join(', ')}`)
}
writeFileSync(indexFile, JSON.stringify(index, null, 2))
