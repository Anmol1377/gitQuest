import { useState } from 'react'
import type { Building, District, World } from '../lib/generate.ts'
import { CLS_COLOR } from '../game/world2d.ts'

type Props = {
  b: Building; district: District; world: World; cleared: boolean; playerHp: number; maxHp: number
  onClear: () => void; onHit: (damage: number) => void; onClose: () => void
}

// Damage a fighter deals you for each wrong answer.
export const DAMAGE: Record<string, number> = { Enemy: 10, 'Mini boss': 15, Boss: 25, 'Final boss': 34 }

export default function Panel({ b, district, world, cleared, playerHp, maxHp, onClear, onHit, onClose }: Props) {
  const [fighting, setFighting] = useState(false)
  const [turn, setTurn] = useState(0)          // questions asked so far; questions cycle
  const [hits, setHits] = useState(0)          // correct answers landed
  const [picked, setPicked] = useState<number | null>(null)
  const [log, setLog] = useState('')
  const [code, setCode] = useState<string | null>(null) // null: closed, '' : loading
  const npc = b.cls === 'NPC'
  const quizzes = b.quizzes ?? []
  const need = quizzes.length                  // correct answers needed to win
  const q = quizzes[turn % Math.max(1, need)]
  const color = cleared ? CLS_COLOR.cleared : CLS_COLOR[b.cls]
  const hpLeft = cleared ? 0 : Math.round(b.hp * (1 - hits / Math.max(1, need)))
  const damage = DAMAGE[b.cls] ?? 10
  const reveal = cleared || npc
  const fileUrl = b.more ? null : `https://github.com/${world.repo.owner}/${world.repo.name}/blob/${world.repo.branch}/${b.path}`

  // Study the real file before the fight. Same no-API sources the world was built from.
  const readCode = async () => {
    setCode('')
    const { owner, name, branch } = world.repo
    const file = b.path.split('/').map(encodeURIComponent).join('/')
    for (const url of [`https://cdn.jsdelivr.net/gh/${owner}/${name}@${branch}/${file}`, `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${file}`]) {
      const text = await fetch(url).then(r => (r.ok ? r.text() : null)).catch(() => null)
      if (text != null) { setCode(text); return }
    }
    setCode('// Couldn\u2019t load this file. Try "Open on GitHub" below.')
  }

  // Every answer is one exchange: right, you hit it; wrong, it hits you. Then the next question.
  const answer = (i: number) => {
    setPicked(i)
    if (i === q.answer) {
      const landed = hits + 1
      setHits(landed)
      setLog(landed >= need ? `${b.title} falls!` : `You hit ${b.title} for ${Math.round(b.hp / need).toLocaleString()}.`)
      setTimeout(() => { if (landed >= need) onClear(); else { setTurn(t => t + 1); setPicked(null); setLog('') } }, 800)
    } else {
      setLog(`${b.title} hits you for ${damage}.`)
      onHit(damage)
      setTimeout(() => { setTurn(t => t + 1); setPicked(null); setLog('') }, 1400)
    }
  }

  return (
    <aside className="panel" aria-label={`${b.label} details`}>
      <button className="x" aria-label="Close" onClick={onClose}>×</button>
      <div className="cls" style={{ color }}>{cleared ? 'Defeated · ' : ''}{b.cls}</div>
      <div className="title">{b.title}</div>
      <h3>{b.more ? district.path : b.path}</h3>
      {!npc && (
        <div className="hp">
          <span>HP {hpLeft.toLocaleString()} / {b.hp.toLocaleString()}{!cleared ? ` · ${need} hit${need > 1 ? 's' : ''} to win · hits for ${damage}` : ''}</span>
          <div className="bar"><i style={{ width: `${(hpLeft / b.hp) * 100}%` }} /></div>
        </div>
      )}
      {b.more ? (
        <dl className="stats">
          <div><dt>Files</dt><dd>{b.more}</dd></div>
          <div><dt>Lines in total</dt><dd>{b.lines.toLocaleString()}</dd></div>
        </dl>
      ) : (
        <dl className="stats">
          <div><dt>Imported by</dt><dd>{reveal ? b.deps : '???'}</dd></div>
          <div><dt>Imports</dt><dd>{reveal ? b.imports.length : '???'}</dd></div>
          <div><dt>Lines</dt><dd>{reveal ? b.lines.toLocaleString() : '???'}</dd></div>
          <div><dt>District</dt><dd style={{ fontSize: 14 }}>{district.label}</dd></div>
        </dl>
      )}
      <div className="chips">
        {b.hot && <span className="chip hot">Hot zone</span>}
        {b.ghost && <span className="chip ghost">Abandoned</span>}
        {cleared && <span className="chip clear">Cleared</span>}
        {b.abilities.map(a => <span className="chip" key={a}>{a}</span>)}
      </div>

      {!fighting ? (
        <>
          {!npc && !cleared && (
            <span className="src">Every question is answered by this file. Read it first: once the fight starts, the code closes.</span>
          )}
          {!b.more && !cleared && (code == null
            ? <button className="btn ghost" onClick={readCode}>{npc ? 'READ THE FILE' : 'READ THE CODE'}</button>
            : <CodeView text={code} />)}
          <button className="btn" disabled={cleared} onClick={() => { setFighting(true); setCode(null) }}>
            {npc ? 'TALK' : cleared ? 'CLEARED' : b.cls.endsWith('oss') ? 'ENTER DUNGEON' : 'FIGHT'}
          </button>
        </>
      ) : npc ? (
        <p className="talk">“{b.talk}”</p>
      ) : q && !cleared ? (
        <div className={`quiz${picked != null && picked !== q.answer ? ' hurt' : ''}`} key={turn}>
          <div className="you">
            <span>You · HP {playerHp} / {maxHp}</span>
            <div className="bar"><i style={{ width: `${(playerHp / maxHp) * 100}%` }} /></div>
          </div>
          <span className="src">Turn {turn + 1} · {hits} / {need} hits landed</span>
          <p>{q.q}</p>
          {q.options.map((o, i) => (
            <button key={i} disabled={picked != null}
              className={picked != null && i === q.answer ? 'right' : picked === i ? 'wrong' : ''}
              onClick={() => answer(i)}>{o}</button>
          ))}
          {log ? <span className={`log${picked === q.answer ? ' good' : ''}`} role="status">{log}</span> : <span className="src">{q.source}</span>}
        </div>
      ) : null}
      {fileUrl && <a className="open" href={fileUrl} target="_blank" rel="noreferrer">Open on GitHub ↗</a>}
    </aside>
  )
}

const KEY_LINE = /^\s*(import\b|export\b|from\s+\S+\s+import\b|package\b|func\s|def\s|class\s|function\s|const\s+\w+\s*=\s*require\()|require\(/

function CodeView({ text }: { text: string }) {
  if (!text) return <div className="code loading">Reading the scroll…</div>
  const lines = text.replace(/\n$/, '').split('\n')
  const shown = lines.slice(0, 2000)
  return (
    <div className="code" tabIndex={0} aria-label="File source">
      <div className="code-head">{lines.length.toLocaleString()} lines{lines.length > shown.length ? ' · first 2,000 shown' : ''}</div>
      <pre>{shown.map((l, i) => (
        <div key={i} className={KEY_LINE.test(l) ? 'key' : undefined}><span>{i + 1}</span>{l || ' '}</div>
      ))}</pre>
    </div>
  )
}
