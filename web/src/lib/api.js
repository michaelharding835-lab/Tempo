// Talks to the Tempo backend (or the bundled sample data) and keeps a local cache so
// screens paint instantly, then refresh from Garmin.

const CONN_KEY = 'tempo:conn'
const CACHE_PREFIX = 'tempo:cache:'
const MAX_CACHE = 60

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function getConn() {
  try { return JSON.parse(localStorage.getItem(CONN_KEY) || 'null') } catch { return null }
}

export function setConn(conn) {
  try { localStorage.setItem(CONN_KEY, JSON.stringify(conn)) } catch { /* ignore */ }
  listeners.forEach((fn) => fn(conn))
}

const listeners = new Set()
export const onConnChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

export const isDemo = () => { const c = getConn(); return !c || !!c.demo }

function base() {
  const c = getConn()
  return (c?.server || '').replace(/\/$/, '')
}

function headers(extra = {}) {
  const c = getConn()
  return { ...(c?.key ? { Authorization: `Bearer ${c.key}` } : {}), ...extra }
}

async function parseError(res) {
  let body = null
  try { body = await res.json() } catch { /* not json */ }
  const d = body?.detail
  const message = (typeof d === 'object' ? d?.message : d) || `The server answered ${res.status}.`
  return new ApiError(message, typeof d === 'object' ? d?.code : null, res.status)
}

async function request(path, opts = {}) {
  if (isDemo()) {
    const demo = await import('./demo.js')
    return demo.get(path, opts)
  }
  let res
  try {
    res = await fetch(base() + path, {
      ...opts,
      headers: headers(opts.body ? { 'Content-Type': 'application/json' } : {}),
    })
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 'offline', 0)
  }
  if (!res.ok) throw await parseError(res)
  return res.json()
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
}

// Probe a server without saving it.
export async function probe(server, key) {
  const root = (server || '').replace(/\/$/, '')
  const res = await fetch(`${root}/api/check`, { headers: key ? { Authorization: `Bearer ${key}` } : {} })
  if (!res.ok) throw await parseError(res)
  return res.json()
}

export async function sameOriginHealth() {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3500)
    const res = await fetch('/api/health', { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const body = await res.json()
    return body?.ok ? body : null
  } catch {
    return null
  }
}

// ---- cache
const memory = new Map()

export function readCache(path) {
  if (memory.has(path)) return memory.get(path)
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + (isDemo() ? 'demo:' : '') + path)
    if (!raw) return null
    const hit = JSON.parse(raw)
    memory.set(path, hit)
    return hit
  } catch {
    return null
  }
}

export function writeCache(path, data) {
  const hit = { t: Date.now(), data }
  memory.set(path, hit)
  if (isDemo()) return
  try {
    localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(hit))
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX))
    if (keys.length > MAX_CACHE) {
      keys.map((k) => [k, JSON.parse(localStorage.getItem(k) || '{}').t || 0])
        .sort((a, b) => a[1] - b[1]).slice(0, keys.length - MAX_CACHE)
        .forEach(([k]) => localStorage.removeItem(k))
    }
  } catch {
    // Storage full: drop the oldest half and move on.
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).slice(0, 20).forEach((k) => localStorage.removeItem(k))
    } catch { /* ignore */ }
  }
}

export function clearCache() {
  memory.clear()
  try { Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
}

// ---- coach (newline-delimited JSON stream)
export async function askCoach({ messages, today, about }, onEvent, signal) {
  if (isDemo()) {
    const demo = await import('./demo.js')
    return demo.coach(messages, onEvent, signal)
  }
  const res = await fetch(base() + '/api/coach', {
    method: 'POST', signal,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ messages, today, about }),
  })
  if (!res.ok) throw await parseError(res)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (line) { try { onEvent(JSON.parse(line)) } catch { /* partial */ } }
    }
  }
  if (buf.trim()) { try { onEvent(JSON.parse(buf)) } catch { /* ignore */ } }
}
