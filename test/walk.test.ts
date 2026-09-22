import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { roadsOf, gridOf, findPath, walkableAt } from '../src/game/walk.ts'
import type { World } from '../src/lib/generate.ts'

for (const slug of ['facebook__react', 'expressjs__express', 'anmol1377__code-tune']) {
  test(`every building in ${slug} can be reached by road from the spawn`, () => {
    const world: World = JSON.parse(readFileSync(new URL(`../public/samples/${slug}.json`, import.meta.url), 'utf8'))
    const grid = gridOf(world, roadsOf(world))
    assert.ok(walkableAt(grid, world.spawn.x, world.spawn.y), 'spawn is walkable')
    assert.ok(!walkableAt(grid, 4, 4), 'empty corner is not walkable')
    for (const b of world.districts.flatMap(d => d.buildings)) {
      const front = { x: b.x + b.size / 2, y: b.y + b.size + 18 }
      const route = findPath(grid, world.spawn, front)
      assert.ok(route, `no path to ${b.path}`)
      const end = route.at(-1)!
      assert.ok(Math.hypot(end.x - front.x, end.y - front.y) < 40, `${b.path}: path ends ${Math.round(Math.hypot(end.x - front.x, end.y - front.y))}px from the door`)
    }
  })
}
