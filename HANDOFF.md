# Bambai — handoff

Written for a Claude session picking this project up cold. Everything here was
verified against the code, not recalled. Last updated at commit `85c624a`.

Repo: <https://github.com/iseerahul/bambai>
Live: <https://13.203.232.95.sslip.io> (AWS EC2, Docker, nginx + Let's Encrypt)

---

## 1. What it is

A map of Mumbai you can ask questions of, keep your own pins on, and make plans
from. A semester-7 student project, deployed and public.

Four things, all in one React app:

| Mode | What it does |
|---|---|
| **Ask map** | Search 19,336 places by *mood* ("somewhere chill by the water"), ranked with the reason attached. Walking/cycling/driving directions and live navigation. |
| **Been here** | Pin places you actually went, with photos and a private note. Optionally publish a pin as a public "spot". |
| **Hang out** | Start something where you are, see who is nearby on the map, land in a group chat. |
| **Events** | What's on tonight / this week / a chosen date, imported from live sources. |

---

## 2. Shape of the thing — the part that surprises people

**It is two separate front ends on one origin.**

```
/        landing page   landing/      TanStack Start, PRERENDERED to static
/app/    the map app    src/          Vite + React SPA
/api/*   the backend    worker/       Cloudflare Worker
```

- The landing is a separate design (from the `bambai-meet-vibes` Lovable repo)
  vendored into `landing/`. It has **its own `package.json` and node_modules** —
  `npm install` at the root is not enough, you also need
  `npm install --prefix landing`.
- It is **prerendered**, not server-rendered. That is what lets the Worker serve
  it as plain static files so both halves share one origin. `prerender` lives in
  `landing/vite.config.ts`, and `crawlLinks` must stay **off** — the CTA points
  at `/app/`, which does not exist in the landing's router, and the prerenderer
  would follow it and fail the build.
- The map app's Vite `base` is `/app/`. This bites constantly: any absolute path
  written as `/data/...` or `/hangout` is wrong. Use
  `import.meta.env.BASE_URL`.
- `npm run build` builds the map into `dist/app`, then prerenders the landing
  and copies it around it, then copies `static/` last.

---

## 3. Running it

Requires **Node 22.13+** — the dev server's D1 shim uses built-in `node:sqlite`.

```bash
npm install
npm install --prefix landing

cp .dev.vars.example .dev.vars     # REQUIRED even with placeholder values

npm run dev:api        # :8787
npm run dev            # http://127.0.0.1:5173/app/   <- note the /app/
npm run dev:landing    # http://127.0.0.1:3000/
```

**Copying `.dev.vars` is not optional.** `APP_ORIGIN` is what enables the local
dev login (`devLoginAllowed` in `worker/auth.ts`). Without the file you can
browse everything but cannot sign in at all — no pins, no activities, no trips.
The placeholders in the example are recognised as placeholders.

Place data is **committed** (`public/data/*.geojson`). Do not run `npm run data`
as a setup step; it hammers Overpass for data already in the repo.

The database **creates itself** from `worker/schema.sql` on first start.
Wrangler is only needed to deploy.

---

## 4. Deployment

Three compose files. Use exactly one — they replace each other, they do not
overlay (Compose merges `ports` by appending, so an overlay cannot un-publish a
port).

| File | Proxy |
|---|---|
| `docker-compose.yml` | none, plain HTTP on 8787 |
| `docker-compose.https.yml` | Caddy, automatic certs, ~1 service |
| `docker-compose.nginx.yml` | nginx + certbot, 3 services — **this is what is deployed** |

```bash
./restart.sh --pull        # rebuild + restart whatever is running, wait for health
```

**HTTPS with no domain:** `sslip.io` resolves any hostname containing an IP to
that IP, so `13.203.232.95.sslip.io` is a real hostname Let's Encrypt will sign.
No CA issues certs for a bare IP.

`.env` on the server must have `SITE_ADDRESS`, `APP_ORIGIN` (the **https** URL,
matching exactly), `IP_SALT`, `LETSENCRYPT_EMAIL`, and the Google credentials.
`APP_ORIGIN` decides the OAuth redirect **and** whether session cookies get
`Secure`, so an `http://` value behind TLS is silently dangerous.

---

## 5. Hard-won gotchas — read this before debugging anything

Each of these cost real time and will recur.

**nginx 502s after every rebuild.** nginx resolves the app's hostname once at
config load and caches the IP forever; rebuilding gives the container a new IP.
Fixed with a `resolver 127.0.0.11` + variable `proxy_pass`, but `restart.sh`
must also recreate the proxy, because both proxies read config from a bind mount
and `up` sees no reason to touch them.

**The Node shim is not workerd.** `scripts/dev-server.mjs` bundles the Worker and
runs it on plain Node with SQLite for D1 and a directory for R2. It exists
because Smart App Control blocks `workerd.exe` on the dev machine. It has no
Durable Objects, no KV, no platform limits. It *does* now emulate cron.

**Cron is what imports events.** `scheduled()` → `sweepEvents()` → seed + Luma +
AllEvents + Ticketmaster. The shim calls it at boot and every 6h. Without that a
self-hosted database stays empty forever and nothing says why.

**`HOST` must be `0.0.0.0` in a container.** The shim defaults to loopback;
inside a container that is the container's own loopback and every request to the
published port returns an empty reply. This was once misdiagnosed as a Windows
virtualisation problem.

**Never `docker compose down -v`.** It takes the SQLite database, every uploaded
photo, *and* the Let's Encrypt cert and account key. Let's Encrypt allows five
certs per hostname per week.

**Duplicate CSP headers intersect, they do not override.** `static/_headers`
therefore puts the *relaxed* landing policy on `/*` and the *strict* map policy
on `/app/*`, so the intersection lands correctly for both. Getting this
backwards blocks the landing's inline hydration scripts.

**The bundled Worker must not live in `dist/`.** `dist/` is what wrangler
publishes and the shim serves; a bundle there was downloadable at `/worker.mjs`
— the whole server, SQL and auth flow included. It builds to `build/` now.

**`build-landing.mjs` prunes `dist/` (keeping `dist/app`).** Without that,
anything a previous build produced survives and ships — that is how a deleted
Lovable favicon kept being deployed.

**Lovable assets are CDN pointers.** A fresh design sync brings `.asset.json`
files pointing at Lovable's host, which 404 anywhere else. Download them into
`landing/src/assets/` as real files and rewrite the imports. Then run
`npm run landing:shrink` — the raw images were 14.6 MB and the audience is on
4G.

**Escaping traps.** Writing JS/shell through Python heredocs repeatedly mangled
`\n` and `\x1b`. Prefer line-range edits or separate files for anything with
escapes.

---

## 6. Non-obvious design decisions

- **No LLM.** There was one (Gemini); it was removed. Ranking is explainable
  arithmetic in `src/search/rank.ts` — mood 3.0, text 2.2, distance 1.6,
  community 0.8, open 0.5, chain −0.7.
- **Honesty is the product's whole positioning.** It says "price unknown"
  rather than guessing, "hours unknown" rather than implying open. Luma reports
  every event as free including paid conferences, so the importer *drops* the
  price. The landing's stats are real rows or an em dash — never an invented
  figure. **Do not add a fabricated number anywhere.**
- **The board's hard invariant:** no endpoint ever returns one person's visits
  to anyone else. A visit is private and can carry a private note; the public
  spot derived from it is a separate row with a separate note.
- **The dev login is a deliberate bypass** ("anyone who can reach it can become
  anyone"). It switches off automatically for any non-loopback bind;
  `ALLOW_DEV_LOGIN=1` overrides on a trusted network.
- Place data is baked at build time because public Overpass forbids
  app-backend use. That is also why search is local arithmetic.

---

## 7. Verifying work

There are three real suites, run against a live server over HTTP:

```bash
node scripts/test-board.mjs    # 32 — includes the privacy invariant
node scripts/test-trips.mjs    # 10
node scripts/test-events.mjs   # 45
```

They **skip themselves when Google credentials are configured**, because they
use the dev login. To actually run them, start an isolated server with
`APP_ORIGIN=http://localhost:<port>` and no Google creds.

`npm run typecheck` covers both the app and the worker tsconfigs.

There is **no headless browser** in this project. Anything visual — layout,
mobile geometry — can only be reasoned about arithmetically. Say so rather than
claiming it was checked.

---

## 8. Known outstanding

- **Not deployed to Cloudflare.** `database_id` in `wrangler.toml` is still a
  placeholder. Only the Docker path is live.
- **Google sign-in on the deployment** was last seen failing; the callback now
  redirects to `/app/` (it went to `/hangout`, which served the landing → blank
  screen) and each failure reason gets its own `auth_error` value. Needs a real
  round-trip to confirm.
- **`ORS_API_KEY` unset** → routing does not error, it silently falls back to
  straight lines with guessed times.
- Two decorative fabrications remain on the landing: the rooftop strip's
  "Friday · 9 PM · 16 people joined · Lower Parel rooftop".
- Authorisation gaps found but not fixed: `POST /api/rooms/:id/join` has no
  eligibility check, and `roomDetail` returns a full member roster to
  non-members. `/api/social/people` has an unbounded bbox and no rate limit.
- A backend correctness audit was started and never finished.
- Mobile layout of the landing is arithmetic-only, unverified on a device.

---

## 9. Working style that has been productive here

- Verify claims against the code before repeating them. Several confident
  reports in this project turned out to be wrong — including some of mine.
- Say plainly what was tested and what was not. "Build passes, not visually
  checked" is more useful than implied confidence.
- When something is invented, unknown or broken, name it rather than smoothing
  it over. That is also the product's own standard.
