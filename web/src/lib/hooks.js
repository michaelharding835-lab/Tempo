import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, readCache, writeCache } from './api'

// Paths already refreshed from Garmin during this app session.
const freshThisSession = new Set()
const inflight = new Map()

function fetchOnce(path) {
  if (!inflight.has(path)) {
    inflight.set(path, api.get(path).finally(() => inflight.delete(path)))
  }
  return inflight.get(path)
}

/**
 * Stale-while-revalidate: show the cached copy instantly, then pull fresh data.
 * The first view of a screen in each session asks the server to bypass its cache, so
 * opening the app always pulls the latest from Garmin.
 */
export function useApi(path, { freshKey = true } = {}) {
  const cached = path ? readCache(path) : null
  const [state, setState] = useState({ data: cached?.data ?? null, error: null, loading: !cached, refreshing: false, at: cached?.t ?? null })
  const pathRef = useRef(path)

  const load = useCallback(async (forceFresh = false) => {
    if (!path) return
    const wantFresh = forceFresh || (freshKey && !freshThisSession.has(path))
    const url = wantFresh ? `${path}${path.includes('?') ? '&' : '?'}fresh=1` : path
    setState((s) => ({ ...s, refreshing: !!s.data, loading: !s.data, error: null }))
    try {
      const data = await fetchOnce(url)
      if (pathRef.current !== path) return
      freshThisSession.add(path)
      writeCache(path, data)
      setState({ data, error: null, loading: false, refreshing: false, at: Date.now() })
    } catch (error) {
      if (pathRef.current !== path) return
      setState((s) => ({ ...s, error, loading: false, refreshing: false }))
    }
  }, [path, freshKey])

  useEffect(() => {
    pathRef.current = path
    const hit = path ? readCache(path) : null
    setState({ data: hit?.data ?? null, error: null, loading: !!path && !hit, refreshing: false, at: hit?.t ?? null })
    load(false)
  }, [path, load])

  // Coming back to the app after a while counts as opening it.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && state.at && Date.now() - state.at > 5 * 60 * 1000) load(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load, state.at])

  return { ...state, refresh: () => load(true) }
}

export function useMeasure() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

export function usePersistent(key, initial) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ } }, [key, value])
  return [value, setValue]
}

// Pull-to-refresh for a scroll container.
export function usePullToRefresh(onRefresh, scrollRef) {
  const [pull, setPull] = useState(0)
  const start = useRef(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const down = (e) => { if (el.scrollTop <= 0) start.current = e.touches[0].clientY }
    const move = (e) => {
      if (start.current == null) return
      const dy = e.touches[0].clientY - start.current
      if (dy > 0 && el.scrollTop <= 0) setPull(Math.min(110, dy * 0.5))
    }
    const up = () => {
      if (start.current == null) return
      start.current = null
      setPull((p) => { if (p > 64) onRefresh(); return 0 })
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', up)
    return () => { el.removeEventListener('touchstart', down); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', up) }
  }, [onRefresh, scrollRef])
  return pull
}
