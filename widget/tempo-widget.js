// Tempo home-screen widget for Scriptable (iOS).
// 1. Install Scriptable from the App Store and create a new script with this code.
// 2. Fill in SERVER and KEY below.
// 3. Add a Scriptable widget to your home screen (small or medium) and pick this script.
// It refreshes whenever iOS updates widgets, pulling the same data as the app.

const SERVER = "https://your-app.vercel.app"   // your Tempo address
const KEY = "your-access-key"                   // APP_ACCESS_KEY

const LIME = new Color("#E0FF4F")
const BLUE = new Color("#002FFF")
const INK = Color.white()
const MUTED = new Color("#ffffff", 0.6)

async function load() {
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const req = new Request(`${SERVER}/api/widget?date=${today}`)
  req.headers = { Authorization: `Bearer ${KEY}` }
  return await req.loadJSON()
}

function hm(sec) {
  if (!sec) return "—"
  const m = Math.round(sec / 60)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

function stat(stack, value, label, color = INK) {
  const s = stack.addStack()
  s.layoutVertically()
  const v = s.addText(String(value ?? "—"))
  v.font = Font.semiboldSystemFont(20)
  v.textColor = color
  const l = s.addText(label)
  l.font = Font.mediumSystemFont(11)
  l.textColor = MUTED
}

async function build() {
  const w = new ListWidget()
  w.backgroundColor = Color.black()
  w.setPadding(14, 14, 14, 14)
  w.url = SERVER
  let data
  try { data = await load() } catch (e) {
    const t = w.addText("Tempo can't reach your server")
    t.textColor = INK; t.font = Font.mediumSystemFont(13)
    return w
  }
  const top = w.addStack()
  const title = top.addText("Readiness")
  title.font = Font.mediumSystemFont(12); title.textColor = MUTED
  top.addSpacer()
  const lvl = top.addText(data.readiness_level || "")
  lvl.font = Font.semiboldSystemFont(12); lvl.textColor = LIME

  const big = w.addText(String(data.readiness ?? "—"))
  big.font = Font.semiboldRoundedSystemFont(48); big.textColor = INK
  w.addSpacer(4)

  const row = w.addStack()
  row.spacing = 14
  stat(row, data.body_battery, "Battery", LIME)
  stat(row, data.sleep_score, "Sleep")
  if (config.widgetFamily !== "small") {
    stat(row, data.hrv ? `${data.hrv}` : "—", "HRV ms")
    stat(row, data.steps ? `${Math.round(data.steps / 100) / 10}k` : "—", "Steps")
    if (data.latest?.name) {
      w.addSpacer(6)
      const l = w.addText(`Last: ${data.latest.name}`)
      l.font = Font.mediumSystemFont(11); l.textColor = MUTED; l.lineLimit = 1
    }
  }
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000)
  return w
}

const widget = await build()
if (config.runsInWidget) Script.setWidget(widget)
else await widget.presentMedium()
Script.complete()
