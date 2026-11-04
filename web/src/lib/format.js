// Number, time and unit formatting. Everything takes metric input and converts on display.

let UNITS = 'metric'
export const setUnits = (u) => { UNITS = u === 'imperial' ? 'imperial' : 'metric' }
export const units = () => UNITS

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export function n(v, digits = 0) {
  if (!isNum(v)) return '—'
  return v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function compact(v) {
  if (!isNum(v)) return '—'
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return n(v)
}

// 3725 -> "1:02:05", 345 -> "5:45"
export function clock(sec, forceHours = false) {
  if (!isNum(sec)) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(h || forceHours ? 2 : 1, '0')
  const ss = String(r).padStart(2, '0')
  return h || forceHours ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// 26100 -> "7h 15m"
export function hm(sec) {
  if (!isNum(sec)) return '—'
  const m = Math.round(sec / 60)
  const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export function hmParts(sec) {
  if (!isNum(sec)) return { h: '—', m: '' }
  const m = Math.round(sec / 60)
  return { h: Math.floor(m / 60), m: m % 60 }
}

export function distance(m, digits) {
  if (!isNum(m)) return { value: '—', unit: '' }
  if (UNITS === 'imperial') {
    const mi = m / 1609.344
    return { value: n(mi, digits ?? (mi < 10 ? 2 : 1)), unit: 'mi' }
  }
  if (m < 1000 && digits === undefined) return { value: n(m), unit: 'm' }
  const km = m / 1000
  return { value: n(km, digits ?? (km < 10 ? 2 : 1)), unit: 'km' }
}

export const distanceText = (m, digits) => { const d = distance(m, digits); return `${d.value} ${d.unit}`.trim() }

// seconds per km -> "4:45 /km"
export function pace(sPerKm) {
  if (!isNum(sPerKm) || sPerKm <= 0) return { value: '—', unit: '' }
  const s = UNITS === 'imperial' ? sPerKm * 1.609344 : sPerKm
  return { value: clock(s), unit: UNITS === 'imperial' ? '/mi' : '/km' }
}
export const paceText = (s) => { const p = pace(s); return `${p.value}${p.unit}` }

export function speed(mps) {
  if (!isNum(mps)) return { value: '—', unit: '' }
  return UNITS === 'imperial' ? { value: n(mps * 2.23694, 1), unit: 'mph' } : { value: n(mps * 3.6, 1), unit: 'km/h' }
}

export function elevation(m) {
  if (!isNum(m)) return { value: '—', unit: '' }
  return UNITS === 'imperial' ? { value: n(m * 3.28084), unit: 'ft' } : { value: n(m), unit: 'm' }
}

export function weight(kg) {
  if (!isNum(kg)) return { value: '—', unit: '' }
  return UNITS === 'imperial' ? { value: n(kg * 2.20462, 1), unit: 'lb' } : { value: n(kg, 1), unit: 'kg' }
}

export function temp(c) {
  if (!isNum(c)) return '—'
  return UNITS === 'imperial' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`
}

// ---- dates
export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const fromISO = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (iso, k) => { const d = fromISO(iso); d.setDate(d.getDate() + k); return isoOf(d) }

export function dayLabel(iso, opts = {}) {
  if (!iso) return ''
  const t = todayISO()
  if (iso.slice(0, 10) === t) return 'Today'
  if (iso.slice(0, 10) === addDays(t, -1)) return 'Yesterday'
  const d = fromISO(iso)
  return d.toLocaleDateString('en-GB', { weekday: opts.short ? 'short' : 'long', day: 'numeric', month: 'short' })
}

export function relDay(iso) {
  if (!iso) return ''
  const t = todayISO()
  const d = iso.slice(0, 10)
  if (d === t) return 'Today'
  if (d === addDays(t, 1)) return 'Tomorrow'
  if (d === addDays(t, -1)) return 'Yesterday'
  return fromISO(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export const shortDate = (iso) => iso ? fromISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
export const weekday = (iso, len = 'short') => fromISO(iso).toLocaleDateString('en-GB', { weekday: len })
export const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

export function timeOf(ms) {
  if (!isNum(ms)) return ''
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// "2026-11-04 06:06:00" (local) -> "06:06"
export const localTime = (s) => (s ? s.slice(11, 16) : '')

export function relative(ms) {
  if (!isNum(ms)) return ''
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`
  return `${Math.round(diff / 86400)} d ago`
}

export function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Late night'
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}
