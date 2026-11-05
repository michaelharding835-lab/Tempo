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

## Set it up on Windows (about 20 minutes)

You need free accounts at github.com and vercel.com, and an Anthropic API key
(console.anthropic.com) for the coach. Replace `tempo-ben` below with your own
Vercel project name.

### 1. Unzip and make your access key
1. Right-click `tempo.zip` → **Extract All** → **Extract**. You get `Downloads\tempo`,
   with `app.py` directly inside.
2. Open **Anaconda Prompt** and make the app's password:
   ```
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
   Keep it somewhere you can paste from on your laptop *and* phone (e.g. email it to
   yourself). You'll use it in Vercel, the Garmin sign-in and the app.

### 2. Put the code on GitHub
In **PowerShell**:
```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
```
Close PowerShell, open it again, then:
```powershell
gh auth login                      # GitHub.com → HTTPS → Yes → Login with a web browser
cd $HOME\Downloads\tempo
gh repo create tempo --private --source . --push
```
It's done when it prints `https://github.com/<you>/tempo`.
(VS Code alternative: open the folder → Source Control → **Publish Branch** → private.)

### 3. Deploy on Vercel
1. vercel.com → **Sign Up** → **Continue with GitHub** (Hobby, free).
2. **Add New… → Project** → **Import** `tempo`. If it isn't listed, use *Adjust GitHub
   App Permissions* to give Vercel access to the repo.
3. Name the project (e.g. `tempo-ben` → your app lives at `https://tempo-ben.vercel.app`).
   **Framework Preset** should say **FastAPI**; leave the build settings alone.
4. Open **Environment Variables** and add `APP_ACCESS_KEY` (your key from step 1) and
   `ANTHROPIC_API_KEY`.
5. **Deploy** and wait for the confetti.

### 4. Add free storage for your Garmin login (required)
Garmin's login tokens change every time they're used, so the server must save them.
1. In the project: **Storage** → **Create Database** → **Upstash for Redis** → **Free**
   plan → a US East region (Vercel runs your server in Washington, D.C. by default) →
   create it and **connect it to the tempo project**. Leave the environment variable
   prefix as it is (it adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`).
2. **Deployments** → `⋯` next to the latest one → **Redeploy**.
3. Check `https://tempo-ben.vercel.app/api/health`. You want `"store":"upstash"`,
   `"access_key_set":true` and `"coach":true`. `garmin_linked` stays false until step 5.

### 5. Connect your Garmin account (from your laptop)
Garmin often blocks sign-ins from cloud servers, so sign in once from your laptop. In
**Anaconda Prompt**:
```
conda create -n garmin python=3.12 -y
conda activate garmin
pip install garminconnect
cd %USERPROFILE%\Downloads\tempo
python scripts\garmin_login.py --app https://tempo-ben.vercel.app --key YOUR_ACCESS_KEY
```
Enter your Garmin email, password (it stays invisible while you type) and the code
Garmin sends you. It's done when it says **Tokens are saved on your server**. The
password is used once and never stored.

No Python? Open the app on your phone first (step 6), then use **Settings → Garmin
account → Email & password**. That works when Garmin allows the cloud sign-in.

### 6. Install it on your iPhone
1. Open `https://tempo-ben.vercel.app` in **Safari**.
2. Paste your access key → **Connect**. Today fills with your data.
3. Tap **Share** → **Add to Home Screen** → keep the name **Tempo** (leave *Open as Web
   App* on if you see it) → **Add**.

Every time you open it from the home screen, it pulls fresh data from Garmin.

### Making changes later
Edit the code (or ask Claude Code to), then in PowerShell in the folder:
```powershell
cd web; npm install; npm run build; cd ..      # only if you changed the app in web/src
git add -A; git commit -m "Describe the change"; git push
```
Vercel redeploys automatically on every push.

### App icon
The black icon is built in (`web/public/icons`). Lime and blue versions are in
`web/public/icons/alt`. To switch, copy `alt/lime-apple-touch-icon.png` over
`icons/apple-touch-icon.png` (and the 512 version over `icon-512.png`) in both
`web/public` and `web/dist`, push, then remove and re-add the app on your phone.

---

## Use your data from Claude Code (and your own assistant)

Your server is a standard Streamable-HTTP MCP server with eight read-only tools
(`get_daily_summary`, `list_activities`, `get_activity`, `get_training_status`,
`get_trend`, `get_hyrox_history`, `get_muscle_load`, `get_profile`):

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
- **Muscles this week** — a front-and-back body map that fills in from your strength
  sessions (grey → lime → orange → red as sets add up) and resets every Monday. Tap a
  day to see the week up to that point. HYROX stations can count too.
- **Coach** — Claude with live access to your data through the MCP server.
- **Settings** — theme, units, maps, chart style, Today layout, Health order, race
  countdown, coach context, connection and Garmin account.

### How the muscle map works
Garmin logs each set of a Strength activity with an exercise (for example
`BENCH_PRESS / INCLINE_DUMBBELL_BENCH_PRESS`). `backend/muscles.py` maps every exercise
to the muscles it trains: each set counts 1 for the main muscles and 0.5 for the ones
that assist. A muscle is **light** below 40% of your target, **building** after that and
**worked** (red) at the target, 8 hard sets a week by default (change it in Settings →
Strength). Exercises it doesn't recognise are listed on the Muscles page; add them to
`NAME_RULES` in `backend/muscles.py`. If a set was logged as the wrong exercise, fix it
in Garmin Connect and the map updates.

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
backend/muscles.py      Exercise → muscle mapping for the weekly muscle map
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
| `/api/health` shows `"store":"memory"` | Upstash isn't connected, or you haven't redeployed since connecting it. |
| "The access key doesn't match" | Re-paste it with no spaces. If you changed it in Vercel, redeploy first. |
| The Vercel build fails | Open the deployment → **Build Logs** and copy the red lines into Claude. |
| The first open of the day is slow | The serverless function is waking up and fetching ~18 Garmin endpoints; it takes a few seconds. |

## Notes
- This uses the unofficial `garminconnect` library (Garmin's official API is for
  approved companies). Garmin can change things without notice; when they do, update
  the library: `pip install -U garminconnect` and bump `requirements.txt`.
- Your Garmin tokens, access key and API key live only in your Vercel and Upstash
  accounts. The MCP endpoint and API both require the access key.
- Not affiliated with Garmin.
