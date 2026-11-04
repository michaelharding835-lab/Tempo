// Sample-data mode: answers API paths from a snapshot produced by the real backend
// (scripts/export_demo.py) so the app is fully explorable before Garmin is connected.

let snapPromise = null
const snap = () => (snapPromise ||= import('../demo/snapshot.json').then((m) => m.default || m))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function stats(points) {
  const vals = points.map((p) => p.value).filter((v) => typeof v === 'number')
  if (!vals.length) return null
  const half = Math.max(1, Math.floor(vals.length / 2))
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length
  return {
    avg: Math.round(avg(vals) * 10) / 10, min: Math.min(...vals), max: Math.max(...vals), latest: vals.at(-1),
    change: vals.length > 1 ? Math.round((avg(vals.slice(half)) - avg(vals.slice(0, half))) * 10) / 10 : null,
  }
}

export async function get(path) {
  const s = await snap()
  await wait(180)
  const url = new URL(path, 'https://demo.local')
  const p = url.pathname
  const q = Object.fromEntries(url.searchParams)
  if (p === '/api/health' || p === '/api/check') return { ok: true, mode: 'demo', profile: s.profile }
  if (p === '/api/today') {
    const days = Object.keys(s.today).sort()
    const want = q.date && s.today[q.date] ? q.date : days.at(-1)
    return s.today[want]
  }
  if (p === '/api/activities') {
    const start = +(q.start || 0)
    const limit = +(q.limit || 30)
    let items = s.activities
    if (q.group) items = items.filter((a) => a.group === q.group)
    return { items: items.slice(start, start + limit), start, limit, has_more: start + limit < items.length }
  }
  const act = p.match(/^\/api\/activities\/(\d+)$/)
  if (act) {
    const d = s.details[act[1]]
    if (d) return d
    const summary = s.activities.find((a) => String(a.id) === act[1])
    if (summary) return { ...summary, streams: { t: [] }, laps: [], route: null, hr_zones: null, weather: null }
    throw Object.assign(new Error('That activity is not in the sample data.'), { code: 'not_found' })
  }
  if (p === '/api/training') return s.training
  const trend = p.match(/^\/api\/trends\/(\w+)$/)
  if (trend) {
    const t = s.trends[trend[1]]
    if (!t) throw new Error('Unknown metric')
    const days = Math.min(366, +(q.days || 28))
    const points = t.points.slice(-days)
    return { ...t, points, stats: stats(points) }
  }
  if (p === '/api/calendar') {
    const now = new Date()
    const key = `${q.year || now.getFullYear()}-${+(q.month || now.getMonth() + 1)}`
    return s.calendar[key] || { year: +q.year, month: +q.month, days: {}, totals: { activities: 0, distance_m: 0, duration_s: 0, load: 0 } }
  }
  if (p === '/api/hyrox') return s.hyrox
  if (p === '/api/profile') return s.profile
  if (p === '/api/settings') return {}
  throw new Error(`Sample data has nothing for ${p}`)
}

// A canned coach that streams like the real one, reading from the sample data.
export async function coach(messages, onEvent, signal) {
  const s = await snap()
  const q = (messages.at(-1)?.content || '').toLowerCase()
  const day = s.today[Object.keys(s.today).sort().at(-1)]
  const r = day.readiness || {}
  const sl = day.sleep || {}
  const h = day.hrv || {}
  const hy = s.hyrox.sessions?.[0]?.hyrox
  let tools = ['get_daily_summary']
  let text
  if (q.includes('hyrox') && hy) {
    tools = ['get_hyrox_history', 'get_activity']
    const runs = hy.runs.map((x) => x.pace_s_km)
    const fmt = (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`
    const worst = [...hy.stations].sort((a, b) => b.duration_s - a.duration_s)[0]
    const total = `${Math.floor(hy.total_s / 3600)}:${String(Math.floor(hy.total_s % 3600 / 60)).padStart(2, '0')}:${String(Math.round(hy.total_s % 60)).padStart(2, '0')}`
    text = `Your last HYROX took **${total}**, and ${Math.round(hy.run_total_s / hy.total_s * 100)}% of that was running.\n\n` +
      `- Run 1 went out at **${fmt(runs[0])}/km** and the later runs averaged **${fmt(hy.compromised.later_avg_pace)}/km**, a ${hy.compromised.decay_pct}% fade. Under 5% is where strong amateurs sit.\n` +
      `- **${worst.name}** was your longest station at ${fmt(worst.duration_s)}. That's the cheapest time to win back.\n` +
      `- Your runs got slower steadily rather than collapsing after one station, which points to general fatigue, not a single weak link.\n\n` +
      `This week I'd add one compromised session: 4 × (1 km at race pace straight into 100 m sandbag lunges), and keep the long run easy.`
  } else if (q.includes('hrv')) {
    tools = ['get_daily_summary', 'get_trend']
    text = `Last night's HRV was **${h.last_night} ms** against a 7-day average of **${h.weekly_avg} ms**, so you're still inside your balanced range (${h.baseline_low}–${h.baseline_high} ms).\n\n` +
      `A single low night after a hard day — like yesterday's HYROX sim — is normal. Watch the 7-day average rather than one reading; if it drifts below ${h.baseline_low} ms for three or more days, back off intensity and prioritise sleep.`
  } else if (q.includes('week') || q.includes('plan')) {
    tools = ['get_training_status', 'get_daily_summary']
    text = `You're **${(day.training?.status || 'productive').toLowerCase()}** with an acute load of ${day.training?.acute_load}. Here's a shape for the next 7 days:\n\n` +
      `- **Today:** easy 30–40 min, or rest — readiness is ${r.score}.\n- **Tomorrow:** threshold 4 × 2 km (it's already on your calendar).\n` +
      `- **Day 3:** strength, lower body light.\n- **Day 4:** compromised running — 5 × 1 km + station.\n- **Day 5:** rest or swim.\n- **Day 6:** long run, 16 km easy.\n- **Day 7:** easy ride.\n\nKeep two easy days between the hard ones while readiness is under 50.`
  } else {
    text = `Readiness is **${r.score} (${(r.level || '').toLowerCase()})** this morning. ${r.headline || ''}.\n\n` +
      `- Sleep scored **${sl.score}** with ${Math.round((sl.duration_s || 0) / 360) / 10} h — a bit short after a hard day.\n` +
      `- HRV was ${h.last_night} ms, still ${h.status?.toLowerCase()}.\n- Body Battery is at ${day.body_battery?.current}.\n\n` +
      `Keep today aerobic: an easy run or mobility. Tomorrow's threshold session will land better for it.`
  }
  for (const t of tools) {
    if (signal?.aborted) return
    onEvent({ type: 'tool', name: t, label: { get_daily_summary: "Read today's metrics", get_hyrox_history: 'Reviewed HYROX history', get_activity: 'Opened an activity', get_trend: 'Looked at a trend', get_training_status: 'Checked training status' }[t] })
    await wait(420)
  }
  const words = text.split(/(\s+)/)
  for (let i = 0; i < words.length; i += 3) {
    if (signal?.aborted) return
    onEvent({ type: 'text', text: words.slice(i, i + 3).join('') })
    await wait(24)
  }
  onEvent({ type: 'done' })
}
