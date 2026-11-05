// The Tempo mark: a four-segment readiness dial around a T (same drawing as the app icon).
const S = 1024
const R = 300
const SW = 100
const SWEEP = 250
const START = -90 - SWEEP / 2
const CY = (S - (R * (1 + Math.sin(((START + SWEEP) * Math.PI) / 180)) + SW)) / 2 + SW / 2 + R
const pt = (a) => [S / 2 + R * Math.cos((a * Math.PI) / 180), CY + R * Math.sin((a * Math.PI) / 180)]
const arc = (a0, a1) => {
  const [x0, y0] = pt(a0)
  const [x1, y1] = pt(a1)
  return `M${x0},${y0} A${R},${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`
}

export default function TempoMark({ size = 64, bg = '#000', fill = '#E0FF4F', track = '#2a2a2a', ink = '#fff', radius = 0.225 }) {
  const segs = [0, 1, 2, 3].map((i) => {
    const a0 = START + (SWEEP * i) / 4 + (i ? 2.5 : 0)
    const a1 = START + (SWEEP * (i + 1)) / 4 - (i < 3 ? 2.5 : 0)
    return <path key={i} d={arc(a0, a1)} fill="none" stroke={i < 3 ? fill : track} strokeWidth={SW} />
  })
  const [sx, sy] = pt(START)
  const [ex, ey] = pt(START + SWEEP)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Tempo">
      <rect width={S} height={S} rx={S * radius} fill={bg} />
      {segs}
      <circle cx={sx} cy={sy} r={SW / 2} fill={fill} />
      <circle cx={ex} cy={ey} r={SW / 2} fill={track} />
      <text x={S / 2} y={CY + 410 * 0.35} textAnchor="middle" fontFamily="'Outfit Variable', Outfit, sans-serif" fontWeight="700" fontSize="410" fill={ink}>T</text>
    </svg>
  )
}
