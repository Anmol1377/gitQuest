import { useState } from 'react'
import type { Character, World } from '../lib/generate.ts'

export type TalkMemo = { tip?: string; tipKey?: string; healed?: boolean }
type Props = {
  c: Character; world: World; cleared: Set<string>; hp: number; maxHp: number; memo: TalkMemo; usedTips: string[]
  onMemo: (m: TalkMemo) => void; onHeal: (amount: number) => void; onTravel: () => void; onClose: () => void
}

export const HEAL = 30
const RANK: Record<string, number> = { 'Final boss': 4, Boss: 3, 'Mini boss': 2, Enemy: 1 }

// The strongest question nobody has told you yet: strongest undefeated enemy first, preferring
// this person's districts, skipping any enemy + question another contributor already revealed.
function pickTip(c: Character, world: World, cleared: Set<string>, used: string[]) {
  const candidates = (ids?: string[]) => world.districts.filter(d => !ids || ids.includes(d.id))
    .flatMap(d => d.buildings.map(b => ({ b, d })))
    .filter(({ b }) => b.quizzes?.length && !cleared.has(b.path))
    .sort((x, y) => RANK[y.b.cls] - RANK[x.b.cls] || y.b.hp - x.b.hp)
  for (const list of [candidates(c.homes), candidates()])
    for (const { b, d } of list)
      for (let i = 0; i < b.quizzes!.length; i++)
        if (!used.includes(`${b.path}#${i}`)) return { b, d, i }
  return null
}

export default function Talk({ c, world, cleared, hp, maxHp, memo, usedTips, onMemo, onHeal, onTravel, onClose }: Props) {
  const [line, setLine] = useState(memo.tip ?? '')
  const districts = world.districts.filter(d => c.homes.includes(d.id))
  const home = districts[0]
  const where = districts.map(d => d.label).join(', ') || 'around here'

  const tip = () => {
    if (memo.tip) { setLine(memo.tip); return }
    const t = pickTip(c, world, cleared, usedTips)
    if (!t) { setLine('I’ve got nothing you haven’t heard. Go read some code.'); return }
    const q = t.b.quizzes![t.i] // question i comes up on turn i of the fight
    const when = t.i === 0 ? 'It asks that first' : `It asks that in round ${t.i + 1}`
    const text = `${t.b.title} (${t.b.label}, ${t.d.label}) will ask: ‘${q.q}’ The answer is ${q.options[q.answer]}. ${when}.`
    onMemo({ ...memo, tip: text, tipKey: `${t.b.path}#${t.i}` })
    setLine(text)
  }
  const heal = () => {
    if (memo.healed) { setLine('I already patched you up. Go find someone else.'); return }
    if (hp >= maxHp) { setLine('You look fine to me. Come back when you’re hurt.'); return }
    onHeal(HEAL)
    onMemo({ ...memo, healed: true })
    setLine(`There you go, +${HEAL} HP. Try not to fight the Final Boss without reading its code.`)
  }

  return (
    <aside className="panel talk-panel" aria-label={`Talking to ${c.login}`}>
      <button className="x" aria-label="Close" onClick={onClose}>×</button>
      <div className="who">
        <img src={`https://github.com/${c.login}.png?size=96`} alt="" width={48} height={48} />
        <div>
          <div className="title">{c.login}</div>
          <div className="src">{c.role} · {c.commits.toLocaleString()} commits</div>
        </div>
      </div>
      <p className="talk">“Hey, I’m {c.login}. I’ve made {c.commits.toLocaleString()} commits here, mostly in {where}.”</p>
      {line && <p className="talk reply" role="status">“{line}”</p>}
      <div className="options">
        <button onClick={tip}>{memo.tip ? 'What was that tip again?' : 'Any tips for the fights?'}</button>
        <button onClick={heal} disabled={memo.healed}>{memo.healed ? 'Patched up already' : `Patch me up (+${HEAL} HP)`}</button>
        {home && <button onClick={onTravel}>Show me where you work ({home.label})</button>}
        <a href={`https://github.com/${c.login}`} target="_blank" rel="noreferrer">View GitHub profile ↗</a>
      </div>
    </aside>
  )
}
