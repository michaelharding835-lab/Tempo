import { useMemo, useState } from 'react'
import { useMeasure } from '../lib/hooks'
import { useSettings } from '../lib/settings'

const TILE = 256

function project(lat, lon, z) {
  const s = TILE * 2 ** z
  const sin = Math.sin((lat * Math.PI) / 180)
  return [((lon + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s]
}

function useDark() {
  const { settings } = useSettings()
  if (settings.theme === 'dark') return true
  if (settings.theme === 'light') return false
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Static map: OpenStreetMap tiles (via CARTO) fitted to the route, with the route drawn on top. */
export function RouteMap({ route, height = 240, radius = 0, color = 'var(--blue)', live = true, padding = 28, highlight }) {
  const [ref, { width }] = useMeasure()
  const { settings } = useSettings()
  const dark = useDark()
  const [failed, setFailed] = useState(false)
  const showTiles = live && settings.map !== 'minimal' && !failed
  const layout = useMemo(() => {
    if (!route?.length || !width) return null
    let z = 17
    for (; z > 2; z--) {
      const pts = route.map(([la, lo]) => project(la, lo, z))
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys)
      if (w <= width - padding * 2 && h <= height - padding * 2) break
    }
    const pts = route.map(([la, lo]) => project(la, lo, z))
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const ox = cx - width / 2, oy = cy - height / 2
    const local = pts.map(([x, y]) => [x - ox, y - oy])
    const tiles = []
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + width) / TILE); tx++) {
      for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + height) / TILE); ty++) {
        tiles.push({ tx, ty, left: tx * TILE - ox, top: ty * TILE - oy })
      }
    }
    return { z, local, tiles }
  }, [route, width, height, padding])

  const d = layout ? layout.local.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') : ''
  const style = dark ? 'dark_all' : 'light_all'
  return (
    <div className="map" ref={ref} style={{ height, borderRadius: radius,
      backgroundImage: !showTiles ? 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)' : undefined,
      backgroundSize: !showTiles ? '28px 28px' : undefined }}>
      {layout && showTiles && (
        <div className="map__tiles">
          {layout.tiles.map((t) => (
            <img key={`${t.tx}-${t.ty}`} alt="" draggable="false" loading="lazy" style={{ left: t.left, top: t.top }}
              src={`https://${'abcd'[(t.tx + t.ty) & 3]}.basemaps.cartocdn.com/${style}/${layout.z}/${t.tx}/${t.ty}@2x.png`}
              onError={() => setFailed(true)} />
          ))}
        </div>
      )}
      {layout && (
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} role="img" aria-label="route map">
          <path d={d} fill="none" stroke={dark ? '#000' : '#fff'} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
          <path d={d} fill="none" stroke={color} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
          {highlight != null && layout.local[highlight] && (
            <circle cx={layout.local[highlight][0]} cy={layout.local[highlight][1]} r="7" fill="var(--lime)" stroke="#000" strokeWidth="2" />
          )}
          <circle cx={layout.local[0][0]} cy={layout.local[0][1]} r="6" fill="var(--good)" stroke="#fff" strokeWidth="2.5" />
          <circle cx={layout.local.at(-1)[0]} cy={layout.local.at(-1)[1]} r="6" fill="#000" stroke="#fff" strokeWidth="2.5" />
        </svg>
      )}
      {layout && showTiles && <div className="map__attr">© OpenStreetMap © CARTO</div>}
    </div>
  )
}

/** Route silhouette with no tiles (for list thumbnails and coloured cards). */
export function RouteShape({ route, size = 56, color = 'currentColor', stroke = 2.4, width, height }) {
  const W = width || size, H = height || size
  if (!route?.length) return null
  const pts = route.map(([la, lo]) => project(la, lo, 15))
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const w = Math.max(...xs) - minX || 1, h = Math.max(...ys) - minY || 1
  const k = Math.min((W - 10) / w, (H - 10) / h)
  const ox = (W - w * k) / 2, oy = (H - h * k) / 2
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * k).toFixed(1)},${(oy + (y - minY) * k).toFixed(1)}`).join('')
  return (
    <svg width={W} height={H} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
