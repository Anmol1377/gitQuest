import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generate, type Facts } from '../src/lib/generate.ts'
import { parseImports, resolveImport, pickDistricts } from '../src/lib/analyze.ts'

const src: Record<string, string> = {
  'src/payments/stripe.js': "import Stripe from 'stripe'\nimport { db } from '../db/database.js'\n" + 'x\n'.repeat(900),
  'src/db/database.js': "import pg from 'pg'\n",
  'src/auth/login.js': "import { db } from '../db/database'\nimport { charge } from '../payments/stripe'\nimport jwt from 'jsonwebtoken'\n",
  'src/auth/register.js': "const s = require('../payments/stripe.js')\n",
  'src/users/user.js': "import { db } from '@/db/database'\nimport '../payments/stripe'\n",
  'src/users/profile.js': "export { x } from './user'\nimport('../payments/stripe')\n",
  'src/dashboard/dashboard.js': "import s from '../payments/stripe'\nimport u from '../users/user'\n",
  'tests/auth.test.js': "import '../src/auth/login'\nimport '../src/payments/stripe'\n",
  'README.md': '# my-app\n',
  'package.json': '{"dependencies":{"stripe":"1","pg":"1"},"devDependencies":{"vite":"1"}}',
}
const facts: Facts = {
  repo: { owner: 'you', name: 'my-app', description: '', stars: 0, branch: 'main', language: 'JavaScript' },
  files: Object.entries(src).map(([path, t]) => ({ path, size: t.length })),
  contents: src,
  activity: { 'src/payments/': { commits: 83, lastDays: 1, authors: { anmol: 40 } }, 'src/db/': { commits: 5, lastDays: 800, authors: {} } },
  contributors: [{ login: 'anmol', commits: 300 }],
  truncated: false,
  apiCalls: 9,
}

test('parses and resolves imports across languages', () => {
  assert.deepEqual(parseImports('a.ts', "import a from './x'\nexport * from \"../y\"\nconst z = require('z')"), ['./x', '../y', 'z'])
  assert.deepEqual(parseImports('a.py', 'from .models import User\nimport os.path\n'), ['.models', 'os.path'])
  const files = new Set(['src/a/x.ts', 'app/models.py', 'pkg/util/u.go'])
  assert.deepEqual(resolveImport('src/a/b.ts', './x.js', files), ['src/a/x.ts'])
  assert.deepEqual(resolveImport('app/views.py', '.models', files), ['app/models.py'])
  assert.deepEqual(resolveImport('main.go', 'example.com/m/pkg/util', files, 'example.com/m'), ['pkg/util/u.go'])
  assert.deepEqual(resolveImport('src/a/b.ts', 'react', files), [])
  const mono = new Set(['packages/shared/ReactSymbols.js', 'packages/ui/src/index.ts'])
  assert.deepEqual(resolveImport('packages/dom/x.js', 'shared/ReactSymbols', mono), ['packages/shared/ReactSymbols.js'])
  assert.deepEqual(resolveImport('apps/web/x.ts', '@acme/ui', mono), ['packages/ui/src/index.ts'])
})

test('a dominant src/ folder is split into its children', () => {
  const ids = pickDistricts(Object.keys(src)).map(g => g.id)
  assert.deepEqual(ids.slice(0, 1), ['root'])
  for (const id of ['src/auth/', 'src/payments/', 'src/users/', 'tests/']) assert.ok(ids.includes(id), id)
})

test('the most imported file becomes the final boss', () => {
  const w = generate(facts)
  const all = w.districts.flatMap(d => d.buildings)
  const stripe = all.find(b => b.name === 'stripe.js')!
  assert.equal(stripe.cls, 'Final boss')
  assert.equal(stripe.deps, 6)
  assert.ok(stripe.abilities.some(a => a.startsWith('Stripe')))
  assert.equal(all.filter(b => b.cls === 'Final boss').length, 1)
  assert.equal(all.find(b => b.name === 'README.md')!.cls, 'NPC')
  assert.match(all.find(b => b.name === 'package.json')!.talk!, /2 dependencies and 1 dev/)
  assert.ok(w.districts.find(d => d.id === 'src/payments/')!.hot)
  assert.ok(w.districts.find(d => d.id === 'src/db/')!.ghost)
  // every district is reachable by road from the village
  assert.equal(w.roads.length, w.districts.length - 1)
  // quizzes point at a real option
  for (const b of all) if (b.quiz) assert.ok(b.quiz.answer >= 0 && b.quiz.answer < b.quiz.options.length && b.quiz.options.every(Boolean), b.path)
})

test('same repo, same world', () => {
  const strip = (w: object) => JSON.stringify({ ...w, generatedAt: 0 })
  assert.equal(strip(generate(facts)), strip(generate(facts)))
})
