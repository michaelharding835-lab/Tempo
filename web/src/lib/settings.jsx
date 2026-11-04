import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setUnits } from './format'

// ---- Today widgets: every card on the Today screen, with the sizes and chart styles it supports.
export const WIDGETS = {
  readiness: { title: 'Training readiness', sizes: ['full'], styles: { gauge: 'Gauge', number: 'Big number' } },
  latest: { title: 'Latest session', sizes: ['full'], styles: { map: 'Map', stats: 'Stats only' }, note: 'Turns into a HYROX breakdown when your latest session was one.' },
  hyrox: { title: 'HYROX (when recent)', sizes: ['full'], styles: { splits: 'Splits', sequence: 'Timeline' }, note: 'Appears for 7 days after a HYROX race or simulation.' },
  race: { title: 'Race countdown', sizes: ['full', 'half'], styles: {}, note: 'Set your race date in Settings → HYROX.' },
  sleep: { title: 'Sleep', sizes: ['full', 'half'], styles: { stages: 'Stage map', bar: 'Stage bar', week: 'Week' } },
  body_battery: { title: 'Body Battery', sizes: ['half', 'full'], styles: { curve: 'Curve', ring: 'Ring' } },
  hrv: { title: 'HRV status', sizes: ['half', 'full'], styles: { week: 'Week', gauge: 'Range' } },
  stress: { title: 'Stress', sizes: ['half', 'full'], styles: { line: 'Line', split: 'Breakdown' } },
  heart_rate: { title: 'Heart rate', sizes: ['half', 'full'], styles: { line: 'Line', bars: 'Hourly range' } },
  steps: { title: 'Steps', sizes: ['half', 'full'], styles: { ring: 'Ring', week: 'Week' } },
  intensity: { title: 'Intensity minutes', sizes: ['half', 'full'], styles: {} },
  training_status: { title: 'Training status', sizes: ['full', 'half'], styles: {} },
  load_focus: { title: 'Load focus', sizes: ['full'], styles: {} },
  next_workout: { title: 'Next workout', sizes: ['full', 'half'], styles: {} },
  week: { title: 'This week', sizes: ['full'], styles: { load: 'Training load', steps: 'Steps' } },
  calories: { title: 'Calories', sizes: ['half', 'full'], styles: {} },
  respiration: { title: 'Respiration', sizes: ['half', 'full'], styles: {} },
  spo2: { title: 'Pulse Ox', sizes: ['half', 'full'], styles: {} },
  hydration: { title: 'Hydration', sizes: ['half', 'full'], styles: {} },
  weight: { title: 'Weight', sizes: ['half', 'full'], styles: {} },
  floors: { title: 'Floors', sizes: ['half'], styles: {} },
}

const DEFAULT_TODAY = [
  ['readiness', true, 'full', 'gauge'],
  ['latest', true, 'full', 'map'],
  ['hyrox', true, 'full', 'splits'],
  ['race', false, 'full'],
  ['sleep', true, 'full', 'stages'],
  ['body_battery', true, 'half', 'curve'],
  ['hrv', true, 'half', 'week'],
  ['stress', true, 'half', 'line'],
  ['heart_rate', true, 'half', 'line'],
  ['steps', true, 'half', 'ring'],
  ['intensity', true, 'half'],
  ['training_status', true, 'full'],
  ['next_workout', true, 'full'],
  ['week', true, 'full', 'load'],
  ['load_focus', false, 'full'],
  ['calories', false, 'half'],
  ['respiration', false, 'half'],
  ['spo2', false, 'half'],
  ['hydration', false, 'half'],
  ['weight', false, 'half'],
  ['floors', false, 'half'],
].map(([id, on, size, style]) => ({ id, on, size, style: style || Object.keys(WIDGETS[id].styles)[0] || null }))

// ---- Health screen sections
export const HEALTH = {
  sleep: 'Sleep', body_battery: 'Body Battery', hrv: 'HRV status', heart_rate: 'Heart rate',
  stress: 'Stress', respiration: 'Respiration', spo2: 'Pulse Ox', steps: 'Steps',
  intensity: 'Intensity minutes', calories: 'Calories', floors: 'Floors', hydration: 'Hydration', weight: 'Weight',
}
const DEFAULT_HEALTH = Object.keys(HEALTH).map((id) => ({ id, on: true }))

export const DEFAULT_PROMPTS = [
  'How recovered am I today?',
  'Break down my last HYROX',
  'Plan my training for this week',
  'Why might my HRV be down?',
  'How is my running fitness trending?',
]

export const DEFAULTS = {
  theme: 'auto',
  units: 'metric',
  hero: 'black',
  charts: { grid: true, smooth: true, animate: true },
  defaultTab: 'today',
  today: DEFAULT_TODAY,
  health: DEFAULT_HEALTH,
  activities: { maps: true },
  map: 'streets',
  coach: { about: 'Training for HYROX. I wear a Forerunner 955.' },
  hyrox: { raceDate: '', raceName: '', target: '', division: 'Open' },
}

const KEY = 'tempo:settings'

function mergeList(saved, defaults) {
  if (!Array.isArray(saved)) return defaults
  const known = new Map(defaults.map((d) => [d.id, d]))
  const out = saved.filter((s) => known.has(s.id)).map((s) => ({ ...known.get(s.id), ...s }))
  for (const d of defaults) if (!out.find((o) => o.id === d.id)) out.push(d)
  return out
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw) return DEFAULTS
    return {
      ...DEFAULTS, ...raw,
      charts: { ...DEFAULTS.charts, ...(raw.charts || {}) },
      activities: { ...DEFAULTS.activities, ...(raw.activities || {}) },
      coach: { ...DEFAULTS.coach, ...(raw.coach || {}) },
      hyrox: { ...DEFAULTS.hyrox, ...(raw.hyrox || {}) },
      today: mergeList(raw.today, DEFAULTS.today),
      health: mergeList(raw.health, DEFAULTS.health),
    }
  } catch {
    return DEFAULTS
  }
}

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* private mode */ }
    setUnits(settings.units)
    const root = document.documentElement
    // Only clear a theme we set ourselves, so a host page's own choice survives "Auto".
    if (settings.theme === 'auto') {
      if (root.dataset.tempoTheme) { root.removeAttribute('data-theme'); delete root.dataset.tempoTheme }
    } else {
      root.setAttribute('data-theme', settings.theme)
      root.dataset.tempoTheme = '1'
    }
    root.dataset.animate = settings.charts.animate ? 'on' : 'off'
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#eeeeec')
  }, [settings])

  const update = useCallback((patch) => {
    setSettings((s) => (typeof patch === 'function' ? patch(s) : { ...s, ...patch }))
  }, [])

  const value = useMemo(() => ({ settings, update, reset: () => setSettings(DEFAULTS) }), [settings, update])
  setUnits(settings.units)
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext)
