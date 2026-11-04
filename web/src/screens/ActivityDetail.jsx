import { useMemo } from 'react'
import { CloudSun, Flame, HeartPulse, Mountain, Timer, TrendingUp, Zap, Footprints, Gauge as GaugeIcon } from 'lucide-react'
import { LineChart } from '../charts/charts'
import { RouteMap } from '../charts/map'
import { useApi } from '../lib/hooks'
import { clock, dayLabel, distance, elevation, hm, isNum, localTime, n, pace, speed, temp } from '../lib/format'
import { Card, CardHead, CoachLink, ErrorBox, Num, PageHead, Skeleton, SportIcon, Stat, groupMeta } from '../components/ui'
import { HyroxSequence } from './widgets'

const minuteTicks = (t) => {
  if (!t?.length) return []
  const total = t.at(-1)
  const step = total > 7200 ? 1800 : total > 2400 ? 900 : 300
  const out = []
  for (let s = step; s < total; s += step) out.push({ x: s, label: `${Math.round(s / 60)}′` })
  return out
}

// Light rolling average so second-by-second noise doesn't hide the shape of the effort.
function smooth(values, k) {
  if (k <= 1) return values
  return values.map((v, i) => {
    if (!isNum(v)) return null
    let sum = 0, c = 0
    for (let j = Math.max(0, i - k); j <= Math.min(values.length - 1, i + k); j++) if (isNum(values[j])) { sum += values[j]; c++ }
    return c ? sum / c : null
  })
}

function StreamChart({ title, icon, color, t, values: raw, format, invert, yMin, unit, band, window = 2 }) {
  const values = useMemo(() => smooth(raw, window), [raw, window])
  const pts = useMemo(() => t.map((x, i) => [x, isNum(values[i]) ? (invert ? -values[i] : values[i]) : null]), [t, values, invert])
  const vals = values.filter(isNum)
  if (vals.length < 3) return null
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length
  return (
    <Card>
      <CardHead icon={icon} color={color} title={title} right={<span className="small muted">avg {format(avg)}{unit ? ` ${unit}` : ''}</span>} />
      <LineChart points={pts} color={color} height={130} yMin={yMin} band={band}
        formatY={(v, tip) => (tip ? `${format(invert ? -v : v)}${unit ? ` ${unit}` : ''}` : format(invert ? -v : v))}
        formatX={(x) => clock(x)} xTicks={minuteTicks(t)} endDot={false} gap={120} strokeWidth={1.8} />
    </Card>
  )
}

function Zones({ zones }) {
  const total = zones.reduce((s, z) => s + z.seconds, 0) || 1
  return (
    <div className="stack" style={{ gap: 10 }}>
      {[...zones].reverse().map((z) => {
        const pct = (z.seconds / total) * 100
        return (
          <div key={z.zone} style={{ display: 'grid', gridTemplateColumns: '52px 1fr 92px', alignItems: 'center', gap: 10 }}>
            <div className="small"><b style={{ fontWeight: 600 }}>Zone {z.zone}</b><div className="muted" style={{ fontSize: 11 }}>{z.low_bpm}+ bpm</div></div>
            <div className="meter" style={{ height: 10 }}>
              <span style={{ width: `${Math.max(pct, 1)}%`, background: `color-mix(in srgb, var(--c-hr) ${30 + z.zone * 14}%, var(--surface-3))` }} />
            </div>
            <div className="small tnum" style={{ textAlign: 'right' }}>{clock(z.seconds)} <span className="muted">{Math.round(pct)}%</span></div>
          </div>
        )
      })}
    </div>
  )
}

function TrainingEffect({ a }) {
  const rows = [['Aerobic', a.te_aerobic, 'var(--f-high)'], ['Anaerobic', a.te_anaerobic, 'var(--f-ana)']]
  return (
    <Card>
      <CardHead icon={TrendingUp} title="Training effect" right={a.te_label ? <span className="badge">{a.te_label}</span> : null} />
      <div className="stack" style={{ gap: 12 }}>
        {rows.map(([label, v, color]) => isNum(v) && (
          <div key={label}>
            <div className="row row--between small" style={{ marginBottom: 6 }}>
              <span className="row" style={{ gap: 6 }}><span className="legend__key" style={{ background: color }} />{label}</span>
              <b style={{ fontWeight: 600 }}>{n(v, 1)} <span className="muted" style={{ fontWeight: 400 }}>/ 5.0</span></b>
            </div>
            <div className="meter"><span style={{ width: `${(v / 5) * 100}%`, background: color }} /></div>
          </div>
        ))}
      </div>
      {isNum(a.training_load) && <div className="small muted" style={{ marginTop: 12 }}>Exercise load {a.training_load}</div>}
    </Card>
  )
}

function Laps({ laps, group }) {
  const run = group === 'run' || group === 'walk'
  const paces = laps.map((l) => l.pace_s_km).filter(isNum)
  const best = paces.length ? Math.min(...paces) : null
  const worst = paces.length ? Math.max(...paces) : null
  return (
    <Card>
      <CardHead icon={Timer} title={run ? 'Splits' : 'Laps'} right={<span className="small muted">{laps.length}</span>} />
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>#</th><th>{laps.some((l) => l.name) ? 'Lap' : 'Dist'}</th><th>Time</th>{run && <th style={{ width: '32%' }}>Pace</th>}<th>HR</th></tr></thead>
          <tbody>
            {laps.map((l) => {
              const p = l.pace_s_km ? pace(l.pace_s_km) : null
              const k = best && worst && l.pace_s_km ? 1 - (l.pace_s_km - best) / ((worst - best) || 1) : 0
              return (
                <tr key={l.index}>
                  <td className="muted">{l.index}</td>
                  <td>{l.name || (l.distance_m ? distance(l.distance_m).value + ' ' + distance(l.distance_m).unit : '—')}</td>
                  <td>{clock(l.duration_s)}</td>
                  {run && (
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ minWidth: 38 }}>{p ? p.value : '—'}</span>
                        {p && <span className="grow"><span style={{ display: 'block', height: 6, borderRadius: 3, width: `${30 + k * 70}%`, background: l.intensity === 'REST' ? 'var(--surface-3)' : 'var(--c-run)' }} /></span>}
                      </div>
                    </td>
                  )}
                  <td>{l.avg_hr ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function HyroxBreakdown({ h, bests }) {
  const fastest = Math.min(...h.runs.map((r) => r.pace_s_km || Infinity))
  const slowest = Math.max(...h.runs.map((r) => r.pace_s_km || 0))
  return (
    <>
      <Card>
        <CardHead icon={Flame} color="var(--c-station)" title="Race timeline" right={<span className="badge">{h.source}</span>} />
        <HyroxSequence seq={h.sequence} height={30} runColor="var(--c-run)" stationColor="var(--c-station)" />
        <div className="legend">
          <span className="legend__item"><span className="legend__key" style={{ background: 'var(--c-run)' }} />Runs {clock(h.run_total_s)}</span>
          <span className="legend__item"><span className="legend__key" style={{ background: 'var(--c-station)' }} />Stations {clock(h.station_total_s)}</span>
          {h.roxzone_s ? <span className="legend__item">Roxzone {clock(h.roxzone_s)}</span> : null}
        </div>
      </Card>
      <Card>
        <CardHead icon={Footprints} color="var(--c-run)" title="Compromised running" />
        {h.compromised && (
          <div className="stats" style={{ marginBottom: 14 }}>
            <Stat value={pace(h.compromised.first_pace).value} unit={pace(1).unit} label="Run 1" />
            <Stat value={pace(h.compromised.later_avg_pace).value} unit={pace(1).unit} label="Runs 2–8 avg" />
            <Stat value={`${h.compromised.decay_pct > 0 ? '+' : ''}${n(h.compromised.decay_pct, 1)}`} unit="%" label="Fade" />
          </div>
        )}
        <div className="stack" style={{ gap: 8 }}>
          {h.runs.map((r) => {
            const k = r.pace_s_km && slowest > fastest ? (r.pace_s_km - fastest) / (slowest - fastest) : 0
            return (
              <div key={r.n} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 56px 44px', gap: 10, alignItems: 'center' }} className="small tnum">
                <span className="muted">Run {r.n}</span>
                <div className="meter" style={{ height: 8 }}><span style={{ width: `${100 - k * 45}%`, background: 'var(--c-run)' }} /></div>
                <b style={{ fontWeight: 600, textAlign: 'right' }}>{r.pace_s_km ? clock(r.pace_s_km) : '—'}</b>
                <span className="muted" style={{ textAlign: 'right' }}>{r.avg_hr ?? '—'}</span>
              </div>
            )
          })}
        </div>
        <p className="small muted" style={{ margin: '10px 0 0' }}>Pace per 1 km run, longest bar is fastest. Right column is average heart rate.</p>
      </Card>
      <Card>
        <CardHead icon={Zap} color="var(--c-station)" title="Stations" right={bests ? <span className="small muted">vs your best</span> : null} />
        <div className="stack" style={{ gap: 0 }}>
          {h.stations.map((s) => {
            const best = bests?.[s.name]
            const diff = isNum(best) ? s.duration_s - best : null
            return (
              <div key={s.n} className="row" style={{ padding: '9px 0', borderTop: s.n > 1 ? '1px solid var(--line)' : 0 }}>
                <span className="muted small" style={{ width: 18 }}>{s.n}</span>
                <span className="grow">{s.name}</span>
                {isNum(diff) && <span className="small" style={{ color: diff <= 0.5 ? 'var(--good)' : 'var(--ink-3)', marginRight: 8 }}>{diff <= 0.5 ? 'Best' : `+${clock(diff)}`}</span>}
                <b className="tnum" style={{ fontWeight: 600 }}>{clock(s.duration_s)}</b>
              </div>
            )
          })}
        </div>
      </Card>
    </>
  )
}

function Sets({ sets }) {
  const groups = []
  for (const s of sets) {
    const last = groups.at(-1)
    if (last && last.name === s.exercise) last.sets.push(s)
    else groups.push({ name: s.exercise, sets: [s] })
  }
  return (
    <Card>
      <CardHead icon={GaugeIcon} title="Sets" right={<span className="small muted">{sets.length} sets</span>} />
      {groups.map((g, i) => (
        <div key={i} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>{g.name}</div>
          <div className="row small muted" style={{ flexWrap: 'wrap', gap: '4px 14px' }}>
            {g.sets.map((s, j) => (
              <span key={j} className="tnum">{s.reps ? `${s.reps} reps` : clock(s.duration_s)}{s.weight_kg ? ` × ${n(s.weight_kg, s.weight_kg % 1 ? 1 : 0)} kg` : ''}</span>
            ))}
          </div>
        </div>
      ))}
    </Card>
  )
}

export default function ActivityDetail({ id }) {
  const { data: a, error, refresh } = useApi(`/api/activities/${id}`, { freshKey: false })
  const hy = useApi(a?.hyrox ? '/api/hyrox' : null, { freshKey: false })
  if (error && !a) return <div className="scroller"><div className="wrap"><PageHead title="Activity" /><ErrorBox error={error} onRetry={refresh} /></div></div>
  if (!a) return <div className="scroller"><div className="wrap"><PageHead title="Activity" /><div className="stack"><Skeleton height={260} /><Skeleton height={140} /><Skeleton height={160} /></div></div></div>
  const M = groupMeta(a.group)
  const s = a.streams || { t: [] }
  const d = distance(a.distance_m)
  const isRun = a.group === 'run' || a.group === 'walk'
  const primary = []
  if (a.hyrox) primary.push([clock(a.hyrox.total_s), '', 'Total time'], [clock(a.hyrox.run_total_s), '', 'Running'], [clock(a.hyrox.station_total_s), '', 'Stations'])
  else {
    if (a.distance_m) primary.push([d.value, d.unit, 'Distance'])
    primary.push([clock(a.duration_s), '', 'Time'])
    if (a.avg_pace_s_km && isRun) { const p = pace(a.avg_pace_s_km); primary.push([p.value, p.unit, 'Avg pace']) }
    else if (a.avg_speed && a.group === 'ride') { const sp = speed(a.avg_speed); primary.push([sp.value, sp.unit, 'Avg speed']) }
    else if (a.group === 'strength') primary.push([a.sets ?? '—', '', 'Sets'])
    else if (a.avg_hr) primary.push([a.avg_hr, 'bpm', 'Avg HR'])
  }
  const secondary = [
    a.avg_hr && ['Avg HR', a.avg_hr, 'bpm'], a.max_hr && ['Max HR', a.max_hr, 'bpm'],
    isNum(a.calories) && ['Calories', n(a.calories), 'kcal'], isNum(a.elevation_gain) && a.elevation_gain > 0 && ['Ascent', elevation(a.elevation_gain).value, elevation(a.elevation_gain).unit],
    a.cadence && ['Cadence', a.cadence, a.group === 'ride' ? 'rpm' : 'spm'], a.avg_power && ['Avg power', a.avg_power, 'W'],
    a.norm_power && ['Norm. power', a.norm_power, 'W'], a.moving_s && ['Moving time', clock(a.moving_s), ''],
    isNum(a.body_battery) && ['Body Battery', a.body_battery > 0 ? `+${a.body_battery}` : a.body_battery, ''],
    a.sweat_ml && ['Sweat loss', n(a.sweat_ml), 'ml'], a.steps && ['Steps', n(a.steps), ''],
    a.reps && ['Reps', a.reps, ''], a.recovery_hr && ['Recovery HR', a.recovery_hr, 'bpm'],
  ].filter(Boolean)
  const dynamics = [
    a.stride_cm && ['Stride', n(a.stride_cm / 100, 2), 'm'], a.ground_contact_ms && ['Ground contact', a.ground_contact_ms, 'ms'],
    a.vertical_osc_cm && ['Vertical osc.', n(a.vertical_osc_cm, 1), 'cm'], a.vertical_ratio && ['Vertical ratio', n(a.vertical_ratio, 1), '%'],
  ].filter(Boolean)
  const heroTone = a.hyrox ? 'lime' : 'blue'
  return (
    <div className="scroller">
      <div className="wrap">
        <PageHead title={a.name} />
        {a.route ? (
          <div style={{ margin: '0 0 12px', borderRadius: 'var(--r-hero)', overflow: 'hidden' }}>
            <RouteMap route={a.route} height={290} color="var(--blue)" />
          </div>
        ) : null}
        <Card tone={a.route ? undefined : heroTone} size={a.route ? undefined : 'hero'} style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 10, marginBottom: 12 }}>
            <SportIcon group={a.group} size={20} color={a.route ? undefined : 'currentColor'} />
            <span className="small" style={{ opacity: 0.75 }}>{a.type_label} · {dayLabel(a.start_local)} · {localTime(a.start_local)}{a.location ? ` · ${a.location}` : ''}</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 14 }}>{a.name}</div>
          <div className="stats">
            {primary.map(([v, u, l]) => (
              <div key={l}><Num value={v} unit={u} size="m" /><div className="stat__l">{l}</div></div>
            ))}
          </div>
        </Card>
        <div className="stack">
          {a.description && <Card><p className="lead" style={{ margin: 0 }}>{a.description}</p></Card>}
          {secondary.length > 0 && (
            <Card><div className="stats">{secondary.map(([l, v, u]) => <Stat key={l} value={v} unit={u} label={l} />)}</div></Card>
          )}
          {a.hyrox && <HyroxBreakdown h={a.hyrox} bests={hy.data?.station_bests} />}
          {(isNum(a.te_aerobic) || isNum(a.te_anaerobic)) && <TrainingEffect a={a} />}
          {s.hr && <StreamChart title="Heart rate" icon={HeartPulse} color="var(--c-hr)" t={s.t} values={s.hr} format={(v) => Math.round(v)} unit="bpm" />}
          {s.speed && isRun && !a.hyrox && (
            <StreamChart title="Pace" icon={Timer} color="var(--c-run)" t={s.t} invert unit=""
              values={s.speed.map((v) => (v && v > 0.9 ? 1000 / v : null))} format={(v) => pace(v).value} />
          )}
          {s.speed && a.group === 'ride' && <StreamChart title="Speed" icon={Timer} color="var(--c-battery)" t={s.t} values={s.speed.map((v) => (v ? v * 3.6 : null))} format={(v) => n(v, 1)} unit="km/h" yMin={0} />}
          {s.elevation && a.route && <StreamChart title="Elevation" icon={Mountain} color="var(--c-weight)" t={s.t} values={s.elevation} format={(v) => Math.round(v)} unit="m" />}
          {s.cadence && isRun && <StreamChart title="Cadence" icon={Footprints} color="var(--c-steps)" t={s.t} values={s.cadence} format={(v) => Math.round(v)} unit="spm" />}
          {s.power && <StreamChart title="Power" icon={Zap} color="var(--c-cal)" t={s.t} values={s.power} format={(v) => Math.round(v)} unit="W" />}
          {s.stamina && <StreamChart title="Stamina" icon={GaugeIcon} color="var(--c-hrv)" t={s.t} values={s.stamina} format={(v) => Math.round(v)} unit="%" yMin={0} />}
          {a.hr_zones && (
            <Card>
              <CardHead icon={HeartPulse} color="var(--c-hr)" title="Time in heart-rate zones" />
              <Zones zones={a.hr_zones} />
            </Card>
          )}
          {a.sets && <Sets sets={a.sets} />}
          {a.laps?.length > 1 && !a.hyrox && <Laps laps={a.laps} group={a.group} />}
          {dynamics.length > 0 && (
            <Card>
              <CardHead icon={Footprints} title="Running dynamics" />
              <div className="stats stats--2">{dynamics.map(([l, v, u]) => <Stat key={l} value={v} unit={u} label={l} />)}</div>
            </Card>
          )}
          {(isNum(a.stamina_start) || a.weather) && (
            <div className="bento">
              {isNum(a.stamina_end) && (
                <Card size="tile"><CardHead icon={GaugeIcon} title="Stamina" />
                  <Num value={a.stamina_end} unit="%" size="m" /><div className="stat__l">left at the end · low {a.stamina_min}%</div></Card>
              )}
              {a.weather && (
                <Card size="tile"><CardHead icon={CloudSun} title="Weather" />
                  <Num value={temp(a.weather.temp_c)} size="m" />
                  <div className="stat__l">{a.weather.summary} · {a.weather.humidity}% · {a.weather.wind_kmh} km/h {a.weather.wind_dir}</div></Card>
              )}
            </div>
          )}
          <CoachLink prompt={`Analyse my ${a.type_label.toLowerCase()} "${a.name}" from ${dayLabel(a.start_local)} (activity ${a.id}). What went well and what should I change?`}>
            Ask the coach about this session
          </CoachLink>
          <p className="small muted" style={{ textAlign: 'center' }}>{M.label} · recorded {hm(a.duration_s)}{a.missing?.length ? ` · Garmin didn't return ${a.missing.join(', ')}` : ''}</p>
        </div>
      </div>
    </div>
  )
}
