import { Award, Footprints, Medal, Watch } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { clock, compact, distance, hm, n, relative, shortDate } from '../lib/format'
import { Card, CardHead, ErrorBox, Num, PageHead, Skeleton, Stat, useNav } from '../components/ui'

export default function Profile() {
  const nav = useNav()
  const { data, error, refresh } = useApi('/api/profile')
  return (
    <div className="scroller">
      <div className="wrap">
        <PageHead title="Profile" />
        {error && !data && <ErrorBox error={error} onRetry={refresh} />}
        {!data && !error && <div className="stack"><Skeleton height={150} /><Skeleton height={220} /></div>}
        {data && (
          <div className="stack">
            <Card size="hero">
              <div className="row" style={{ gap: 14 }}>
                <div className="avatar" style={{ width: 56, height: 56, fontSize: 24, background: 'var(--lime)', color: '#000' }}>{(data.name || 'You').charAt(0)}</div>
                <div className="grow">
                  <div style={{ fontSize: 24, fontWeight: 600 }}>{data.name || 'Athlete'}</div>
                  <div className="small" style={{ opacity: 0.7 }}>
                    {data.devices?.find((d) => d.primary)?.name || data.devices?.[0]?.name || 'Garmin'}{data.last_sync_ms ? ` · synced ${relative(data.last_sync_ms)}` : ''}
                  </div>
                </div>
              </div>
              <div className="divider" />
              <div className="stats">
                <Stat value={compact(data.lifetime?.activities)} label="Activities" />
                <Stat value={distance(data.lifetime?.distance_m, 0).value} unit={distance(data.lifetime?.distance_m, 0).unit} label="Distance" />
                <Stat value={n((data.lifetime?.duration_s || 0) / 3600)} unit="h" label="Moving time" />
              </div>
            </Card>

            {data.records?.length > 0 && (
              <>
                <h2 className="section-title">Personal records</h2>
                <div className="list">
                  {data.records.map((r, i) => (
                    <button key={i} type="button" className="list__row" onClick={() => r.activity_id && nav.push('activity', { id: r.activity_id })}>
                      <span className="list__icon"><Award size={17} /></span>
                      <span className="list__main"><span className="list__title">{r.label}</span><div className="list__sub">{shortDate(r.date)}</div></span>
                      <span className="list__value tnum" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                        {r.kind === 'time' ? clock(r.value) : r.kind === 'distance' ? `${distance(r.value).value} ${distance(r.value).unit}` : n(r.value)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {data.gear?.length > 0 && (
              <>
                <h2 className="section-title">Gear</h2>
                {data.gear.map((g, i) => {
                  const d = distance(g.distance_m, 0)
                  const pct = g.max_m ? Math.min(100, (g.distance_m / g.max_m) * 100) : null
                  return (
                    <Card key={i}>
                      <CardHead icon={Footprints} title={g.type || 'Gear'} right={g.since ? <span className="small muted">since {shortDate(g.since)}</span> : null} />
                      <div className="row row--between row--end">
                        <div style={{ fontWeight: 500, fontSize: 17 }}>{g.name}</div>
                        <Num value={d.value} unit={d.unit} size="s" />
                      </div>
                      {pct != null && (
                        <>
                          <div className="meter" style={{ marginTop: 10 }}><span style={{ width: `${pct}%`, background: pct > 85 ? 'var(--warn)' : 'var(--c-steps)' }} /></div>
                          <div className="small muted" style={{ marginTop: 6 }}>{Math.round(pct)}% of its {distance(g.max_m, 0).value} {distance(g.max_m, 0).unit} life · {g.activities} activities</div>
                        </>
                      )}
                    </Card>
                  )
                })}
              </>
            )}

            {data.badges?.length > 0 && (
              <>
                <h2 className="section-title">Badges <small>{data.badges.length}</small></h2>
                <div className="bento">
                  {data.badges.slice(0, 12).map((b, i) => (
                    <Card key={i} size="tile">
                      <Medal size={22} color="var(--c-cal)" />
                      <div style={{ fontWeight: 500, marginTop: 8 }}>{b.name}</div>
                      <div className="small muted">{shortDate(b.date)}{b.points ? ` · ${b.points} pts` : ''}</div>
                    </Card>
                  ))}
                </div>
              </>
            )}

            {data.devices?.length > 0 && (
              <>
                <h2 className="section-title">Devices</h2>
                <div className="list">
                  {data.devices.map((d, i) => (
                    <div key={i} className="list__row">
                      <span className="list__icon"><Watch size={17} /></span>
                      <span className="list__main"><span className="list__title">{d.name}</span><div className="list__sub">{d.primary ? 'Primary device · ' : ''}firmware {d.firmware || '—'}</div></span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="small muted" style={{ textAlign: 'center' }}>Lifetime: {compact(data.lifetime?.steps)} steps · {hm(data.lifetime?.duration_s)} · {n(data.lifetime?.calories)} kcal</p>
          </div>
        )}
      </div>
    </div>
  )
}
