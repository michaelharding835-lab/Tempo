import { useEffect, useRef, useState } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import { ArrowDown, ArrowUp, Check, Copy, GripVertical, KeyRound, Link2, Server, Smartphone } from 'lucide-react'
import { api, clearCache, getConn, isDemo, probe, setConn } from '../lib/api'
import { DEFAULTS, HEALTH, WIDGETS, useSettings } from '../lib/settings'
import { Card, PageHead, Seg, Switch, useNav } from '../components/ui'

function Row({ title, sub, children, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className="list__row" onClick={onClick}>
      <span className="list__main"><span className="list__title">{title}</span>{sub && <div className="list__sub">{sub}</div>}</span>
      {children}
    </Tag>
  )
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="icon-btn" style={{ background: 'var(--surface-2)' }} aria-label="Copy"
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  )
}

// ---------------------------------------------------------------- connection

function Connection() {
  const conn = getConn() || { demo: true }
  const [server, setServer] = useState(conn.server || '')
  const [key, setKey] = useState(conn.key || '')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const test = async () => {
    setBusy(true); setStatus(null)
    try {
      const res = await probe(server, key)
      setConn({ demo: false, server: server.trim(), key: key.trim() })
      clearCache()
      setStatus({ ok: true, text: `Connected${res.profile?.name ? ` as ${res.profile.name}` : ''}. ${res.mode === 'sample' ? 'The server is running in sample mode.' : 'Live Garmin data.'}` })
    } catch (e) {
      setStatus({ ok: false, text: e.message })
    } finally { setBusy(false) }
  }
  return (
    <>
      <div className="list">
        <Row title="Use sample data" sub="Explore the app without a Garmin account">
          <Switch checked={!!conn.demo} label="Use sample data" onChange={(v) => { setConn({ ...conn, demo: v }); clearCache(); location.reload() }} />
        </Row>
      </div>
      <Card style={{ marginTop: 10 }}>
        <label className="field-label" htmlFor="server" style={{ marginTop: 0 }}>Server address</label>
        <input id="server" className="field" placeholder="Leave blank if this app is on your server" value={server} onChange={(e) => setServer(e.target.value)} autoCapitalize="off" autoCorrect="off" inputMode="url" />
        <label className="field-label" htmlFor="key">Access key</label>
        <input id="key" className="field" type="password" placeholder="APP_ACCESS_KEY from Vercel" value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        <button type="button" className="btn" style={{ marginTop: 14 }} onClick={test} disabled={busy}>{busy ? 'Checking…' : 'Connect'}</button>
        {status && <p className="small" style={{ margin: '10px 0 0', color: status.ok ? 'var(--good)' : 'var(--bad)' }}>{status.text}</p>}
      </Card>
    </>
  )
}

function GarminAccount() {
  const [mode, setMode] = useState('tokens')
  const [tokens, setTokens] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needsMfa, setNeedsMfa] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn) => {
    setBusy(true); setMsg(null)
    try { const r = await fn(); if (r?.needs_mfa) { setNeedsMfa(true); setMsg({ ok: true, text: 'Garmin sent you a code. Enter it below.' }) } else { setMsg({ ok: true, text: `Garmin connected${r?.name ? ` — hi ${r.name}` : ''}.` }); clearCache() } }
    catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }
  if (isDemo()) return <p className="list-note">Connect to your server first, then link Garmin here.</p>
  return (
    <Card>
      <Seg label="Sign-in method" value={mode} onChange={setMode} options={[['tokens', 'Paste tokens'], ['password', 'Email & password']]} />
      {mode === 'tokens' ? (
        <>
          <p className="small muted" style={{ margin: '12px 0 0' }}>Run <span className="kbd-hint">python scripts/garmin_login.py</span> on your laptop once and paste what it prints. This is the most reliable way.</p>
          <textarea className="field" style={{ marginTop: 10, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} placeholder='{"di_token": …}' value={tokens} onChange={(e) => setTokens(e.target.value)} />
          <button type="button" className="btn" style={{ marginTop: 12 }} disabled={busy || !tokens.trim()} onClick={() => run(() => api.post('/api/garmin/tokens', { tokens }))}>Save tokens</button>
        </>
      ) : (
        <>
          <p className="small muted" style={{ margin: '12px 0 0' }}>Signs in from the server. Garmin sometimes blocks cloud sign-ins — if it does, use the token method. Your password is used once and never stored.</p>
          {!needsMfa ? (
            <>
              <input className="field" style={{ marginTop: 10 }} placeholder="Garmin email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className="field" style={{ marginTop: 8 }} placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="btn" style={{ marginTop: 12 }} disabled={busy || !email || !password} onClick={() => run(() => api.post('/api/garmin/login', { email, password }).finally(() => setPassword('')))}>Sign in to Garmin</button>
            </>
          ) : (
            <>
              <input className="field" style={{ marginTop: 10 }} placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              <button type="button" className="btn" style={{ marginTop: 12 }} disabled={busy || !code} onClick={() => run(() => api.post('/api/garmin/mfa', { code }))}>Verify code</button>
            </>
          )}
        </>
      )}
      {msg && <p className="small" style={{ margin: '10px 0 0', color: msg.ok ? 'var(--good)' : 'var(--bad)' }}>{msg.text}</p>}
    </Card>
  )
}

// ---------------------------------------------------------------- customise Today

function WidgetRow({ w, onChange }) {
  const controls = useDragControls()
  const meta = WIDGETS[w.id]
  const styles = Object.entries(meta.styles)
  return (
    <Reorder.Item value={w} dragListener={false} dragControls={controls} as="div"
      style={{ background: 'var(--surface)', borderRadius: 20, padding: '10px 12px', marginBottom: 8, listStyle: 'none', position: 'relative' }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="drag-handle" onPointerDown={(e) => controls.start(e)} aria-label={`Drag to reorder ${meta.title}`}><GripVertical size={18} /></span>
        <span className="grow" style={{ fontWeight: 500, opacity: w.on ? 1 : 0.5 }}>{meta.title}</span>
        <Switch checked={w.on} label={`Show ${meta.title}`} onChange={(v) => onChange({ ...w, on: v })} />
      </div>
      {w.on && (meta.sizes.length > 1 || styles.length > 1) && (
        <div className="stack" style={{ gap: 8, marginTop: 10, paddingLeft: 30 }}>
          {meta.sizes.length > 1 && (
            <Seg label="Size" value={w.size} onChange={(v) => onChange({ ...w, size: v })} options={meta.sizes.map((s) => [s, s === 'full' ? 'Wide' : 'Half'])} />
          )}
          {styles.length > 1 && (
            <Seg label="Style" value={w.style} onChange={(v) => onChange({ ...w, style: v })} options={styles} />
          )}
        </div>
      )}
      {w.on && meta.note && <div className="small muted" style={{ marginTop: 8, paddingLeft: 30 }}>{meta.note}</div>}
    </Reorder.Item>
  )
}

export function Customize() {
  const { settings, update } = useSettings()
  const setList = (list) => update({ today: list })
  return (
    <div className="scroller">
      <div className="wrap">
        <PageHead title="Customise Today" right={<button type="button" className="link" style={{ width: 40 }} onClick={() => update({ today: DEFAULTS.today })}>Reset</button>} />
        <p className="lead" style={{ margin: '4px 4px 14px' }}>Drag to reorder. Choose which cards appear, how wide they are and how each one draws its chart.</p>
        <Reorder.Group axis="y" values={settings.today} onReorder={setList} as="div">
          {settings.today.map((w) => (
            <WidgetRow key={w.id} w={w} onChange={(next) => setList(settings.today.map((x) => (x.id === next.id ? next : x)))} />
          ))}
        </Reorder.Group>
      </div>
    </div>
  )
}

function HealthOrder() {
  const { settings, update } = useSettings()
  const list = settings.health
  const move = (i, k) => {
    const next = [...list]
    const [item] = next.splice(i, 1)
    next.splice(Math.max(0, Math.min(next.length, i + k)), 0, item)
    update({ health: next })
  }
  return (
    <div className="list">
      {list.map((h, i) => (
        <div key={h.id} className="list__row">
          <span className="list__main" style={{ opacity: h.on ? 1 : 0.5 }}>{HEALTH[h.id]}</span>
          <button type="button" className="icon-btn icon-btn--ghost" aria-label={`Move ${HEALTH[h.id]} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={17} /></button>
          <button type="button" className="icon-btn icon-btn--ghost" aria-label={`Move ${HEALTH[h.id]} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={17} /></button>
          <Switch checked={h.on} label={`Show ${HEALTH[h.id]}`} onChange={(v) => update({ health: list.map((x) => (x.id === h.id ? { ...x, on: v } : x)) })} />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- settings page

export default function Settings({ section }) {
  const { settings, update, reset } = useSettings()
  const nav = useNav()
  const refs = { connection: useRef(null), hyrox: useRef(null) }
  const [syncMsg, setSyncMsg] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => { if (section && refs[section]?.current) setTimeout(() => refs[section].current.scrollIntoView({ behavior: 'smooth' }), 380) }, [section]) // eslint-disable-line
  const conn = getConn()
  const origin = conn?.server || (typeof location !== 'undefined' ? location.origin : '')
  const mcpCmd = `claude mcp add --transport http garmin ${origin}/mcp --header "Authorization: Bearer ${conn?.key || '<your access key>'}"`
  const set = (key) => (v) => update({ [key]: v })
  const setIn = (group, key) => (v) => update((s) => ({ ...s, [group]: { ...s[group], [key]: v } }))
  return (
    <div className="scroller">
      <div className="wrap">
        <PageHead title="Settings" />

        <div ref={refs.connection} />
        <div className="list-label"><Server size={13} style={{ verticalAlign: -2 }} /> Connection</div>
        <Connection />
        <div className="list-label"><KeyRound size={13} style={{ verticalAlign: -2 }} /> Garmin account</div>
        <GarminAccount />

        <div className="list-label">Appearance</div>
        <div className="list">
          <Row title="Theme"><div style={{ width: 200 }}><Seg label="Theme" value={settings.theme} onChange={set('theme')} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} /></div></Row>
          <Row title="Readiness card"><div style={{ width: 200 }}><Seg label="Readiness card colour" value={settings.hero} onChange={set('hero')} options={[['black', 'Black'], ['blue', 'Blue'], ['lime', 'Lime']]} /></div></Row>
          <Row title="Units"><div style={{ width: 200 }}><Seg label="Units" value={settings.units} onChange={set('units')} options={[['metric', 'Metric'], ['imperial', 'Imperial']]} /></div></Row>
          <Row title="Maps" sub="Street maps load from OpenStreetMap"><div style={{ width: 200 }}><Seg label="Map style" value={settings.map} onChange={set('map')} options={[['streets', 'Streets'], ['minimal', 'Minimal']]} /></div></Row>
          <Row title="Open the app on"><div style={{ width: 200 }}>
            <select className="field" style={{ height: 36 }} value={settings.defaultTab} onChange={(e) => set('defaultTab')(e.target.value)} aria-label="Start screen">
              <option value="today">Today</option><option value="activities">Activities</option><option value="training">Training</option><option value="health">Health</option><option value="coach">Coach</option>
            </select></div></Row>
        </div>

        <div className="list-label">Charts</div>
        <div className="list">
          <Row title="Gridlines"><Switch checked={settings.charts.grid} label="Gridlines" onChange={setIn('charts', 'grid')} /></Row>
          <Row title="Smooth curves"><Switch checked={settings.charts.smooth} label="Smooth curves" onChange={setIn('charts', 'smooth')} /></Row>
          <Row title="Animate charts"><Switch checked={settings.charts.animate} label="Animate charts" onChange={setIn('charts', 'animate')} /></Row>
          <Row title="Route previews in activity lists"><Switch checked={settings.activities.maps} label="Route previews" onChange={setIn('activities', 'maps')} /></Row>
        </div>

        <div className="list-label">Screens</div>
        <div className="list">
          <Row title="Customise Today" sub="Order, size and chart style of every card" onClick={() => nav.push('customize')}><span className="list__value">›</span></Row>
        </div>
        <div className="list-label">Health sections</div>
        <HealthOrder />

        <div ref={refs.hyrox} />
        <div className="list-label">HYROX</div>
        <Card>
          <label className="field-label" style={{ marginTop: 0 }} htmlFor="race-name">Next race</label>
          <input id="race-name" className="field" placeholder="e.g. HYROX Johannesburg" value={settings.hyrox.raceName} onChange={(e) => setIn('hyrox', 'raceName')(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <div className="grow"><label className="field-label" htmlFor="race-date">Date</label><input id="race-date" type="date" className="field" value={settings.hyrox.raceDate} onChange={(e) => setIn('hyrox', 'raceDate')(e.target.value)} /></div>
            <div className="grow"><label className="field-label" htmlFor="race-target">Target time</label><input id="race-target" className="field" placeholder="1:10:00" value={settings.hyrox.target} onChange={(e) => setIn('hyrox', 'target')(e.target.value)} /></div>
          </div>
          <label className="field-label">Division</label>
          <Seg label="Division" value={settings.hyrox.division} onChange={setIn('hyrox', 'division')} options={[['Open', 'Open'], ['Pro', 'Pro'], ['Doubles', 'Doubles'], ['Relay', 'Relay']]} />
          <p className="small muted" style={{ margin: '12px 0 0' }}>Turn on the Race countdown card in Customise Today to see it on the home screen.</p>
        </Card>

        <div className="list-label">Strength</div>
        <div className="list">
          <Row title="Count HYROX stations" sub="Adds station work to the weekly muscle map"><Switch checked={settings.strength.hyrox} label="Count HYROX stations" onChange={setIn('strength', 'hyrox')} /></Row>
          <Row title="Muscle counts as worked at" sub="Hard sets per week"><div style={{ width: 170 }}><Seg label="Sets for worked" value={settings.strength.worked} onChange={setIn('strength', 'worked')} options={[[6, '6'], [8, '8'], [10, '10'], [12, '12']]} /></div></Row>
        </div>

        <div className="list-label">Coach</div>
        <Card>
          <label className="field-label" style={{ marginTop: 0 }} htmlFor="about">About you</label>
          <textarea id="about" className="field" value={settings.coach.about} onChange={(e) => setIn('coach', 'about')(e.target.value)} placeholder="Goals, injuries, schedule — anything the coach should know" />
          <p className="small muted" style={{ margin: '8px 0 0' }}>Sent with every question so the coach can tailor its advice.</p>
        </Card>

        <div className="list-label"><Link2 size={13} style={{ verticalAlign: -2 }} /> Use your data in Claude Code</div>
        <Card>
          <p className="small" style={{ margin: '0 0 10px', color: 'var(--ink-2)' }}>Your server is also an MCP server. Add it to Claude Code (or your own assistant) with:</p>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="code grow">{mcpCmd}</div>
            <CopyButton text={mcpCmd} />
          </div>
        </Card>

        <div className="list-label"><Smartphone size={13} style={{ verticalAlign: -2 }} /> Install on iPhone</div>
        <Card>
          <p className="small" style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.5 }}>Open your app’s address in Safari, tap the Share button, then <b>Add to Home Screen</b>. It opens full screen like any other app.</p>
        </Card>

        <div className="list-label">Data</div>
        <div className="list">
          {!isDemo() && <Row title="Save settings to your server" sub={syncMsg || 'So a new phone gets the same layout'} onClick={async () => { try { await api.put('/api/settings', settings); setSyncMsg('Saved.') } catch (e) { setSyncMsg(e.message) } }} />}
          {!isDemo() && <Row title="Load settings from your server" onClick={async () => { try { const s = await api.get('/api/settings'); if (s && s.today) { update(s); setSyncMsg('Loaded.') } else setSyncMsg('Nothing saved yet.') } catch (e) { setSyncMsg(e.message) } }} />}
          <Row title="Clear saved data" sub="Forces a full reload from Garmin" onClick={() => { clearCache(); location.reload() }} />
          <Row title={confirmReset ? 'Tap again to reset everything' : 'Reset all settings'} onClick={() => { if (confirmReset) { reset(); setConfirmReset(false) } else setConfirmReset(true) }}>
            <span className="list__value" style={{ color: 'var(--bad)' }}>{confirmReset ? 'Confirm' : 'Reset'}</span>
          </Row>
        </div>
        <p className="list-note" style={{ textAlign: 'center', marginTop: 24 }}>Tempo 1.0 · Not affiliated with Garmin</p>
      </div>
    </div>
  )
}
