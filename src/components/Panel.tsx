import { useState } from 'react'
import type { Building, District, World } from '../lib/generate.ts'
import { CLS_COLOR } from '../game/world2d.ts'

type Props = { b: Building; district: District; world: World; cleared: boolean; onClear: () => void; onClose: () => void }

export default function Panel({ b, district, world, cleared, onClear, onClose }: Props) {
  const [mode, setMode] = useState<'info' | 'act'>('info')
  const [wrong, setWrong] = useState<number[]>([])
  const [right, setRight] = useState(false)
  const npc = b.cls === 'NPC'
  const color = cleared ? CLS_COLOR.cleared : CLS_COLOR[b.cls]
  const fileUrl = b.more ? null : `https://github.com/${world.repo.owner}/${world.repo.name}/blob/${world.repo.branch}/${b.path}`

  const answer = (i: number) => {
    if (i === b.quiz!.answer) { setRight(true); setTimeout(onClear, 600) }
    else setWrong(w => [...w, i])
  }

  return (
    <aside className="panel" aria-label={`${b.name} details`}>
      <button className="x" aria-label="Close" onClick={onClose}>×</button>
      <div className="cls" style={{ color }}>{cleared ? 'Defeated · ' : ''}{b.cls}</div>
      <div className="title">{b.title}</div>
      <h3>{b.more ? `${district.path} · ${b.more} files` : b.path}</h3>
      {!npc && (
        <div className="hp">
          <span>HP {(cleared ? 0 : b.hp).toLocaleString()} / {b.hp.toLocaleString()}</span>
          <div className="bar"><i style={{ width: cleared ? '0%' : '100%' }} /></div>
        </div>
      )}
      <dl className="stats">
        <div><dt>Imported by</dt><dd>{b.deps}</dd></div>
        <div><dt>Imports</dt><dd>{b.imports.length}</dd></div>
        <div><dt>Lines</dt><dd>{b.lines.toLocaleString()}</dd></div>
        <div><dt>District</dt><dd style={{ fontSize: 14 }}>{district.label}</dd></div>
      </dl>
      <div className="chips">
        {b.hot && <span className="chip hot">Hot zone</span>}
        {b.ghost && <span className="chip ghost">Abandoned</span>}
        {cleared && <span className="chip clear">Cleared</span>}
        {b.abilities.map(a => <span className="chip" key={a}>{a}</span>)}
      </div>

      {mode === 'info' ? (
        <button className="btn" disabled={cleared} onClick={() => setMode('act')}>
          {npc ? 'TALK' : cleared ? 'CLEARED' : b.cls.endsWith('oss') ? 'ENTER DUNGEON' : 'FIGHT'}
        </button>
      ) : npc ? (
        <p className="talk">“{b.talk}”</p>
      ) : (
        <div className="quiz">
          <p>{b.quiz!.q}</p>
          {b.quiz!.options.map((o, i) => (
            <button key={i} disabled={right || wrong.includes(i)}
              className={right && i === b.quiz!.answer ? 'right' : wrong.includes(i) ? 'wrong' : ''}
              onClick={() => answer(i)}>{o}</button>
          ))}
          <span className="src">{b.quiz!.source}</span>
        </div>
      )}
      {fileUrl && <a className="open" href={fileUrl} target="_blank" rel="noreferrer">Open on GitHub ↗</a>}
    </aside>
  )
}
