<h1 align="center">gitQuest</h1>

<p align="center">
  <strong>Paste a GitHub repo. Walk around it.</strong><br/>
  gitQuest turns any public repository into a world you can explore, in 2D or 3D:<br/>
  folders become districts, files become buildings, and the files everything imports become bosses.
</p>

<p align="center">
  <a href="https://anmol1377.github.io/gitQuest/"><img src="https://img.shields.io/badge/%E2%96%B6%20PLAY%20NOW-anmol1377.github.io%2FgitQuest-f0b429?style=for-the-badge&labelColor=141a24" alt="Play gitQuest now" /></a>
</p>

<p align="center">
  <b>Live:</b> <a href="https://anmol1377.github.io/gitQuest/">https://anmol1377.github.io/gitQuest/</a><br/>
  No install, no login, no API key. Just open it in your browser.
</p>

<p align="center">
  Demo worlds:
  <a href="https://anmol1377.github.io/gitQuest/?repo=facebook/react">facebook/react</a>
  &nbsp;·&nbsp;
  <a href="https://anmol1377.github.io/gitQuest/?repo=expressjs/express">expressjs/express</a>
  &nbsp;·&nbsp;
  <a href="https://anmol1377.github.io/gitQuest/?repo=Anmol1377/code-tune">Anmol1377/code-tune</a>
</p>

<p align="center">
  Play your own repo: <code>https://anmol1377.github.io/gitQuest/?repo=owner/name</code>
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
| Lots of recent commits | **Hot zone** 🔥, per file for bosses (last change, commit count, main author) |
| Untouched for a year | **Abandoned zone**, greyed out with cobwebs |
| Contributors | **Characters** who wander the districts they commit to |
| Open issues | **Bug monsters**, crawling next to the file the issue mentions |
| Pull requests | **Gates**: red and locked while the PR is open, raised and green once it's merged |
| What a file imports and defines | **Challenges**: "Which of these is defined in `login.js`?" |

Importance score: `imported-by × 3 + √lines / 4 + district activity`. Tests, examples and docs count for less, so they can't become the big bosses.

Big repos stay walkable: dominant folders like `src/` and monorepo folders like `packages/` are split into their children, each district shows its top 9 files, and the rest become one hamlet.

## How you play

- Walk with **WASD** or the arrow keys, or click where you want to go. Press **E** to interact. Click the minimap to fast-travel
- Switch between the **2D map and the 3D world** with the button in the corner (or open a link with `&view=3d`). Press **F** for full screen
- **Quest:** the red arrow points to the Final Boss, the most imported file in the repo
- You walk on **roads and inside districts** only. Click anywhere and your character finds the way along the roads
- **Study, then fight.** Press **Read the code** on any enemy to see its real source. Every question is answered by that file: which files it imports, which packages it uses, what it defines, how long it is. Once you press Fight, the code closes
- **Fights:** each answer is one exchange: get it right and you hit the enemy, get it wrong and it hits you, and you see the correct answer. Then the next question comes
- Enemies take 1 hit to beat, mini bosses 2, bosses 3, and the Final Boss 4. They hit back for 10, 15, 25 and 34 damage
- You have **100 HP**. Clearing a building heals 25. At 0 HP you're knocked out and sent back to README Village
- **Talk to contributors** (press **E** or click them). Each one gives one real answer for the strongest enemy in their district, patches you up for +30 HP once, can send you to where they work, and links to their GitHub profile
- **Squash bugs.** Each open issue is a bug hiding in a file. Read that file, answer one question about it, and it's squashed (+10 HP). A wrong answer and it bites for 10. The link takes you to the real issue if you want to fix it for real
- **Gates** are pull requests. Walk through a merged one to celebrate (+10 HP), or follow a locked one to review it on GitHub
- A building's stats stay hidden until you defeat it. Progress is saved per repo in your browser

## No API key needed

A world costs **zero** GitHub API calls:

- The file list comes from [jsDelivr](https://www.jsdelivr.com/)'s GitHub mirror (`data.jsdelivr.com`), which has no rate limit
- Source code is read from the jsDelivr CDN, falling back to `raw.githubusercontent.com`
- Imports and definitions are parsed in the browser: **JavaScript, TypeScript, Python, Go, Rust, Java and Ruby**, including monorepo package names, Rust modules and Java packages

Commit history, contributors, star counts, issues and pull requests are extras from the GitHub API, about 20 calls per world. If a visitor's hourly limit (60 without a login) runs out, the world still builds, just without hot zones, characters, bugs and gates. Demo worlds are pre-generated and stored as JSON, so they never call anything.

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
src/game/world2d.ts   game loop, movement, interactions, 2D canvas renderer, minimap
src/game/world3d.ts   Three.js renderer (loaded only when you switch to 3D)
src/game/walk.ts      walkable roads and districts, pathfinding
src/App.tsx           input, loading, HUD, 2D/3D switch
src/components/Panel.tsx      buildings: inspect, code reader, fights
src/components/Talk.tsx       contributors: tips, healing, travel
src/components/Encounter.tsx  bugs (issues) and gates (pull requests)
```

The generator outputs a plain `world.json`. The game logic runs the same in both views; the 2D and 3D renderers only draw it.

## Contributing

Issues and PRs are welcome, and they show up in the game as bugs and gates. Good first areas: import parsers for more languages (Kotlin, PHP, C#), district themes, and new challenge types in `generate.ts`.

## License

[MIT](LICENSE) © Anmol
