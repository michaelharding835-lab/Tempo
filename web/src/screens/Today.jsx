import { useRef } from 'react'
import { LayoutGrid, RefreshCw, Settings, User } from 'lucide-react'
import { useApi, usePullToRefresh } from '../lib/hooks'
import { isDemo } from '../lib/api'
import { dayLabel, greeting, relative, todayISO } from '../lib/format'
import { useSettings } from '../lib/settings'
import { ErrorBox, LoadingGrid, useNav } from '../components/ui'
import { WIDGET_COMPONENTS } from './widgets'

export function initial() {
  let name = ''
  try { name = localStorage.getItem('tempo:name') || '' } catch { /* ignore */ }
  return name.trim() ? name.trim().charAt(0).toUpperCase() : <User size={18} />
}

export function Header({ title, sub, at, refreshing, right }) {
  const nav = useNav()
  const stale = at && Date.now() - at > 30 * 60 * 1000
  return (
    <>
      <div className="topbar">
        <div className="sync-line">
          {refreshing ? <RefreshCw size={12} className="spin" /> : <span className={`sync-dot ${stale ? 'sync-dot--stale' : ''}`} />}
          {refreshing ? 'Pulling from Garmin…' : isDemo() ? 'Sample data' : at ? `Updated ${relative(at)}` : ''}
        </div>
        <div className="topbar__actions">
          {right}
          <button type="button" className="icon-btn" aria-label="Settings" onClick={() => nav.push('settings')}><Settings size={19} /></button>
          <button type="button" className="avatar" aria-label="Profile" onClick={() => nav.push('profile')}>{initial()}</button>
        </div>
      </div>
      <h1 className="screen-title">{title}</h1>
      {sub && <p className="screen-sub">{sub}</p>}
    </>
  )
}

export function PullIndicator({ pull }) {
  return (
    <div className="pull" style={{ height: pull }} aria-hidden="true">
      <RefreshCw size={20} style={{ transform: `rotate(${pull * 3}deg)`, opacity: pull > 64 ? 1 : 0.5 }} />
    </div>
  )
}

export default function Today() {
  const { settings } = useSettings()
  const nav = useNav()
  const scrollRef = useRef(null)
  const { data, error, loading, refreshing, at, refresh } = useApi(`/api/today?date=${todayISO()}`)
  const pull = usePullToRefresh(refresh, scrollRef)
  const name = data?.profile?.name?.split(' ')[0]
  if (data?.profile?.name) { try { localStorage.setItem('tempo:name', data.profile.name) } catch { /* ignore */ } }
  return (
    <div className="scroller" ref={scrollRef}>
      <div className="wrap">
        <PullIndicator pull={pull} />
        <Header
          title={name ? `${greeting()}, ${name}` : greeting()}
          sub={dayLabel(todayISO()) === 'Today' ? new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
          at={at} refreshing={refreshing}
          right={<button type="button" className="icon-btn" aria-label="Customise Today" onClick={() => nav.push('customize')}><LayoutGrid size={18} /></button>}
        />
        {isDemo() && (
          <button type="button" className="banner" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.push('settings', { section: 'connection' })}>
            <span className="grow">You’re looking at sample data. Connect your Garmin to see your own.</span>
            <b>Connect</b>
          </button>
        )}
        {error && !data && <ErrorBox error={error} onRetry={refresh} />}
        {loading && !data && <LoadingGrid />}
        {data && (
          <div className="bento">
            {settings.today.filter((w) => w.on).map((w) => {
              const Comp = WIDGET_COMPONENTS[w.id]
              return Comp ? <Comp key={w.id} data={data} cfg={w} /> : null
            })}
          </div>
        )}
        {error && data && <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>Showing saved data — {error.message}</p>}
        {data?.missing?.length > 0 && (
          <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>Garmin didn’t return: {data.missing.join(', ').replaceAll('_', ' ')}.</p>
        )}
      </div>
    </div>
  )
}
