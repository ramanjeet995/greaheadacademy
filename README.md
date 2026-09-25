# Gearhead Academy

Learn how machines work by designing them. Learners pick a system (steering, brakes, elevator…), describe how they'd build it in plain words, compare it with real designs, and go one layer deeper — Student → Junior → Mid-level → Senior → Modern.

Hosted on **Netlify**: a static site built from `public/`, one **Netlify Function** for the API, **Netlify Blobs** for storage, the **Claude API** for the optional AI mentor, and **Google AdSense** for revenue.

## How the money works

| | |
|---|---|
| Hosting | Netlify's free plan to start. Page views are static files (cheap); only API calls run a function. *Check Netlify's current plan limits and pricing before launch.* Domain ~$10–15/year. |
| AI mentor | `claude-haiku-4-5` ($1 / $5 per million input/output tokens). One reply ≈ $0.005, so the default cap of 5 replies per user per day costs at most ~$0.025 per active user per day. |
| Hard spend ceiling | `GLOBAL_DAILY_REPLIES` (default 1000/day ≈ $5/day worst case). Also set a monthly spend limit in the Anthropic Console. |
| Free path | Without the AI mentor, learners still get the real-world answer after each layer — costs nothing. |
| Explore any machine | Signed-in learners can type any machine and Claude writes a new 5-layer lesson (≈ $0.01 each on Haiku). Each topic is written once and cached, so the next learner who asks for it costs nothing. Capped at 2 new topics per user per day, 200 site-wide. |

Keep the AI caps low until AdSense shows your real revenue per 1,000 page views, then raise `FREE_DAILY_REPLIES` only as far as revenue covers it.

## Project layout

```
public/                    source for the static site
  index.html, app.js, styles.css
  systems.json             all lesson content — the single source of truth
  about.html, privacy.html
build.mjs                  builds dist/: page per system (/s/<id>/), AdSense tags, sitemap, robots, ads.txt, 404
netlify/functions/api.mjs  the API at /api/* (accounts, progress, AI mentor)
netlify/functions/cleanup.mjs   daily clean-up of old counters and sessions
netlify.toml
tools/generate_system.py   write new systems with Claude (one-time cost per system)
```

API: `POST /api/login` (username + PIN; unknown usernames are created), `GET/PUT /api/progress`, `GET /api/me`, `POST /api/mentor`, `POST /api/generate` (write a lesson for a typed topic), `GET /api/topic/:id` (a generated topic, for shared links), `POST /api/logout`, `GET /api/config`.

Generated topics live in the `topics` Blobs store and open at `/s/x-<slug>`. They aren't in the sitemap and aren't reviewed. To make a good one a permanent, indexed page, review it and add it to `public/systems.json` (or regenerate it with `tools/generate_system.py`).

## Deploy

1. Put this folder in a GitHub repository.
2. In Netlify: **Add new project → Import an existing project**, pick the repo. The build settings come from `netlify.toml` (build `node build.mjs`, publish `dist`).
3. In **Project configuration → Environment variables**, add:

   | Variable | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key from console.anthropic.com (mark as secret) |
   | `PIN_PEPPER` | any long random string — never change it, or every user is locked out (mark as secret) |

4. **Deploy**. Netlify Blobs needs no setup. Add your domain under **Domain management**.

Every push to the repo redeploys the site.

### Without GitHub (CLI)

Needs [Node.js](https://nodejs.org) LTS.

```bash
npm install
npx netlify login
npx netlify init
npx netlify env:set ANTHROPIC_API_KEY sk-ant-...
npx netlify env:set PIN_PEPPER some-long-random-string
npm run deploy
```

### Local development

```bash
npm install
npx netlify dev
```

`netlify dev` runs the build, the functions and a local Blobs store, using the environment variables from your linked Netlify project.

## AdSense

1. Before applying: fill in `[your contact email]` and `[date]` in `public/about.html` and `public/privacy.html`, have your own domain live, and publish plenty of systems. Thin sites get rejected.
2. Apply at adsense.google.com with your domain. Add environment variable `ADSENSE_CLIENT` = your publisher ID (`ca-pub-…`) and redeploy. That adds the AdSense code and verification tag to every page and publishes `/ads.txt`.
3. After approval, create three **display ad units** and add their slot IDs as `AD_SLOT_TOP`, `AD_SLOT_SIDE`, `AD_SLOT_BOTTOM`. Redeploy.
4. In AdSense → **Privacy & messaging**, publish the GDPR consent message (required for EEA/UK/Swiss visitors).

Ads sit in the header, the sidebar and the bottom of the page — never inside the lesson thread, to avoid accidental clicks, which AdSense penalises.

## Adding content

Each system in `public/systems.json` becomes a static page at `/s/<id>` with crawlable reference notes. More pages means more search traffic and more ad revenue.

```bash
pip install anthropic
python tools/generate_system.py mechanical "Bicycle gears"                   # draft → tools/drafts/
python tools/generate_system.py mechanical "Bicycle gears" --publish-draft   # after reviewing it
git commit -am "Add bicycle gears" && git push                               # Netlify redeploys
```

The generator uses `claude-opus-5` for quality (a few cents per system) with server-side refusal fallbacks enabled. Review every draft for accuracy before publishing.

## Settings (Netlify environment variables)

| Name | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for the AI mentor |
| `PIN_PEPPER` | — | Required; secret mixed into PIN hashes |
| `MODEL` | `claude-haiku-4-5` | Model for the AI mentor |
| `FREE_DAILY_REPLIES` | 5 | AI replies (answers + hints) per user per day |
| `IP_DAILY_REPLIES` | 15 | Per IP address per day — stops one person farming usernames |
| `GLOBAL_DAILY_REPLIES` | 1000 | Whole-site ceiling per day |
| `SIGNUPS_PER_IP_DAILY` | 5 | New usernames per IP per day |
| `GEN_MODEL` | `MODEL` | Model that writes explored topics |
| `GEN_DAILY` | 2 | New topics per user per day (cached topics are free) |
| `GEN_IP_DAILY` | 4 | New topics per IP per day |
| `GEN_GLOBAL_DAILY` | 200 | New topics site-wide per day |
| `ADSENSE_CLIENT`, `AD_SLOT_TOP`, `AD_SLOT_SIDE`, `AD_SLOT_BOTTOM` | empty | AdSense; used at build time, so redeploy after changing |
| `SITE_URL` | Netlify's `URL` | Override the site URL used in the sitemap and canonical links |

## Accounts and security

- Username + PIN, no email. New usernames are created on first sign-in; there's no recovery.
- PINs are stored as salted SHA-256 hashes with a server-side pepper. Short PINs are protected by the lockout after 10 wrong tries per hour, not by the hash.
- Usage counters live in Netlify Blobs, which has no atomic increment: two requests at the same instant can overshoot a limit by one. The global cap bounds the worst case.
- Learner answers are sent to the model as material to grade, capped at 2,500 characters. Replies are capped in length and returned as structured JSON only.
