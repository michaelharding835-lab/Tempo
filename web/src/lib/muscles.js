// Weekly muscle load: labels, groups and the four colour levels.

export const MUSCLE_LABELS = {
  chest: 'Chest', frontDelts: 'Front delts', rearDelts: 'Rear delts', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', abs: 'Abs', obliques: 'Obliques', lats: 'Lats', upperBack: 'Upper back', traps: 'Traps',
  lowerBack: 'Lower back', glutes: 'Glutes', quads: 'Quads', hamstrings: 'Hamstrings', calves: 'Calves',
}

export const MUSCLE_GROUPS = [
  ['Push', ['chest', 'frontDelts', 'triceps']],
  ['Pull', ['lats', 'upperBack', 'rearDelts', 'biceps', 'traps', 'forearms']],
  ['Legs', ['quads', 'glutes', 'hamstrings', 'calves']],
  ['Core', ['abs', 'obliques', 'lowerBack']],
]

export const LEVELS = [
  { key: 0, label: 'Not yet', color: 'var(--m-none)' },
  { key: 1, label: 'Light', color: 'var(--m-1)' },
  { key: 2, label: 'Building', color: 'var(--m-2)' },
  { key: 3, label: 'Worked', color: 'var(--m-3)' },
]

/** 0 untouched · 1 light · 2 building · 3 worked (at or above `worked` sets). */
export function levelFor(sets, worked = 8) {
  if (!sets || sets <= 0) return 0
  if (sets >= worked) return 3
  if (sets >= worked * 0.4) return 2
  return 1
}

/** Sum sessions from Monday up to and including `uptoIndex` (0 = Monday). */
export function weekTotals(week, uptoIndex = 6, includeHyrox = true) {
  const totals = {}
  const sessions = []
  ;(week?.days || []).forEach((d, i) => {
    if (i > uptoIndex) return
    for (const s of d.sessions) {
      if (s.kind === 'hyrox' && !includeHyrox) continue
      sessions.push({ ...s, date: d.date })
      for (const [k, v] of Object.entries(s.muscles)) totals[k] = Math.round(((totals[k] || 0) + v) * 10) / 10
    }
  })
  return { totals, sessions }
}

export function levelsFrom(totals, worked) {
  return Object.fromEntries(Object.keys(MUSCLE_LABELS).map((k) => [k, levelFor(totals[k], worked)]))
}
