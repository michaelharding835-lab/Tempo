import { useState } from 'react'
import { clearCache, probe, setConn } from '../lib/api'

// Shown the first time the app opens on its own server: ask for the access key.
export default function Welcome() {
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true); setErr('')
    try {
      await probe('', key.trim())
      clearCache()
      setConn({ demo: false, server: '', key: key.trim() })
    } catch (e) {
      setErr(e.message)
    } finally { setBusy(false) }
  }
  return (
    <div className="scroller" style={{ paddingBottom: 40 }}>
      <div className="wrap" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 40 }}>
        <div className="card card--hero" style={{ padding: 28 }}>
          <div className="num num-hero" style={{ fontSize: 64 }}>Tempo</div>
          <p className="lead" style={{ margin: '14px 0 0' }}>Your Garmin data, pulled fresh every time you open the app.</p>
        </div>
        <label className="field-label" htmlFor="welcome-key" style={{ marginTop: 24 }}>Access key</label>
        <input id="welcome-key" className="field" type="password" value={key} onChange={(e) => setKey(e.target.value)}
          placeholder="The APP_ACCESS_KEY you set in Vercel" autoCapitalize="off" autoCorrect="off"
          onKeyDown={(e) => { if (e.key === 'Enter') connect() }} />
        {err && <p className="small" style={{ color: 'var(--bad)', margin: '8px 2px 0' }}>{err}</p>}
        <button type="button" className="btn" style={{ marginTop: 14 }} disabled={!key.trim() || busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</button>
        <button type="button" className="btn btn--soft" style={{ marginTop: 10 }} onClick={() => setConn({ demo: true, server: '', key: '' })}>Explore with sample data</button>
      </div>
    </div>
  )
}
