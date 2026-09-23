# Launch Plan — from localhost to 500 real users

Written 2026-09-16. Ordered by what blocks what.

---

## 0. Read this first: the one thing that decides whether you can launch

**Your AI quota is 40 requests per day, total, across all users.**

Gemini's free tier gives 20 requests/day/model, and `GEMINI_MODELS` has two
models in the fallback chain. That is not 40 per user — it is **40 per day for
the entire application**.

At 500 users asking even three questions each, you need ~1,500/day. You are
**37× short**. On launch day the "Ask map" feature — your flagship, and the
subject of your paper — would die within the first few minutes of traffic, and
every user after that would silently get the deterministic fallback parser.

This is fixable, and cheaply, but it must be fixed **before** you send anyone a
link. Everything in §2 depends on it.

---

## 1. Deployment runbook

Do this first — it also fixes your broken local dev loop, because
`wrangler deploy` bundles with esbuild and **never spawns `workerd`**, which is
the binary Smart App Control is currently blocking on your machine.

```bash
# 1. Authenticate (opens a browser; no workerd involved)
npx wrangler login

# 2. Create the real database
npx wrangler d1 create civic-reports
#    → copy the printed database_id
```

```toml
# 3. wrangler.toml — replace the placeholder
database_id = "PASTE_THE_REAL_ID_HERE"   # was 00000000-0000-0000-0000-000000000000
```

```bash
# 4. Create the schema remotely
npm run db:init:remote

# 5. Secrets — never in git
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put IP_SALT            # FRESH random value, not your dev one
npx wrangler secret put ORS_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put APP_ORIGIN         # https://mumbai-civic-map.<you>.workers.dev
npx wrangler secret put TICKETMASTER_API_KEY   # optional

# 6. Build and ship
npm run build
npx wrangler deploy

# 7. Seed the events board
curl -X POST https://<your-url>/api/events/refresh
```

**Generate `IP_SALT` properly** — it is what makes rate-limit buckets
unlinkable across days:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**If `wrangler login` or `deploy` is also blocked** by the same App Control
policy, move the project off OneDrive to `C:\dev\sem7project`, reinstall
`node_modules`, and retry. Deploy from GitHub Actions as a last resort — CI
runs on Linux and has no such policy.

---

## 2. Blockers that must be fixed before you share the link

### 2.1 🔴 AI quota — see §0

Three changes, in order of leverage. The first two also make your paper
stronger.

**(a) Invert the fallback: local-first, LLM on escalation.**
Right now the LLM is primary and `localInterpret` is the fallback. Flip it. The
deterministic parser already handles the common civic queries — category
keywords, the locality gazetteer, wheelchair/fee/open-now filters, trip
segmentation. Send to Gemini **only** when the local parser returns null or the
query is a genuine judgement call ("best", "good", "worth it").

Realistically this removes 70–80% of calls. It also cuts latency to zero for
most queries and strengthens the privacy claim — most questions would then
never leave the device at all. For the paper this converts §3.7 from a
degradation story into the *primary* design.

**(b) Cache interpretations.**
Normalise the question (lowercase, strip punctuation, collapse whitespace), hash
it, store the interpretation in D1 with a 7-day TTL. "public toilet in andheri
east" will be asked hundreds of times by 500 users. Cache before the rate limit,
not after.

**(c) Then enable billing, with a hard spend cap.**
After (a) and (b) you are looking at maybe 100–300 real LLM calls/day. On
Flash-lite with ~2k-token prompts that is small money — **check current pricing
yourself**, but expect single-digit USD/month at this scale. Set a billing alert
and a cap so a bug or an abusive user cannot run up a bill.

**(d) Add a per-user daily cap.** `RATE_LIMITS.ask` is currently 40/hour per IP
hash. Add a daily ceiling too, so one person cannot consume the budget.

### 2.2 🔴 Nobody can create an account

`devLoginAllowed()` returns false unless `APP_ORIGIN` is localhost — correct and
safe. But `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are still placeholders, so
`oauthCreds()` returns null too.

**In production, both paths are closed: account creation is impossible.** Hang
out, Events join, all chat and DMs would be dead on arrival.

Fix: create an OAuth 2.0 Client ID (type: Web application) at
`console.cloud.google.com/apis/credentials`, with the authorised redirect URI set
to **exactly** `https://<your-production-url>/api/auth/callback`. Then set both
secrets. Test the whole sign-in round trip before announcing anything.

### 2.3 🔴 CSP blocks every user avatar

`index.html` sets `img-src 'self' data: blob:`. Google avatars come from
`lh3.googleusercontent.com`, and `avatarUrl` is rendered as an `<img src>` in
five places — `App.tsx:1132`, `EventSheet.tsx:254`, `HangoutHome.tsx:360`,
`ProfileScreen.tsx:78`, `MapView.tsx:689`.

Every signed-in user would see broken images. Add the host to `img-src`, or
better, proxy avatars through the Worker so no third-party origin sees your
users' requests — which is more consistent with the rest of the app's posture.

### 2.4 🟠 No abuse controls on public user-generated content

Public strangers will be able to post activities, events, chat messages, DMs and
community reports. You have `blocks` and an `abuse_reports` table, but **no
admin tooling to action a report** and no bot defence.

Minimum before launch:
- **Cloudflare Turnstile** on create-activity, create-event and report. Free, and
  the Worker already has a seam for it.
- **A minimal admin view** — one authenticated route listing `abuse_reports` with
  a delete button. Without this, a report goes nowhere.
- **Tighten creation limits**. 10 events/hour per IP is generous for a public app.

### 2.5 🟠 Legal and privacy

You will store real emails via OAuth. **India's DPDP Act 2023 applies.**

- Publish a **privacy policy** and **terms** page. Say what you store (email,
  name, avatar URL, session hash), why, how long, and how to delete it.
- Add an **account deletion** path. Currently there is sign-out but no delete.
- **Re-check `PrivacyDialog` against reality.** It was written when there were no
  accounts. "No account, no cookies, no location history" is now only true for
  the anonymous Ask-map path. Keep it accurate per-mode or you undermine the one
  thing that makes this project distinctive.
- Add a **contact email** so event sources can reach you. Given you import from
  Luma and AllEvents, being reachable is part of the ethical posture you claim.
- **Credit your sources in the UI.** You already tag each event's provenance;
  add a line in the empty state or an About page naming OSM (ODbL), MCGM,
  OpenFreeMap, Luma and AllEvents.

### 2.6 🟡 You cannot count your users

You have no analytics — by design, and that is a genuine feature. But **you
cannot claim 500 users without measuring something.**

Do it in a way consistent with your principles: **aggregate counters only, no
per-user records.** A D1 table of `(date, metric, count)` incremented on the
server — daily unique rate-limit buckets seen, questions asked, events opened,
accounts created. No cookies, no per-user rows, no third-party analytics. That
gives you a real number for the paper and for yourself, and you can describe the
method honestly in one sentence.

---

## 3. Getting to 500 users

### Launch with two modes, not three

**Events is your growth engine. Ask map is your mission. Hang out is your
cold-start problem.**

220 real events, browsable with no login, loading fast, is a genuinely useful
thing that people will share. A civic map with 72 drinking water points is
important but is not what makes someone send a link to a friend.

Hang out, meanwhile, needs *density* to work. 500 users spread across a city of
20 million means the activities map and "people sharing" will look empty, and an
empty social feature reads as a broken product. **Soft-gate or hide Hang out
until you have local density**, then switch it on for one neighbourhood at a
time.

### The story that travels

Your differentiator is not the map — it's **"no account, no tracking, and it
tells you when it doesn't know."** That is a story that does well on Reddit and
Hacker News, where the audience actively distrusts the alternatives. Lead with
it.

### Channels, roughly in order of expected return

1. **r/mumbai and r/india** — the single best fit. Be transparent that you built
   it, do not astroturf, and respond to every comment. One good post can carry
   several hundred users.
2. **The Luma tech communities you already import** — JS Mumbai, Swift Mumbai,
   Mumbai Meets AI, Hackerspace Mumbai. Their events are *on your board*. Tell
   the organisers; it is useful to them and a natural intro.
3. **Your own campus** — WhatsApp and Telegram groups, college subreddits,
   noticeboards. Highest conversion, lowest effort.
4. **Show HN** — the privacy + zero-cost + honest-uncertainty angle fits that
   audience unusually well. Time it for a weekday morning US time.
5. **X/Twitter Mumbai accounts** — local civic and city accounts will often
   amplify a genuinely free public-good tool.
6. **Product Hunt** — lower return for a city-specific tool, but free.

### Before you post anywhere

- Get a **real domain**. `something.in` costs very little and `*.workers.dev`
  reads as a prototype.
- Test on an **actual mid-range Android over 4G**, not desktop Chrome throttled.
  That is your real user.
- Make it **installable (PWA)** — manifest plus an icon set. Cheap, and it
  meaningfully improves return visits.
- Add **OG tags and a preview image**, or every share will look broken.
- **Have someone who has never seen it use it in front of you**, silently. You
  will learn more in ten minutes than from any amount of planning.

### Set an honest expectation

500 users from a standing start is achievable but not automatic. One strong
r/mumbai post plus campus distribution realistically gets you there. What will
**not** get you there is building more features first. Ship, post, watch what
breaks, fix it, post again.

---

## 4. Build order

| Priority | Work | Why |
|---|---|---|
| **1** | Local-first routing + interpretation cache + per-user daily cap (§2.1) | Without this, launch fails in minutes |
| **2** | Google OAuth + production redirect URI (§2.2) | Without this, no accounts exist |
| **3** | CSP fix for avatars (§2.3) | Visibly broken for every signed-in user |
| **4** | Deploy, seed events, verify end to end (§1) | Also unblocks your local dev |
| **5** | Turnstile + admin moderation view (§2.4) | Before strangers arrive, not after |
| **6** | Privacy policy, terms, account deletion, source credits (§2.5) | Legal, and it is your core claim |
| **7** | Aggregate counters (§2.6) | You cannot manage what you cannot measure |
| **8** | PWA, OG tags, domain, real-device testing (§3) | Launch polish |
| **9** | *Then* post to r/mumbai | |

Items 1–3 are the real blockers. Everything else can follow a soft launch to a
small group.

---

## 5. Capacity check at 500 users

Cloudflare's free tier is comfortable at this scale; the AI quota is the only
binding constraint.

| Resource | Free tier | Estimated at 500 users | Headroom |
|---|---|---|---|
| Workers requests | 100k/day | ~25k/day | fine |
| D1 row reads | 5M/day | well under | fine |
| D1 storage | 5 GB | a few MB | fine |
| OpenFreeMap tiles | free, keyless | — | fine |
| OpenRouteService | 2,000 routes/day | maybe 200–500 | fine |
| **Gemini** | **40/day total** | **~1,500/day** | ❌ **37× short** |

The events cron is server-side and runs on a fixed schedule, so **importer load
does not grow with users at all** — a nice property worth keeping.

---

## 6. What I recommend doing next

Items 1–3 in §4 are mechanical and I can implement them:

- invert the interpreter to local-first with LLM escalation
- add the normalised-question interpretation cache in D1
- add a per-user daily ask cap
- fix the CSP for avatars

That is the work that turns "runs on my laptop" into "survives 500 people".
The OAuth credentials and the Cloudflare login need your hands on a browser —
I cannot do those for you.
