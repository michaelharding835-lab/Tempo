import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { RouteShape } from '../charts/map'
import { api } from '../lib/api'
import { useApi, usePullToRefresh } from '../lib/hooks'
import { clock, dayLabel, distance, fromISO, hm, isoOf, localTime, monthName, n, pace, todayISO } from '../lib/format'
import { useSettings } from '../lib/settings'
import { Card, Chip, ErrorBox, GROUP_META, Seg, Skeleton, SportIcon, groupMeta, useNav } from '../components/ui'
import { Header, PullIndicator } from './Today'

function weekStart(iso) {
  const d = fromISO(iso)
  const k = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - k)
  return isoOf(d)
}

export function ActivityRow({ a }) {
  const nav = useNav()
  const { settings } = useSettings()
  const M = groupMeta(a.group)
  const d = distance(a.distance_m)
  const p = a.avg_pace_s_km ? pace(a.avg_pace_s_km) : null
  return (
    <Card onClick={() => nav.push('activity', { id: a.id })} style={{ padding: 12 }} aria-label={`${a.name}, ${dayLabel(a.start_local)}`}>
      <div className="act">
        <div className="act__thumb" style={a.group === 'hyrox' ? { background: 'var(--lime)' } : undefined}>
          {settings.activities.maps && a.route_preview
            ? <RouteShape route={a.route_preview} size={56} color={M.color} />
            : <SportIcon group={a.group} size={24} color={a.group === 'hyrox' ? '#000' : undefined} />}
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="act__name ellipsis">{a.name}</div>
          <div className="act__meta">{dayLabel(a.start_local, { short: true })} · {localTime(a.start_local)}{a.te_label ? ` · ${a.te_label}` : ''}</div>
          <div className="act__stats tnum">
            {a.group === 'hyrox' && a.hyrox ? (
              <>
                <span>{clock(a.hyrox.total_s)}</span>
                <span>{a.hyrox.runs.length}×run<span className="unit"> · {a.hyrox.stations.length} stations</span></span>
              </>
            ) : (
              <>
                {a.distance_m ? <span>{d.value}<span className="unit">{d.unit}</span></span> : null}
                <span>{clock(a.duration_s)}</span>
                {p ? <span>{p.value}<span className="unit">{p.unit}</span></span> : a.avg_hr ? <span>{a.avg_hr}<span className="unit">bpm</span></span> : null}
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function ListView({ group }) {
  const first = useApi('/api/activities?limit=40')
  const [more, setMore] = useState([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [done, setDone] = useState(false)
  const items = useMemo(() => [...(first.data?.items || []), ...more], [first.data, more])
  const shown = group === 'all' ? items : items.filter((a) => a.group === group)
  const weeks = useMemo(() => {
    const map = new Map()
    for (const a of shown) {
      if (!a.start_local) continue
      const w = weekStart(a.start_local.slice(0, 10))
      if (!map.has(w)) map.set(w, [])
      map.get(w).push(a)
    }
    return [...map.entries()]
  }, [shown])
  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const page = await api.get(`/api/activities?start=${items.length}&limit=40`)
      setMore((m) => [...m, ...page.items])
      if (!page.has_more) setDone(true)
    } finally { setLoadingMore(false) }
  }
  if (first.error && !first.data) return <ErrorBox error={first.error} onRetry={first.refresh} />
  if (!first.data) return <div className="stack"><Skeleton height={86} /><Skeleton height={86} /><Skeleton height={86} /></div>
  const thisWeek = weekStart(todayISO())
  return (
    <>
      {weeks.map(([w, acts]) => {
        const dist = acts.reduce((s, a) => s + (a.distance_m || 0), 0)
        const time = acts.reduce((s, a) => s + (a.duration_s || 0), 0)
        const dd = distance(dist)
        return (
          <div key={w}>
            <div className="week-head">
              <b>{w === thisWeek ? 'This week' : `Week of ${fromISO(w).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}</b>
              <span className="tnum">{dist ? `${dd.value} ${dd.unit} · ` : ''}{hm(time)}</span>
            </div>
            <div className="stack" style={{ gap: 8 }}>{acts.map((a) => <ActivityRow key={a.id} a={a} />)}</div>
          </div>
        )
      })}
      {!shown.length && <div className="empty">No {GROUP_META[group]?.label.toLowerCase()} sessions in this stretch.</div>}
      {!done && first.data?.has_more !== false && (
        <button type="button" className="btn btn--soft" style={{ marginTop: 16 }} onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show older activities'}
        </button>
      )}
    </>
  )
}

function CalendarView() {
  const now = new Date()
  const [ym, setYm] = useState([now.getFullYear(), now.getMonth() + 1])
  const [picked, setPicked] = useState(null)
  const { data, error, refresh } = useApi(`/api/calendar?year=${ym[0]}&month=${ym[1]}`)
  const first = new Date(ym[0], ym[1] - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const daysIn = new Date(ym[0], ym[1], 0).getDate()
  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(`${ym[0]}-${String(ym[1]).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  const step = (k) => { setPicked(null); setYm(([y, m]) => { const d = new Date(y, m - 1 + k, 1); return [d.getFullYear(), d.getMonth() + 1] }) }
  const t = data?.totals
  const dd = distance(t?.distance_m)
  const pickedActs = picked ? data?.days?.[picked] || [] : []
  const groupsUsed = [...new Set(Object.values(data?.days || {}).flat().map((a) => a.group))]
  return (
    <>
      <Card>
        <div className="row row--between" style={{ marginBottom: 14 }}>
          <button type="button" className="icon-btn" style={{ background: 'var(--surface-2)' }} onClick={() => step(-1)} aria-label="Previous month"><ChevronLeft size={20} /></button>
          <div style={{ fontWeight: 600, fontSize: 17 }}>{monthName(ym[0], ym[1])}</div>
          <button type="button" className="icon-btn" style={{ background: 'var(--surface-2)' }} onClick={() => step(1)} aria-label="Next month"><ChevronRight size={20} /></button>
        </div>
        {error && !data ? <ErrorBox error={error} onRetry={refresh} /> : (
          <div className="cal">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="cal__dow">{d}</div>)}
            {cells.map((iso, i) => {
              if (!iso) return <div key={`x${i}`} />
              const acts = data?.days?.[iso] || []
              const bg = acts.length ? groupMeta(acts[0].group).color : undefined
              return (
                <button key={iso} type="button" className={`cal__day ${acts.length ? 'cal__day--has' : ''} ${iso === todayISO() ? 'cal__day--today' : ''}`}
                  style={bg ? { background: bg } : undefined} aria-pressed={picked === iso}
                  aria-label={`${iso}: ${acts.length} activities`} onClick={() => setPicked(acts.length ? iso : null)}>
                  {+iso.slice(8)}
                  {acts.length > 1 && <span style={{ position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: '50%', background: 'var(--ink)', color: 'var(--bg)', fontSize: 10, display: 'grid', placeItems: 'center' }}>{acts.length}</span>}
                </button>
              )
            })}
          </div>
        )}
        {groupsUsed.length > 0 && (
          <div className="legend">
            {groupsUsed.map((g) => <span key={g} className="legend__item"><span className="legend__key" style={{ background: groupMeta(g).color, borderRadius: '50%' }} />{groupMeta(g).label}</span>)}
          </div>
        )}
      </Card>
      {t && (
        <div className="bento" style={{ marginTop: 10 }}>
          <Card size="tile"><div className="stat__v">{t.activities}</div><div className="stat__l">Activities</div></Card>
          <Card size="tile"><div className="stat__v">{dd.value}<span className="unit"> {dd.unit}</span></div><div className="stat__l">Distance</div></Card>
          <Card size="tile"><div className="stat__v">{hm(t.duration_s)}</div><div className="stat__l">Time</div></Card>
          <Card size="tile"><div className="stat__v">{n(t.load)}</div><div className="stat__l">Training load</div></Card>
        </div>
      )}
      {picked && (
        <>
          <div className="week-head"><b>{dayLabel(picked)}</b></div>
          <div className="stack" style={{ gap: 8 }}>
            {pickedActs.map((a) => <ActivityRow key={a.id} a={{ ...a, start_local: `${picked} 00:00` }} />)}
          </div>
        </>
      )}
    </>
  )
}

export default function Activities() {
  const [view, setView] = useState('list')
  const [group, setGroup] = useState('all')
  const scrollRef = useRef(null)
  const list = useApi('/api/activities?limit=40')
  const pull = usePullToRefresh(list.refresh, scrollRef)
  const counts = useMemo(() => {
    const c = {}
    for (const a of list.data?.items || []) c[a.group] = (c[a.group] || 0) + 1
    return c
  }, [list.data])
  return (
    <div className="scroller" ref={scrollRef}>
      <div className="wrap">
        <PullIndicator pull={pull} />
        <Header title="Activities" at={list.at} refreshing={list.refreshing} />
        <div style={{ margin: '4px 0 12px' }}>
          <Seg label="View" value={view} onChange={setView} options={[['list', 'List'], ['calendar', 'Calendar']]} />
        </div>
        {view === 'list' ? (
          <>
            <div className="chips">
              <Chip active={group === 'all'} onClick={() => setGroup('all')}>All</Chip>
              {Object.keys(GROUP_META).filter((g) => counts[g]).map((g) => (
                <Chip key={g} active={group === g} onClick={() => setGroup(g)} count={counts[g]}>{GROUP_META[g].label}</Chip>
              ))}
            </div>
            <ListView group={group} />
          </>
        ) : <CalendarView />}
      </div>
    </div>
  )
}
