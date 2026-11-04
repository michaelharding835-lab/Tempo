import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { Activity, HeartPulse, House, Sparkles, TrendingUp } from 'lucide-react'
import { NavContext } from './components/ui'
import { getConn, onConnChange, readCache, sameOriginHealth, setConn } from './lib/api'
import { todayISO } from './lib/format'
import { useSettings } from './lib/settings'
import Today from './screens/Today'
import Activities from './screens/Activities'
import ActivityDetail from './screens/ActivityDetail'
import Training from './screens/Training'
import Health, { MetricPage } from './screens/Health'
import Coach from './screens/Coach'
import Settings, { Customize } from './screens/Settings'
import Profile from './screens/Profile'
import HyroxHistory from './screens/Hyrox'
import MusclesPage from './screens/Muscles'
import Welcome from './screens/Welcome'

const TABS = [
  ['today', 'Today', House],
  ['activities', 'Activities', Activity],
  ['training', 'Training', TrendingUp],
  ['health', 'Health', HeartPulse],
  ['coach', 'Coach', Sparkles],
]

// Inside an embedded preview, leave the host's browser history alone.
const USE_HISTORY = typeof window !== 'undefined' && window.self === window.top

const PAGES = {
  activity: ActivityDetail,
  metric: MetricPage,
  settings: Settings,
  customize: Customize,
  profile: Profile,
  hyrox: HyroxHistory,
  muscles: MusclesPage,
}

function Page({ entry, onBack }) {
  const Comp = PAGES[entry.name]
  const controls = useDragControls()
  return (
    <motion.div className="page" role="dialog" aria-modal="true"
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'tween', ease: [0.2, 0.8, 0.2, 1], duration: 0.32 }}
      drag="x" dragControls={controls} dragListener={false} dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0, right: 0.9 }}
      onDragEnd={(_, info) => { if (info.offset.x > 90 || info.velocity.x > 500) onBack() }}>
      <div onPointerDown={(e) => controls.start(e)} aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 22, zIndex: 20, touchAction: 'none' }} />
      {Comp ? <Comp {...entry.props} /> : null}
    </motion.div>
  )
}

export default function App() {
  const { settings } = useSettings()
  const [conn, setConnState] = useState(getConn)
  const [booting, setBooting] = useState(!getConn())
  const [tab, setTab] = useState(settings.defaultTab || 'today')
  const [visited, setVisited] = useState(() => new Set([settings.defaultTab || 'today']))
  const [stack, setStack] = useState([])
  const [coachDraft, setCoachDraft] = useState(null)
  const idRef = useRef(0)

  useEffect(() => onConnChange((c) => setConnState(c)), [])

  // First launch: if this page is served by a Tempo backend, ask for its key; otherwise show sample data.
  useEffect(() => {
    if (getConn()) return
    sameOriginHealth().then((health) => {
      if (!health) setConn({ demo: true, server: '', key: '' })
      setBooting(false)
    })
  }, [])

  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), [])
  useEffect(() => {
    const onPop = () => setStack((s) => (s.length ? s.slice(0, -1) : s))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const nav = useMemo(() => {
    const profileName = readCache(`/api/today?date=${todayISO()}`)?.data?.profile?.name
    return {
      push: (name, props = {}) => {
        idRef.current += 1
        setStack((s) => [...s, { id: idRef.current, name, props }])
        if (USE_HISTORY) { try { window.history.pushState({ page: name }, '') } catch { /* ignore */ } }
      },
      pop: () => { if (USE_HISTORY && window.history.state?.page) window.history.back(); else pop() },
      tab: (t) => { setStack([]); setTab(t); setVisited((v) => new Set(v).add(t)) },
      ask: (prompt) => { setStack([]); setCoachDraft({ prompt, at: Date.now() }); setTab('coach'); setVisited((v) => new Set(v).add('coach')) },
      current: tab,
      initial: (profileName || 'You').trim().charAt(0).toUpperCase(),
    }
  }, [pop, tab])

  if (booting) return <div className="app" style={{ display: 'grid', placeItems: 'center' }}><div className="num num-m muted">Tempo</div></div>
  if (!conn) return <NavContext.Provider value={nav}><Welcome /></NavContext.Provider>

  const screens = { today: Today, activities: Activities, training: Training, health: Health, coach: Coach }
  return (
    <NavContext.Provider value={nav}>
      <div className="app">
        {TABS.map(([key]) => {
          if (!visited.has(key)) return null
          const S = screens[key]
          return (
            <section key={key} hidden={tab !== key} aria-hidden={tab !== key} style={{ display: tab === key ? 'block' : 'none' }}>
              <S active={tab === key} draft={key === 'coach' ? coachDraft : undefined} />
            </section>
          )
        })}
        <nav className="tabbar" aria-label="Main">
          {TABS.map(([key, label, Icon]) => (
            <button key={key} type="button" className="tab" aria-current={tab === key ? 'page' : undefined}
              onClick={() => { if (tab === key && stack.length) setStack([]); nav.tab(key) }}>
              {tab === key && <motion.span layoutId="tabpill" className="tab__pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <Icon size={21} strokeWidth={tab === key ? 2.3 : 2} />
              {label}
            </button>
          ))}
        </nav>
        <AnimatePresence>
          {stack.map((entry) => <Page key={entry.id} entry={entry} onBack={nav.pop} />)}
        </AnimatePresence>
      </div>
    </NavContext.Provider>
  )
}
