import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generate, type Facts } from '../src/lib/generate.ts'
import { parseImports, parseExports, resolveImport, pickDistricts } from '../src/lib/analyze.ts'

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

test('reads Rust, Java and Ruby', () => {
  const files = new Set(['core/src/lib.rs', 'core/src/net/mod.rs', 'core/src/net/tcp.rs', 'core/src/util.rs',
    'app/src/main/java/com/acme/billing/Invoice.java', 'lib/acme/client.rb', 'lib/acme/errors.rb'])
  assert.deepEqual(parseImports('core/src/net/tcp.rs', 'use crate::util::retry;\nuse super::Conn;\nuse serde::Deserialize;\nmod frame;'),
    ['crate::util::retry', 'super::Conn', 'serde::Deserialize', 'mod:frame'])
  assert.deepEqual(resolveImport('core/src/net/tcp.rs', 'crate::util::retry', files), ['core/src/util.rs'])
  assert.deepEqual(resolveImport('core/src/lib.rs', 'mod:net', files), ['core/src/net/mod.rs'])
  assert.deepEqual(resolveImport('core/src/net/tcp.rs', 'super::tcp', files), ['core/src/net/tcp.rs'])
  assert.deepEqual(parseImports('A.java', 'import com.acme.billing.Invoice;\nimport static com.acme.billing.Invoice.total;\nimport java.util.*;'),
    ['com.acme.billing.Invoice', 'com.acme.billing.Invoice.total', 'java.util'])
  assert.deepEqual(resolveImport('A.java', 'com.acme.billing.Invoice.total', files), ['app/src/main/java/com/acme/billing/Invoice.java'])
  assert.deepEqual(parseImports('lib/acme/client.rb', "require_relative 'errors'\nrequire 'acme/errors'\nrequire 'faraday'"), ['./errors', 'acme/errors', 'faraday'])
  assert.deepEqual(resolveImport('lib/acme/client.rb', './errors', files), ['lib/acme/errors.rb'])
  assert.deepEqual(resolveImport('lib/acme/client.rb', 'acme/errors', files), ['lib/acme/errors.rb'])
  assert.deepEqual(parseExports('x.rs', 'pub fn connect() {}\npub(crate) struct Pool;\nfn helper() {}'), ['connect', 'Pool', 'helper'])
  assert.deepEqual(parseExports('X.java', 'public final class Invoice {\n    public BigDecimal total(int x) {'), ['Invoice', 'total'])
  assert.deepEqual(parseExports('x.rb', 'module Acme\n  class Client\n    def get(path)\n    def self.build'), ['Acme', 'Client', 'get', 'build'])
})

test('finds what a file defines', () => {
  assert.deepEqual(parseExports('a.ts', 'export function login() {}\nexport const MAX = 1\nfunction helper() {}\nexport { x as signIn, y }\n  function nested() {}'), ['login', 'MAX', 'helper', 'signIn', 'y'])
  assert.deepEqual(parseExports('res.js', 'res.send = function send(body) {}\nmodule.exports = res'), ['send'])
  assert.deepEqual(parseExports('m.py', 'def load():\n  def inner(): pass\nclass User:\n'), ['load', 'User'])
  assert.deepEqual(parseExports('m.go', 'func (s *Srv) Start() {}\nfunc helper() {}\ntype Config struct{}'), ['Start', 'Config'])
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
  // bosses take more rounds; every question has distinct options and a real answer
  assert.ok(stripe.quizzes!.length >= 3)
  assert.equal(new Set(stripe.quizzes!.map(q => q.q)).size, stripe.quizzes!.length)
  for (const b of all) for (const q of b.quizzes ?? [])
    assert.ok(q.answer >= 0 && q.answer < q.options.length && q.options.every(Boolean) && new Set(q.options).size === 3, `${b.path}: ${q.q}`)
  // buildings never overlap inside a district
  for (const d of w.districts) for (const a of d.buildings) for (const b of d.buildings)
    if (a !== b) assert.ok(a.x + a.size <= b.x || b.x + b.size <= a.x || a.y + a.size <= b.y - b.size / 2 || b.y + b.size <= a.y - a.size / 2, `${a.path} overlaps ${b.path}`)
})

test('issues become bugs and PRs become gates, placed at the file they mention', () => {
  const w = generate({
    ...facts,
    issues: [
      { number: 7, title: 'Stripe refund fails twice', body: '', labels: ['bug'], createdAt: new Date().toISOString(), comments: 3, user: 'a' },
      { number: 8, title: 'Docs typo', body: 'nothing specific', labels: [], createdAt: new Date().toISOString(), comments: 0, user: 'b' },
    ],
    pulls: [{ number: 9, title: 'Fix redirect', branch: 'fix/login-redirect', state: 'open', createdAt: new Date().toISOString(), mergedAt: null, user: 'c' }],
    fileActivity: { 'src/payments/stripe.js': { commits: 40, lastDays: 2, authors: { anmol: 30, bob: 2 } } },
  })
  assert.equal(w.bugs.find(b => b.number === 7)!.building, 'src/payments/stripe.js')
  assert.equal(w.bugs.find(b => b.number === 8)!.district, 'root')
  const gate = w.gates[0]
  assert.equal(gate.building, 'src/auth/login.js')
  assert.equal(gate.state, 'open')
  const stripe = w.districts.flatMap(d => d.buildings).find(b => b.name === 'stripe.js')!
  assert.deepEqual(stripe.history, { commits: 40, lastDays: 2, author: 'anmol' })
  assert.ok(stripe.hot)
  // bugs and gates stand on walkable street inside their district
  for (const x of [...w.bugs, ...w.gates]) {
    const d = w.districts.find(d => d.id === x.district)!
    assert.ok(Math.abs(x.x - d.x) < d.w / 2 && Math.abs(x.y - d.y) < d.h / 2, `#${x.number} outside its district`)
  }
})

test('same repo, same world', () => {
  const strip = (w: object) => JSON.stringify({ ...w, generatedAt: 0 })
  assert.equal(strip(generate(facts)), strip(generate(facts)))
})
