# Tempo

A personal Garmin Connect app for iPhone. One small Python server pulls your data from
Garmin whenever you open the app, serves a phone-first web app you install to your home
screen, and exposes the same data as an **MCP server** so Claude (the in-app coach,
Claude Code, or your own assistant) can read it.

```
iPhone (Tempo web app) ──► /api/*  ─┐
Claude coach  ──MCP connector──► /mcp ─┼─► FastAPI on Vercel ──► Garmin Connect
Claude Code / your assistant ──► /mcp ─┘          │
                                                  └─► Upstash Redis (tokens + short cache)
```

Everything runs on free tiers: Vercel Hobby for the server and app, Upstash Redis for
token storage. The coach uses your Anthropic API key (billed per use by Anthropic).

---

## Set it up (about 15 minutes)

### 1. Put the code on GitHub
Create a **private** repository and push this folder to it:

```bash
cd tempo
git add -A && git commit -m "Tempo"
gh repo create tempo --private --source=. --push      # or create it on github.com and push
```

### 2. Deploy to Vercel
1. Sign in at vercel.com with GitHub → **Add New → Project** → import `tempo`.
   Vercel detects FastAPI automatically; leave the build settings as they are.
2. Before deploying, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `APP_ACCESS_KEY` | a long random string, e.g. the output of `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` — this is the app's password |
   | `ANTHROPIC_API_KEY` | your key from console.anthropic.com |

3. Click **Deploy**. You get an address like `https://tempo-ben.vercel.app`.

### 3. Add free token storage (required)
Garmin's refresh tokens change every time they're used, so the server must save them.
In your Vercel project: **Storage → Create → Upstash for Redis (free)** → connect it to
the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Then **Deployments →
⋯ → Redeploy** so the server picks them up.

### 4. Connect your Garmin account
Garmin often blocks sign-ins that come from cloud servers, so sign in once from your
laptop and send the tokens to your server:

```bash
pip install garminconnect
python scripts/garmin_login.py --app https://tempo-ben.vercel.app --key YOUR_APP_ACCESS_KEY
```

It asks for your Garmin email, password and MFA code. The password is used once and
never stored. (You can also run it without `--app`/`--key` and paste the printed tokens
into the app under **Settings → Garmin account → Paste tokens**, or try **Email &
password** there, which works when Garmin allows the cloud sign-in.)

### 5. Install it on your iPhone
Open your Vercel address in **Safari** → **Share** → **Add to Home Screen**. Open Tempo
from the home screen and enter your access key. Done: every time you open it, it pulls
fresh data from Garmin.

---

## Use your data from Claude Code (and your own assistant)

Your server is a standard Streamable-HTTP MCP server with seven read-only tools
(`get_daily_summary`, `list_activities`, `get_activity`, `get_training_status`,
`get_trend`, `get_hyrox_history`, `get_profile`):

```bash
claude mcp add --transport http garmin https://tempo-ben.vercel.app/mcp \
  --header "Authorization: Bearer YOUR_APP_ACCESS_KEY"
```

Any MCP client that supports HTTP servers and a bearer header can use the same URL.

## Home-screen widget (optional)
iOS web apps can't have widgets, so `widget/tempo-widget.js` is a
[Scriptable](https://scriptable.app) script that shows readiness, Body Battery, sleep,
HRV and steps. Paste it into a new Scriptable script, fill in `SERVER` and `KEY`, and add
a Scriptable widget to your home screen.

---

## What's in the app

- **Today** — readiness, your latest session (or a HYROX breakdown), sleep, Body
  Battery, HRV, stress, heart rate, steps, intensity minutes, training status, next
  workout and the last 7 days. Every card can be shown/hidden, reordered, resized and
  switched between chart styles (tap the grid icon).
- **Activities** — list by week with filters, or a month calendar. Each activity has the
  route map, splits/laps, heart-rate zones, pace/HR/elevation/cadence/power/stamina
  charts, training effect, running dynamics, strength sets and weather.
- **Training** — training status, acute load vs optimal range, 4-week load focus, VO₂ max
  history, race predictions, readiness trend, endurance and hill score, lactate
  threshold, heat/altitude acclimation, weekly volume, HYROX history and personal records.
- **Health** — every daily metric for any day, with 7-day to 1-year trends for each.
- **Coach** — Claude with live access to your data through the MCP server.
- **Settings** — theme, units, maps, chart style, Today layout, Health order, race
  countdown, coach context, connection and Garmin account.

### How HYROX sessions are recognised
Garmin has no HYROX activity profile, so Tempo looks for any of these:
1. **The name** contains "HYROX" (e.g. a renamed Cardio profile, or you rename the
   activity in Garmin Connect).
2. **Named laps** with station names (SkiErg, Sled Push, Wall Balls…), which some Connect
   IQ apps and structured workouts produce.
3. **The lap pattern**: about 1 km laps alternating with laps that barely move. Press
   lap after every run and every station and it's picked up even without the name.

Multisport recordings (run/cardio legs) work too. Stations without names are assigned
in race order. A HYROX card appears on Today for 7 days after one.

---

## Develop locally

```bash
pip install -r requirements.txt
GARMIN_FAKE=1 APP_ACCESS_KEY=dev uvicorn app:app --reload --port 8765   # sample data, no account needed
cd web && npm install && npm run dev                                     # app at http://localhost:5173
GARMIN_FAKE=1 APP_ACCESS_KEY=test python -m pytest -q                    # backend tests
```

After changing the app, run `cd web && npm run build` and commit `web/dist` — Vercel
serves that folder. `python scripts/export_demo.py` regenerates the sample data the app
shows before it's connected.

If a number looks wrong or missing, Garmin may have renamed a field. Look at the raw
answer with `/api/raw/<method>?args=<date>` (for example
`/api/raw/get_sleep_data?args=2026-11-04`, with your key) and adjust the matching
function in `backend/normalize.py`.

### Project layout
```
app.py                  FastAPI entry: API routes, /mcp, serves web/dist
backend/garmin.py       Garmin session, token rotation, caching, parallel calls
backend/service.py      Screen-sized bundles (today, activity, training, trends…)
backend/normalize.py    Garmin JSON → clean shapes
backend/hyrox.py        HYROX detection and analysis
backend/tools.py        The tool functions (shared by MCP and the coach)
backend/mcp_server.py   MCP server (Streamable HTTP, stateless)
backend/coach.py        Claude coach via the MCP connector
backend/fake_garmin.py  Realistic sample account for development and demo mode
web/                    React app (Vite); built into web/dist
scripts/garmin_login.py One-time Garmin sign-in on your laptop
widget/tempo-widget.js  Scriptable home-screen widget
```

## Troubleshooting

| You see | Do this |
|---|---|
| "Garmin isn't connected yet" | Run step 4 again. |
| "Garmin rejected the saved login" | Tokens expired or were revoked — run step 4 again. |
| Tokens stop working after a day | Upstash isn't connected; do step 3 and redeploy. |
| "Garmin asked us to slow down" | Wait a few minutes. Garmin rate-limits heavy use. |
| Coach says to add `ANTHROPIC_API_KEY` | Add it in Vercel → Settings → Environment Variables, then redeploy. |
| The first open of the day is slow | The serverless function is waking up and fetching ~18 Garmin endpoints; it takes a few seconds. |

## Notes
- This uses the unofficial `garminconnect` library (Garmin's official API is for
  approved companies). Garmin can change things without notice; when they do, update
  the library: `pip install -U garminconnect` and bump `requirements.txt`.
- Your Garmin tokens, access key and API key live only in your Vercel and Upstash
  accounts. The MCP endpoint and API both require the access key.
- Not affiliated with Garmin.
