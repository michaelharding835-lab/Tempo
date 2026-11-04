import { BODY_BACK, BODY_FRONT } from './bodyPaths'
import { LEVELS, MUSCLE_LABELS } from '../lib/muscles'

// Which of our muscle keys each outline region shows. A region with several keys takes
// the highest level among them (the back outline draws lats inside "upper-back").
const FRONT_KEYS = {
  chest: ['chest'], obliques: ['obliques'], abs: ['abs'], biceps: ['biceps'], triceps: ['triceps'],
  trapezius: ['traps'], deltoids: ['frontDelts'], adductors: ['quads'], quadriceps: ['quads'],
  calves: ['calves'], forearm: ['forearms'],
}
const BACK_KEYS = {
  trapezius: ['traps'], deltoids: ['rearDelts'], 'upper-back': ['upperBack', 'lats'], triceps: ['triceps'],
  'lower-back': ['lowerBack'], forearm: ['forearms'], gluteal: ['glutes'], adductors: ['hamstrings'],
  hamstring: ['hamstrings'], calves: ['calves'],
}

function Figure({ parts, keys, levels, viewBox, height, label }) {
  return (
    <svg viewBox={viewBox} height={height} width={height / 2} role="img" aria-label={label} style={{ overflow: 'visible' }}>
      {parts.map((part) => {
        const ks = keys[part.slug]
        const level = ks ? Math.max(...ks.map((k) => levels[k] || 0)) : null
        const fill = level == null ? 'var(--m-body)' : LEVELS[level].color
        return (
          <g key={part.slug} fill={fill} style={{ transition: 'fill 0.45s ease' }}>
            {part.paths.map((d, i) => <path key={i} d={d} />)}
          </g>
        )
      })}
    </svg>
  )
}

/** Front and back body with each muscle coloured by its level (0–3). */
export function BodyMap({ levels = {}, height = 250, gap = 18 }) {
  const worked = Object.entries(levels).filter(([, v]) => v === 3).map(([k]) => MUSCLE_LABELS[k])
  const front = `Front of body. Worked: ${worked.join(', ') || 'none yet'}.`
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap }}>
      <Figure parts={BODY_FRONT} keys={FRONT_KEYS} levels={levels} viewBox="0 0 724 1448" height={height} label={front} />
      <Figure parts={BODY_BACK} keys={BACK_KEYS} levels={levels} viewBox="724 0 724 1448" height={height} label="Back of body" />
    </div>
  )
}

export function LevelLegend({ worked }) {
  return (
    <div className="legend" style={{ justifyContent: 'center' }}>
      {LEVELS.map((l) => (
        <span key={l.key} className="legend__item">
          <span className="legend__key" style={{ background: l.color, borderRadius: '50%' }} />
          {l.label}{l.key === 3 ? ` (${worked}+ sets)` : ''}
        </span>
      ))}
    </div>
  )
}
