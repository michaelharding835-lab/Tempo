// Every card on the Today screen. Each one reads the day bundle and its own settings
// (size: full | half, style: one of WIDGETS[id].styles).
import {
  Battery, Calendar, Droplet, Flame, Footprints, Gauge as GaugeIcon, HeartPulse, Moon, Mountain, Scale,
  Timer, TrendingUp, Wind, Zap, Activity, Target, Trophy,
} from 'lucide-react'
import { BandMeter, Columns, Gauge, Hypnogram, LineChart, RangeBars, Ring, StackBar, STAGE_COLORS } from '../charts/charts'
import { RouteShape } from '../charts/map'
import { clock, compact, dayLabel, relDay, distance, fromISO, hm, isNum, localTime, n, pace, timeOf, todayISO, weekday, weight } from '../lib/format'
import { useSettings } from '../lib/settings'
import { Card, CardHead, Num, SportIcon, Stat, StatusTag, groupMeta, useNav } from '../components/ui'

const levelTone = (level) => ({ Prime: 'blue', High: 'good', Moderate: 'warn', Low: 'bad', Poor: 'bad' }[level] || 'neutral')
const span = (cfg) => (cfg.size === 'full' ? 'span-2' : '')
const dayXTicks = (points) => {
  if (!points?.length) return []
  const t0 = points[0][0]
  const out = []
  for (const h of [0, 6, 12, 18]) {
    const d = new Date(t0); d.setHours(h, 0, 0, 0)
    if (d.getTime() >= t0 - 1 && d.getTime() <= points.at(-1)[0]) out.push({ x: d.getTime(), label: `${String(h).padStart(2, '0')}:00` })
  }
  return out
}
const timeFmt = (t) => timeOf(t)
// Average a long timeline into n buckets so small tiles read as a trend, not noise.
function thin(points = [], buckets = 40) {
  const pts = points.filter((p) => isNum(p[1]))
  if (pts.length <= buckets) return pts
  const size = pts.length / buckets
  const out = []
  for (let i = 0; i < buckets; i++) {
    const chunk = pts.slice(Math.floor(i * size), Math.floor((i + 1) * size))
    if (chunk.length) out.push([chunk[Math.floor(chunk.length / 2)][0], chunk.reduce((a, p) => a + p[1], 0) / chunk.length])
  }
  return out
}

function NoData({ cfg, icon, title, children = 'No data for this day yet.' }) {
  return (
    <Card size="tile" className={span(cfg)}>
      <CardHead icon={icon} title={title} />
      <div className="muted small">{children}</div>
    </Card>
  )
}

// ---------------------------------------------------------------- readiness (hero)

export function ReadinessWidget({ data, cfg }) {
  const { settings } = useSettings()
  const nav = useNav()
  const r = data.readiness
  if (!r) return <NoData cfg={cfg} icon={GaugeIcon} title="Training readiness">Readiness appears after your watch syncs this morning.</NoData>
  const tone = { black: 'hero', blue: 'blue', lime: 'lime' }[settings.hero] || 'hero'
  const onDark = tone !== 'lime'
  const accent = tone === 'hero' ? 'var(--lime)' : tone === 'blue' ? 'var(--lime)' : '#000'
  const track = onDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'
  const factors = [
    ['Sleep', r.factors?.sleep], ['Recovery', r.factors?.recovery], ['HRV', r.factors?.hrv],
    ['Load', r.factors?.load], ['Stress', r.factors?.stress], ['Sleep history', r.factors?.sleep_history],
  ].filter(([, f]) => f)
  return (
    <Card tone={tone} className="span-2" onClick={() => nav.push('metric', { metric: 'readiness' })} aria-label={`Training readiness ${r.score}, ${r.level}`}>
      <CardHead icon={GaugeIcon} title="Training readiness" right={<StatusTag tone={levelTone(r.level)}>{r.level}</StatusTag>} />
      {cfg.style === 'number' ? (
        <div className="row row--end" style={{ gap: 16, marginTop: 4 }}>
          <span className="num num-hero">{r.score}</span>
          <div style={{ paddingBottom: 6 }}>
            <div className="word" style={{ fontSize: 26 }}>{r.level}</div>
            {isNum(r.recovery_min) && r.recovery_min > 0 && <div className="small" style={{ opacity: 0.7 }}>{hm(r.recovery_min * 60)} to full recovery</div>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', margin: '2px 0 -6px' }}>
          <Gauge value={r.score} size={214} thickness={16} color={accent} track={track} marks={[25, 50, 75, 95]}
            markColor={tone === 'hero' ? 'var(--hero)' : tone === 'blue' ? 'var(--blue)' : 'var(--lime)'}>
            <div style={{ textAlign: 'center', marginTop: 18 }}>
              <div className="num num-hero" style={{ fontSize: 76 }}>{r.score}</div>
              {isNum(r.recovery_min) && r.recovery_min > 0
                ? <div className="small" style={{ opacity: 0.66, marginTop: 6 }}>{hm(r.recovery_min * 60)} recovery left</div>
                : <div className="small" style={{ opacity: 0.66, marginTop: 6 }}>Fully recovered</div>}
            </div>
          </Gauge>
        </div>
      )}
      <p className="lead" style={{ margin: '10px 0 14px', color: 'inherit', opacity: 0.85 }}>{r.message || r.headline}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
        {factors.map(([label, f]) => (
          <div key={label}>
            <div className="row row--between small" style={{ marginBottom: 5 }}>
              <span style={{ opacity: 0.72 }}>{label}</span><span style={{ fontWeight: 600 }}>{f.pct}%</span>
            </div>
            <div className="meter" style={{ height: 5, background: track }}>
              <span style={{ width: `${Math.min(100, f.pct)}%`, background: accent }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- latest session (blue) + HYROX (lime)

function activityStats(a) {
  const d = distance(a.distance_m)
  const out = []
  if (a.distance_m) out.push([d.value, d.unit, 'Distance'])
  out.push([clock(a.duration_s), '', 'Time'])
  if (a.avg_pace_s_km) { const p = pace(a.avg_pace_s_km); out.push([p.value, p.unit, 'Avg pace']) }
  else if (a.group === 'ride' && a.avg_speed) out.push([n(a.avg_speed * 3.6, 1), 'km/h', 'Avg speed'])
  if (a.avg_hr) out.push([a.avg_hr, 'bpm', 'Avg HR'])
  if (a.group === 'strength' && a.sets) out.push([a.sets, '', 'Sets'])
  if (a.training_load) out.push([a.training_load, '', 'Load'])
  return out.slice(0, 3)
}

export function LatestWidget({ data, cfg }) {
  const nav = useNav()
  const a = data.latest_activity
  if (!a) return <NoData cfg={cfg} icon={Activity} title="Latest session">No activities in the last two weeks.</NoData>
  if (a.is_hyrox && a.hyrox) return <HyroxCard a={a} cfg={{ ...cfg, style: 'splits' }} />
  const big = a.distance_m ? distance(a.distance_m) : { value: clock(a.duration_s), unit: '' }
  const showMap = cfg.style === 'map' && a.route_preview
  return (
    <Card tone="blue" className="span-2" onClick={() => nav.push('activity', { id: a.id })} aria-label={`Latest session: ${a.name}`}>
      <CardHead icon={groupMeta(a.group).icon} title={`${dayLabel(a.start_local)} · ${localTime(a.start_local)}`} chevron />
      <div className="row" style={{ alignItems: 'stretch', gap: 14 }}>
        <div className="grow">
          <div style={{ fontSize: 19, fontWeight: 500, marginBottom: 10 }} className="ellipsis">{a.name}</div>
          <Num value={big.value} unit={big.unit} size="xl" />
        </div>
        {showMap && (
          <div style={{ width: 128, height: 92, display: 'grid', placeItems: 'center' }}>
            <RouteShape route={a.route_preview} width={128} height={92} color="#fff" stroke={2.6} />
          </div>
        )}
      </div>
      <div className="divider" style={{ background: 'rgba(255,255,255,0.18)' }} />
      <div className="stats">
        {activityStats(a).map(([v, u, l]) => <Stat key={l} value={v} unit={u} label={l} />)}
      </div>
      {a.te_label && (
        <div className="row" style={{ marginTop: 14, gap: 6, flexWrap: 'wrap' }}>
          <span className="badge">{a.te_label}</span>
          {isNum(a.te_aerobic) && <span className="badge">Aerobic {n(a.te_aerobic, 1)}</span>}
          {isNum(a.te_anaerobic) && <span className="badge">Anaerobic {n(a.te_anaerobic, 1)}</span>}
        </div>
      )}
    </Card>
  )
}

export function HyroxSequence({ seq, height = 26, runColor = '#000', stationColor = 'rgba(0,0,0,0.28)' }) {
  const total = seq.reduce((s, x) => s + x.duration_s, 0) || 1
  return (
    <div style={{ display: 'flex', gap: 2, height }} role="img" aria-label="Runs and stations in order">
      {seq.map((x, i) => (
        <div key={i} title={`${x.label} ${clock(x.duration_s)}`} style={{
          width: `${(x.duration_s / total) * 100}%`, borderRadius: 4,
          background: x.kind === 'run' ? runColor : stationColor,
        }} />
      ))}
    </div>
  )
}

export function HyroxCard({ a, cfg }) {
  const nav = useNav()
  const h = a.hyrox
  const c = h.compromised
  const fastest = Math.min(...h.runs.map((r) => r.pace_s_km || Infinity))
  return (
    <Card tone="lime" className="span-2" onClick={() => nav.push('activity', { id: a.id })} aria-label={`HYROX session ${a.name}`}>
      <CardHead icon={Flame} title={`HYROX · ${dayLabel(a.start_local)}`} chevron />
      <div style={{ fontSize: 19, fontWeight: 500 }} className="ellipsis">{a.name}</div>
      <div className="row row--end row--between" style={{ margin: '8px 0 14px' }}>
        <Num value={clock(h.total_s)} size="xl" />
        <div style={{ textAlign: 'right', paddingBottom: 4 }}>
          <div className="small" style={{ opacity: 0.66 }}>Runs {Math.round(h.run_total_s / h.total_s * 100)}%</div>
          <div className="small" style={{ opacity: 0.66 }}>{h.complete ? 'Full race format' : `${h.runs.length} runs · ${h.stations.length} stations`}</div>
        </div>
      </div>
      {cfg.style === 'sequence' ? (
        <>
          <HyroxSequence seq={h.sequence} />
          <div className="legend" style={{ color: 'inherit' }}>
            <span className="legend__item"><span className="legend__key" style={{ background: '#000' }} />Runs {clock(h.run_total_s)}</span>
            <span className="legend__item"><span className="legend__key" style={{ background: 'rgba(0,0,0,0.28)' }} />Stations {clock(h.station_total_s)}</span>
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, alignItems: 'end', height: 76 }} role="img" aria-label="Run pace by lap">
          {h.runs.map((r) => {
            const k = r.pace_s_km ? fastest / r.pace_s_km : 0
            return (
              <div key={r.n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600 }}>{r.pace_s_km ? clock(r.pace_s_km) : '—'}</span>
                <div style={{ width: '70%', maxWidth: 22, height: `${Math.max(12, (k ** 6) * 46)}px`, background: '#000', borderRadius: '4px 4px 0 0' }} />
              </div>
            )
          })}
        </div>
      )}
      <div className="divider" style={{ background: 'rgba(0,0,0,0.12)' }} />
      <div className="stats">
        <Stat value={c ? `${c.decay_pct > 0 ? '+' : ''}${n(c.decay_pct, 1)}` : '—'} unit="%" label="Run fade" />
        <Stat value={clock(h.station_total_s)} label="Stations" />
        <Stat value={h.longest_station?.replace('Burpee Broad Jumps', 'Burpees') || '—'} label="Longest station" />
      </div>
    </Card>
  )
}

export function HyroxWidget({ data, cfg }) {
  const a = data.hyrox_recent
  if (!a?.hyrox) return null
  if (data.latest_activity?.id === a.id) return null // already shown as the latest session
  return <HyroxCard a={a} cfg={cfg} />
}

export function RaceWidget({ cfg }) {
  const { settings } = useSettings()
  const nav = useNav()
  const r = settings.hyrox
  if (!r.raceDate) {
    return (
      <Card size="tile" className={span(cfg)} onClick={() => nav.push('settings', { section: 'hyrox' })}>
        <CardHead icon={Trophy} title="Race countdown" chevron />
        <div className="muted small">Add your next race date to count down to it.</div>
      </Card>
    )
  }
  const days = Math.round((fromISO(r.raceDate) - fromISO(todayISO())) / 86400000)
  return (
    <Card size="tile" className={span(cfg)} onClick={() => nav.push('settings', { section: 'hyrox' })}>
      <CardHead icon={Trophy} title={r.raceName || 'Next race'} />
      <Num value={days >= 0 ? days : 0} unit={days === 1 ? 'day' : 'days'} size={cfg.size === 'full' ? 'xl' : 'l'} />
      <div className="small muted" style={{ marginTop: 6 }}>
        {fromISO(r.raceDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
        {r.target ? ` · target ${r.target}` : ''}{r.division ? ` · ${r.division}` : ''}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- sleep

export function SleepWidget({ data, cfg }) {
  const nav = useNav()
  const s = data.sleep
  if (!s) return <NoData cfg={cfg} icon={Moon} title="Sleep" />
  const full = cfg.size === 'full'
  const parts = [
    { key: 'deep', label: 'Deep', value: s.deep_s, color: STAGE_COLORS.deep },
    { key: 'light', label: 'Light', value: s.light_s, color: STAGE_COLORS.light },
    { key: 'rem', label: 'REM', value: s.rem_s, color: STAGE_COLORS.rem },
    { key: 'awake', label: 'Awake', value: s.awake_s, color: STAGE_COLORS.awake },
  ]
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'sleep', date: data.date })}>
      <CardHead icon={Moon} color="var(--c-sleep)" title="Sleep" chevron={full} right={full && s.quality ? <span className="badge">{s.quality}</span> : null} />
      <div className="row row--end" style={{ gap: 14, marginBottom: full ? 12 : 8 }}>
        <Num value={s.score ?? '—'} size={full ? 'xl' : 'l'} />
        <div style={{ paddingBottom: 4 }}>
          <div style={{ fontSize: full ? 18 : 15, fontWeight: 500 }}>{hm(s.duration_s)}</div>
          {full && <div className="small muted">{timeOf(s.start_ms)} – {timeOf(s.end_ms)}</div>}
        </div>
      </div>
      {full && cfg.style === 'stages' && s.stages?.length > 0 && <Hypnogram stages={s.stages} start={s.start_ms} end={s.end_ms} height={140} formatTime={timeFmt} />}
      {(cfg.style === 'bar' || !full) && <StackBar parts={parts} legend={full} format={hm} height={full ? 12 : 8} />}
      {full && cfg.style === 'week' && (
        <Columns height={110} color="var(--c-sleep)" format={(v) => `${n(v, 1)} h`}
          data={data.week.map((w, i) => ({ key: w.date, label: weekday(w.date).slice(0, 2), value: w.sleep_h, title: dayLabel(w.date) }))}
          highlight={6} muted="color-mix(in srgb, var(--c-sleep) 35%, transparent)" />
      )}
      {full && s.feedback && <p className="small muted" style={{ margin: '10px 0 0' }}>{s.feedback}.</p>}
    </Card>
  )
}

// ---------------------------------------------------------------- body battery

export function BodyBatteryWidget({ data, cfg }) {
  const nav = useNav()
  const b = data.body_battery
  if (!b) return <NoData cfg={cfg} icon={Battery} title="Body Battery" />
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'body_battery', date: data.date })}>
      <CardHead icon={Zap} color="var(--c-battery)" title="Body Battery" chevron={full} />
      {cfg.style === 'ring' ? (
        <div className="row" style={{ gap: 14 }}>
          <Ring value={b.current} max={100} color="var(--c-battery)" size={full ? 110 : 86} thickness={full ? 12 : 9}>
            <span className="num num-m">{b.current ?? '—'}</span>
          </Ring>
          <div className="small">
            <div><span className="muted">Charged</span> +{b.charged ?? '—'}</div>
            <div><span className="muted">Drained</span> −{b.drained ?? '—'}</div>
            <div><span className="muted">High</span> {b.high ?? '—'}</div>
          </div>
        </div>
      ) : (
        <>
          <div className="row row--between row--end">
            <Num value={b.current ?? '—'} size={full ? 'xl' : 'l'} />
            <div className="small muted" style={{ textAlign: 'right' }}>+{b.charged ?? '—'} / −{b.drained ?? '—'}</div>
          </div>
          <LineChart points={b.timeline} color="var(--c-battery)" height={full ? 120 : 64} yMin={0} yMax={100}
            showAxis={full} xTicks={dayXTicks(b.timeline)} formatX={timeFmt} endDot pad={full ? undefined : { top: 6, right: 4, bottom: 4, left: 0 }} />
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- HRV

const hrvTone = (s) => ({ Balanced: 'good', Unbalanced: 'warn', Low: 'bad', Poor: 'bad' }[s] || 'neutral')

export function HrvWidget({ data, cfg }) {
  const nav = useNav()
  const h = data.hrv
  if (!h) return <NoData cfg={cfg} icon={HeartPulse} title="HRV status" />
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'hrv', date: data.date })}>
      <CardHead icon={Activity} color="var(--c-hrv)" title="HRV" chevron={full} right={full && h.status ? <StatusTag tone={hrvTone(h.status)}>{h.status}</StatusTag> : null} />
      <Num value={h.last_night ?? '—'} unit="ms" size={full ? 'xl' : 'l'} />
      {!full && h.status && <div className="small" style={{ margin: '6px 0 8px' }}><StatusTag tone={hrvTone(h.status)}>{h.status}</StatusTag></div>}
      {cfg.style === 'gauge' ? (
        <HrvRange h={h} />
      ) : (
        <Columns height={full ? 100 : 54} color="var(--c-hrv)" showLabels={full}
          data={data.week.map((w) => ({ key: w.date, label: weekday(w.date).slice(0, 2), value: w.hrv, title: dayLabel(w.date) }))}
          format={(v) => `${Math.round(v)} ms`} highlight={6} muted="color-mix(in srgb, var(--c-hrv) 35%, transparent)" />
      )}
      {full && <div className="small muted" style={{ marginTop: 8 }}>7-day average {h.weekly_avg ?? '—'} ms · balanced {h.baseline_low}–{h.baseline_high} ms</div>}
    </Card>
  )
}

function HrvRange({ h }) {
  const lo = Math.min(h.low_upper || h.baseline_low || 40, h.last_night || 100) - 10
  const hi = Math.max(h.baseline_high || 100, h.last_night || 0) + 10
  const pos = (v) => `${((v - lo) / (hi - lo)) * 100}%`
  return (
    <div style={{ position: 'relative', height: 30, marginTop: 10 }} role="img" aria-label={`Last night ${h.last_night} ms, balanced range ${h.baseline_low} to ${h.baseline_high}`}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 8, borderRadius: 999, background: 'var(--surface-3)' }} />
      <div style={{ position: 'absolute', top: 8, height: 8, left: pos(h.baseline_low), width: `calc(${pos(h.baseline_high)} - ${pos(h.baseline_low)})`, background: 'color-mix(in srgb, var(--c-hrv) 40%, transparent)', borderRadius: 999 }} />
      {isNum(h.weekly_avg) && <div style={{ position: 'absolute', top: 4, left: pos(h.weekly_avg), width: 3, height: 16, marginLeft: -1.5, background: 'var(--ink)', borderRadius: 2 }} />}
      {isNum(h.last_night) && <div style={{ position: 'absolute', top: 6, left: pos(h.last_night), width: 12, height: 12, marginLeft: -6, borderRadius: '50%', background: 'var(--c-hrv)', border: '2px solid var(--surface)' }} />}
    </div>
  )
}

// ---------------------------------------------------------------- stress / heart rate

export function StressWidget({ data, cfg }) {
  const nav = useNav()
  const s = data.stress
  if (!s) return <NoData cfg={cfg} icon={Wind} title="Stress" />
  const full = cfg.size === 'full'
  const word = s.avg == null ? '' : s.avg <= 25 ? 'Resting' : s.avg <= 50 ? 'Low' : s.avg <= 75 ? 'Medium' : 'High'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'stress', date: data.date })}>
      <CardHead icon={Wind} color="var(--c-stress)" title="Stress" chevron={full} />
      <div className="row row--end" style={{ gap: 10 }}>
        <Num value={s.avg ?? '—'} size={full ? 'xl' : 'l'} />
        <span className="small muted" style={{ paddingBottom: 4 }}>{word}</span>
      </div>
      {cfg.style === 'split' ? (
        <div style={{ marginTop: 10 }}>
          <StackBar legend={full} format={hm} height={full ? 12 : 8} parts={[
            { key: 'rest', label: 'Rest', value: s.rest_s, color: 'var(--c-battery)' },
            { key: 'low', label: 'Low', value: s.low_s, color: 'var(--s-awake)' },
            { key: 'med', label: 'Medium', value: s.medium_s, color: 'var(--c-stress)' },
            { key: 'high', label: 'High', value: s.high_s, color: 'var(--s-rem)' },
          ]} />
        </div>
      ) : (
        <LineChart points={thin(s.timeline, full ? 110 : 40)} color="var(--c-stress)" height={full ? 120 : 64} yMin={0} yMax={100} area
          showAxis={full} xTicks={dayXTicks(s.timeline)} formatX={timeFmt} gap={20 * 60000} endDot={false}
          pad={full ? undefined : { top: 6, right: 4, bottom: 4, left: 0 }} strokeWidth={1.6} />
      )}
    </Card>
  )
}

export function HeartRateWidget({ data, cfg }) {
  const nav = useNav()
  const h = data.heart_rate
  if (!h) return <NoData cfg={cfg} icon={HeartPulse} title="Heart rate" />
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'heart_rate', date: data.date })}>
      <CardHead icon={HeartPulse} color="var(--c-hr)" title="Resting HR" chevron={full} />
      <div className="row row--end row--between">
        <Num value={h.resting ?? '—'} unit="bpm" size={full ? 'xl' : 'l'} />
        {full && <span className="small muted">{h.min}–{h.max} bpm today · 7-day {h.resting_7d}</span>}
      </div>
      {cfg.style === 'bars' && full ? (
        <RangeBars points={h.timeline} height={130} />
      ) : (
        <LineChart points={full ? h.timeline : thin(h.timeline, 48)} color="var(--c-hr)" height={full ? 120 : 64} showAxis={full}
          xTicks={dayXTicks(h.timeline)} formatX={timeFmt} formatY={(v, tip) => (tip ? `${Math.round(v)} bpm` : Math.round(v))} gap={20 * 60000}
          pad={full ? undefined : { top: 6, right: 4, bottom: 4, left: 0 }} strokeWidth={1.6} endDot={false} />
      )}
      {!full && <div className="small muted" style={{ marginTop: 6 }}>{h.min}–{h.max} bpm</div>}
    </Card>
  )
}

// ---------------------------------------------------------------- activity totals

export function StepsWidget({ data, cfg }) {
  const nav = useNav()
  const t = data.totals
  const full = cfg.size === 'full'
  if (!isNum(t.steps)) return <NoData cfg={cfg} icon={Footprints} title="Steps" />
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'steps', date: data.date })}>
      <CardHead icon={Footprints} color="var(--c-steps)" title="Steps" chevron={full} />
      {cfg.style === 'week' ? (
        <>
          <Num value={compact(t.steps)} size={full ? 'xl' : 'l'} />
          <Columns height={full ? 110 : 58} color="var(--c-steps)" goal={t.steps_goal} showLabels={full}
            data={data.week.map((w) => ({ key: w.date, label: weekday(w.date).slice(0, 2), value: w.steps, title: dayLabel(w.date) }))}
            format={(v) => n(v)} highlight={6} muted="color-mix(in srgb, var(--c-steps) 35%, transparent)" />
        </>
      ) : (
        <div className="row" style={{ gap: 12, justifyContent: full ? 'flex-start' : 'center' }}>
          <Ring value={t.steps} max={t.steps_goal || 10000} size={full ? 110 : 96} thickness={full ? 12 : 10}>
            <div>
              <div className="num num-s">{compact(t.steps)}</div>
              <div className="small muted">of {compact(t.steps_goal)}</div>
            </div>
          </Ring>
          {full && (
            <div className="stats stats--2 grow">
              <Stat value={distance(t.distance_m).value} unit={distance(t.distance_m).unit} label="Distance" />
              <Stat value={t.floors_up ?? '—'} label="Floors up" />
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export function IntensityWidget({ data, cfg }) {
  const nav = useNav()
  const t = data.totals
  const today = (t.intensity_moderate || 0) + 2 * (t.intensity_vigorous || 0)
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'intensity', date: data.date })}>
      <CardHead icon={Flame} color="var(--c-intensity)" title="Intensity min" chevron={full} />
      <Num value={today} unit="today" size={full ? 'xl' : 'l'} />
      <div style={{ marginTop: 12 }}>
        <StackBar legend={full} height={8} format={(v) => `${v} min`} parts={[
          { key: 'mod', label: 'Moderate', value: t.intensity_moderate, color: 'color-mix(in srgb, var(--c-intensity) 55%, var(--surface))' },
          { key: 'vig', label: 'Vigorous ×2', value: 2 * (t.intensity_vigorous || 0), color: 'var(--c-intensity)' },
        ]} />
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>Weekly goal {t.intensity_goal || 150} min</div>
    </Card>
  )
}

export function CaloriesWidget({ data, cfg }) {
  const t = data.totals
  if (!isNum(t.calories_total)) return null
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)}>
      <CardHead icon={Flame} color="var(--c-cal)" title="Calories" />
      <Num value={n(t.calories_total)} unit="kcal" size={full ? 'xl' : 'l'} />
      <div style={{ marginTop: 12 }}>
        <StackBar legend height={8} format={(v) => n(v)} parts={[
          { key: 'active', label: 'Active', value: t.calories_active, color: 'var(--c-cal)' },
          { key: 'rest', label: 'Resting', value: t.calories_bmr, color: 'color-mix(in srgb, var(--c-cal) 35%, var(--surface))' },
        ]} />
      </div>
    </Card>
  )
}

export function RespirationWidget({ data, cfg }) {
  const nav = useNav()
  const r = data.respiration
  if (!r) return null
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'respiration', date: data.date })}>
      <CardHead icon={Wind} color="var(--c-resp)" title="Respiration" />
      <Num value={n(r.waking, 1)} unit="brpm" size={full ? 'xl' : 'l'} />
      <LineChart points={r.timeline} color="var(--c-resp)" height={full ? 100 : 54} showAxis={full} xTicks={dayXTicks(r.timeline)}
        formatX={timeFmt} pad={full ? undefined : { top: 6, right: 4, bottom: 4, left: 0 }} strokeWidth={1.6} endDot={false} />
      <div className="small muted" style={{ marginTop: 6 }}>Asleep {n(r.sleeping, 1)} brpm</div>
    </Card>
  )
}

export function Spo2Widget({ data, cfg }) {
  const s = data.spo2
  if (!s) return null
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)}>
      <CardHead icon={Droplet} color="var(--c-spo2)" title="Pulse Ox" />
      <Num value={s.avg} unit="%" size={full ? 'xl' : 'l'} />
      <div className="small muted" style={{ marginTop: 6 }}>Lowest {s.low}% · latest {s.latest}%</div>
    </Card>
  )
}

export function HydrationWidget({ data, cfg }) {
  const h = data.hydration
  if (!h) return null
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)}>
      <CardHead icon={Droplet} color="var(--c-battery)" title="Hydration" />
      <Num value={n((h.intake_ml || 0) / 1000, 1)} unit={`of ${n((h.goal_ml || 0) / 1000, 1)} L`} size={full ? 'xl' : 'l'} />
      <div className="meter" style={{ marginTop: 12 }}><span style={{ width: `${Math.min(100, (h.intake_ml / (h.goal_ml || 1)) * 100)}%`, background: 'var(--c-battery)' }} /></div>
      {h.sweat_ml ? <div className="small muted" style={{ marginTop: 8 }}>Sweat loss {n(h.sweat_ml)} ml</div> : null}
    </Card>
  )
}

export function WeightWidget({ data, cfg }) {
  const nav = useNav()
  const w = data.weight
  if (!w) return null
  const full = cfg.size === 'full'
  const kg = weight(w.kg)
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.push('metric', { metric: 'weight', date: data.date })}>
      <CardHead icon={Scale} color="var(--c-weight)" title="Weight" />
      <Num value={kg.value} unit={kg.unit} size={full ? 'xl' : 'l'} />
      <div className="small muted" style={{ marginTop: 6 }}>{w.body_fat ? `${w.body_fat}% body fat · ` : ''}{w.date ? dayLabel(w.date, { short: true }) : ''}</div>
    </Card>
  )
}

export function FloorsWidget({ data, cfg }) {
  const t = data.totals
  if (!isNum(t.floors_up)) return null
  return (
    <Card size="tile" className={span(cfg)}>
      <CardHead icon={Mountain} color="var(--c-steps)" title="Floors" />
      <div className="row" style={{ gap: 12 }}>
        <Ring value={t.floors_up} max={t.floors_goal || 10} size={74} thickness={8} color="var(--c-steps)">
          <span className="num num-s">{Math.round(t.floors_up)}</span>
        </Ring>
        <div className="small muted">Goal {t.floors_goal || 10}<br />Down {Math.round(t.floors_down || 0)}</div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- training

export function TrainingStatusWidget({ data, cfg }) {
  const nav = useNav()
  const t = data.training
  if (!t) return null
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)} onClick={() => nav.tab('training')}>
      <CardHead icon={TrendingUp} color="var(--c-load)" title="Training status" chevron />
      <div className="word" style={{ fontSize: full ? 34 : 26 }}>{t.status || 'No status'}</div>
      {full ? (
        <>
          <div className="stats" style={{ marginTop: 14 }}>
            <Stat value={t.acute_load ?? '—'} label="Acute load" />
            <Stat value={t.acwr_status || '—'} label="Load ratio" />
            <Stat value={n(t.vo2max, 1)} label="VO₂ max" />
          </div>
          <div style={{ marginTop: 14 }}>
            <Columns height={70} color="var(--c-load)" showLabels
              data={data.week.map((w) => ({ key: w.date, label: weekday(w.date).slice(0, 2), value: w.load, title: dayLabel(w.date) }))}
              format={(v) => `${Math.round(v)} load`} />
          </div>
        </>
      ) : (
        <div className="small muted" style={{ marginTop: 6 }}>Load {t.acute_load ?? '—'} · VO₂ {n(t.vo2max, 1)}</div>
      )}
    </Card>
  )
}

export function LoadFocus({ focus }) {
  if (!focus) return null
  const rows = [
    ['Low aerobic', focus.low_aerobic, 'var(--f-low)'],
    ['High aerobic', focus.high_aerobic, 'var(--f-high)'],
    ['Anaerobic', focus.anaerobic, 'var(--f-ana)'],
  ]
  const top = Math.max(...rows.map(([, r]) => Math.max(r.value || 0, r.max || 0))) * 1.1
  return (
    <div className="stack" style={{ gap: 14 }}>
      {rows.map(([label, r, color]) => (
        <div key={label}>
          <div className="row row--between small" style={{ marginBottom: 6 }}>
            <span className="row" style={{ gap: 6 }}><span className="legend__key" style={{ background: color }} />{label}</span>
            <span><b style={{ fontWeight: 600 }}>{r.value ?? '—'}</b> <span className="muted">target {r.min}–{r.max}</span></span>
          </div>
          <BandMeter value={r.value} min={r.min} max={r.max} color={color} scaleMax={top} />
        </div>
      ))}
    </div>
  )
}

export function LoadFocusWidget({ data, cfg }) {
  const f = data.training?.load_focus
  if (!f) return null
  return (
    <Card className={span(cfg)}>
      <CardHead icon={Target} color="var(--f-high)" title="4-week load focus" right={f.feedback ? <span className="badge">{f.feedback}</span> : null} />
      <LoadFocus focus={f} />
    </Card>
  )
}

export function NextWorkoutWidget({ data, cfg }) {
  const w = data.next_workout
  if (!w) return null
  const full = cfg.size === 'full'
  return (
    <Card size={full ? undefined : 'tile'} className={span(cfg)}>
      <CardHead icon={Calendar} title="Next workout" right={<span className="badge" style={{ background: 'var(--lime)', color: '#000' }}>{relDay(w.date)}</span>} />
      <div className="row" style={{ gap: 12 }}>
        <div className="act__thumb" style={{ width: 48, height: 48 }}><SportIcon group={w.sport?.includes('run') ? 'run' : w.sport?.includes('cycl') ? 'ride' : 'other'} /></div>
        <div className="grow">
          <div style={{ fontSize: 18, fontWeight: 500 }}>{w.name}</div>
          <div className="small muted">
            {[w.distance_m ? distance(w.distance_m).value + ' ' + distance(w.distance_m).unit : null, w.duration_s ? hm(w.duration_s) : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      {full && w.description && <p className="small" style={{ margin: '12px 0 0', color: 'var(--ink-2)' }}>{w.description}</p>}
    </Card>
  )
}

export function WeekWidget({ data, cfg }) {
  const nav = useNav()
  const steps = cfg.style === 'steps'
  const totalLoad = data.week.reduce((s, w) => s + (w.load || 0), 0)
  const sessions = data.week.reduce((s, w) => s + w.activities.length, 0)
  return (
    <Card className="span-2" onClick={() => nav.tab('activities')}>
      <CardHead icon={Timer} title="Last 7 days" chevron />
      <div className="row" style={{ gap: 22, marginBottom: 10 }}>
        <div><Num value={sessions} size="m" /><div className="stat__l">Sessions</div></div>
        <div><Num value={Math.round(totalLoad)} size="m" /><div className="stat__l">Training load</div></div>
      </div>
      <Columns height={92} color={steps ? 'var(--c-steps)' : 'var(--c-load)'} format={(v) => (steps ? n(v) : `${Math.round(v)} load`)}
        data={data.week.map((w) => ({ key: w.date, label: weekday(w.date).slice(0, 2), value: steps ? w.steps : w.load, title: dayLabel(w.date) }))} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginTop: 6 }}>
        {data.week.map((w) => (
          <div key={w.date} style={{ display: 'flex', justifyContent: 'center', gap: 2, minHeight: 18 }}>
            {w.activities.slice(0, 2).map((a) => <SportIcon key={a.id} group={a.group} size={14} />)}
          </div>
        ))}
      </div>
    </Card>
  )
}

export const WIDGET_COMPONENTS = {
  readiness: ReadinessWidget, latest: LatestWidget, hyrox: HyroxWidget, race: RaceWidget, sleep: SleepWidget,
  body_battery: BodyBatteryWidget, hrv: HrvWidget, stress: StressWidget, heart_rate: HeartRateWidget,
  steps: StepsWidget, intensity: IntensityWidget, training_status: TrainingStatusWidget, load_focus: LoadFocusWidget,
  next_workout: NextWorkoutWidget, week: WeekWidget, calories: CaloriesWidget, respiration: RespirationWidget,
  spo2: Spo2Widget, hydration: HydrationWidget, weight: WeightWidget, floors: FloorsWidget,
}
