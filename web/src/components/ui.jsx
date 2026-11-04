import { createContext, useContext } from 'react'
import {
  Activity, Bike, ChevronLeft, ChevronRight, Dumbbell, Flame, Footprints, HeartPulse, Mountain, PersonStanding,
  RefreshCw, Waves, Wind, Layers, Sparkles,
} from 'lucide-react'

export const NavContext = createContext(null)
export const useNav = () => useContext(NavContext)

export function Card({ children, onClick, className = '', style, tone, size, as, ...rest }) {
  const cls = ['card', tone && `card--${tone}`, size && `card--${size}`, className].filter(Boolean).join(' ')
  if (onClick) {
    return <button type="button" className={cls} style={style} onClick={onClick} {...rest}>{children}</button>
  }
  const Tag = as || 'div'
  return <Tag className={cls} style={style} {...rest}>{children}</Tag>
}

export function CardHead({ icon: Icon, title, right, chevron, color }) {
  return (
    <div className="card__head">
      <span className="card__title">
        {Icon && <Icon size={16} strokeWidth={2.2} color={color} aria-hidden="true" />}
        {title}
      </span>
      <span className="row">
        {right}
        {chevron && <ChevronRight size={18} className="card__chev" aria-hidden="true" />}
      </span>
    </div>
  )
}

export function Num({ value, unit, size = 'm', className = '' }) {
  return (
    <span className={`num num-${size} ${className}`}>
      {value}{unit ? <span className="unit">{unit}</span> : null}
    </span>
  )
}

export function Stat({ value, unit, label }) {
  return (
    <div>
      <div className="stat__v">{value}{unit ? <span className="unit"> {unit}</span> : null}</div>
      <div className="stat__l">{label}</div>
    </div>
  )
}

export function Chip({ active, onClick, children, count }) {
  return (
    <button type="button" className="chip" aria-pressed={!!active} onClick={onClick}>
      {children}{count != null && <span className="chip__count">{count}</span>}
    </button>
  )
}

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{text}</button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
}

export function PageHead({ title, right }) {
  const nav = useNav()
  return (
    <div className="page-head">
      <button type="button" className="icon-btn icon-btn--ghost" onClick={nav.pop} aria-label="Back">
        <ChevronLeft size={26} />
      </button>
      <div className="page-head__title">{title}</div>
      {right || <span className="page-head__spacer" />}
    </div>
  )
}

export function Skeleton({ height = 120, span = 2, radius }) {
  return <div className={`skel ${span === 2 ? 'span-2' : ''}`} style={{ height, borderRadius: radius }} />
}

export function LoadingGrid() {
  return (
    <div className="bento" aria-busy="true" aria-label="Loading">
      <Skeleton height={250} />
      <Skeleton height={180} />
      <Skeleton height={150} span={1} />
      <Skeleton height={150} span={1} />
      <Skeleton height={150} span={1} />
      <Skeleton height={150} span={1} />
    </div>
  )
}

export function ErrorBox({ error, onRetry }) {
  const nav = useNav()
  const code = error?.code
  const title = {
    garmin_not_connected: 'Garmin isn’t connected yet',
    bad_key: 'The access key doesn’t match',
    no_access_key: 'The server needs an access key',
    garmin_rate_limited: 'Garmin asked us to slow down',
    offline: 'You’re offline',
  }[code] || 'Couldn’t load this'
  return (
    <div className="error">
      <h3>{title}</h3>
      <p className="lead" style={{ margin: '0 0 14px' }}>{error?.message || 'Something went wrong.'}</p>
      <div className="row">
        {onRetry && <button type="button" className="btn btn--soft" style={{ height: 42 }} onClick={onRetry}><RefreshCw size={16} />Try again</button>}
        {['garmin_not_connected', 'bad_key', 'no_access_key'].includes(code) && (
          <button type="button" className="btn" style={{ height: 42 }} onClick={() => nav.push('settings', { section: 'connection' })}>Open connection settings</button>
        )}
      </div>
    </div>
  )
}

export const GROUP_META = {
  run: { label: 'Run', icon: Footprints, color: 'var(--c-run)' },
  hyrox: { label: 'HYROX', icon: Flame, color: 'var(--c-station)' },
  ride: { label: 'Ride', icon: Bike, color: 'var(--c-battery)' },
  swim: { label: 'Swim', icon: Waves, color: 'var(--c-spo2)' },
  strength: { label: 'Strength', icon: Dumbbell, color: 'var(--c-sleep)' },
  cardio: { label: 'Cardio', icon: HeartPulse, color: 'var(--c-hr)' },
  walk: { label: 'Walk', icon: PersonStanding, color: 'var(--c-steps)' },
  mind: { label: 'Mind', icon: Wind, color: 'var(--c-resp)' },
  multi: { label: 'Multisport', icon: Layers, color: 'var(--c-intensity)' },
  other: { label: 'Other', icon: Activity, color: 'var(--ink-2)' },
}
export const groupMeta = (g) => GROUP_META[g] || GROUP_META.other

export function SportIcon({ group, size = 20, color }) {
  const M = groupMeta(group)
  const I = M.icon || Mountain
  return <I size={size} color={color || M.color} strokeWidth={2.1} aria-label={M.label} />
}

// Status labels always carry a dot + word, never colour alone.
export function StatusTag({ tone = 'good', children }) {
  const color = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', neutral: 'var(--ink-3)', blue: 'var(--c-readiness)' }[tone]
  return <span className="badge"><span className="status-dot" style={{ background: color }} />{children}</span>
}

export function CoachLink({ prompt, children = 'Ask the coach about this' }) {
  const nav = useNav()
  return (
    <button type="button" className="btn btn--soft" onClick={() => nav.ask(prompt)} style={{ marginTop: 14 }}>
      <Sparkles size={17} />{children}
    </button>
  )
}

// **bold**, bullet lists and paragraphs — enough markdown for coach replies.
export function RichText({ text }) {
  const blocks = (text || '').trim().split(/\n{2,}/)
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : part)
  return blocks.map((b, i) => {
    const lines = b.split('\n')
    if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), j)}</li>)}</ul>
    }
    return <p key={i}>{lines.map((l, j) => <span key={j}>{inline(l.replace(/^#+\s*/, ''), j)}{j < lines.length - 1 && <br />}</span>)}</p>
  })
}
