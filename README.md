<h1 align="center">gitQuest</h1>

<p align="center">
  <strong>Paste a GitHub repo. Walk around it.</strong><br/>
  gitQuest turns any public repository into a top-down world you can explore:<br/>
  folders become districts, files become buildings, and the files everything imports become bosses.
</p>

<p align="center">
  <a href="https://anmol1377.github.io/gitQuest/"><b>Play it →</b></a>
  &nbsp;·&nbsp;
  <a href="https://anmol1377.github.io/gitQuest/?repo=facebook/react">facebook/react</a>
  &nbsp;·&nbsp;
  <a href="https://anmol1377.github.io/gitQuest/?repo=expressjs/express">expressjs/express</a>
</p>

---

## How a repo becomes a world

The world isn't designed by hand. The repository generates it.

| Repo | World |
|---|---|
| Folder | **District**, themed by its name: `auth` → castle, `payments` → dungeon, `db` → depths, `tests` → lab, `components` → keep |
| File | **Building**, sized by importance |
| How many files import it | **NPC → Enemy → Mini boss → Boss**. The most imported file in the repo is the **Final Boss** |
| Imports between folders | **Roads**. Districts connect in dependency order, starting from README Village |
| Lots of recent commits | **Hot zone** 🔥 |
| Untouched for a year | **Abandoned zone**, greyed out with cobwebs |
| Contributors | **Characters** who wander the districts they commit to |
| What a file imports and defines | **Challenges**: "Which of these is defined in `login.js`?" |

Importance score: `imported-by × 3 + √lines / 4 + district activity`. Tests, examples and docs count for less, so they can't become the big bosses.

Big repos stay walkable: dominant folders like `src/` and monorepo folders like `packages/` are split into their children, each district shows its top 9 files, and the rest become one hamlet.

## How you play

- Walk with **WASD** or the arrow keys, or click where you want to go. Press **E** to inspect a building. Click the minimap to fast-travel
- **Quest:** the red arrow points to the Final Boss, the most imported file in the repo
- You walk on **roads and inside districts** only. Click anywhere and your character finds the way along the roads
- **Study, then fight.** Press **Read the code** on any enemy to see its real source. Every question is answered by that file: which files it imports, which packages it uses, what it defines, how long it is. Once you press Fight, the code closes
- **Fights:** each answer is one exchange: get it right and you hit the enemy, get it wrong and it hits you, and you see the correct answer. Then the next question comes
- Enemies take 1 hit to beat, mini bosses 2, bosses 3, and the Final Boss 4. They hit back for 10, 15, 25 and 34 damage
- You have **100 HP**. Clearing a building heals 25. At 0 HP you're knocked out and sent back to README Village
- A building's stats stay hidden until you defeat it. Progress is saved per repo in your browser

## No API key needed

A world costs **zero** GitHub API calls:

- The file list comes from [jsDelivr](https://www.jsdelivr.com/)'s GitHub mirror (`data.jsdelivr.com`), which has no rate limit
- Source code is read from the jsDelivr CDN, falling back to `raw.githubusercontent.com`
- Imports are parsed in the browser (JS/TS, Python and Go, including monorepo package names)

Commit history, contributors and star counts are extras from the GitHub API, about 9 calls per world. If a visitor's hourly limit (60 without a login) runs out, the world still builds, just without hot zones and characters. Demo worlds are pre-generated and stored as JSON, so they never call anything.

## Run it locally

```bash
git clone https://github.com/Anmol1377/gitQuest.git
cd gitQuest
npm install
npm run dev      # http://localhost:5173
npm test         # generator tests (Node 22.18+)
```

Add or refresh a demo world:

```bash
npm run sample -- owner/repo
```

This writes `public/samples/owner__repo.json` and adds it to the demo list. Fetched data is cached in `scripts/.cache/`, so you can tune the generator and re-run without hitting GitHub. Set `GITHUB_TOKEN` to get full commit history on big repos.

## Project layout

```
src/lib/github.ts     jsDelivr file list, file contents, optional GitHub API extras
src/lib/analyze.ts    file filtering, districts, import parsing and resolution
src/lib/generate.ts   repo facts → world.json (deterministic)
src/lib/build.ts      fetch everything, then generate
src/game/world2d.ts   canvas renderer: camera, movement, minimap
src/game/walk.ts      walkable roads and districts, pathfinding
src/App.tsx           input, loading, HUD
src/components/Panel.tsx   inspect panel and challenges
```

The generator outputs a plain `world.json`, and the renderer only draws it. That keeps a future 3D renderer a drop-in.

## Roadmap

- [x] **v0.1 Walkable world**: districts, buildings, bosses, challenges, zero-API generation
- [ ] **v0.2 Deeper code reading**: more languages (Rust, Java, Ruby), per-file history
- [ ] **v0.3 Issues and PRs**: bug dungeons, locked gates that open on merge
- [ ] **v0.4 3D world**: a Three.js renderer reading the same `world.json`
- [ ] **v0.5 AI layer**: bring your own key for boss names, abilities and challenges written from the actual code
- [ ] **Later**: multiplayer repo worlds

## Contributing

Issues and PRs are welcome. Good first areas: import parsers for new languages, district themes, and new challenge types in `generate.ts`.

## License

[MIT](LICENSE) © Anmol
