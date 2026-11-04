import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Columns, LineChart } from '../charts/charts'
import { useApi, usePullToRefresh } from '../lib/hooks'
import { addDays, dayLabel, fromISO, hm, isNum, n, shortDate, todayISO, weight as fmtWeight } from '../lib/format'
import { HEALTH, useSettings } from '../lib/settings'
import { Card, CoachLink, ErrorBox, LoadingGrid, Num, PageHead, Seg, Stat } from '../components/ui'
import { WIDGET_COMPONENTS } from './widgets'
import { Header, PullIndicator } from './Today'

const HEALTH_STYLE = { sleep: 'stages', body_battery: 'curve', hrv: 'gauge', heart_rate: 'bars', stress: 'line', steps: 'week' }

export default function Health() {
  const { settings } = useSettings()
  const [date, setDate] = useState(todayISO())
  const scrollRef = useRef(null)
  const { data, error, loading, refresh, at, refreshing } = useApi(`/api/today?date=${date}`)
  const pull = usePullToRefresh(refresh, scrollRef)
  const isToday = date === todayISO()
  return (
    <div className="scroller" ref={scrollRef}>
      <div className="wrap">
        <PullIndicator pull={pull} />
        <Header title="Health" at={at} refreshing={refreshing} />
        <div className="row row--between" style={{ margin: '0 0 14px', background: 'var(--surface)', borderRadius: 18, padding: 4 }}>
          <button type="button" className="icon-btn icon-btn--ghost" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><ChevronLeft size={22} /></button>
          <div style={{ fontWeight: 600 }}>{dayLabel(date)}</div>
          <button type="button" className="icon-btn icon-btn--ghost" onClick={() => setDate(addDays(date, 1))} disabled={isToday} style={{ opacity: isToday ? 0.25 : 1 }} aria-label="Next day"><ChevronRight size={22} /></button>
        </div>
        {error && !data && <ErrorBox error={error} onRetry={refresh} />}
        {loading && !data && <LoadingGrid />}
        {data && (
          <div className="bento">
            {settings.health.filter((h) => h.on).map((h) => {
              const Comp = WIDGET_COMPONENTS[h.id]
              return Comp ? <Comp key={h.id} data={data} cfg={{ id: h.id, size: 'full', style: HEALTH_STYLE[h.id] || null }} /> : null
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- metric detail

const METRICS = {
  readiness: { trend: 'readiness', title: 'Training readiness', color: 'var(--c-readiness)', fmt: (v) => Math.round(v), widget: 'readiness', yMin: 0, yMax: 100,
    about: 'Readiness blends last night’s sleep, recovery time, HRV, acute load, and recent stress and sleep history into one 1–100 score. Above 75 means you can train hard; under 50 means keep it easy.' },
  sleep: { trend: 'sleep_hours', title: 'Sleep', color: 'var(--c-sleep)', fmt: (v) => hm(v * 3600), unit: '', widget: 'sleep',
    about: 'Sleep score (0–100) weighs duration, deep and REM sleep, restlessness and overnight stress. Garmin’s sleep need rises after hard training.', extra: 'sleep_score' },
  body_battery: { trend: 'body_battery', title: 'Body Battery', color: 'var(--c-battery)', fmt: (v) => Math.round(v), widget: 'body_battery', yMin: 0, yMax: 100,
    about: 'Body Battery estimates your energy reserves from HRV, stress, sleep and activity. Watch the morning high: if it rarely gets above 70, recovery is lagging.' },
  hrv: { trend: 'hrv', title: 'HRV status', color: 'var(--c-hrv)', fmt: (v) => Math.round(v), unit: 'ms', widget: 'hrv',
    about: 'Overnight heart-rate variability compared with your personal baseline. The shaded band is your balanced range; a 7-day average below it is a sign of accumulated fatigue, illness or stress.' },
  heart_rate: { trend: 'rhr', title: 'Resting heart rate', color: 'var(--c-hr)', fmt: (v) => Math.round(v), unit: 'bpm', widget: 'heart_rate',
    about: 'Resting heart rate trending a few beats above normal for several days often means fatigue or illness coming on.' },
  stress: { trend: 'stress', title: 'Stress', color: 'var(--c-stress)', fmt: (v) => Math.round(v), widget: 'stress', yMin: 0,
    about: 'Stress level (0–100) comes from heart-rate variability while you’re not exercising. 0–25 is rest, 26–50 low, 51–75 medium, 76+ high.' },
  respiration: { trend: 'respiration', title: 'Respiration', color: 'var(--c-resp)', fmt: (v) => n(v, 1), unit: 'brpm', widget: 'respiration',
    about: 'Breaths per minute while awake. A sustained rise can be an early sign of illness.' },
  steps: { trend: 'steps', title: 'Steps', color: 'var(--c-steps)', fmt: (v) => n(v), widget: 'steps', yMin: 0, bars: true,
    about: 'Total daily steps from your watch, including runs.' },
  intensity: { trend: 'intensity', title: 'Intensity minutes', color: 'var(--c-intensity)', fmt: (v) => Math.round(v), unit: 'min', widget: 'intensity', yMin: 0, bars: true,
    about: 'Moderate minutes count once and vigorous minutes count twice. The WHO-backed goal is 150 a week.' },
  calories: { trend: 'calories', title: 'Active calories', color: 'var(--c-cal)', fmt: (v) => n(v), unit: 'kcal', widget: 'calories', yMin: 0, bars: true,
    about: 'Calories burned through movement and exercise, on top of your resting burn.' },
  weight: { trend: 'weight', title: 'Weight', color: 'var(--c-weight)', fmt: (v) => fmtWeight(v).value, unit: '', widget: 'weight',
    about: 'Weigh-ins from a Garmin scale or entered in Garmin Connect.' },
  vo2max: { trend: 'vo2max', title: 'VO₂ max', color: 'var(--c-vo2)', fmt: (v) => n(v, 1), widget: null,
    about: 'Your aerobic ceiling, estimated from outdoor runs with heart rate. It moves slowly: half a point over a training block is real progress.' },
  spo2: { trend: null, title: 'Pulse Ox', widget: 'spo2', about: 'Blood oxygen saturation measured while you sleep.' },
  hydration: { trend: null, title: 'Hydration', widget: 'hydration', about: 'Water you’ve logged, against a goal that rises with sweat loss.' },
  floors: { trend: null, title: 'Floors', widget: 'floors', about: 'Floors climbed, from the barometric altimeter.' },
}

const RANGES = [['7', '7D'], ['28', '4W'], ['90', '3M'], ['365', '1Y']]

function TrendChart({ m, data, days }) {
  const pts = data.points
  if (!pts.length) return <div className="empty">No history for this range.</div>
  if (m.bars && days <= 90) {
    return (
      <Columns height={170} color={m.color} maxBar={days <= 7 ? 22 : days <= 28 ? 9 : 4}
        labelEvery={days <= 7 ? 1 : days <= 28 ? 7 : 30}
        data={pts.map((p, i) => ({ key: p.date, value: p.value, title: dayLabel(p.date),
          label: days <= 7 ? fromISO(p.date).toLocaleDateString('en-GB', { weekday: 'narrow' }) : (i % (days <= 28 ? 7 : 30) === 0 ? shortDate(p.date) : '') }))}
        format={(v, tip) => `${m.fmt(v)}${tip && m.unit ? ` ${m.unit}` : ''}`} />
    )
  }
  const series = pts.map((p) => [fromISO(p.date).getTime(), p.value])
  const ticks = []
  const every = days <= 7 ? 1 : days <= 28 ? 7 : days <= 90 ? 30 : 90
  pts.forEach((p, i) => { if (i % every === 0) ticks.push({ x: fromISO(p.date).getTime(), label: days <= 7 ? fromISO(p.date).toLocaleDateString('en-GB', { weekday: 'short' }) : shortDate(p.date) }) })
  return (
    <>
      <LineChart points={series} color={m.color} height={180} yMin={m.yMin} yMax={m.yMax} dots={days <= 28}
        band={data.band && isNum(data.band.low) ? data.band : undefined}
        formatY={(v, tip) => `${m.fmt(v)}${tip && m.unit ? ` ${m.unit}` : ''}`}
        formatX={(x) => new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} xTicks={ticks} />
      {data.band && isNum(data.band.low) && <div className="legend"><span className="legend__item"><span className="legend__key" style={{ background: m.color, opacity: 0.25 }} />Balanced range {data.band.low}–{data.band.high} ms</span></div>}
    </>
  )
}

export function MetricPage({ metric, date }) {
  const m = METRICS[metric] || METRICS.readiness
  const [days, setDays] = useState('28')
  const trend = useApi(m.trend ? `/api/trends/${m.trend}?days=${days}` : null, { freshKey: false })
  const extra = useApi(m.extra ? `/api/trends/${m.extra}?days=${days}` : null, { freshKey: false })
  const day = useApi(m.widget ? `/api/today?date=${date || todayISO()}` : null, { freshKey: false })
  const Widget = m.widget ? WIDGET_COMPONENTS[m.widget] : null
  const s = trend.data?.stats
  const avgText = s ? m.fmt(s.avg) : '—'
  const change = s?.change
  return (
    <div className="scroller">
      <div className="wrap">
        <PageHead title={m.title} />
        {m.trend && (
          <Card>
            <Seg label="Range" value={days} onChange={setDays} options={RANGES} />
            <div className="row row--between row--end" style={{ margin: '16px 0 8px' }}>
              <div>
                <div className="stat__l" style={{ marginTop: 0, marginBottom: 4 }}>Average</div>
                <Num value={avgText} unit={m.unit} size="xl" />
              </div>
              {isNum(change) && (
                <div className="small" style={{ textAlign: 'right', paddingBottom: 6 }}>
                  <div className="muted">vs first half</div>
                  <b style={{ fontWeight: 600 }}>{change > 0 ? '+' : ''}{m.fmt(Math.abs(change)) === '0' ? '0' : `${change < 0 ? '−' : ''}${m.fmt(Math.abs(change))}`}{m.unit ? ` ${m.unit}` : ''}</b>
                </div>
              )}
            </div>
            {trend.error && !trend.data ? <ErrorBox error={trend.error} onRetry={trend.refresh} /> : trend.data ? <TrendChart m={m} data={trend.data} days={+days} /> : <div className="skel" style={{ height: 180 }} />}
            {s && (
              <div className="stats stats--3" style={{ marginTop: 16 }}>
                <Stat value={m.fmt(s.min)} unit={m.unit} label="Lowest" />
                <Stat value={m.fmt(s.max)} unit={m.unit} label="Highest" />
                <Stat value={m.fmt(s.latest)} unit={m.unit} label="Latest" />
              </div>
            )}
          </Card>
        )}
        {m.extra && extra.data?.points?.length > 0 && (
          <Card style={{ marginTop: 10 }}>
            <div className="card__head"><span className="card__title">Sleep score</span><span className="small muted">avg {Math.round(extra.data.stats?.avg ?? 0)}</span></div>
            <Columns height={120} color="var(--c-sleep)" maxBar={+days <= 7 ? 22 : +days <= 28 ? 9 : 3} showLabels={+days <= 7} yMax={100}
              data={extra.data.points.map((p) => ({ key: p.date, value: p.value, title: dayLabel(p.date), label: fromISO(p.date).toLocaleDateString('en-GB', { weekday: 'narrow' }) }))} />
          </Card>
        )}
        {Widget && day.data && (
          <>
            <h2 className="section-title">{dayLabel(day.data.date)}</h2>
            <div className="bento"><Widget data={day.data} cfg={{ size: 'full', style: HEALTH_STYLE[m.widget] || (metric === 'readiness' ? 'gauge' : null) }} /></div>
          </>
        )}
        {metric === 'body_battery' && day.data?.body_battery?.events?.length > 0 && (
          <div className="list" style={{ marginTop: 10 }}>
            {day.data.body_battery.events.map((e, i) => (
              <div key={i} className="list__row">
                <span className="list__main"><span className="list__title">{e.name || e.type}</span><div className="list__sub">{e.feedback} · {hm(e.duration_min * 60)}</div></span>
                <span className="list__value tnum" style={{ color: e.impact >= 0 ? 'var(--good)' : 'var(--ink)' }}>{e.impact > 0 ? '+' : ''}{e.impact}</span>
              </div>
            ))}
          </div>
        )}
        {metric === 'sleep' && day.data?.sleep?.sub_scores && <SleepDetails s={day.data.sleep} />}
        <p className="lead" style={{ margin: '18px 4px 0' }}>{m.about}</p>
        <CoachLink prompt={`Look at my ${m.title.toLowerCase()} over the last ${days} days. What does it tell you and what should I do about it?`} />
      </div>
    </div>
  )
}

function SleepDetails({ s }) {
  const rows = [
    ['Duration', s.sub_scores.totalDuration?.quality, hm(s.duration_s)],
    ['Deep sleep', s.sub_scores.deepPercentage?.quality, `${s.sub_scores.deepPercentage?.value ?? '—'}%`],
    ['REM sleep', s.sub_scores.remPercentage?.quality, `${s.sub_scores.remPercentage?.value ?? '—'}%`],
    ['Light sleep', s.sub_scores.lightPercentage?.quality, `${s.sub_scores.lightPercentage?.value ?? '—'}%`],
    ['Restlessness', s.sub_scores.restlessness?.quality, s.restless_moments != null ? `${s.restless_moments} moments` : '—'],
    ['Stress', s.sub_scores.stress?.quality, s.avg_stress != null ? `avg ${s.avg_stress}` : '—'],
    ['Overnight HRV', null, s.avg_hrv ? `${s.avg_hrv} ms` : '—'],
    ['Resting HR', null, s.resting_hr ? `${s.resting_hr} bpm` : '—'],
    ['Respiration', null, s.avg_respiration ? `${n(s.avg_respiration, 1)} brpm` : '—'],
    ['Pulse Ox', null, s.avg_spo2 ? `${s.avg_spo2}% (low ${s.low_spo2}%)` : '—'],
    ['Body Battery change', null, s.body_battery_change != null ? `+${s.body_battery_change}` : '—'],
    ['Sleep need', s.need_feedback, s.need_min ? hm(s.need_min * 60) : '—'],
  ]
  return (
    <div className="list" style={{ marginTop: 10 }}>
      {rows.map(([label, q, v]) => (
        <div key={label} className="list__row">
          <span className="list__main"><span className="list__title">{label}</span>{q && <div className="list__sub">{q}</div>}</span>
          <span className="list__value tnum">{v}</span>
        </div>
      ))}
    </div>
  )
}

export { METRICS, HEALTH }
