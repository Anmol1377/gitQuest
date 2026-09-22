import { useEffect, useRef, useState } from 'react'
import { Game } from './game/world2d.ts'
import { buildWorld } from './lib/build.ts'
import { parseRepo } from './lib/github.ts'
import type { Building, District, World } from './lib/generate.ts'
import Panel from './components/Panel.tsx'

type Sample = { slug: string; label: string; language: string }
const BASE = import.meta.env.BASE_URL
const STEPS = ['Listing files', 'Reading code and history', 'Generating world']
const DAY = 86_400_000
const HEARTS = 5

const store = {
  get<T>(k: string): T | null { try { return JSON.parse(localStorage.getItem(k) ?? 'null') } catch { return null } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* full or blocked */ } },
}
const repoKey = (w: World) => `${w.repo.owner}/${w.repo.name}`.toLowerCase()

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const game = useRef<Game | null>(null)
  const [world, setWorld] = useState<World | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState<number[] | null>(null) // [step, done, total]
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Building | null>(null)
  const [near, setNear] = useState<Building | null>(null)
  const [zone, setZone] = useState<District | null>(null)
  const [cleared, setCleared] = useState<Set<string>>(new Set())
  const [hearts, setHearts] = useState(HEARTS)
  const [toast, setToast] = useState('')

  const finalBoss = world?.districts.flatMap(d => d.buildings).find(b => b.cls === 'Final boss') ?? null
  const finalDistrict = finalBoss && world?.districts.find(d => d.buildings.includes(finalBoss))
  useEffect(() => { if (game.current) game.current.quest = finalBoss && !cleared.has(finalBoss.path) ? finalBoss : null }, [finalBoss, cleared])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])

  useEffect(() => {
    const g = new Game(canvas.current!, { inspect: setSelected, near: setNear, zone: setZone })
    game.current = g
    fetch(`${BASE}samples/index.json`).then(r => r.json()).then((list: Sample[]) => {
      setSamples(list)
      const asked = new URLSearchParams(location.search).get('repo')
      if (asked) { setInput(asked); generate(asked, list) }
      else if (list[0]) loadSample(list[0])
    }).catch(() => setError('Couldn’t load the demo worlds. Paste a repo above instead.'))
    return () => g.destroy()
  }, [])

  function show(w: World) {
    const c = new Set(store.get<string[]>(`gq:cleared:${repoKey(w)}`) ?? [])
    game.current!.cleared = c
    game.current!.setWorld(w)
    setCleared(c)
    setSelected(null)
    setHearts(HEARTS)
    setWorld(w)
  }

  async function loadSample(s: Sample) {
    setError('')
    const w: World = await fetch(`${BASE}samples/${s.slug}.json`).then(r => r.json())
    show(w)
    history.replaceState(null, '', `?repo=${s.label}`)
  }

  async function generate(raw: string, list = samples) {
    const p = parseRepo(raw)
    if (!p) { setError('That doesn’t look like a GitHub repo. Try owner/name or a github.com link.'); return }
    const key = `${p.owner}/${p.repo}`.toLowerCase()
    const sample = list.find(s => s.label.toLowerCase() === key)
    if (sample) return loadSample(sample)
    const cached = store.get<{ at: number; world: World }>(`gq:world:${key}`)
    if (cached && cached.world.version === 2 && Date.now() - cached.at < DAY) { show(cached.world); history.replaceState(null, '', `?repo=${key}`); return }

    setError('')
    setSelected(null)
    setLoading([0, 0, 1])
    try {
      const w = await buildWorld(raw, (step, done, total) => setLoading([step, done, total]))
      store.set(`gq:world:${key}`, { at: Date.now(), world: w })
      show(w)
      history.replaceState(null, '', `?repo=${p.owner}/${p.repo}`)
      game.current!.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }

  function clear(b: Building) {
    const next = new Set(cleared).add(b.path)
    game.current!.cleared = next
    setCleared(next)
    setHearts(h => Math.min(HEARTS, h + 1))
    store.set(`gq:cleared:${repoKey(world!)}`, [...next])
    if (b.cls === 'Final boss') setToast(`${b.title} is defeated. You conquered ${world!.repo.owner}/${world!.repo.name}!`)
  }

  function hit(b: Building) {
    if (hearts > 1) { setHearts(hearts - 1); return }
    setSelected(null)
    setHearts(HEARTS)
    game.current!.respawn()
    setToast(`Knocked out by ${b.title}. Back to README Village.`)
  }

  const fighters = world ? world.districts.flatMap(d => d.buildings).filter(b => b.cls !== 'NPC') : []
  const bosses = fighters.filter(b => b.cls === 'Boss' || b.cls === 'Final boss')
  const selectedDistrict = selected && world?.districts.find(d => d.buildings.includes(selected))
  const current = world && `${world.repo.owner}/${world.repo.name}`.toLowerCase()

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>git<span>Quest</span></h1>
          <p className="tag">Paste a public GitHub repo and walk around it. Folders are districts, files are buildings, and the files everything imports are the bosses.</p>
        </div>
        <a className="gh" href="https://github.com/Anmol1377/gitQuest" target="_blank" rel="noreferrer">★ Star on GitHub</a>
      </header>

      <form className="gen" onSubmit={e => { e.preventDefault(); generate(input) }}>
        <input id="repo" value={input} onChange={e => setInput(e.target.value)} placeholder="github.com/owner/repo"
          aria-label="GitHub repository" spellCheck={false} autoComplete="off" />
        <button className="btn" type="submit" disabled={!!loading || !input.trim()}>GENERATE WORLD</button>
      </form>
      {samples.length > 0 && (
        <div className="demos">
          <span>Demo worlds:</span>
          {samples.map(s => (
            <button key={s.slug} aria-pressed={current === s.label.toLowerCase()} onClick={() => { setInput(s.label); loadSample(s) }}>{s.label}</button>
          ))}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="stage">
        <canvas ref={canvas} tabIndex={0} aria-label="Repository world. Move with WASD or arrow keys, press E to inspect a building." />
        {world && (
          <div className="hud">
            <b>{world.repo.owner}/{world.repo.name}{world.repo.stars ? `  ★ ${world.repo.stars.toLocaleString()}` : ''}</b>
            <span className="hearts" aria-label={`${hearts} of ${HEARTS} hearts`}>{'♥'.repeat(hearts)}<span>{'♥'.repeat(HEARTS - hearts)}</span></span>
            <span>{zone ? zone.label : 'On the road'}</span>
            <span>Bosses {bosses.filter(b => cleared.has(b.path)).length} / {bosses.length} · Cleared {fighters.filter(b => cleared.has(b.path)).length} / {fighters.length}</span>
            {finalBoss && (cleared.has(finalBoss.path)
              ? <span className="quest done">Quest complete</span>
              : <span className="quest">Quest: defeat {finalBoss.title}{finalDistrict ? ` in ${finalDistrict.label}` : ''}</span>)}
          </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
        {near && !selected && <div className="hint">E · inspect {near.label}</div>}
        {selected && selectedDistrict && world && (
          <Panel key={selected.path} b={selected} district={selectedDistrict} world={world}
            cleared={cleared.has(selected.path)} onClear={() => clear(selected)} onHit={() => hit(selected)} onClose={() => setSelected(null)} />
        )}
        {loading && (
          <div className="loading" aria-live="polite">
            {STEPS.map((label, i) => {
              const pct = i < loading[0] ? 100 : i > loading[0] ? 0 : (loading[1] / Math.max(1, loading[2])) * 100
              return (
                <div className="row" key={label}>
                  <span>{label}… <span className="count">{i === loading[0] && loading[2] > 1 ? `${loading[1]} / ${loading[2]}` : i < loading[0] ? 'done' : ''}</span></span>
                  <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="under">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to walk · click to walk there · <kbd>E</kbd> to inspect · click the minimap to travel</span>
        <span className="legend">
          <span><i className="sw" style={{ background: '#c9c2ae' }} />NPC</span>
          <span><i className="sw" style={{ background: '#8a93a6' }} />Enemy</span>
          <span><i className="sw" style={{ background: 'var(--accent)' }} />Mini boss</span>
          <span><i className="sw" style={{ background: 'var(--boss)' }} />Boss</span>
          <span><i className="sw" style={{ background: 'var(--hot)' }} />Hot</span>
          <span><i className="sw" style={{ background: 'var(--ghost)', opacity: .5 }} />Abandoned</span>
        </span>
      </div>
      {world && (
        <div className="under">
          <span>{world.stats.files.toLocaleString()} files · {world.stats.readFiles} read · {world.stats.links} import links · {world.stats.apiCalls} GitHub API calls</span>
          {world.stats.truncated && <span>Very large repo: only part of the file tree was loaded.</span>}
        </div>
      )}

      <footer>
        <span>gitQuest is open source under the MIT license. Made by Anmol.</span>
        <a href="https://github.com/Anmol1377/gitQuest" target="_blank" rel="noreferrer">github.com/Anmol1377/gitQuest</a>
      </footer>
    </div>
  )
}
