import { Flame } from 'lucide-react'
import { Columns, LineChart } from '../charts/charts'
import { useApi } from '../lib/hooks'
import { clock, dayLabel, isNum, n, pace } from '../lib/format'
import { Card, CardHead, CoachLink, ErrorBox, Num, PageHead, Skeleton, Stat, useNav } from '../components/ui'
import { HyroxSequence } from './widgets'

const STATIONS = ['SkiErg', 'Sled Push', 'Sled Pull', 'Burpee Broad Jumps', 'Row', 'Farmers Carry', 'Sandbag Lunges', 'Wall Balls']

export default function HyroxHistory() {
  const nav = useNav()
  const { data, error, refresh } = useApi('/api/hyrox')
  const sessions = data?.sessions || []
  const last = sessions[0]
  return (
    <div className="scroller">
      <div className="wrap">
        <PageHead title="HYROX" />
        {error && !data && <ErrorBox error={error} onRetry={refresh} />}
        {!data && !error && <div className="stack"><Skeleton height={200} /><Skeleton height={260} /></div>}
        {data && !sessions.length && (
          <Card><p className="lead" style={{ margin: 0 }}>No HYROX sessions found in the last year. Name an activity with “HYROX” in Garmin Connect, or record it with laps for each run and station, and it’ll show up here.</p></Card>
        )}
        {last && (
          <div className="stack">
            <Card tone="lime">
              <CardHead icon={Flame} title="Personal best (full format)" />
              <Num value={clock(data.best_total_s)} size="xl" />
              <div className="stats" style={{ marginTop: 14 }}>
                <Stat value={sessions.length} label="Sessions this year" />
                <Stat value={sessions.filter((s) => s.hyrox.complete).length} label="Full simulations" />
                <Stat value={last.hyrox.compromised ? `${n(last.hyrox.compromised.decay_pct, 1)}%` : '—'} label="Latest run fade" />
              </div>
            </Card>

            <Card>
              <CardHead title="Best time per station" />
              <Columns height={150} color="var(--c-station)" maxBar={20}
                data={STATIONS.map((s) => ({ key: s, label: s.split(' ')[0].slice(0, 5), value: data.station_bests[s], title: s }))}
                format={(v, tip) => (tip ? clock(v) : clock(v))} showValue />
            </Card>

            {sessions.length > 1 && (
              <Card>
                <CardHead title="Total time by session" />
                <LineChart points={[...sessions].reverse().map((s) => [s.start_ms, s.hyrox.total_s])} color="var(--c-station)" height={140} dots
                  formatY={(v) => clock(v)} formatX={(x) => new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
              </Card>
            )}

            <h2 className="section-title">Sessions</h2>
            {sessions.map((s) => (
              <Card key={s.id} onClick={() => nav.push('activity', { id: s.id })}>
                <div className="row row--between" style={{ marginBottom: 8 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }} className="ellipsis">{s.name}</div>
                    <div className="small muted">{dayLabel(s.start_local)} · {s.hyrox.source}</div>
                  </div>
                  <Num value={clock(s.hyrox.total_s)} size="s" />
                </div>
                <HyroxSequence seq={s.hyrox.sequence} height={14} runColor="var(--c-run)" stationColor="var(--c-station)" />
                <div className="row small muted" style={{ gap: 14, marginTop: 8 }}>
                  <span>Runs {clock(s.hyrox.run_total_s)}</span>
                  <span>Stations {clock(s.hyrox.station_total_s)}</span>
                  {s.hyrox.compromised && <span>Avg run {pace(s.hyrox.compromised.avg_pace).value}</span>}
                </div>
              </Card>
            ))}
            <CoachLink prompt="Compare my HYROX sessions this year. Where am I losing the most time and what should I train before my next race?">Ask the coach where to find time</CoachLink>
          </div>
        )}
      </div>
    </div>
  )
}
