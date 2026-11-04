import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, RotateCcw, Sparkles, Square } from 'lucide-react'
import { askCoach, isDemo } from '../lib/api'
import { usePersistent } from '../lib/hooks'
import { todayISO } from '../lib/format'
import { DEFAULT_PROMPTS, useSettings } from '../lib/settings'
import { RichText, useNav } from '../components/ui'
import { initial } from './Today'

export default function Coach({ draft }) {
  const { settings } = useSettings()
  const nav = useNav()
  const [messages, setMessages] = usePersistent('tempo:coach', [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef(null)
  const scrollRef = useRef(null)
  const lastDraft = useRef(null)

  const scrollDown = () => requestAnimationFrame(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  const send = async (text) => {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput('')
    const history = [...messages.filter((m) => !m.error), { role: 'user', content: q }]
    setMessages([...history, { role: 'assistant', content: '', tools: [], pending: true }])
    setBusy(true)
    scrollDown()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const patch = (fn) => setMessages((ms) => { const copy = [...ms]; copy[copy.length - 1] = fn({ ...copy[copy.length - 1] }); return copy })
    try {
      await askCoach({ messages: history.map(({ role, content }) => ({ role, content })), today: todayISO(), about: settings.coach.about }, (e) => {
        if (e.type === 'text') patch((m) => ({ ...m, content: m.content + e.text }))
        if (e.type === 'tool') patch((m) => ({ ...m, tools: [...(m.tools || []), e.label || e.name] }))
        if (e.type === 'error') patch((m) => ({ ...m, content: e.message, error: true }))
        scrollDown()
      }, ctrl.signal)
    } catch (err) {
      if (err.name !== 'AbortError') patch((m) => ({ ...m, content: err.message || 'The coach is unavailable right now.', error: true }))
    } finally {
      patch((m) => ({ ...m, pending: false }))
      setBusy(false)
      abortRef.current = null
    }
  }

  useEffect(() => {
    if (draft && draft.at !== lastDraft.current) {
      lastDraft.current = draft.at
      send(draft.prompt)
    }
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scrollDown() }, [])

  return (
    <>
      <div className="scroller" ref={scrollRef} style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 170px)' }}>
        <div className="wrap">
          <div className="topbar">
            <div className="sync-line"><Sparkles size={13} />{isDemo() ? 'Sample coach' : 'Reads your live Garmin data'}</div>
            <div className="topbar__actions">
              {messages.length > 0 && (
                <button type="button" className="icon-btn" aria-label="New conversation" onClick={() => { abortRef.current?.abort(); setMessages([]) }}><RotateCcw size={18} /></button>
              )}
              <button type="button" className="avatar" aria-label="Profile" onClick={() => nav.push('profile')}>{initial()}</button>
            </div>
          </div>
          <h1 className="screen-title">Coach</h1>
          {messages.length === 0 ? (
            <>
              <p className="screen-sub">Ask anything about your training, recovery or races. The coach checks your Garmin data before it answers.</p>
              <div className="suggest">
                {DEFAULT_PROMPTS.map((p) => <button key={p} type="button" onClick={() => send(p)}>{p}</button>)}
              </div>
            </>
          ) : (
            <div className="coach" style={{ marginTop: 14 }} aria-live="polite">
              {messages.map((m, i) => m.role === 'user' ? (
                <div key={i} className="msg msg--user">{m.content}</div>
              ) : (
                <div key={i} className="msg msg--bot" style={m.error ? { color: 'var(--bad)' } : undefined}>
                  {m.tools?.length > 0 && (
                    <div>{m.tools.map((t, j) => <span key={j} className="tool-chip"><Check size={13} />{t}</span>)}</div>
                  )}
                  {m.content ? <RichText text={m.content} /> : m.pending ? <span className="muted">{m.tools?.length ? 'Thinking it through…' : 'Checking your data…'}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
        <div className="composer__inner">
          <textarea rows={1} value={input} placeholder="Ask your coach" aria-label="Message the coach"
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px` }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          {busy ? (
            <button type="button" className="send" aria-label="Stop" onClick={() => abortRef.current?.abort()}><Square size={14} fill="currentColor" /></button>
          ) : (
            <button type="submit" className="send" aria-label="Send" disabled={!input.trim()}><ArrowUp size={19} /></button>
          )}
        </div>
      </form>
    </>
  )
}
