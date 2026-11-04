import { useMemo, useState } from 'react'
import { Dumbbell, Flame } from 'lucide-react'
import { BodyMap, LevelLegend } from '../charts/muscleMap'
import { useApi } from '../lib/hooks'
import { dayLabel, fromISO, n, shortDate, todayISO } from '../lib/format'
import { LEVELS, MUSCLE_GROUPS, MUSCLE_LABELS, levelFor, levelsFrom, weekTotals } from '../lib/muscles'
import { useSettings } from '../lib/settings'
import { Card, CardHead, CoachLink, ErrorBox, PageHead, Skeleton, Switch, useNav } from '../components/ui'

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function DayPicker({ week, value, onChange, includeHyrox }) {
  const today = todayISO()
  return (
    <div className="days" role="group" aria-label="Show the week up to">
      {week.days.map((d, i) => {
        const has = d.sessions.some((s) => includeHyrox || s.kind !== 'hyrox')
        const future = d.date > today
        return (
          <button key={d.date} type="button" className="day" aria-pressed={value === i} disabled={future}
            aria-label={`${dayLabel(d.date)}${has ? ', trained' : ''}`}
            onClick={(e) => { e.stopPropagation(); onChange(i) }}>
            {DAY_LETTERS[i]}
            <span className={`day__dot ${has ? 'day__dot--on' : ''}`} />
          </button>
        )
      })}
    </div>
  )
}

function MuscleBars({ totals, worked }) {
  const max = Math.max(worked, ...Object.values(totals))
  return (
    <div className="stack" style={{ gap: 14 }}>
      {MUSCLE_GROUPS.map(([group, keys]) => (
        <div key={group}>
          <div className="small muted" style={{ marginBottom: 6 }}>{group}</div>
          <div className="stack" style={{ gap: 7 }}>
            {keys.map((k) => {
              const v = totals[k] || 0
              const lvl = levelFor(v, worked)
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 46px', alignItems: 'center', gap: 10 }} className="small">
                  <span>{MUSCLE_LABELS[k]}</span>
                  <div style={{ position: 'relative', height: 8, borderRadius: 999, background: 'var(--surface-3)' }}>
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999, width: `${Math.min(100, (v / max) * 100)}%`, background: LEVELS[lvl].color }} />
                    <span style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${(worked / max) * 100}%`, background: 'var(--ink-3)', borderRadius: 1 }} aria-hidden="true" />
                  </div>
                  <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{v ? n(v, v % 1 ? 1 : 0) : '—'}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <div className="small muted">Hard sets this week. The tick marks {worked} sets, where a muscle counts as worked.</div>
    </div>
  )
}

function Summary({ totals, worked }) {
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
  const untouched = Object.keys(MUSCLE_LABELS).filter((k) => !totals[k])
  return (
    <div className="stack" style={{ gap: 6, marginTop: 12 }}>
      {sorted.length > 0 && (
        <div className="small"><span className="muted">Most worked </span>
          {sorted.slice(0, 3).map(([k, v], i) => <span key={k}>{i ? ' · ' : ''}<b style={{ fontWeight: 600 }}>{MUSCLE_LABELS[k]}</b> {n(v, v % 1 ? 1 : 0)}</span>)}
        </div>
      )}
      <div className="small"><span className="muted">Still to train </span>
        {untouched.length ? untouched.map((k) => MUSCLE_LABELS[k]).join(', ') : 'nothing — every muscle has had work'}
      </div>
    </div>
  )
}

function useWeek() {
  const { settings } = useSettings()
  const res = useApi(`/api/muscles?date=${todayISO()}`)
  const todayIndex = res.data ? Math.max(0, res.data.days.findIndex((d) => d.date === todayISO())) : 6
  return { ...res, todayIndex, worked: settings.strength.worked, includeHyrox: settings.strength.hyrox }
}

/** Today card. */
export function MusclesWidget({ cfg }) {
  const nav = useNav()
  const { data, error, todayIndex, worked, includeHyrox } = useWeek()
  const [pick, setPick] = useState(null)
  const upto = pick ?? todayIndex
  const { totals, sessions } = useMemo(() => weekTotals(data, upto, includeHyrox), [data, upto, includeHyrox])
  if (error && !data) return null
  if (!data) return <Skeleton height={420} />
  const range = `${shortDate(data.week_start)} – ${shortDate(data.week_end)}`
  return (
    <Card className="span-2" onClick={() => nav.push('muscles')} aria-label="Muscles this week">
      <CardHead icon={Dumbbell} title="Muscles this week" chevron right={<span className="small muted">{range}</span>} />
      <DayPicker week={data} value={upto} onChange={setPick} includeHyrox={includeHyrox} />
      {cfg.style === 'list' ? <MuscleBars totals={totals} worked={worked} /> : (
        <>
          <BodyMap levels={levelsFrom(totals, worked)} height={250} />
          <LevelLegend worked={worked} />
        </>
      )}
      <Summary totals={totals} worked={worked} />
      {sessions.length === 0 && <p className="small muted" style={{ margin: '8px 0 0' }}>No strength sessions yet this week. It resets every Monday.</p>}
    </Card>
  )
}

/** Full page. */
export default function MusclesPage() {
  const nav = useNav()
  const { settings, update } = useSettings()
  const { data, error, refresh, todayIndex, worked, includeHyrox } = useWeek()
  const [pick, setPick] = useState(null)
  const upto = pick ?? todayIndex
  const { totals, sessions } = useMemo(() => weekTotals(data, upto, includeHyrox), [data, upto, includeHyrox])
  return (
    <div className="scroller">
      <div className="wrap">
        <PageHead title="Muscles this week" />
        {error && !data && <ErrorBox error={error} onRetry={refresh} />}
        {!data && !error && <div className="stack"><Skeleton height={460} /><Skeleton height={300} /></div>}
        {data && (
          <div className="stack">
            <Card>
              <div className="row row--between" style={{ marginBottom: 10 }}>
                <span className="small muted">{dayLabel(data.week_start)} to {dayLabel(data.days[upto].date)}</span>
                <span className="small muted">Resets Monday</span>
              </div>
              <DayPicker week={data} value={upto} onChange={setPick} includeHyrox={includeHyrox} />
              <BodyMap levels={levelsFrom(totals, worked)} height={330} gap={24} />
              <LevelLegend worked={worked} />
              <Summary totals={totals} worked={worked} />
            </Card>
            <Card>
              <CardHead icon={Dumbbell} title="Sets per muscle" />
              <MuscleBars totals={totals} worked={worked} />
            </Card>
            <div className="list">
              <div className="list__row">
                <span className="list__main"><span className="list__title">Count HYROX stations</span>
                  <div className="list__sub">Sled push, lunges, wall balls and the rest add to your legs, back and shoulders</div></span>
                <Switch checked={includeHyrox} label="Count HYROX stations" onChange={(v) => update((s) => ({ ...s, strength: { ...s.strength, hyrox: v } }))} />
              </div>
              <div className="list__row">
                <span className="list__main"><span className="list__title">Worked at</span><div className="list__sub">Hard sets in a week before a muscle turns red</div></span>
                <div className="seg" role="group" aria-label="Sets for worked">
                  {[6, 8, 10, 12].map((v) => (
                    <button key={v} type="button" aria-pressed={settings.strength.worked === v}
                      onClick={() => update((s) => ({ ...s, strength: { ...s.strength, worked: v } }))}>{v}</button>
                  ))}
                </div>
              </div>
            </div>
            <h2 className="section-title" style={{ marginTop: 14 }}>Sessions <small>{sessions.length}</small></h2>
            {sessions.length === 0 && <Card><p className="lead" style={{ margin: 0 }}>No strength sessions logged this week yet. Garmin records the sets when you use a Strength activity on your watch.</p></Card>}
            {sessions.map((s) => {
              const top = Object.entries(s.muscles).sort((a, b) => b[1] - a[1]).slice(0, 4)
              return (
                <Card key={s.id} onClick={() => nav.push('activity', { id: s.id })}>
                  <div className="row" style={{ gap: 12 }}>
                    <div className="act__thumb" style={{ width: 44, height: 44, background: s.kind === 'hyrox' ? 'var(--lime)' : undefined }}>
                      {s.kind === 'hyrox' ? <Flame size={20} color="#000" /> : <Dumbbell size={20} color="var(--c-sleep)" />}
                    </div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }} className="ellipsis">{s.name}</div>
                      <div className="small muted">{dayLabel(s.date)} · {s.time}</div>
                    </div>
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {top.map(([k, v]) => (
                      <span key={k} className="badge"><span className="status-dot" style={{ background: LEVELS[levelFor(v, worked)].color }} />{MUSCLE_LABELS[k]} {n(v, v % 1 ? 1 : 0)}</span>
                    ))}
                  </div>
                </Card>
              )
            })}
            {data.unmapped?.length > 0 && (
              <p className="small muted" style={{ margin: '4px 4px 0' }}>Not counted (exercise not recognised): {data.unmapped.join(', ')}.</p>
            )}
            <p className="lead" style={{ margin: '10px 4px 0' }}>
              Each set counts fully for the muscles an exercise targets and half for the ones that assist. Exercises come from what your watch logged; fix any wrong ones in Garmin Connect and they update here.
            </p>
            <CoachLink prompt={`Look at my muscle load this week (get_muscle_load) and my readiness. What should I train in my next session, given ${fromISO(todayISO()).toLocaleDateString('en-GB', { weekday: 'long' })} is today?`}>
              Ask the coach what to train next
            </CoachLink>
          </div>
        )}
      </div>
    </div>
  )
}

export function SessionMuscles({ muscles }) {
  const worked = 4
  return (
    <Card>
      <CardHead icon={Dumbbell} title="Muscles worked" />
      <BodyMap levels={levelsFrom(muscles, worked)} height={230} />
      <LevelLegend worked={worked} />
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 12, justifyContent: 'center' }}>
        {Object.entries(muscles).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
          <span key={k} className="badge"><span className="status-dot" style={{ background: LEVELS[levelFor(v, worked)].color }} />{MUSCLE_LABELS[k]} {n(v, v % 1 ? 1 : 0)}</span>
        ))}
      </div>
    </Card>
  )
}
