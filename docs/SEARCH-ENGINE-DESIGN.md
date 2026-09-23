# Replacing the LLM with a deterministic search + recommendation engine

Design note, 2026-09-16. All coverage numbers below were measured live against
OpenStreetMap for the Mumbai bbox `18.87,72.77,19.32,73.02` on that date, not
estimated.

> **Note added 2026-09-23 — this proposal has been carried out.**
> This is a historical design note, written while the LLM was still live, and
> the body is left as written. The change it argues for has since shipped:
> `/api/ask`, the Gemini client and `GEMINI_API_KEY` have been removed, and
> search is now deterministic ranking in `src/search/rank.ts`, fed by
> `src/search/interpret.ts`, `src/search/moods.ts` and `src/search/localIndex.ts`,
> and wired into `src/App.tsx`. So any sentence below in the present tense about
> the LLM ("right now it carries an asterisk", "a model you no longer use") is
> describing 2026-09-16, not today, and the tasks in §7 are done rather than
> pending. The measured tag-coverage numbers in §2, the mood taxonomy in §5 and
> the scoring model in §6 still describe the shipped design.

---

## 1. Verdict: do it

This is the right call, and not only for cost. Removing the LLM wins you five
things:

| | Before | After |
|---|---|---|
| Cost at 500 users | ~1,500 calls/day vs a 40/day quota | **₹0, no ceiling** |
| Latency | 1–3 s round trip | **instant, on-device** |
| Privacy claim | "no coordinates, but the question text is sent" | **"nothing leaves the device"** |
| Failure modes | 429s, MAX_TOKENS degeneration, truncated JSON, model retirement | **none** |
| Explainability | "the model picked this" | **"park · 400 m · open now"** |

That third row is the big one. Your whole product identity is the privacy claim,
and right now it carries an asterisk — `/api/ask` sends the question text to
Google. Delete the LLM and the asterisk goes with it. **Search becomes fully
on-device**, and the only thing that ever leaves the phone is a routing request
you already disclose.

The fifth row matters more than it looks. A deterministic scorer can tell the
user *why* something was recommended, because every component of the score is a
real fact. An LLM cannot. For a civic tool, "matched: garden, 300 m, open now"
beats an opaque suggestion.

---

## 2. What your data actually supports

I measured this before designing anything, because a mood system built on tags
that don't exist would silently return nothing.

### 2.1 Your shipped data currently has **no tags at all**

```json
{ "id": "osm:node/245653876", "name": "Copper Chimney",
  "category": "food", "source": "osm" }
```

No `cuisine`, no `opening_hours`, nothing. `KEEP_TAGS` in
`scripts/build-data.mjs` *does* list them, but the committed data predates that
change. **You must re-run the pipeline** before any of this works.

### 2.2 Real OSM tag coverage for Mumbai food POIs (n = 2,090)

| Tag | Coverage | Verdict |
|---|---|---|
| `name` | **86.3%** | ✅ strong |
| **`cuisine`** | **45.2%** | ✅ **your best mood signal** |
| `opening_hours` | 18.2% | ⚠️ bonus only, never a filter |
| `takeaway` | 14.3% | ⚠️ marginal |
| `brand` | 12.0% | ✅ useful for chain de-duplication |
| `diet:vegetarian` | 8.2% | ⚠️ marginal |
| `outdoor_seating` | **7.9%** | ❌ too thin |
| `air_conditioning` | 7.7% | ❌ too thin |
| `wheelchair` | 5.6% | ❌ thin (keep as filter, not mood) |
| `internet_access` | **5.1%** | ❌ too thin |

**Kill these mood ideas now:** "work-friendly café with wifi" (5.1%),
"outdoor seating vibe" (7.9%), "air-conditioned" (7.7%). Each would return
~100 places citywide and miss 92% of real ones. A recommender that confidently
misses almost everything is worse than no recommender.

Top cuisines present: indian 269 · coffee_shop 161 · pizza 154 · burger 115 ·
chinese 95 · sandwich 69 · italian 47 · regional 47 · chicken 38 · tea 26 ·
asian 24 · mexican 21 · juice 21 · dessert 20 · seafood 16 · south_indian 16.

### 2.3 The finding that changes the design

**Your 10 civic categories are the wrong corpus for a hangout recommender.**
Drinking water and public toilets are not places you hang out.

Mumbai's OSM has **3,914 leisure/tourism POIs, 1,855 of them named** — and you
ship none of them:

| Kind | Count | | Kind | Count |
|---|---|---|---|---|
| `leisure=park` | **1,653** | | `amenity=cinema` | 80 |
| `leisure=pitch` | 659 | | `amenity=community_centre` | 69 |
| `leisure=playground` | 353 | | `tourism=attraction` | 55 |
| `leisure=garden` | 335 | | `amenity=library` | 53 |
| `tourism=artwork` | 112 | | `amenity=theatre` | 51 |
| `leisure=fitness_centre` | 98 | | `tourism=viewpoint` | 27 |
| `leisure=sports_centre` | 95 | | `tourism=museum` | 18 |
| `amenity=marketplace` | 93 | | `leisure=stadium` | 18 |
| `shop=mall` | 84 | | `natural=beach` | **17** |

Adding these roughly **doubles your usable corpus** and gives the mood engine
something real to work with. This is the single highest-value data change you
can make.

---

## 3. What you give up — honestly

1. **Novel phrasings.** A keyword parser handles what it was taught. "Somewhere
   to decompress after a rough day" will miss unless you map it.
   *Mitigation below — and it's arguably better UX than a black box.*
2. **Complex multi-stop trips.** `localTripInterpret` already handles
   "X but first Y"; unusual constructions will degrade.
3. **Open-ended judgement.** "Best cheesecake" becomes "bakeries and dessert
   places near you, ranked" — which, given you never had review data, is
   **more honest than what the LLM was doing anyway.**

### The mitigation is a UI move, not a model

Show what the engine understood as **editable chips**:

```
   [ Food ✕ ]  [ Bandra West ✕ ]  [ Open now ✕ ]     ← tap any chip to change it
```

When the parser gets it wrong, the user fixes it in one tap instead of
rephrasing and hoping. This is *better* than an LLM for a utility app: it is
predictable, correctable, and instant. Lean into it as a feature.

---

## 4. Architecture

```
Query  "chill place near bandra"
  │
  ├─ 1. NORMALISE      lowercase, strip punctuation, collapse whitespace
  │
  ├─ 2. PARSE (on-device, deterministic)
  │      ├─ locality   → matchLocality()  [existing gazetteer, 49 entries]
  │      ├─ mood       → MOOD_TABLE       [new]
  │      ├─ category   → guessCategories() + synonyms  [existing, extend]
  │      ├─ filters    → detectFilters()  [existing]
  │      └─ free text  → whatever is left → name matching
  │
  ├─ 3. RETRIEVE       inverted index over name tokens + category + cuisine
  │
  ├─ 4. SCORE          explainable, weighted, no invented popularity
  │
  └─ 5. EXPLAIN        "park · 400 m · open now"
```

Everything runs in the browser. **Zero network calls.** Delete `/api/ask`
entirely, along with `parseLoosely`, the prefix-ladder name matcher, the
maxOutputTokens clamp and the model fallback chain — roughly 500 lines of
LLM-tolerance machinery that exists only to survive a model you no longer use.

### Retrieval index

15k POIs is small. Build an inverted index at load time:
`token → Set<poiId>`, over name tokens + category + cuisine + subtype. Add
typo tolerance with trigram similarity for tokens ≥ 4 chars. No library needed;
brute force is already fast enough, the index just makes it instant.

---

## 5. Mood taxonomy — grounded in measured coverage

Each mood is a weighted set of subtypes. **Every mood below is backed by
hundreds of real POIs.** Weight is how strongly the subtype signals that mood.

| Mood | Maps to | Backing |
|---|---|---|
| **Chill / unwind** | `park` 1.0 · `garden` 1.0 · `beach` 0.9 · `viewpoint` 0.9 · `nature_reserve` 0.8 | ~2,030 |
| **Green / outdoors** | `park` 1.0 · `garden` 1.0 · `nature_reserve` 0.9 · `beach` 0.7 | ~2,010 |
| **Lively / buzzing** | `marketplace` 1.0 · `mall` 0.9 · `nightclub` 0.8 · `bar` 0.8 · `pub` 0.8 | ~180+bars |
| **Culture** | `museum` 1.0 · `gallery` 1.0 · `theatre` 0.9 · `arts_centre` 0.9 · `artwork` 0.6 | ~200 |
| **Movie night** | `cinema` 1.0 | 80 |
| **Active / sporty** | `sports_centre` 1.0 · `pitch` 0.9 · `fitness_centre` 0.9 · `stadium` 0.7 | ~870 |
| **Family / kids** | `playground` 1.0 · `park` 0.7 · `theme_park` 0.9 · `zoo` 0.8 | ~2,010 |
| **Coffee** | `cuisine=coffee_shop` 1.0 · `amenity=cafe` 0.9 | 161+ |
| **Cheap eats** | `fast_food` 1.0 · `cuisine` ∈ {tea, juice, sandwich, burger} 0.8 | ~400 |
| **Proper meal** | `restaurant` 1.0, cuisine-weighted | ~900 |
| **Quiet** | `library` 1.0 · `garden` 0.7 · `museum` 0.6 | ~400 |

### Moods you must NOT ship

**Romantic · Instagrammable · Work-friendly · Hidden gem · Trendy.**

There is no data behind any of them. You would be inventing a judgement, which
is precisely the failure mode your whole project is built to avoid. If you want
them later, they need a real signal — community votes from your own users are
the honest path, and you already have the reporting infrastructure for it.

---

## 6. Ranking model

```
score = w_mood · moodMatch        // 0–1 from the table above
      + w_dist · distanceDecay    // exp(-d / scale), scale ≈ 1200 m
      + w_text · nameMatch        // BM25-lite over name tokens
      + w_open · openNowBonus     // only when opening_hours exists (18%)
      + w_rep  · communitySignal  // your own reports: working/broken
      - w_dupe · chainPenalty     // same `brand` already in results
```

Four rules that keep it honest:

1. **`openNowBonus` is a bonus, never a filter.** 82% of POIs have no hours. A
   hard "open now" filter would hide almost everything. When hours are unknown,
   say "hours unknown" — you already do this elsewhere.
2. **No invented popularity.** You have no ratings, no review counts, no
   footfall. Never synthesise a star rating or a "trending" badge.
3. **`communitySignal` is your only real quality signal, and it compounds.**
   Every report a user files makes the ranking better. That is your moat, and it
   is the one thing Google cannot copy for civic infrastructure in Mumbai.
4. **Always show the explanation.** `"park · 400 m · open now"`. If you cannot
   explain a result in four words, the scoring is wrong.

**Detour ranking already exists** in `src/trip/plan.ts` and should stay — for
trip stops, rank by extra walking, not raw distance.

---

## 7. Build order

| # | Task | Notes |
|---|---|---|
| **1** | Re-run the data pipeline with tags | `npm run data` — without this, nothing else works |
| **2** | Add leisure/tourism categories to `shared/categories.json` | park, garden, beach, viewpoint, cinema, theatre, museum, gallery, mall, marketplace, playground, sports_centre, library |
| **3** | Build `MOOD_TABLE` + the mood parser | §5 |
| **4** | Inverted index + trigram typo tolerance | `src/search/index.ts` |
| **5** | Scoring function with explanations | §6 |
| **6** | Editable interpretation chips in the UI | §3 — this replaces the LLM's flexibility |
| **7** | Delete `/api/ask`, `parseQuery.ts` server path, LLM tolerance code | ~500 lines gone |
| **8** | Update `PrivacyDialog` — the asterisk is gone | "Nothing you type leaves your device" |

Navigation, live location, and walk/drive/cycle/transit routing are **untouched**.
ORS free tier is 2,000 routes/day and unaffected by any of this.

⚠️ **Watch payload size.** Adding ~1,900 leisure POIs plus cuisine tags grows
the bundle. Keep the lazy per-category loading, and consider splitting `toilets`
(2.4 MB) by ward.

---

## 8. What this does to your research paper

**Be aware: this kills the paper as currently planned.** "Grounding Without
Ground Truth: Constrained LLM Retrieval" cannot be written about a system with
no LLM in it.

**But your pilot data already points at a better paper.** Recall what it found:
zero out-of-set leaks in 36 picks, correct abstention 6/6, and — at D3, the
dense query — the grounded and ungrounded models agreeing completely. The LLM
was doing very little work that a gazetteer could not.

New thesis:

> **"Do you need an LLM to talk to a map? A deterministic baseline for civic
> search in data-sparse cities."**
>
> We show that a deterministic parser over a local gazetteer matches LLM-based
> interpretation on N% of real civic queries, at zero marginal cost, zero
> latency, with full explainability and without transmitting the query at all —
> and we characterise exactly the query classes where the LLM still wins.

This is a **stronger** paper for your venue. It has a crisp claim, a real
baseline, an honest negative result, and it speaks directly to deployment in
resource-constrained settings. Experiment E4 from the strategy doc becomes the
headline instead of a supporting table, and **your existing pilot data becomes
the LLM comparison arm** — so none of that work is wasted.

Keep `scripts/pilot-results.json` and the harness. Do not delete the LLM code
until you have re-run the comparison; you need the baseline arm for the paper
even though it will not ship in the product.

---

## 9. Recommendation

Do it. The product gets faster, free, more private and more explainable, and the
paper gets a sharper claim.

The order that matters: **re-run the pipeline with tags and add the leisure
categories first** (tasks 1–2). Everything else is downstream of having the data,
and right now you have none of it.
