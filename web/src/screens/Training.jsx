import { useRef, useState } from 'react'
import { Award, ChevronRight, Flame, Gauge as GaugeIcon, HeartPulse, Mountain, Target, Thermometer, Timer, TrendingUp, Trophy } from 'lucide-react'
import { Columns, Gauge, LineChart } from '../charts/charts'
import { useApi, usePullToRefresh } from '../lib/hooks'
import { clock, dayLabel, distance, fromISO, isNum, n, pace, shortDate, todayISO } from '../lib/format'
import { Card, CardHead, CoachLink, ErrorBox, LoadingGrid, Num, Seg, Stat, StatusTag, useNav } from '../components/ui'
import { LoadFocus } from './widgets'
import { Header, PullIndicator } from './Today'

const STATUS_TONE = { Productive: 'good', Peaking: 'blue', Maintaining: 'neutral', Recovery: 'neutral', Unproductive: 'warn', Overreaching: 'bad', Strained: 'bad', Detraining: 'warn' }

function LoadCard({ t, daily }) {
  return (
    <Card className="span-2">
      <CardHead icon={TrendingUp} color="var(--c-load)" title="Acute load" right={t.acwr_status ? <StatusTag tone={t.acwr_status === 'Optimal' ? 'good' : 'warn'}>{t.acwr_status}</StatusTag> : null} />
      <div className="row row--end" style={{ gap: 18 }}>
        <Num value={t.acute_load ?? '—'} size="xl" />
        <div style={{ paddingBottom: 6 }} className="small">
          <div className="muted">Optimal range</div>
          <b style={{ fontWeight: 600 }}>{t.chronic_min ?? '—'}–{t.chronic_max ?? '—'}</b>
        </div>
        <div style={{ paddingBottom: 6 }} className="small">
          <div className="muted">Ratio</div>
          <b style={{ fontWeight: 600 }}>{n(t.acwr, 1)}</b>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Columns height={110} color="var(--c-load)" labelEvery={7} maxBar={10}
          data={daily.map((d, i) => ({ key: d.date, label: i % 7 === 0 ? shortDate(d.date) : '', value: d.value, title: dayLabel(d.date) }))}
          format={(v) => `${Math.round(v)} load`} />
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>Daily exercise load, last 4 weeks. Acute load is your weighted 7-day total; it should sit inside the optimal range.</p>
    </Card>
  )
}

function VolumeCard({ weeks }) {
  const [mode, setMode] = useState('run_km')
  const label = { run_km: 'km run', hours: 'hours', load: 'load' }[mode]
  return (
    <Card className="span-2">
      <CardHead icon={Timer} title="Weekly volume" />
      <Seg label="Measure" value={mode} onChange={setMode} options={[['run_km', 'Running'], ['hours', 'Hours'], ['load', 'Load']]} />
      <div style={{ marginTop: 14 }}>
        <Columns height={120} color={mode === 'run_km' ? 'var(--c-run)' : mode === 'hours' ? 'var(--c-sleep)' : 'var(--c-load)'} labelEvery={4}
          data={weeks.map((w) => ({ key: w.week_start, label: shortDate(w.week_start), value: w[mode], title: `Week of ${shortDate(w.week_start)}` }))}
          format={(v, tip) => (tip ? `${n(v, mode === 'load' ? 0 : 1)} ${label}` : n(v, 0))} highlight={weeks.length - 1}
          muted="color-mix(in srgb, currentColor 0%, var(--surface-3))" showValue />
      </div>
    </Card>
  )
}

function RacePredictions({ r }) {
  const rows = [['5K', r['5k'], 5], ['10K', r['10k'], 10], ['Half', r.half, 21.0975], ['Marathon', r.marathon, 42.195]]
  return (
    <Card className="span-2">
      <CardHead icon={Trophy} title="Race predictions" />
      <div className="stats stats--2" style={{ gap: '16px 10px' }}>
        {rows.map(([label, sec, km]) => (
          <div key={label}>
            <Num value={clock(sec)} size="m" />
            <div className="stat__l">{label} · {isNum(sec) ? pace(sec / km).value : '—'}{pace(1).unit}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Endurance({ e }) {
  const lo = e.levels[0]?.from ?? 0
  const hi = e.max || (e.levels.at(-1)?.from ?? lo) * 1.1
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`
  return (
    <Card className="span-2">
      <CardHead icon={GaugeIcon} color="var(--c-hrv)" title="Endurance score" right={e.level ? <span className="badge">{e.level}</span> : null} />
      <Num value={n(e.score)} size="xl" />
      <div style={{ position: 'relative', height: 10, borderRadius: 999, background: 'var(--surface-3)', margin: '16px 0 6px' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(e.score), background: 'var(--c-hrv)', borderRadius: 999 }} />
        {e.levels.slice(1).map((l) => <div key={l.label} style={{ position: 'absolute', left: pct(l.from), top: -2, bottom: -2, width: 2, background: 'var(--surface)' }} />)}
      </div>
      <div style={{ position: 'relative', height: 16 }} className="small muted">
        {e.levels.slice(1).filter((_, i) => i % 2 === 0).map((l) => <span key={l.label} style={{ position: 'absolute', left: pct(l.from), transform: 'translateX(-50%)', fontSize: 11 }}>{l.label}</span>)}
      </div>
    </Card>
  )
}

function HyroxSummary() {
  const nav = useNav()
  const { data } = useApi('/api/hyrox', { freshKey: false })
  if (!data?.sessions?.length) return null
  const last = data.sessions[0]
  const totals = [...data.sessions].reverse().map((s) => [s.start_ms, s.hyrox.total_s])
  return (
    <>
      <h2 className="section-title">HYROX <small>{data.sessions.length} sessions</small></h2>
      <Card tone="lime" onClick={() => nav.push('hyrox')} aria-label="HYROX history">
        <CardHead icon={Flame} title="Best full session" chevron />
        <Num value={clock(data.best_total_s)} size="xl" />
        <div className="stats" style={{ marginTop: 14 }}>
          <Stat value={clock(last.hyrox.total_s)} label={`Last · ${dayLabel(last.start_local, { short: true })}`} />
          <Stat value={last.hyrox.compromised ? `${n(last.hyrox.compromised.decay_pct, 1)}%` : '—'} label="Last run fade" />
          <Stat value={Object.keys(data.station_bests).length} label="Stations logged" />
        </div>
        {totals.length > 1 && (
          <div style={{ marginTop: 10, color: '#000' }}>
            <LineChart points={totals} color="#000" height={80} area={false} dots showAxis={false}
              formatY={(v) => clock(v)} formatX={(x) => new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              pad={{ top: 10, right: 50, bottom: 4, left: 4 }} yTicks={2} />
          </div>
        )}
      </Card>
    </>
  )
}

export default function Training() {
  const nav = useNav()
  const scrollRef = useRef(null)
  const { data, error, refresh, at, refreshing } = useApi(`/api/training?date=${todayISO()}`)
  const pull = usePullToRefresh(refresh, scrollRef)
  const t = data?.status
  return (
    <div className="scroller" ref={scrollRef}>
      <div className="wrap">
        <PullIndicator pull={pull} />
        <Header title="Training" at={at} refreshing={refreshing} />
        {error && !data && <ErrorBox error={error} onRetry={refresh} />}
        {!data && !error && <LoadingGrid />}
        {data && (
          <>
            <div className="bento">
              {t && (
                <Card size="hero" className="span-2">
                  <CardHead icon={TrendingUp} title="Training status" right={t.status ? <StatusTag tone={STATUS_TONE[t.status] || 'neutral'}>{t.feedback || t.status}</StatusTag> : null} />
                  <div className="word" style={{ fontSize: 48, margin: '4px 0 16px' }}>{t.status || 'No status'}</div>
                  <div className="stats">
                    <Stat value={n(t.vo2max, 1)} label="VO₂ max" />
                    <Stat value={t.acute_load ?? '—'} label="Acute load" />
                    <Stat value={t.fitness_age ?? data.fitness_age?.fitness_age ?? '—'} label="Fitness age" />
                  </div>
                </Card>
              )}
              {t && <LoadCard t={t} daily={data.daily_load} />}
              {t?.load_focus && (
                <Card className="span-2">
                  <CardHead icon={Target} color="var(--f-high)" title="4-week load focus" right={t.load_focus.feedback ? <span className="badge">{t.load_focus.feedback}</span> : null} />
                  <LoadFocus focus={t.load_focus} />
                  <p className="small muted" style={{ margin: '12px 0 0' }}>Outlined boxes are Garmin’s target range for each kind of load.</p>
                </Card>
              )}
              {data.vo2max_history?.length > 1 && (
                <Card className="span-2" onClick={() => nav.push('metric', { metric: 'vo2max' })}>
                  <CardHead icon={HeartPulse} color="var(--c-vo2)" title="VO₂ max" chevron />
                  <Num value={n(t?.vo2max ?? data.vo2max_history.at(-1).value, 1)} size="xl" />
                  <LineChart points={data.vo2max_history.map((p) => [fromISO(p.date).getTime(), p.value])} color="var(--c-vo2)" height={110}
                    formatY={(v) => n(v, 1)} formatX={(x) => new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                </Card>
              )}
              {data.race_predictions && <RacePredictions r={data.race_predictions} />}
              {data.readiness_28d?.length > 1 && (
                <Card className="span-2" onClick={() => nav.push('metric', { metric: 'readiness' })}>
                  <CardHead icon={GaugeIcon} color="var(--c-readiness)" title="Readiness, 4 weeks" chevron />
                  <Columns height={100} color="var(--c-readiness)" maxBar={8} labelEvery={7} yMax={100}
                    data={data.readiness_28d.map((p, i) => ({ key: p.date, label: i % 7 === 0 ? shortDate(p.date) : '', value: p.value, title: dayLabel(p.date) }))} />
                </Card>
              )}
              {data.endurance && <Endurance e={data.endurance} />}
              {data.hill && (
                <Card size="tile">
                  <CardHead icon={Mountain} title="Hill score" />
                  <Num value={data.hill.score} size="l" />
                  <div className="stat__l">Strength {data.hill.strength} · Endurance {data.hill.endurance}</div>
                </Card>
              )}
              {data.lactate_threshold && (
                <Card size="tile">
                  <CardHead icon={Thermometer} title="Lactate threshold" />
                  <Num value={data.lactate_threshold.heart_rate ?? '—'} unit="bpm" size="l" />
                  <div className="stat__l">{data.lactate_threshold.pace_s_km ? `${pace(data.lactate_threshold.pace_s_km).value}${pace(1).unit}` : ''}{data.lactate_threshold.power ? ` · ${data.lactate_threshold.power} W` : ''}</div>
                </Card>
              )}
              {t && isNum(t.heat_acclimation_pct) && (
                <Card size="tile">
                  <CardHead icon={Thermometer} title="Heat acclimation" />
                  <Num value={t.heat_acclimation_pct} unit="%" size="l" />
                  <div className="stat__l">{t.heat_trend}</div>
                </Card>
              )}
              {t && isNum(t.altitude_acclimation_m) && (
                <Card size="tile">
                  <CardHead icon={Mountain} title="Altitude acclimation" />
                  <Num value={n(t.altitude_acclimation_m)} unit="m" size="l" />
                  <div className="stat__l">{t.altitude_trend}</div>
                </Card>
              )}
              {data.weeks?.length > 0 && <VolumeCard weeks={data.weeks} />}
            </div>
            <HyroxSummary />
            {data.records?.length > 0 && (
              <>
                <h2 className="section-title">Personal records</h2>
                <div className="list">
                  {data.records.map((r, i) => (
                    <button key={i} type="button" className="list__row" onClick={() => r.activity_id && nav.push('activity', { id: r.activity_id })}>
                      <span className="list__icon"><Award size={17} /></span>
                      <span className="list__main"><span className="list__title">{r.label}</span><div className="list__sub">{r.date ? shortDate(r.date) : ''}{r.activity_name ? ` · ${r.activity_name}` : ''}</div></span>
                      <span className="list__value tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                        {r.kind === 'time' ? clock(r.value) : r.kind === 'distance' ? `${distance(r.value).value} ${distance(r.value).unit}` : n(r.value)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <CoachLink prompt="Look at my training status, load focus and weekly volume. What should I change in the next two weeks?">Ask the coach to review my training</CoachLink>
            <button type="button" className="btn btn--soft" style={{ marginTop: 10 }} onClick={() => nav.push('profile')}>Badges, gear and devices <ChevronRight size={18} /></button>
          </>
        )}
      </div>
    </div>
  )
}
