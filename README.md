# Bambai

A map of Mumbai you can ask questions of, keep your own pins on, and make plans
from. Four things in one place:

- **Ask map** — search every park, chai stall, gallery and ground in the city by
  how you feel, not just by name. Walking, cycling, driving and transit
  directions, with live navigation.
- **Been here** — pin the places you actually went, with photos and a note. Your
  own map of the city, plus the option to publish a spot for everyone.
- **Hang out** — start something nearby, see who's around, land in the group chat.
- **Events** — what's on in Mumbai tonight, this week, or on a date you pick.

Built on open data and free tiers. No paid API sits in the request path.

---

## Two apps, one origin

The product is a landing page and a map app, deployed together:

| URL | What | Lives in | Stack |
|---|---|---|---|
| `/` | The landing page — the front door | `mumbai-zenscape/` | TanStack Start, prerendered |
| `/app/` | The map, and everything in it | `src/` | Vite + React SPA |
| `/api/*` | The backend | `worker/` | Cloudflare Worker |

"Explore Bambai" on the landing is a plain link to `/app/`. Because both halves
are served from one Cloudflare Worker it is a same-origin navigation — one
deploy, one domain, one session cookie, no CORS.

The landing started life as a separate Lovable project
([mumbai-zenscape](https://github.com/iseerahul/mumbai-zenscape)) and is now
vendored into this repo as an ordinary folder — one repo, one clone, one build.
It keeps its own `package.json` and dependency tree because it is a different
stack (TanStack Start rather than a plain Vite SPA).

It is a poster with no server functions, so it is **prerendered to a single
HTML file at build time** rather than server-rendered per request — that is
what lets a Worker that already exists serve it as plain static assets.

To pull a fresh design down from Lovable, copy its `src/` over the top rather
than re-cloning the repo into place; a nested `.git` here would make the folder
a submodule again and a clone of this repo would get an empty directory.

---

## How it works

```
Browser
├── MapLibre GL JS      ← vector tiles from OpenFreeMap (free, no API key)
├── /data/*.geojson     ← 19,336 places, baked at build time
├── src/search/         ← ranking runs here, on-device, no network call
└── /api/*              → Cloudflare Worker ─┬─→ D1     (accounts, events, board)
                                             ├─→ R2     (photos)
                                             └─→ Photon / Wikimedia / Luma / AllEvents
```

One origin in production: the Worker serves both front ends and `/api/*`, so
the browser never makes a cross-origin request and the CSP stays tight.

### Places come from a build step, not a live API

Public Overpass instances forbid app-backend use (~10k requests/day, and they
shed load on heavy users). So the POI data is baked into static GeoJSON at build
time and never queried live.

That constraint turned out to be a feature: because the whole dataset is on the
device, **search is local arithmetic**. Typing is instant, it works on a bad
connection, and it costs nothing per query.

| Layer | Features | Layer | Features |
|---|---:|---|---:|
| toilets | 8,638 | culture | 396 |
| food | 2,454 | rail_lines | 390 |
| park | 1,992 | transit | 318 |
| health | 1,805 | bench | 260 |
| sports | 1,690 | market | 206 |
| atm | 980 | pharmacy | 205 |
| waterfront | 47 | police | 129 |
| flood_spots | 44 | shelter | 100 |
| drinking_water | 72 | | |

Note what's thin. 72 drinking water points for 20 million people. When a search
comes back empty, that usually means *nobody has mapped it*, not that the city
has none — and the UI says so rather than implying absence.

### Search and recommendations are deterministic

There is no LLM in the search path. Ranking is explainable arithmetic in
[`src/search/rank.ts`](src/search/rank.ts), and every result can say why it
scored what it did:

| Signal | Weight |
|---|---:|
| mood match | 3.0 |
| text match | 2.2 |
| distance | 1.6 |
| community pins | 0.8 |
| open now | 0.5 |
| chain penalty | −0.7 |

**Moods** ([`src/search/moods.ts`](src/search/moods.ts)) map a feeling onto OSM
tags — *chill* → `leisure=park`, `leisure=garden`, `tourism=viewpoint`. Twelve
shipped. Every weight is tied to a measured subtype count in the actual data,
and moods whose tags had under 8% coverage were cut rather than shipped as a
guess; the rejected ones and their coverage are documented in `NOT_SHIPPABLE`.

**Typo tolerance** is a squashed-string match plus trigram Dice similarity, so
`kitabkhana`, `kitab khana` and `Kitab Khana` all find the same shop.

### What the backend actually does

D1 holds 27 tables across five features — accounts and sessions, the visit
board, hangout activities and rooms, events, and trips. Photos go to R2, which
has no egress charge.

Sign-in is Google OAuth (authorization-code flow) with opaque session cookies.
You can browse the entire app signed out; the prompt appears at the moment you
try to contribute something.

**Events** are imported from Luma's public discovery feed and AllEvents'
schema.org JSON-LD, classified into 12 categories, deduplicated, and refreshed on
a cron. One deliberate choice: Luma reports `is_free: true` with a null price for
*every* event including paid conferences, so the importer drops the price rather
than repeating it. "Price unknown" on a ticketed summit is a much better failure
than "Free".

**The board** keeps a hard invariant: no endpoint ever returns one person's
visits to anyone else. A visit is private and can carry a private note; the
public spot derived from it is a separate row with its own separate note.

---

## Running it

Requires **Node 22+** — not incidental, the dev server's D1 shim is built on
the built-in `node:sqlite`, which does not exist before it.

Two dependency trees, because the landing is a different stack:

```bash
npm install
npm install --prefix mumbai-zenscape
```

### 1. Place data — already committed, nothing to run

`public/data/*.geojson` is in the repo on purpose, so a bad Overpass day can
never block a build or a demo. A fresh clone has all 19,336 places and needs
no pipeline run.

Only re-run it when you want fresher data, roughly weekly:

```bash
npm run data         # hits Overpass + the MCGM toilet dataset
npm run data:civic   # just the small civic layers, faster
```

It takes a couple of minutes and is deliberately polite (3s between queries,
mirror failover). Run it manually — never from the app. It warns loudly if
counts come back far below the baselines above, which means the pipeline broke
rather than the city changing.

```bash
npm run data:civic   # just the small civic layers, for faster iteration
```

### 2. Configure

```bash
cp .dev.vars.example .dev.vars
```

Copying the file is not optional, even with every value left as a placeholder:
`APP_ORIGIN` is what enables the local dev login, and without it you can browse
everything but cannot sign in at all — so no pins, activities or trips. The
placeholders in the example are recognised as placeholders, so the copy works
as-is.

Google sign-in needs an OAuth 2.0 Client ID from
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
with `http://localhost:5173/api/auth/callback` as an authorised redirect URI.

Leave `GOOGLE_CLIENT_ID` blank and the Worker enables a local dev login instead —
which the test scripts need. The two are mutually exclusive on purpose: a sign-in
bypass must never sit beside working auth.

```bash
node scripts/check-auth.mjs   # validates the credentials before you debug blind
```

### 3. The database creates itself

Nothing to do locally. On first start the dev server finds no database and
builds one from `worker/schema.sql` under `.wrangler/state`. Wrangler is only
needed when you actually deploy:

```bash
npx wrangler d1 create civic-reports   # deploying only
# paste the printed database_id into wrangler.toml
npm run db:init:remote
```

### 4. Run it

Three terminals, because in development the two front ends are two Vite
servers. In production they are one origin.

```bash
npm run dev:api       # the Worker      — :8787
npm run dev           # the map         — http://127.0.0.1:5173/app/
npm run dev:landing   # the landing     — http://127.0.0.1:3000/
```

Note the map's dev URL is **`/app/`**, not `/`. That is deliberate: its Vite
`base` matches where it is served in production, so the two never diverge.

Vite proxies `/api` to the Worker, so the browser only makes same-origin
requests, exactly as in production.

### 5. Load some events

The database starts empty. One request fills it from the live sources:

```bash
curl -X POST http://127.0.0.1:8787/api/events/refresh
```

Expect a couple of hundred events. It is also the "Refresh" button in the
Events tab, and it runs on a cron once deployed.

`mumbai-zenscape/.env.development` points "Explore Bambai" at the map's dev
port. It is `.env.development` rather than `.env` on purpose — a plain `.env`
is read in *every* mode and would bake `127.0.0.1` into the production build.

**Why `node scripts/dev-server.mjs` and not `npm run worker:dev`.** `wrangler
dev` runs the Worker inside `workerd.exe`, which Smart App Control / WDAC blocks
outright on some managed Windows machines — and the block is on the binary's
signature, not its path, so moving the project does not help. The shim bundles
the Worker with esbuild and runs it on plain Node against *the same* SQLite file
under `.wrangler/state`, so data created either way is shared. It is not a
Workers emulator: no cron triggers, no Durable Objects, no KV, no platform
limits. On a machine where `wrangler dev` works, use it.

### 6. Tests

```bash
node scripts/test-events.mjs   # events: import integrity, auth boundaries, chat
node scripts/test-board.mjs    # visits and spots, incl. the privacy invariant
node scripts/test-trips.mjs    # trips and destination groups
```

These run against a live Worker over real HTTP rather than mocking, because what
breaks here is authorisation boundaries and import idempotency — neither of which
a unit test would catch. They sign in through the dev login, so **they skip
themselves when Google credentials are configured** and say so.

### 7. Deploy

```bash
npm run build     # map -> dist/app, then landing -> dist/
npx wrangler secret put IP_SALT
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run worker:deploy
```

`npm run build` runs `build:map` then `build:landing`, in that order. The map
is built first because `scripts/build-landing.mjs` copies the landing *on top
of* `dist/` and must not clobber `dist/app/` — it fails the build rather than
overwrite if the landing ever emits an `app` entry.

Headers for both halves come from `static/_headers`, copied last so it wins.
It has to be `dist/_headers`; a `_headers` inside `dist/app/` is ignored.

---

## Running it in Docker

For when you want the whole thing on one machine — a demo, an evaluator, or a
host where `wrangler dev` cannot run at all.

```bash
cp .env.example .env     # fill in IP_SALT at minimum
docker compose up --build
```

Then open **http://localhost:8787** — landing at `/`, map at `/app/`, API at
`/api/*`, all from the one container. That is the same single-origin layout as
the Cloudflare deployment, which is what keeps "Explore Bambai" a plain link.

The image is a two-stage build: the first stage installs both dependency trees,
builds both front ends and bundles the Worker; the runtime stage copies `dist/`,
the server script and `schema.sql`, and nothing else. No `node_modules`, no
TypeScript, no esbuild — the Worker bundle is handed over prebuilt via
`WORKER_BUNDLE`, which is what `scripts/build-worker.mjs` exists for.

**State lives in a volume.** `DATA_DIR=/data` holds the SQLite database and
every uploaded photo, and `docker-compose.yml` mounts `bambai-data` over it. On
first boot against an empty volume the server creates the database from
`worker/schema.sql` itself — there is no wrangler in the container to do it.
Without that volume, `docker compose down` takes every account, pin and photo.

**This is not Cloudflare.** The container runs the same Node shim as local
development: D1 is real SQLite, R2 is a directory, and there are no cron
triggers, Durable Objects, KV, or platform limits. It runs this app's routes;
deployment correctness is still `wrangler deploy`'s job. Production is
Cloudflare — see step 6 above.

If you expose it beyond your own machine, set real `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`. Leaving them blank switches the Worker to its local dev
login, which is a sign-in bypass.

---

## Project layout

```
mumbai-zenscape/          The landing page at / — vendored from Lovable, own deps
static/_headers           Headers for the whole origin (both apps)
dist/                     Build output: landing at /, map at /app/

Dockerfile                Two-stage image; runtime is dist/ + the server script
docker-compose.yml        Self-hosting: one container, one volume for state

scripts/build-data.mjs    Overpass + MCGM → static GeoJSON (build-time only)
scripts/build-landing.mjs Prerenders the landing and folds it into dist/
scripts/build-worker.mjs  Bundles the Worker for the container image
scripts/dev-server.mjs    Plain-Node stand-in for `wrangler dev`; serves dist/
shared/categories.json    Single source of truth for categories (pipeline + app)

worker/index.ts           Router, reports, CSP
worker/auth.ts            Google OAuth, sessions
worker/board.ts           Visits (private) and spots (public)
worker/events.ts          Event list, filters, attendance
worker/luma.ts            Luma importer + the shared category classifier
worker/allevents.ts       AllEvents JSON-LD importer
worker/social.ts          Activities, trips, destination groups
worker/rooms.ts           Group chat and DMs
worker/geocode.ts         Photon, with Nominatim as strict fallback
worker/destinations.ts    Place type-ahead + Wikipedia/Commons photos

src/search/               Local index, moods, ranking, query interpretation
src/board/                Visit capture, photo prep (EXIF GPS), API client
src/hangout/              Activities, trips, chat, profile
src/events/               Event browsing and creation
src/map/                  MapLibre view, markers, ambient animation, sprites
src/nav/ src/trip/        Turn-by-turn navigation, route planning
src/detail/ src/ui/       Place cards, shared components
```

---

## Known limits

Stated here rather than discovered during a demo:

- **Not deployed.** `database_id` in `wrangler.toml` is still a placeholder, so
  the app only runs locally. Everything else for deployment is in place.
- **Two landing images are hosted by Lovable and will 404 here.**
  `nature-in-city.jpg` and `city-dreamer.jpg` are `.asset.json` pointers to
  `/__l5e/assets-v1/…`, a path that only resolves on Lovable's own preview
  host. They are already broken on localhost. Fix by downloading both into
  `mumbai-zenscape/src/assets/` and importing them like the other artwork.
- **The landing's CSP rule is unverified.** `static/_headers` relaxes
  `script-src` for `/` alone, because TanStack ships two inline hydration
  scripts; the map keeps the strict policy. That relies on a more specific rule
  overriding `/*`, which cannot be tested without deploying — check the
  response headers on `/` and `/app/` after the first deploy.
- **`node_modules` lives inside OneDrive**, for both apps. OneDrive syncs every
  one of those files, which makes installs slow and can lock the directory —
  it blocked renaming `mumbai-zenscape/` during this work. Excluding the
  project folder from OneDrive sync would fix it.
- **Dead LLM code.** An earlier version sent questions to Gemini. Search is
  deterministic now, and `askServer`, `buildCandidates`, `localInterpret` and
  `looksLikeRecommendation` in `src/search/parseQuery.ts` have **zero callers** —
  as does `/api/ask` in the Worker, along with its `GEMINI_API_KEY` handling.
  It should be deleted; it is dead weight in the bundle and misleading to read.
- **Flood-spot coordinates are approximate** (~100–300m junction centroids,
  hand-compiled from documented locations). They warn "this area floods"; they
  cannot say a specific lane is under water.
- **No flood-aware routing.** The app shows what to avoid. Rerouting around a
  mutating road graph is a separate project.
- **`opening_hours` coverage in Mumbai is thin**, so "open now" is often unknown.
  The parser returns `unknown` rather than guessing, and the UI says "Hours
  unknown" — telling someone a toilet is open when it isn't is the worse failure.
- **Event times are sometimes unknown.** AllEvents listing pages carry a date but
  no clock time. Rather than rendering that as midnight, those rows are flagged
  `timeKnown: false` and the UI omits a time.
- **Anti-abuse is minimal by design**: rate limiting and blocks, no CAPTCHA, no
  reputation. A public launch needs Cloudflare Turnstile; the seam is marked in
  the Worker.
- **Polling, not push.** Chat and activity lists refresh on a 30s timer. Fine for
  a demo, wasteful at scale — this wants WebSockets or a Durable Object.

---

## Data & licensing

- Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright)
- Basemap tiles by [OpenFreeMap](https://openfreemap.org/)
- MCGM public toilet records via [data.opencity.in](https://data.opencity.in/dataset/mumbai-public-toilets-map) (public domain)
- Place photos from Wikipedia and Wikimedia Commons (CC-licensed)
- Event listings from [Luma](https://lu.ma) and [AllEvents](https://allevents.in)
- Geocoding by [Photon](https://photon.komoot.io/) and [Nominatim](https://nominatim.openstreetmap.org/)
- Flood-prone locations: hand-compiled reference list, not an official dataset

No ads, no sponsored pins, no paid placement.
