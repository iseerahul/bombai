# What's pending, and what to do first

Audited against the code on 2026-09-16. Everything marked ❌ was verified absent,
not assumed.

---

## The headline: the search engine you asked for is built but not plugged in

`src/search/rank.ts` and `src/search/moods.ts` are **referenced nowhere in the
app**. `App.tsx` still calls `askServer()` → `/api/ask` → Gemini.

Three consequences, all live right now:

1. **The mood feature is invisible.** Chill / Green / By the water / Culture /
   Active / Movie / Kids / Quiet / Coffee — none of it is reachable.
2. **You're still on the LLM**, with its 40-requests-a-day ceiling and its cost,
   after deciding to drop it.
3. **4,331 new POIs are unreachable** — 1,992 parks, 1,690 sports grounds, 396
   culture venues, 206 markets, 47 beaches and viewpoints. Fetched, shipped in
   `public/data/`, invisible in the UI.

That is the single biggest gap, and it is also the cheapest to close because the
hard part is done and tested.

---

## Pending — search and recommendations

| | State |
|---|---|
| `rank.ts` / `moods.ts` wired into App | ❌ **not wired at all** |
| Mood chips in the UI | ❌ |
| Editable interpretation chips (`[Food ✕] [Bandra West ✕]`) | ❌ |
| Icons for the 5 new categories | ❌ all fall back to a generic pin |
| Spots feeding `tagCounts` into the ranker | ❌ |
| Delete `/api/ask` + ~500 lines of LLM tolerance code | ❌ |

`CATEGORY_ICONS` in `src/ui/Icon.tsx` has 11 entries for 15 categories. `park`,
`waterfront`, `sports`, `culture` and `market` render as a generic pin.

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

**1 — Wire the search engine.** ← start here

It is 80% built, delivering zero value, and finishing it removes your LLM
dependency, surfaces 4,331 POIs and ships the mood feature in one move. It needs
no Cloudflare login, no OAuth, no external config — it is pure local work you can
finish in one sitting.

It also **has to come before the UI pass**, because it changes what the UI must
show: mood chips, interpretation chips, and results with explanations
(`park · 310 m · open now`) rather than LLM prose. Styling the current chat-first
UI now would be styling something you're about to replace.

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

**5 — The UI/UX pass.** Desktop layout, the 5 missing icons, PWA manifest, OG
tags, real-device testing. Last, because polishing before the feature set settles
is work you do twice.

---

## What to remove

- `/api/ask`, `askServer()`, `parseLoosely()`, the prefix-ladder name matcher,
  the `maxOutputTokens` clamp and the model fallback chain — roughly **500 lines**
  that exist only to survive a model you're dropping. Keep
  `scripts/pilot-grounding.mjs` and its results; delete the runtime path.
- The `GEMINI_API_KEY` secret and the Gemini rate-limit bucket.
- The "No account, no cookies, no location history" pill in `ChatPanel.tsx` —
  goes when storage lands, not before.
- **Worth questioning:** the social travel-trips feature. It's a second social
  system next to activities, with the same cold-start problem and no connection
  to the board or the recommender. It may be earning less than it costs.

---

## Recommendation

Do **1** now — it's half-finished work currently returning nothing. Answer **2**
in a sentence before building any new screen. Then 3, 4, 5 in order.
