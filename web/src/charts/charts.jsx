// Hand-drawn SVG charts. Thin marks, 4px rounded data ends, hairline grids,
// a 10% wash under lines, and a scrub tooltip on every plotted chart.
import { useMemo, useRef, useState } from 'react'
import { useMeasure } from '../lib/hooks'
import { useSettings } from '../lib/settings'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// ---------------------------------------------------------------- paths

// Monotone cubic (Fritsch–Carlson) so smoothed curves never overshoot the data.
function monotonePath(pts) {
  if (pts.length < 3) return linePath(pts)
  const n = pts.length
  const dx = [], dy = [], m = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0]
    dy[i] = pts[i + 1][1] - pts[i][1]
    m[i] = dx[i] ? dy[i] / dx[i] : 0
  }
  const t = [m[0]]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  t[n - 1] = m[n - 2]
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`
  }
  return d
}
const linePath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('')

// Split into runs wherever the data has a gap.
function segments(points, gap) {
  const out = []
  let cur = []
  points.forEach((p, i) => {
    if (!isNum(p[1])) { if (cur.length) out.push(cur); cur = []; return }
    if (cur.length && gap && p[0] - points[i - 1][0] > gap) { out.push(cur); cur = [] }
    cur.push(p)
  })
  if (cur.length) out.push(cur)
  return out
}

function niceTicks(min, max, count = 3) {
  const span = max - min || 1
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0) || step0
  const ticks = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return ticks
}

// ---------------------------------------------------------------- scrub

function useScrub(count, toIndex) {
  const [idx, setIdx] = useState(null)
  const timer = useRef(null)
  const handlers = {
    onPointerDown: (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); clearTimeout(timer.current); setIdx(toIndex(e)) },
    onPointerMove: (e) => { if (e.buttons || e.pointerType === 'mouse') { clearTimeout(timer.current); setIdx(toIndex(e)) } },
    onPointerUp: () => { timer.current = setTimeout(() => setIdx(null), 1400) },
    onPointerLeave: (e) => { if (e.pointerType === 'mouse') setIdx(null) },
  }
  return [count ? idx : null, handlers]
}

// ---------------------------------------------------------------- LineChart

/**
 * points: [[x, y], ...] with numeric x (ms or index). Optional `band` {low, high}
 * draws a target range; `refY` draws a reference line.
 */
export function LineChart({
  points = [], color = 'var(--c-readiness)', height = 120, yMin, yMax, area = true, band, refY,
  formatX = (x) => x, formatY = (y) => Math.round(y), gap, yTicks = 3, showAxis = true, xTicks = [],
  pad = { top: 10, right: 30, bottom: 18, left: 0 }, dots = false, endDot = true, strokeWidth = 2,
}) {
  const { settings } = useSettings()
  const [ref, { width }] = useMeasure()
  const clean = points.filter((p) => isNum(p[0]))
  const ys = clean.map((p) => p[1]).filter(isNum)
  const lo = yMin ?? (ys.length ? Math.min(...ys, band?.low ?? Infinity) : 0)
  const hi = yMax ?? (ys.length ? Math.max(...ys, band?.high ?? -Infinity) : 1)
  const span = hi - lo || 1
  const y0 = yMin ?? lo - span * 0.08
  const y1 = yMax ?? hi + span * 0.08
  const x0 = clean.length ? clean[0][0] : 0
  const x1 = clean.length ? clean[clean.length - 1][0] : 1
  const ticks = niceTicks(y0, y1, yTicks).filter((t) => t >= y0 && t <= y1)
  // Leave room on the right for the widest tick label.
  const labelW = settings.charts.grid && ticks.length ? Math.max(...ticks.map((t) => String(formatY(t)).length)) * 6.4 + 8 : 0
  const padRight = Math.max(pad.right, Math.min(64, labelW))
  const w = Math.max(10, width - pad.left - padRight)
  const h = height - pad.top - (showAxis ? pad.bottom : 4)
  const sx = (x) => pad.left + ((x - x0) / (x1 - x0 || 1)) * w
  const sy = (y) => pad.top + (1 - (y - y0) / (y1 - y0 || 1)) * h
  const segs = useMemo(() => segments(clean, gap).map((s) => s.map((p) => [sx(p[0]), sy(p[1])])), [clean, gap, width, y0, y1]) // eslint-disable-line
  const smooth = settings.charts.smooth
  const toIndex = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    let best = 0, bd = Infinity
    clean.forEach((p, i) => { const d = Math.abs(sx(p[0]) - x); if (d < bd && isNum(p[1])) { bd = d; best = i } })
    return best
  }
  const [idx, scrub] = useScrub(clean.length, toIndex)
  const last = [...clean].reverse().find((p) => isNum(p[1]))
  const active = idx != null ? clean[idx] : null
  return (
    <div className="chart" ref={ref} style={{ height }} {...scrub}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="chart">
          {settings.charts.grid && ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.left} x2={pad.left + w} y1={sy(t)} y2={sy(t)} />
              <text x={pad.left + w + 6} y={sy(t) + 4}>{formatY(t)}</text>
            </g>
          ))}
          {band && isNum(band.low) && isNum(band.high) && (
            <rect x={pad.left} width={w} y={sy(band.high)} height={Math.max(0, sy(band.low) - sy(band.high))}
              fill={color} opacity="0.1" rx="4" />
          )}
          {isNum(refY) && <line x1={pad.left} x2={pad.left + w} y1={sy(refY)} y2={sy(refY)} stroke="var(--ink-3)" strokeWidth="1" />}
          {segs.map((s, i) => {
            const d = smooth ? monotonePath(s) : linePath(s)
            return (
              <g key={i}>
                {area && s.length > 1 && (
                  <path d={`${d}L${s[s.length - 1][0]},${pad.top + h}L${s[0][0]},${pad.top + h}Z`} fill={color} opacity="0.1" />
                )}
                <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round"
                  className="draw" pathLength="1000" style={{ strokeDasharray: 1000, '--len': 1000 }} />
                {s.length === 1 && <circle cx={s[0][0]} cy={s[0][1]} r="3" fill={color} />}
              </g>
            )
          })}
          {dots && clean.map((p, i) => isNum(p[1]) && (
            <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
          ))}
          {endDot && last && !active && (
            <circle cx={sx(last[0])} cy={sy(last[1])} r="4.5" fill={color} stroke="var(--surface)" strokeWidth="2" />
          )}
          {showAxis && xTicks.map((t, i) => {
            const x = sx(t.x)
            const anchor = x < 18 ? 'start' : x > pad.left + w - 18 ? 'end' : 'middle'
            return <text key={i} x={clamp(x, 0, pad.left + w)} y={height - 3} textAnchor={anchor}>{t.label}</text>
          })}
          {active && isNum(active[1]) && (
            <g>
              <line x1={sx(active[0])} x2={sx(active[0])} y1={pad.top} y2={pad.top + h} stroke="var(--ink-3)" strokeWidth="1" />
              <circle cx={sx(active[0])} cy={sy(active[1])} r="5" fill={color} stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {active && isNum(active[1]) && (
        <div className="tip" style={{ left: clamp(sx(active[0]), 44, width - 44), top: -6 }}>
          {formatY(active[1], true)}<small>{formatX(active[0])}</small>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Columns

/** data: [{ key, label, value, color?, title? }] */
export function Columns({
  data = [], color = 'var(--c-load)', height = 110, goal, format = (v) => Math.round(v), maxBar = 22,
  showLabels = true, labelEvery = 1, highlight, muted = 'var(--surface-3)', yMax, showValue,
}) {
  const { settings } = useSettings()
  const [ref, { width }] = useMeasure()
  const vals = data.map((d) => d.value).filter(isNum)
  const top = Math.max(yMax ?? 0, ...vals, goal ?? 0) || 1
  const labelH = showLabels ? 18 : 2
  const topPad = showValue ? 18 : 6
  const h = height - labelH - topPad
  const band = width / Math.max(1, data.length)
  const bw = Math.max(3, Math.min(maxBar, band * 0.62))
  const toIndex = (e) => clamp(Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / band), 0, data.length - 1)
  const [idx, scrub] = useScrub(data.length, toIndex)
  return (
    <div className="chart" ref={ref} style={{ height }} {...scrub}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="bar chart">
          {settings.charts.grid && <line className="grid" x1="0" x2={width} y1={topPad + h + 0.5} y2={topPad + h + 0.5} />}
          {isNum(goal) && (
            <line x1="0" x2={width} y1={topPad + h - (goal / top) * h} y2={topPad + h - (goal / top) * h}
              stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="0" opacity="0.6" />
          )}
          {data.map((d, i) => {
            const v = isNum(d.value) ? d.value : 0
            const bh = Math.max(v > 0 ? 3 : 0, (v / top) * h)
            const x = i * band + (band - bw) / 2
            const y = topPad + h - bh
            const r = Math.min(4, bw / 2, bh)
            const c = d.color || (highlight == null || highlight === i ? color : muted)
            return (
              <g key={d.key ?? i} opacity={idx == null || idx === i ? 1 : 0.45}>
                {bh > 0 && (
                  <path className="grow-in" style={{ animationDelay: `${i * 18}ms` }}
                    d={`M${x},${y + bh}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + bh}Z`} fill={c} />
                )}
                {showValue && isNum(d.value) && (highlight == null || highlight === i) && (
                  <text x={x + bw / 2} y={y - 5} textAnchor="middle" style={{ fill: 'var(--ink-2)', fontWeight: 500 }}>{format(d.value)}</text>
                )}
                {showLabels && i % labelEvery === 0 && (
                  <text x={x + bw / 2} y={height - 3} textAnchor="middle">{d.label}</text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {idx != null && data[idx] && (
        <div className="tip" style={{ left: clamp(idx * band + band / 2, 44, width - 44), top: -8 }}>
          {isNum(data[idx].value) ? format(data[idx].value, true) : 'No data'}<small>{data[idx].title || data[idx].label}</small>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Gauge & Ring

export function Gauge({ value, max = 100, color = 'var(--c-readiness)', size = 180, thickness = 14, track, sweep = 250, children, marks = [], markColor = 'var(--surface)' }) {
  const r = (size - thickness) / 2
  const cx = size / 2, cy = size / 2
  const start = -90 - sweep / 2
  const frac = isNum(value) ? clamp(value / max, 0, 1) : 0
  const pt = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]
  const arc = (a0, a1) => {
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1)
    return `M${x0},${y0}A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`
  }
  const end = start + sweep * frac
  const h = cy + r * Math.sin(((start) * Math.PI) / 180) + thickness
  return (
    <div style={{ position: 'relative', width: size, height: Math.max(h, size * 0.62) }}>
      <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }} aria-hidden="true">
        <path d={arc(start, start + sweep)} fill="none" stroke={track || 'var(--surface-3)'} strokeWidth={thickness} strokeLinecap="round" />
        {frac > 0 && (
          <path d={arc(start, Math.max(start + 0.5, end))} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round"
            className="draw" pathLength="1000" style={{ strokeDasharray: 1000, '--len': 1000 }} />
        )}
        {marks.map((m, i) => {
          const a = start + sweep * clamp(m / max, 0, 1)
          const [x0, y0] = [cx + (r - thickness / 2 - 0.5) * Math.cos(a * Math.PI / 180), cy + (r - thickness / 2 - 0.5) * Math.sin(a * Math.PI / 180)]
          const [x1, y1] = [cx + (r + thickness / 2 + 0.5) * Math.cos(a * Math.PI / 180), cy + (r + thickness / 2 + 0.5) * Math.sin(a * Math.PI / 180)]
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={markColor} strokeWidth="3" />
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  )
}

export function Ring({ value, max = 100, color = 'var(--c-steps)', size = 92, thickness = 10, track, children }) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const frac = isNum(value) ? clamp(value / (max || 1), 0, 1) : 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track || 'var(--surface-3)'} strokeWidth={thickness} />
        {frac > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round"
            strokeDasharray={`${c * frac} ${c}`} className="fade-in" />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------- sleep

const STAGES = [
  { key: 'awake', label: 'Awake', color: 'var(--s-awake)' },
  { key: 'rem', label: 'REM', color: 'var(--s-rem)' },
  { key: 'light', label: 'Light', color: 'var(--s-light)' },
  { key: 'deep', label: 'Deep', color: 'var(--s-deep)' },
]
export const STAGE_COLORS = Object.fromEntries(STAGES.map((s) => [s.key, s.color]))

/** Four-lane stage map: each stage gets its own row so position names it, not just colour. */
export function Hypnogram({ stages = [], start, end, height = 150, labels = true, formatTime }) {
  const [ref, { width }] = useMeasure()
  const s0 = start ?? stages[0]?.start
  const s1 = end ?? stages.at(-1)?.end
  const left = labels ? 46 : 0
  const w = Math.max(10, width - left)
  const axis = 16
  const lane = (height - axis) / 4
  const sx = (t) => left + ((t - s0) / (s1 - s0 || 1)) * w
  const ticks = []
  if (s0 && s1) {
    const first = new Date(s0); first.setMinutes(0, 0, 0); first.setHours(first.getHours() + 1)
    const span = (s1 - s0) / 3600000
    const step = span > 8 ? 3 : 2
    for (let t = first.getTime(); t < s1; t += step * 3600000) ticks.push(t)
  }
  const [idx, scrub] = useScrub(stages.length, (e) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    const t = s0 + ((x - left) / w) * (s1 - s0)
    return Math.max(0, stages.findIndex((s) => s.start <= t && t < s.end))
  })
  const active = idx != null ? stages[idx] : null
  return (
    <div className="chart" ref={ref} style={{ height }} {...scrub}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="sleep stages">
          {STAGES.map((st, row) => (
            <g key={st.key}>
              {labels && <text x="0" y={row * lane + lane / 2 + 4}>{st.label}</text>}
              <line className="grid" x1={left} x2={left + w} y1={row * lane + lane / 2} y2={row * lane + lane / 2} />
            </g>
          ))}
          {stages.map((s, i) => {
            const row = STAGES.findIndex((st) => st.key === s.stage)
            if (row < 0) return null
            const x = sx(s.start)
            const bw = Math.max(1.5, sx(s.end) - x - 1)
            const bh = lane * 0.62
            return (
              <rect key={i} x={x} y={row * lane + (lane - bh) / 2} width={bw} height={bh} rx={Math.min(4, bw / 2)}
                fill={STAGE_COLORS[s.stage]} opacity={idx == null || idx === i ? 1 : 0.4} className="fade-in" />
            )
          })}
          {ticks.map((t) => (
            <text key={t} x={sx(t)} y={height - 2} textAnchor="middle">{formatTime ? formatTime(t) : new Date(t).getHours().toString().padStart(2, '0') + ':00'}</text>
          ))}
        </svg>
      )}
      {active && (
        <div className="tip" style={{ left: clamp(sx((active.start + active.end) / 2), 50, width - 50), top: -8 }}>
          {STAGES.find((s) => s.key === active.stage)?.label} · {Math.round((active.end - active.start) / 60000)} min
          <small>{formatTime ? formatTime(active.start) : ''}</small>
        </div>
      )}
    </div>
  )
}

/** One whole split into parts. Thin = no text; tall = labels printed inside when they fit. */
export function StackBar({ parts = [], height = 10, legend = true, format = (v) => v, tall = false }) {
  const total = parts.reduce((s, p) => s + (isNum(p.value) ? p.value : 0), 0) || 1
  const shown = parts.filter((p) => isNum(p.value) && p.value > 0)
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: tall ? 28 : height }} role="img"
        aria-label={shown.map((p) => `${p.label} ${format(p.value)}`).join(', ')}>
        {shown.map((p, i) => {
          const pct = (p.value / total) * 100
          return (
            <div key={p.key} title={`${p.label}: ${format(p.value)}`} style={{
              width: `${pct}%`, background: p.color, minWidth: 3,
              borderRadius: tall ? 4 : `${i === 0 ? 999 : 2}px ${i === shown.length - 1 ? 999 : 2}px ${i === shown.length - 1 ? 999 : 2}px ${i === 0 ? 999 : 2}px`,
              display: 'flex', alignItems: 'center', paddingLeft: tall ? 6 : 0, overflow: 'hidden',
              color: p.ink || '#fff', fontSize: 12, fontWeight: 600,
            }}>
              {tall && pct > 14 && <span>{Math.round(pct)}%</span>}
            </div>
          )
        })}
      </div>
      {legend && (
        <div className="legend">
          {shown.map((p) => (
            <span className="legend__item" key={p.key}>
              <span className="legend__key" style={{ background: p.color }} />{p.label} <b style={{ fontWeight: 500, color: 'var(--ink)' }}>{format(p.value)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Hourly min–max candles for heart rate. */
export function RangeBars({ points = [], color = 'var(--c-hr)', height = 120, start, end }) {
  const [ref, { width }] = useMeasure()
  const hours = useMemo(() => {
    const map = new Map()
    for (const [t, v] of points) {
      if (!isNum(v)) continue
      const d = new Date(t); d.setMinutes(0, 0, 0)
      const k = d.getTime()
      const cur = map.get(k) || { t: k, lo: v, hi: v }
      cur.lo = Math.min(cur.lo, v); cur.hi = Math.max(cur.hi, v)
      map.set(k, cur)
    }
    return [...map.values()].sort((a, b) => a.t - b.t)
  }, [points])
  const t0 = start ?? hours[0]?.t ?? 0
  const t1 = end ?? (hours.at(-1)?.t ?? 0) + 3600000
  const lo = Math.min(...hours.map((h) => h.lo), 200) - 4
  const hi = Math.max(...hours.map((h) => h.hi), 60) + 4
  const axis = 16, w = Math.max(10, width - 26), h = height - axis - 6
  const sx = (t) => ((t - t0) / (t1 - t0 || 1)) * w
  const sy = (v) => 6 + (1 - (v - lo) / (hi - lo || 1)) * h
  const bw = Math.max(3, Math.min(8, (w / 24) * 0.5))
  const [idx, scrub] = useScrub(hours.length, (e) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    let best = 0, bd = Infinity
    hours.forEach((hh, i) => { const d = Math.abs(sx(hh.t + 1800000) - x); if (d < bd) { bd = d; best = i } })
    return best
  })
  const active = idx != null ? hours[idx] : null
  return (
    <div className="chart" ref={ref} style={{ height }} {...scrub}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="hourly heart rate range">
          {niceTicks(lo, hi, 3).map((t) => (
            <g key={t}><line className="grid" x1="0" x2={w} y1={sy(t)} y2={sy(t)} /><text x={w + 5} y={sy(t) + 4}>{t}</text></g>
          ))}
          {hours.map((hh, i) => {
            const x = sx(hh.t + 1800000) - bw / 2
            const y = sy(hh.hi), y2 = sy(hh.lo)
            return <rect key={hh.t} x={x} y={y} width={bw} height={Math.max(bw, y2 - y)} rx={bw / 2} fill={color} opacity={idx == null || idx === i ? 1 : 0.35} className="grow-in" />
          })}
          {[0, 6, 12, 18].map((hr) => {
            const d = new Date(t0); d.setHours(hr, 0, 0, 0)
            const x = sx(d.getTime())
            return d.getTime() >= t0 && d.getTime() <= t1 ? <text key={hr} x={x} y={height - 2} textAnchor={x < 18 ? 'start' : 'middle'}>{String(hr).padStart(2, '0')}:00</text> : null
          })}
        </svg>
      )}
      {active && (
        <div className="tip" style={{ left: clamp(sx(active.t + 1800000), 50, width - 50), top: -8 }}>
          {active.lo}–{active.hi} bpm<small>{new Date(active.t).getHours().toString().padStart(2, '0')}:00</small>
        </div>
      )}
    </div>
  )
}

export function Sparkline({ values = [], color = 'var(--ink)', height = 32, width: fixedW, area = true }) {
  const [ref, { width }] = useMeasure()
  const W = fixedW || width
  const vals = values.map((v) => (isNum(v) ? v : null))
  const nums = vals.filter(isNum)
  if (!nums.length) return <div ref={ref} style={{ height }} />
  const lo = Math.min(...nums), hi = Math.max(...nums)
  const pts = vals.map((v, i) => (isNum(v) ? [(i / Math.max(1, vals.length - 1)) * (W - 6) + 3, 3 + (1 - (v - lo) / (hi - lo || 1)) * (height - 6)] : null)).filter(Boolean)
  const d = monotonePath(pts)
  return (
    <div ref={ref} style={{ height, width: fixedW }}>
      {W > 0 && (
        <svg width={W} height={height} aria-hidden="true">
          {area && <path d={`${d}L${pts.at(-1)[0]},${height}L${pts[0][0]},${height}Z`} fill={color} opacity="0.12" />}
          <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="3" fill={color} />
        </svg>
      )}
    </div>
  )
}

/** A horizontal meter with a target band (load focus). */
export function BandMeter({ value, min, max, color, scaleMax }) {
  const top = scaleMax || Math.max(value || 0, max || 0) * 1.15 || 1
  const pct = (v) => `${clamp((v / top) * 100, 0, 100)}%`
  return (
    <div style={{ position: 'relative', height: 14 }}>
      <div style={{ position: 'absolute', inset: '3px 0', borderRadius: 999, background: 'var(--surface-3)' }} />
      {isNum(min) && isNum(max) && (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(min), width: `calc(${pct(max)} - ${pct(min)})`, borderRadius: 4, boxShadow: 'inset 0 0 0 1.5px var(--ink-3)' }} />
      )}
      <div style={{ position: 'absolute', top: 3, bottom: 3, left: 0, width: pct(value || 0), borderRadius: 999, background: color }} />
    </div>
  )
}
