// Bug monsters (open issues) and gates (pull requests).
import { useState } from 'react'
import { hash, type Bug, type Gate, type Quiz, type World } from '../lib/generate.ts'
import { CodeView, fetchSource } from './Panel.tsx'

const BUG_DAMAGE = 10
export const BUG_HEAL = 10
export const GATE_HEAL = 10

const issueUrl = (w: World, n: number) => `https://github.com/${w.repo.owner}/${w.repo.name}/issues/${n}`
const pullUrl = (w: World, n: number) => `https://github.com/${w.repo.owner}/${w.repo.name}/pull/${n}`
const age = (d: number) => (d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`)

// A bug is squashed by answering a question about the file it's hiding in
// (or, if the issue doesn't name a file, any fighter in its district).
function bugQuestions(world: World, bug: Bug): { quizzes: Quiz[]; file: string | null } {
  const d = world.districts.find(d => d.id === bug.district)!
  const linked = d.buildings.find(b => b.path === bug.building && b.quizzes?.length)
  if (linked) return { quizzes: linked.quizzes!, file: linked.path }
  const pool = d.buildings.filter(b => b.quizzes?.length)
  const pickB = pool[hash(String(bug.number)) % Math.max(1, pool.length)]
  return { quizzes: pickB?.quizzes ?? [], file: pickB?.path ?? null }
}

type BugProps = { bug: World['bugs'][number]; world: World; squashed: boolean; onSquash: () => void; onHit: (n: number) => void; onClose: () => void }

export function BugPanel({ bug, world, squashed, onSquash, onHit, onClose }: BugProps) {
  const { quizzes, file } = bugQuestions(world, bug)
  const [fighting, setFighting] = useState(false)
  const [turn, setTurn] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [log, setLog] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const q = quizzes[(hash(String(bug.number)) + turn) % Math.max(1, quizzes.length)]
  const district = world.districts.find(d => d.id === bug.district)!

  const answer = (i: number) => {
    setPicked(i)
    if (i === q.answer) { setLog(`Squashed! +${BUG_HEAL} HP.`); setTimeout(onSquash, 800) }
    else {
      setLog(`The bug bites you for ${BUG_DAMAGE}.`)
      onHit(BUG_DAMAGE)
      setTimeout(() => { setTurn(t => t + 1); setPicked(null); setLog('') }, 1400)
    }
  }

  return (
    <aside className="panel" aria-label={`Bug ${bug.number}`}>
      <button className="x" aria-label="Close" onClick={onClose}>×</button>
      <div className="cls" style={{ color: squashed ? 'var(--clear)' : 'var(--boss)' }}>{squashed ? 'Squashed · ' : ''}Bug #{bug.number}</div>
      <div className="title">{bug.title}</div>
      <span className="src">Open {age(bug.ageDays)} · {bug.comments} comment{bug.comments === 1 ? '' : 's'}{bug.user ? ` · reported by ${bug.user}` : ''}</span>
      {bug.labels.length > 0 && <div className="chips">{bug.labels.slice(0, 5).map(l => <span className="chip" key={l}>{l}</span>)}</div>}
      <p className="talk">
        {file ? <>It’s hiding in <b>{file.split('/').pop()}</b>, {district.label}. </> : <>It’s crawling around {district.label}. </>}
        {bug.building ? 'The issue mentions that file.' : 'Nobody’s sure which file it lives in.'}
      </p>

      {squashed ? (
        <span className="src">Squashed in the game. The real issue is still open, so you could go fix it for real.</span>
      ) : !fighting ? (
        <>
          <span className="src">Squash it by answering a question about {file ? file.split('/').pop() : 'this district'}. It bites for {BUG_DAMAGE}.</span>
          {file && <button className="btn ghost" onClick={async () => { setCode(''); setCode(await fetchSource(world, file)) }}>READ {file.split('/').pop()!.toUpperCase()}</button>}
          <button className="btn" disabled={!q} onClick={() => setFighting(true)}>SQUASH</button>
          {code != null && file && <CodeView text={code} path={file} fight="SQUASH" onClose={() => setCode(null)} onFight={() => { setCode(null); setFighting(true) }} />}
        </>
      ) : q ? (
        <div className={`quiz${picked != null && picked !== q.answer ? ' hurt' : ''}`} key={turn}>
          <p>{q.q}</p>
          {q.options.map((o, i) => (
            <button key={i} disabled={picked != null} className={picked != null && i === q.answer ? 'right' : picked === i ? 'wrong' : ''} onClick={() => answer(i)}>{o}</button>
          ))}
          {log ? <span className={`log${picked === q.answer ? ' good' : ''}`} role="status">{log}</span> : <span className="src">{q.source}</span>}
        </div>
      ) : null}
      <a className="open" href={issueUrl(world, bug.number)} target="_blank" rel="noreferrer">Help fix it on GitHub ↗</a>
    </aside>
  )
}

type GateProps = { gate: Gate; world: World; used: boolean; onPass: () => void; onClose: () => void }

export function GatePanel({ gate, world, used, onPass, onClose }: GateProps) {
  const merged = gate.state === 'merged'
  const district = world.districts.find(d => d.id === gate.district)!
  return (
    <aside className="panel" aria-label={`Pull request ${gate.number}`}>
      <button className="x" aria-label="Close" onClick={onClose}>×</button>
      <div className="cls" style={{ color: merged ? 'var(--clear)' : 'var(--boss)' }}>{merged ? 'Open gate' : 'Locked gate'} · PR #{gate.number}</div>
      <div className="title">{gate.title}</div>
      <span className="src">{merged ? `Merged ${age(gate.ageDays)} ago` : `Open for ${age(gate.ageDays)}`}{gate.user ? ` · by ${gate.user}` : ''}</span>
      <p className="talk">
        {merged
          ? `This change made it in. The gate into ${district.label} is up.`
          : `Locked until this pull request is merged. Someone has to review it first.`}
        {gate.building ? ` It touches ${gate.building.split('/').pop()}.` : ''}
      </p>
      {merged && (
        <button className="btn" disabled={used} onClick={onPass}>{used ? 'ALREADY CELEBRATED' : `CELEBRATE THE MERGE (+${GATE_HEAL} HP)`}</button>
      )}
      <a className="open" href={pullUrl(world, gate.number)} target="_blank" rel="noreferrer">{merged ? 'See the change on GitHub ↗' : 'Review it on GitHub ↗'}</a>
    </aside>
  )
}
