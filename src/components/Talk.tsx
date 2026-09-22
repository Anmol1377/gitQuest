import { useState } from 'react'
import type { Building, Character, World } from '../lib/generate.ts'

export type TalkMemo = { tip?: string; healed?: boolean }
type Props = {
  c: Character; world: World; cleared: Set<string>; hp: number; maxHp: number; memo: TalkMemo
  onMemo: (m: TalkMemo) => void; onHeal: (amount: number) => void; onTravel: () => void; onClose: () => void
}

export const HEAL = 30
const RANK: Record<string, number> = { 'Final boss': 4, Boss: 3, 'Mini boss': 2, Enemy: 1 }

// The strongest enemy you haven't beaten, preferring the districts this person works in.
function tipTarget(c: Character, world: World, cleared: Set<string>) {
  const open = (ids?: string[]) => world.districts.filter(d => !ids || ids.includes(d.id))
    .flatMap(d => d.buildings.map(b => [b, d] as const))
    .filter(([b]) => b.quizzes?.length && !cleared.has(b.path))
    .sort(([a], [b]) => RANK[b.cls] - RANK[a.cls] || b.hp - a.hp)
  return open(c.homes)[0] ?? open()[0]
}

export default function Talk({ c, world, cleared, hp, maxHp, memo, onMemo, onHeal, onTravel, onClose }: Props) {
  const [line, setLine] = useState(memo.tip ?? '')
  const districts = world.districts.filter(d => c.homes.includes(d.id))
  const home = districts[0]
  const where = districts.map(d => d.label).join(', ') || 'around here'

  const tip = () => {
    if (memo.tip) { setLine(memo.tip); return }
    const t = tipTarget(c, world, cleared)
    if (!t) { setLine('You’ve beaten everything I know about. Nothing left to tell.'); return }
    const [b, d]: readonly [Building, typeof home] = t
    const q = b.quizzes![0] // the first question it asks in a fight
    const text = `About ${b.label} in ${d.label}: “${q.q}” It’s ${q.options[q.answer]}. That’s the first thing it’ll ask you.`
    onMemo({ ...memo, tip: text })
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
