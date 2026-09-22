import { useEffect, useRef, useState } from 'react'
import { Game, bugKey, targetKey, type Target } from './game/world2d.ts'
import { buildWorld } from './lib/build.ts'
import { parseRepo } from './lib/github.ts'
import type { Building, District, World } from './lib/generate.ts'
import Panel from './components/Panel.tsx'
import Talk, { type TalkMemo } from './components/Talk.tsx'
import { BugPanel, GatePanel, BUG_HEAL, GATE_HEAL } from './components/Encounter.tsx'

type Sample = { slug: string; label: string; language: string }
const BASE = import.meta.env.BASE_URL
const STEPS = ['Listing files', 'Reading code and history', 'Generating world']
const DAY = 86_400_000
const MAX_HP = 100
const HEAL = 25 // restored for each building you clear

const store = {
  get<T>(k: string): T | null { try { return JSON.parse(localStorage.getItem(k) ?? 'null') } catch { return null } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* full or blocked */ } },
}
const repoKey = (w: World) => `${w.repo.owner}/${w.repo.name}`.toLowerCase()
const hintFor = (t: Target) =>
  t.kind === 'building' ? `E · inspect ${t.b.label}` : t.kind === 'char' ? `E · talk to ${t.c.login}`
    : t.kind === 'bug' ? `E · bug #${t.bug.number}` : `E · PR #${t.gate.number}`

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const canvas3d = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const game = useRef<Game | null>(null)
  const [full, setFull] = useState(false)
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [world, setWorld] = useState<World | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [input, setInput] = useState('')
  const [current, setCurrent] = useState('') // which demo button is lit
  const [loading, setLoading] = useState<number[] | null>(null) // [step, done, total]
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Target | null>(null)
  const [near, setNear] = useState<Target | null>(null)
  const [memos, setMemos] = useState<Record<string, TalkMemo>>({})
  const [zone, setZone] = useState<District | null>(null)
  const [cleared, setCleared] = useState<Set<string>>(new Set())
  const [hp, setHp] = useState(MAX_HP)
  const [toast, setToast] = useState('')

  const finalBoss = world?.districts.flatMap(d => d.buildings).find(b => b.cls === 'Final boss') ?? null
  const finalDistrict = finalBoss && world?.districts.find(d => d.buildings.includes(finalBoss))
  useEffect(() => { if (game.current) game.current.quest = finalBoss && !cleared.has(finalBoss.path) ? finalBoss : null }, [finalBoss, cleared])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])

  useEffect(() => {
    const g = new Game(canvas.current!, { open: openTarget, near: setNear, zone: setZone, fullscreen: toggleFull })
    const onFull = () => setFull(document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', onFull)
    game.current = g
    fetch(`${BASE}samples/index.json`).then(r => r.json()).then((list: Sample[]) => {
      setSamples(list)
      const asked = new URLSearchParams(location.search).get('repo')
      if (asked) { setInput(asked); generate(asked, list) }
      else if (list[0]) loadSample(list[0])
    }).catch(() => setError('Couldn’t load the demo worlds. Paste a repo above instead.'))
    const view = new URLSearchParams(location.search).get('view')
    if (view === '3d' || (view !== '2d' && store.get<string>('gq:mode') === '3d')) switchMode('3d')
    return () => { g.destroy(); document.removeEventListener('fullscreenchange', onFull) }
  }, [])

  function openTarget(t: Target | null) {
    setOpen(t)
    if (game.current) game.current.talking = t?.kind === 'char' ? t.c.login : null
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen()
    else stage.current?.requestFullscreen?.().catch(() => {})
    game.current?.focus()
  }

  // three.js loads only when someone asks for 3D
  async function switchMode(next: '2d' | '3d') {
    const g = game.current!
    if (next === '3d') {
      try {
        const { World3D } = await import('./game/world3d.ts')
        g.setView3D(new World3D(canvas3d.current!))
      } catch {
        setToast('3D isn’t available in this browser (WebGL is off). Staying in 2D.')
        return
      }
    } else g.setView3D(null)
    setMode(next)
    store.set('gq:mode', next)
    g.focus()
  }

  function show(w: World) {
    const c = new Set(store.get<string[]>(`gq:cleared:${repoKey(w)}`) ?? [])
    game.current!.cleared = c
    game.current!.setWorld(w)
    setCleared(c)
    openTarget(null)
    setMemos({})
    setHp(MAX_HP)
    setWorld(w)
  }

  async function loadSample(s: Sample) {
    setError('')
    const w: World = await fetch(`${BASE}samples/${s.slug}.json`).then(r => r.json())
    show(w)
    setCurrent(s.label.toLowerCase())
    history.replaceState(null, '', `?repo=${s.label}`)
  }

  async function generate(raw: string, list = samples) {
    const p = parseRepo(raw)
    if (!p) { setError('That doesn’t look like a GitHub repo. Try owner/name or a github.com link.'); return }
    const key = `${p.owner}/${p.repo}`.toLowerCase()
    const sample = list.find(s => s.label.toLowerCase() === key)
    if (sample) return loadSample(sample)
    const cached = store.get<{ at: number; world: World }>(`gq:world:${key}`)
    if (cached && cached.world.version === 3 && Date.now() - cached.at < DAY) { show(cached.world); history.replaceState(null, '', `?repo=${key}`); return }

    setError('')
    openTarget(null)
    setLoading([0, 0, 1])
    try {
      const w = await buildWorld(raw, (step, done, total) => setLoading([step, done, total]))
      store.set(`gq:world:${key}`, { at: Date.now(), world: w })
      show(w)
      setCurrent(key)
      history.replaceState(null, '', `?repo=${p.owner}/${p.repo}`)
      game.current!.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }

  function markCleared(key: string, heal: number) {
    const next = new Set(cleared).add(key)
    game.current!.cleared = next
    setCleared(next)
    setHp(h => Math.min(MAX_HP, h + heal))
    store.set(`gq:cleared:${repoKey(world!)}`, [...next])
  }

  function clearBuilding(b: Building) {
    markCleared(b.path, HEAL)
    if (b.cls === 'Final boss') setToast(`${b.title} is defeated. You conquered ${world!.repo.owner}/${world!.repo.name}!`)
  }

  function hit(by: string, damage: number) {
    if (hp - damage > 0) { setHp(hp - damage); return }
    setHp(0)
    setTimeout(() => {
      openTarget(null)
      setHp(MAX_HP)
      game.current!.respawn()
      setToast(`Knocked out by ${by}. Back to README Village.`)
    }, 1200)
  }

  const fighters = world ? world.districts.flatMap(d => d.buildings).filter(b => b.cls !== 'NPC') : []
  const bosses = fighters.filter(b => b.cls === 'Boss' || b.cls === 'Final boss')
  const bugsLeft = world ? world.bugs.filter(b => !cleared.has(bugKey(b))).length : 0

  function renderOpen() {
    if (!open || !world) return null
    if (open.kind === 'building') {
      const b = open.b, d = world.districts.find(d => d.buildings.includes(b))!
      return <Panel key={b.path} b={b} district={d} world={world} cleared={cleared.has(b.path)} playerHp={hp} maxHp={MAX_HP}
        onClear={() => clearBuilding(b)} onHit={n => hit(b.title, n)} onClose={() => openTarget(null)} />
    }
    if (open.kind === 'char') {
      const c = open.c
      return <Talk key={c.login} c={c} world={world} cleared={cleared} hp={hp} maxHp={MAX_HP}
        memo={memos[c.login] ?? {}} usedTips={Object.values(memos).flatMap(m => m.tipKey ?? [])} onMemo={m => setMemos(ms => ({ ...ms, [c.login]: m }))}
        onHeal={n => setHp(h => Math.min(MAX_HP, h + n))}
        onTravel={() => { game.current!.travelTo(c.homes[0]); openTarget(null) }} onClose={() => openTarget(null)} />
    }
    if (open.kind === 'bug') {
      const bug = open.bug
      return <BugPanel key={bugKey(bug)} bug={bug} world={world} squashed={cleared.has(bugKey(bug))}
        onSquash={() => markCleared(bugKey(bug), BUG_HEAL)} onHit={n => hit(`bug #${bug.number}`, n)} onClose={() => openTarget(null)} />
    }
    const gate = open.gate
    return <GatePanel key={targetKey(open)} gate={gate} world={world} used={cleared.has(targetKey(open))}
      onPass={() => markCleared(targetKey(open), GATE_HEAL)} onClose={() => openTarget(null)} />
  }

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

      <div className={`stage${mode === '3d' ? ' is3d' : ''}`} ref={stage}>
        <canvas ref={canvas3d} className="c3d" aria-hidden="true" />
        <canvas ref={canvas} tabIndex={0} aria-label="Repository world. Move with WASD or arrow keys, press E to interact." />
        {world && (
          <div className="hud">
            <b>{world.repo.owner}/{world.repo.name}{world.repo.stars ? `  ★ ${world.repo.stars.toLocaleString()}` : ''}</b>
            <span className={`php${hp <= 30 ? ' low' : ''}`}>HP {hp} / {MAX_HP}<i><b style={{ width: `${hp}%` }} /></i></span>
            <span>{zone ? zone.label : 'On the road'}</span>
            <span>Bosses {bosses.filter(b => cleared.has(b.path)).length} / {bosses.length} · Cleared {fighters.filter(b => cleared.has(b.path)).length} / {fighters.length}</span>
            {world.bugs.length > 0 && <span>Bugs left {bugsLeft} / {world.bugs.length}</span>}
            {finalBoss && (cleared.has(finalBoss.path)
              ? <span className="quest done">Quest complete</span>
              : <span className="quest">Quest: defeat {finalBoss.title}{finalDistrict ? ` in ${finalDistrict.label}` : ''}</span>)}
          </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
        <div className="corner">
          <button className="fs" onClick={() => switchMode(mode === '3d' ? '2d' : '3d')} aria-label={`Switch to ${mode === '3d' ? '2D' : '3D'} view`}>
            {mode === '3d' ? '▦ 2D view' : '◆ 3D view'}
          </button>
          {document.fullscreenEnabled && (
            <button className="fs" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? '⤡ Exit' : '⤢ Full screen'} <kbd>F</kbd></button>
          )}
        </div>
        {!open && near && <div className="hint">{hintFor(near)}</div>}
        {renderOpen()}
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
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to walk · click to walk there · <kbd>E</kbd> to interact · <kbd>F</kbd> full screen · click the minimap to travel</span>
        <span className="legend">
          <span><i className="sw" style={{ background: '#c9c2ae' }} />NPC</span>
          <span><i className="sw" style={{ background: '#8a93a6' }} />Enemy</span>
          <span><i className="sw" style={{ background: 'var(--accent)' }} />Mini boss</span>
          <span><i className="sw" style={{ background: 'var(--boss)' }} />Boss / bug</span>
          <span><i className="sw" style={{ background: 'var(--hot)' }} />Hot</span>
          <span><i className="sw" style={{ background: 'var(--ghost)', opacity: .5 }} />Abandoned</span>
          <span><i className="sw" style={{ background: 'var(--clear)' }} />Merged PR</span>
        </span>
      </div>
      {world && (
        <div className="under">
          <span>{world.stats.files.toLocaleString()} files · {world.stats.readFiles} read · {world.stats.links} import links · {world.bugs.length} bugs · {world.gates.length} PR gates · {world.stats.apiCalls} GitHub API calls</span>
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
