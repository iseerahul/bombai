# What's pending, and what to do first

Audited against the code on 2026-09-16. Everything marked ❌ was verified absent,
not assumed. **Search and the LLM were re-checked on 2026-09-23** and that
section is updated below; the rest still reflects the 2026-09-16 audit.

---

## The headline: done — the search engine is wired and the LLM is gone

*Updated 2026-09-23. This was the top item on 2026-09-16, when
`src/search/rank.ts` and `src/search/moods.ts` were referenced nowhere and
`App.tsx` still called `askServer()` → `/api/ask` → Gemini. Both halves have
since landed.*

`src/App.tsx` now imports `interpret()` from `src/search/interpret.ts` and
`rank()` from `src/search/rank.ts` and runs the query entirely on-device. The
Gemini path has been deleted: there is no `/api/ask` route, no Gemini client in
`worker/`, and no `GEMINI_API_KEY`.

What that closed:

1. **The mood feature is reachable.** `src/search/moods.ts` feeds `interpret()`,
   which feeds the ranker.
2. **There is no LLM dependency left** — no per-day request ceiling, no per-call
   cost, and nothing you type leaves the device.
3. **The 4,331 leisure POIs are searchable** — 1,992 parks, 1,690 sports
   grounds, 396 culture venues, 206 markets, 47 beaches and viewpoints, all now
   reachable through the ranker rather than sitting unused in `public/data/`.

The remaining gaps below are UI and backend, not interpretation.

---

## Search and recommendations — re-checked 2026-09-23

| | State |
|---|---|
| `rank.ts` / `moods.ts` wired into App | ✅ `src/App.tsx` calls `interpret()` then `rank()` |
| Mood chips in the UI | — dropped on purpose; the free-text input handles moods (see the note in `src/chat/AskPanel.tsx`) |
| Editable interpretation chips (`[Food ✕] [Bandra West ✕]`) | ✅ `askChips` in `App.tsx`, rendered and removable in `AskPanel.tsx` |
| Icons for the 5 new categories | ✅ `CATEGORY_ICONS` now has all 16 |
| Spots feeding `tagCounts` into the ranker | ❌ still pending — blocked on the `spots` table below |
| Delete `/api/ask` + ~500 lines of LLM tolerance code | ✅ removed; no Gemini code remains in `worker/` |

## Pending — backend

| | State | Consequence |
|---|---|---|
| `spots` / `visits` / `photos` tables | ❌ | Board lives only in IndexedDB — clearing site data wipes it, nothing is shared, spots can't feed recommendations |
| R2 bucket for photos | ❌ | Photos can never leave the device |
| `database_id` in `wrangler.toml` | ❌ still `00000000-…` | Cannot deploy |
| Google OAuth credentials | ❌ placeholders | **In production nobody can create an account** — `devLogin` correctly disables itself off localhost |
| Cron trigger in the Node shim | ❌ | Events don't auto-refresh locally; hit Refresh manually |
| Turnstile + admin moderation view | ❌ | No defence and no way to action `abuse_reports` |
| Account + data deletion | ❌ | DPDP requirement once you store visits and photos |
| Privacy dialog rewritten | ❌ | Its claims go false the moment storage lands — must ship in the *same* change |

## Pending — UI/UX for the web

You're right that this needs rethinking. The numbers say so:

**49 `sm:` breakpoints · 2 `md:` · 2 `lg:` · 0 `xl:`**

So there is exactly one adaptation — at ≥640px the bottom sheet becomes a 420px
right rail — and nothing above it. On a 1440px laptop this is a phone UI with a
very large map beside it. The hangout bottom nav in particular is a phone
pattern sitting on a desktop screen.

Other known gaps: no PWA manifest, no OG tags (every share preview is blank), no
favicon set, and the board grid is built for phone widths only.

---

## What to do first

**1 — ~~Wire the search engine.~~ Done, 2026-09-23.**

This was the start-here item. The engine is wired, the LLM dependency is gone,
the 4,331 POIs are reachable and results carry explanations
(`park · 310 m · open now`) instead of model prose. The UI pass below was
blocked on this and no longer is. **Start at 2.**

**2 — Decide the desktop shell. Decide it, don't build it.**

One structural decision, made now, on paper: does the web version keep the
map-with-floating-sheets model, or move to a persistent sidebar + map layout
like most desktop map apps? Every screen built after this — mood chips, spots,
the board — gets built into whichever shell you pick. Choosing later means
rebuilding all of them.

Cheap now. Expensive in three weeks.

**3 — Backend for spots and visits.** D1 tables, R2 for photos, upload endpoint,
then the spots → `tagCounts` → ranker loop. This is what turns the board from a
private scrapbook into the recommendation signal you designed it to be.

**4 — Deploy.** Real `database_id`, Google OAuth, secrets, `wrangler deploy`.
The privacy dialog rewrite ships here, alongside the storage that makes its
current claims false. (`wrangler deploy --dry-run` already works, so this isn't
blocked by the `workerd` problem.)

**5 — The UI/UX pass.** Desktop layout, PWA manifest, OG tags, real-device
testing. (The 5 missing category icons shipped on 2026-09-23.) Last, because
polishing before the feature set settles is work you do twice.

---

## What to remove

- ✅ **Done 2026-09-23.** `/api/ask`, `askServer()`, `parseLoosely()`, the
  prefix-ladder name matcher, the `maxOutputTokens` clamp and the model fallback
  chain — roughly **500 lines** that existed only to survive a model that has now
  been dropped. `scripts/pilot-grounding.mjs` and `scripts/pilot-results.json`
  were kept, as planned; the harness now carries the system prompt inline, since
  the Worker constant it used to read is gone.
- ✅ **Done 2026-09-23.** The `GEMINI_API_KEY` secret and the Gemini rate-limit
  bucket.
- ✅ The "No account, no cookies, no location history" pill went with the old
  `ChatPanel.tsx`; `src/chat/AskPanel.tsx` replaced it. The privacy claims still
  need a re-read when storage lands — see the backend table above.
- **Worth questioning:** the social travel-trips feature. It's a second social
  system next to activities, with the same cold-start problem and no connection
  to the board or the recommender. It may be earning less than it costs.

---

## Recommendation

**1** is done. Answer **2** in a sentence before building any new screen. Then
3, 4, 5 in order.
