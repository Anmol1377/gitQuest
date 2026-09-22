import { useState } from 'react'
import type { Building, District, World } from '../lib/generate.ts'
import { CLS_COLOR } from '../game/world2d.ts'

type Props = {
  b: Building; district: District; world: World; cleared: boolean
  onClear: () => void; onHit: () => void; onClose: () => void
}

export default function Panel({ b, district, world, cleared, onClear, onHit, onClose }: Props) {
  const [fighting, setFighting] = useState(false)
  const [round, setRound] = useState(0)
  const [wrong, setWrong] = useState<number[]>([])
  const [right, setRight] = useState(false)
  const npc = b.cls === 'NPC'
  const quizzes = b.quizzes ?? []
  const q = quizzes[round]
  const color = cleared ? CLS_COLOR.cleared : CLS_COLOR[b.cls]
  const hpLeft = cleared ? 0 : Math.round(b.hp * (1 - (round + (right ? 1 : 0)) / Math.max(1, quizzes.length)))
  const reveal = cleared || npc
  const fileUrl = b.more ? null : `https://github.com/${world.repo.owner}/${world.repo.name}/blob/${world.repo.branch}/${b.path}`

  const answer = (i: number) => {
    if (i !== q.answer) { setWrong(w => [...w, i]); onHit(); return }
    setRight(true)
    setTimeout(() => {
      if (round + 1 >= quizzes.length) onClear()
      else { setRound(r => r + 1); setWrong([]); setRight(false) }
    }, 650)
  }

  return (
    <aside className="panel" aria-label={`${b.label} details`}>
      <button className="x" aria-label="Close" onClick={onClose}>×</button>
      <div className="cls" style={{ color }}>{cleared ? 'Defeated · ' : ''}{b.cls}</div>
      <div className="title">{b.title}</div>
      <h3>{b.more ? district.path : b.path}</h3>
      {!npc && (
        <div className="hp">
          <span>HP {hpLeft.toLocaleString()} / {b.hp.toLocaleString()}{quizzes.length > 1 && !cleared ? ` · ${quizzes.length} rounds` : ''}</span>
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
          {!reveal && <span className="src">Defeat it to reveal its stats.</span>}
          <button className="btn" disabled={cleared} onClick={() => setFighting(true)}>
            {npc ? 'TALK' : cleared ? 'CLEARED' : b.cls.endsWith('oss') ? 'ENTER DUNGEON' : 'FIGHT'}
          </button>
        </>
      ) : npc ? (
        <p className="talk">“{b.talk}”</p>
      ) : q && !cleared ? (
        <div className="quiz" key={round}>
          {quizzes.length > 1 && <span className="src">Round {round + 1} of {quizzes.length}</span>}
          <p>{q.q}</p>
          {q.options.map((o, i) => (
            <button key={i} disabled={right || wrong.includes(i)}
              className={right && i === q.answer ? 'right' : wrong.includes(i) ? 'wrong' : ''}
              onClick={() => answer(i)}>{o}</button>
          ))}
          <span className="src">{q.source} · a wrong answer costs a heart</span>
        </div>
      ) : null}
      {fileUrl && <a className="open" href={fileUrl} target="_blank" rel="noreferrer">Open on GitHub ↗</a>}
    </aside>
  )
}
