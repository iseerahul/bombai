# Research Paper Strategy

A strategic guide for turning this project into a paper submittable to the AI
track of a conference. Read §0 first — it is the part that decides whether the
paper is accepted or desk-rejected.

---

## 0. The hard truth first

**"We built an app" is not a paper.** The single most common reason student
systems papers get rejected from AI tracks is that they describe a system
instead of testing a claim. Your project is unusually well-built, but as it
stands it has **no evaluation**, and that is the only thing standing between you
and a publishable paper.

Three decisions you must make now:

**1. Cut most of the project from the paper.**
The hangout/social layer — activities, DMs, trips, profiles, presence, group
chat — is good engineering and is **not publishable** at an AI track. It has no
AI claim and no measurable hypothesis. Mention it in one sentence as deployment
context, or omit it. Trying to cover all three modes will produce a shallow
paper that reviewers describe as "a project report".

**2. Pick one claim and defend it with numbers.**
Your defensible claim is about **grounding and abstention**, described in §2.

**3. Budget two-thirds of your remaining time for evaluation, not building.**
The system is done. The experiments in §5 are what you actually have left to do.

### What is and isn't novel — be honest with yourself

Reviewers will know this literature. Do not claim novelty you don't have.

| Element | Novel? | How to position it |
|---|---|---|
| Constraining an LLM to a retrieved candidate set | **No.** This is RAG. | Background, not contribution |
| Filtering model output against an allow-list | **No.** Standard practice. | Mechanism, not contribution |
| Running it under a 20-request/day free tier | Mildly | Deployment constraint, motivates fallbacks |
| **Measuring how often prompt-level constraints leak** | **Yes, if you measure it** | **Core contribution** |
| **Grounding behaviour when the candidate set is near-empty** | **Yes — genuinely underexplored** | **Core contribution** |
| **One architecture yielding no-fabrication + zero-coordinate-transmission + zero-cost simultaneously** | Yes, as co-design | Secondary contribution |
| Multi-source event aggregation with provenance | Engineering | Supporting evidence, one subsection |

The gap you are filling: **almost all grounding and RAG work assumes a dense,
high-quality corpus.** Mumbai has **72 mapped drinking water points for ~20
million people**. What a grounded LLM does when the retrieval set is sparse,
stale or empty is a real open question, and you have a live system in exactly
that regime. That is your paper.

---

## 1. Recommended title

### Primary recommendation

> **Grounding Without Ground Truth: Constrained LLM Retrieval for Civic Map
> Search in Data-Sparse Cities**

Why this one works:
- **"Grounding Without Ground Truth"** is a memorable, accurate hook — you are
  grounding against a corpus that is itself radically incomplete.
- **"Constrained LLM Retrieval"** tells an AI-track reviewer the mechanism in
  three words.
- **"Data-Sparse Cities"** names the gap, which is what makes it novel rather
  than a re-run of RAG.
- It promises measurement. The title itself implies experiments, so the abstract
  had better deliver them.

### Alternates, and their trade-offs

| Title | Best for | Risk |
|---|---|---|
| **Say Less Than You Know: Calibrated Abstention in an LLM-Mediated Civic Map** | HCI or Responsible-AI track | Sounds like a position paper; weaker at a systems/AI track |
| **When the Map Is Empty: LLM Grounding Under Retrieval Sparsity** | Pure AI track, most focused | Drops the privacy and cost contributions entirely |
| **Candidate-Constrained Grounding: Co-Designing Hallucination Containment, Location Privacy, and Zero-Cost Deployment** | Systems track | Three claims in a title is one too many; hard to defend all three |
| ~~Ask the Map: A Conversational Interface to Mumbai's Public Infrastructure~~ | — | **Avoid.** Reads as a demo paper. Near-certain desk reject at an AI track. |

**Do not use "hallucination-free" in the title.** You can guarantee no
out-of-corpus place is returned; you cannot guarantee the *prose* is accurate.
Overclaiming in a title is the fastest route to a hostile reviewer.

---

## 2. The thesis, in one paragraph

Write this on a sticky note and check every section against it:

> Large language models are attractive as natural-language interfaces to maps,
> but they fabricate places with confidence, and the cities that most need such
> an interface are exactly those whose map data is too sparse for the model to
> have memorised. We show that fabrication can be eliminated *architecturally*
> rather than by prompting — the client constructs a bounded candidate set from
> a locally-held corpus and the server discards any identifier the model returns
> that was not offered — and that this same construction incidentally guarantees
> that user coordinates are never transmitted, at zero marginal infrastructure
> cost. We measure how often prompt-level constraints alone leak, characterise
> system behaviour as the candidate set shrinks toward empty, and show the
> deployed system degrades to a deterministic parser when its model quota is
> exhausted.

**The elegant part of your architecture — lead with this.** The candidate set is
built *on the device*, from data already downloaded, purely to constrain the
model. Because it contains only public place names and no coordinates, the
privacy property is not an added feature; it is a side-effect of the grounding
mechanism. Two goals usually in tension are served by one design decision. That
is a genuinely nice result and reviewers respond to it.

---

## 3. Exact system specification (for the paper's System Design section)

This is the factual material to write up. All of it is verified against the
implementation.

### 3.1 Architecture

```
┌──────────────────────── Browser (no cookies, no storage ID, no analytics) ───┐
│                                                                              │
│  MapLibre GL JS ◄──── OpenFreeMap "Liberty" vector tiles (free, keyless)      │
│                                                                              │
│  Baked corpus  ────►  localIndex.ts                                          │
│  /data/*.geojson      • Haversine brute-force search                         │
│  (loaded lazily)      • filters: wheelchair, fee, open-now, not-broken       │
│                       • ALL search, distance and ranking runs here           │
│                                ▼                                             │
│                       buildCandidates(pois, limit=40)                        │
│                       → [{id, name, category, detail?}]                      │
│                       NO coordinates. NO distances. NO user location.        │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ POST /api/ask {question, candidates[]}
                                 ▼
┌──────────────────── Cloudflare Worker (the only server) ─────────────────────┐
│  • holds the API key (never in the bundle)                                   │
│  • rate limit: daily-rotating salted IP hash                                 │
│  • model fallback chain: gemini-3.1-flash-lite → gemini-3.5-flash            │
│  • structured output via responseSchema                                      │
│  • THE GROUNDING FILTER  ◄── the paper's central mechanism                   │
│  • D1 (SQLite): community reports, events, rooms, accounts                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 The grounding mechanism (verbatim behaviour)

Three enforcement layers, each of which you should describe separately because
the paper's contribution is showing that the first two are **insufficient**:

**Layer 1 — Corpus restriction (client).**
`buildCandidates()` takes locally-filtered POIs, keeps at most 40 with non-null
names, and emits `{id, name, category, detail?}`. The model never sees anything
outside this set.

**Layer 2 — Prompt constraint (server).**
The system prompt states: *"ABSOLUTE RULE: every id in `picks` MUST appear in the
candidate list given to you. If the candidate list is empty or nothing fits,
return mode `search` instead."*

**Layer 3 — Server-side allow-list filter (the actual guarantee).**
```
allowed = Set(candidates.map(c => c.id))
kept    = picks.filter(p => typeof p.id === 'string' && allowed.has(p.id))
if (kept.length === 0) → degrade to mode:"search", never an empty recommendation
```
Any identifier the model invents is discarded **before the browser sees it**.
This is the only layer that provides a guarantee; Layers 1–2 are best-effort.

**This three-layer framing is your paper's spine.** Layer 3 makes the
out-of-corpus fabrication rate provably zero; the experiment in §5.1 measures
what Layer 2 alone leaves on the table.

### 3.3 Response modes (structured output schema)

| Mode | Returned fields | Meaning |
|---|---|---|
| `search` | `categories[]`, `area`, `filters{}`, `reply` | Resolve locally against the corpus |
| `recommend` | `picks[{id, why}]`, `reply`, `caveat` | Rank within the offered candidates |
| `trip` | `stops[]`, `reply` | Multi-stop itinerary specification |

Every response carries `local: boolean` — true when the deterministic on-device
parser answered and **no network call was made at all**.

### 3.4 Privacy construction

- Geolocation requested **only on explicit user gesture**. No `watchPosition`,
  no background polling (navigation is a separate, disclosed exception).
- Coordinates rounded to **3 decimal places ≈ 110 m** at Mumbai's latitude
  before anything else can touch them.
- The fix lives in a module variable. Never written to `localStorage`,
  `sessionStorage`, IndexedDB or a cookie. Closing the tab forgets it.
- **`/api/ask` receives the question text and public place names only.** No
  latitude, longitude, distance, or identifier.
- The one disclosed exception is `/api/route`, which genuinely needs
  coordinates because the road graph cannot be shipped to a phone. The paper
  must state this plainly — an honest exception is a strength; a hidden one is
  a fatal flaw if a reviewer finds it.

### 3.5 Corpus (baked at build time, committed for reproducibility)

Overpass API public instances forbid application-backend use, so all data is
fetched once at build time into static GeoJSON. This is simultaneously a
licensing constraint, a performance win and the enabler of the privacy property
— note in the paper that the constraint and the goal agreed.

| Layer | Features | Eager load |
|---|---|---|
| `drinking_water` | **72** | yes |
| `toilets` | 8,638 (OSM + MCGM municipal KML) | no (2.4 MB) |
| `health` | 1,805 | no |
| `food` | 2,332 | no |
| `atm` | 980 | no |
| `transit` | 318 | no |
| `bench` | 260 | no |
| `pharmacy` | 205 | no |
| `police` | 129 | no |
| `shelter` | 100 | no |
| `flood_spot` | 44 (hand-seeded, `manual_seed`) | — |
| `rail_lines` | 390 segments | — |

**Cite the 72 number early and often.** It is the most persuasive single fact in
your paper: 72 mapped drinking water points for a city of ~20 million is the
data-sparsity regime your title claims.

### 3.6 Uncertainty taxonomy (the abstention catalogue)

This table is a strong figure. It shows abstention is systematic, not ad hoc.

| Uncertainty | Naïve behaviour | System behaviour | Enforcement |
|---|---|---|---|
| Place may not exist | Model names a plausible place | Out-of-set IDs discarded | Server allow-list |
| Route geometry unavailable | Straight line drawn as a route | **Dashed** line + explicit caveat | Separate map layer |
| Event price unknown | Feed says `is_free: true` for everything | "Price unknown" + link out | Import drops the field |
| Event start time unknown | Render date as midnight | **"time unknown"** | `time_known` column |
| Opening hours unmapped | Guess "open" | "hours unknown" | Parser returns unknown |
| Transit schedule absent | Fabricate a departure | Labelled estimate; refuses if walking is faster | Composed-plan check |
| Nothing found | Empty list | Explains OSM sparsity as the likely cause | Empty-state copy |
| Answer provenance | Silent | "Answered on your device" vs "sent to the AI service" | `local` flag on every turn |

### 3.7 Degradation under quota exhaustion

Free tier allows **20 requests/day/model**. The system responds with:
1. A **model fallback chain** (`gemini-3.1-flash-lite` → `gemini-3.5-flash`)
2. A **deterministic on-device parser** (`localInterpret`) covering the common
   civic queries — category keywords, locality matching against a ward list,
   filter detection (wheelchair/fee/open-now), and trip segmentation
3. **JSON salvage** for truncated model output, plus length clamping and
   prefix-ladder name matching to recover from MAX_TOKENS degeneration loops

The system therefore **remains functional at zero quota**, which is both a
deployment property and a measurable experimental condition (§5.4).

### 3.8 Frontend (one short subsection — do not over-describe)

React 18 + TypeScript + Vite + Tailwind. Single page, three modes over one
shared MapLibre instance. Semantic design tokens as CSS variables so one set of
class names renders light and dark. No webfonts (CSP forbids external font
origins). Full detail in `docs/FRONTEND-SPEC.md` — **the paper needs about one
paragraph of this, not a page.** Interface screenshots belong in a figure, not
in prose.

### 3.9 Multi-source event aggregation (supporting contribution only)

Pluggable adapters, each tagged with provenance that the UI never flattens:

| Source | Method | Count | Uncertainty it forces |
|---|---|---|---|
| `allevents` | schema.org `Event` JSON-LD from public city pages | 136 | Date only, no clock time |
| `luma` | Public keyless city-discovery JSON endpoint | 58 | Price field untrustworthy |
| `seed` | 8 hand-compiled recurring nights × 3 weeks | 26 | No price, no ticket link |
| `ticketmaster` | Discovery API (adapter wired, key not configured) | 0 | — |
| `community` | Member posts | varies | Unverified by construction |

Result: **8 → 200 distinct events**, all eight categories populated, from 0 to
26 tech events. Upserts on `(source, external_id)`, so re-import updates in
place.

**Frame this as evidence for the abstention thesis, not as a contribution in its
own right.** The interesting research content is that *two independent sources
each published a confidently wrong field* (Luma: everything free; AllEvents:
date without time) and that a provenance-preserving importer must actively
discard upstream assertions. That is a nice, concrete finding about real-world
data integration.

---

## 4. Paper structure (8 pages, IEEE double column)

| § | Section | Pages | What goes in it |
|---|---|---|---|
| — | Abstract | 0.15 | Problem, mechanism, **three numbers**, conclusion |
| 1 | Introduction | 0.75 | The 72-water-points fact; why LLM map interfaces fabricate; three contributions as a bulleted list |
| 2 | Related Work | 0.75 | RAG/grounding · hallucination taxonomy · constrained decoding · privacy-preserving LBS · VGI/OSM data quality · uncertainty communication in HCI |
| 3 | System Design | 1.5 | §3.1–3.4 above. Architecture figure + the three-layer grounding figure |
| 4 | Uncertainty and Abstention | 1.0 | §3.6 table as a figure; the design principle |
| 5 | Evaluation | **2.5** | §5 below. **The largest section. Non-negotiable.** |
| 6 | Results & Discussion | 0.75 | What the numbers mean; when grounding fails |
| 7 | Limitations & Threats to Validity | 0.4 | §7 below |
| 8 | Ethics Statement | 0.25 | §8 below |
| 9 | Conclusion & Future Work | 0.25 | |
| — | References | 0.7 | 25–35 entries |

**If Evaluation is shorter than System Design, the paper will be rejected.**
That ratio is the single clearest signal of a systems-report-masquerading-as-
research.

---

## 5. Evaluation design — the work you actually have left

Build a query set **Q** of ~120 natural-language queries: 60 civic lookups
(water, toilets, health, pharmacy, transit, shelter) and 60 recommendation
queries ("best cheesecake in Bandra West", "good dermatologist near Andheri
East"), spread across 8–10 Mumbai localities. Release it as an artifact — a
released benchmark meaningfully raises acceptance odds.

**Ground truth** = the baked corpus itself. A returned place is *fabricated* if
its name matches nothing in the relevant category/area under fuzzy matching.
Adjudicate borderline cases manually and **report inter-annotator agreement** if
two of you label.

### 5.1 Experiment 1 — Does prompting alone contain fabrication? ★ headline

Three conditions over Q:

| Condition | Setup |
|---|---|
| **A — Ungrounded** | Question only, no candidate list. "Name places that answer this." |
| **B — Prompt-constrained** | Candidate list + the ABSOLUTE RULE prompt, **server filter disabled** |
| **C — Production** | Candidate list + prompt + server-side allow-list filter |

Metrics: fabrication rate · **out-of-set ID rate** · abstention rate ·
useful-answer rate.

**Expected shape of the result:** A is high (this is the motivation). C is **0 by
construction** (state this as a proof, not a measurement). **B is the finding.**
If B > 0 — even at 3–5% — you have demonstrated empirically that prompt-level
constraints leak and that an architectural guarantee is required. That single
number justifies your entire design and is the most citable thing in the paper.

If B turns out to be 0 across 120 queries, that is *also* publishable — report
it honestly, and note the sample size limits the claim. Do not quietly rerun
until you get a number you like.

### 5.2 Experiment 2 — Behaviour under retrieval sparsity ★ the novel one

Vary candidate-set size |C| ∈ {0, 1, 3, 5, 10, 20, 40} by truncating the
candidate list.

Measure, at each size: correct-abstention rate (does it return `mode:search`
rather than inventing?), out-of-set ID rate, and answer usefulness.

**|C| = 0 is the critical cell.** A city with 72 water points produces empty
candidate sets constantly. Does the model comply with the instruction to
abstain, or does it fall back on parametric memory? This directly tests your
title's claim and nobody has measured it for this domain.

Plot |C| on the x-axis against abstention and fabrication. That figure is your
paper's centrepiece.

### 5.3 Experiment 3 — Privacy leakage audit

Instrument the network layer. Run all of Q. Assert:
- **zero** occurrences of latitude/longitude in any `/api/ask` payload
- distinct external origins contacted = **2** (map tiles, own Worker)
- bytes transmitted upstream per query (report mean/median)
- after a full session: zero cookies, zero origin storage entries

Report as a table. Contrast qualitatively with what a commercial maps app
transmits — but **do not reverse-engineer a competitor and publish claims about
it**; describe the difference architecturally instead.

### 5.4 Experiment 4 — Utility at zero quota

Compare the LLM interpreter against the deterministic `localInterpret` parser on
the same Q. Metrics: intent-classification accuracy (`search`/`recommend`/
`trip`), category-extraction F1, locality-resolution accuracy.

The claim is **not** that the local parser is as good. It is that the system
retains *N%* of its capability at zero marginal cost and zero quota — which
matters enormously for deployment in the cost regime your paper targets.

### 5.5 Experiment 5 — Aggregation coverage and categoriser quality

- Coverage: 8 → 200 distinct events; per-source and per-category distribution.
- **Manually label all ~200 imported events** with a gold category (about an
  hour of work) and report a confusion matrix for the keyword categoriser,
  with precision/recall per class.
- Report the ~10 events that remain in `other` and argue they are genuinely
  ambiguous rather than classifier failures.
- Report the two upstream-assertion failures (Luma price, AllEvents time) with
  counts — real evidence that provenance-preserving import must discard fields.

### 5.6 Experiment 6 — Cost and performance

₹0 marginal infrastructure cost. Payload per layer. Time-to-first-pin on a real
mid-range Android over 4G. Lighthouse score. Keep this short — it is supporting
material, not a contribution.

### ⚠ Practical blocker you must plan around

120 queries × 3 conditions = **360 API calls**, against a **20 request/day/model**
free tier. You cannot run this on the free tier in a reasonable time.

Options, in order of preference:
1. **Spend a small amount on a paid key for the evaluation only** (a few hundred
   rupees covers this comfortably). Disclose in the paper that the *deployed*
   system runs on free tier and only the evaluation used paid quota. This is
   normal and reviewers will not object.
2. Spread across ~3 weeks using both models plus a second project.
3. Cut Q to 40 queries — but a 40-query benchmark weakens every claim.

**Take option 1.** Do not let the quota shape your science.

---

## 6. Abstract template

Fill the bracketed numbers from your experiments. Do not write the abstract
until the numbers exist.

> Conversational interfaces to maps are increasingly built on large language
> models, but LLMs fabricate places with high confidence, and the cities where
> such interfaces would be most valuable are precisely those whose open map data
> is too sparse for a model to have memorised — OpenStreetMap records **72**
> drinking water points for Mumbai's ~20 million residents. We present a civic
> map search system in which fabrication is contained architecturally rather
> than by prompting: a bounded candidate set is constructed on the device from a
> locally-held corpus, and the server discards any place identifier the model
> returns that was not offered. Because the candidate set carries only public
> place names, the same construction guarantees that user coordinates are never
> transmitted for search. Over a released benchmark of **120** natural-language
> queries, we find that prompt-level constraints alone still emit out-of-corpus
> identifiers in **[B]%** of recommendation queries, while the server-side filter
> reduces this to zero by construction. We further characterise behaviour as the
> candidate set shrinks toward empty, finding that correct abstention falls to
> **[X]%** at |C| = 0, and show the system retains **[N]%** of its intent-
> classification accuracy through a deterministic on-device parser when its model
> quota is exhausted. The deployed system runs at zero marginal infrastructure
> cost and contacts two external origins.

**Three numbers in an abstract is the target.** You have them: the leak rate, the
sparsity result, and the zero-quota retention.

---

## 7. Limitations and threats to validity

Write this section generously. Reviewers trust papers that police themselves.

- **Single city, single language.** Findings may not transfer to cities with
  denser OSM coverage or non-English queries.
- **Ground truth is the corpus itself.** A place absent from OSM but real is
  scored as fabricated. Quantify how often adjudication overturned this.
- **Model versions are moving targets.** Pin exact model identifiers and dates;
  results are not reproducible against a later model revision.
- **Benchmark authored by the system's authors.** Acknowledge the bias; mitigate
  by having someone outside the project write a held-out subset.
- **No live user study.** You measure system behaviour, not whether Mumbai
  residents find it useful. State this plainly and put it in future work rather
  than implying deployment evidence you do not have.
- **The guarantee is about identity, not prose.** The filter proves no
  out-of-corpus place is returned. It does **not** prove the model's `why`
  sentence about a real place is accurate. Say so explicitly — a reviewer who
  spots this before you do will assume you were hiding it.
- **`/api/route` transmits coordinates.** Disclosed, bounded, and unavoidable.

---

## 8. Ethics statement (mandatory — do not skip)

You collect data from third-party services. A reviewer *will* ask. Handled well
this is a strength:

- **All data is either open-licensed or deliberately published for machine
  consumption.** OSM is ODbL; MCGM toilet data is public domain; AllEvents
  listings are read from schema.org `Event` JSON-LD, a format whose stated
  purpose is machine consumption; Luma is read via the public, keyless endpoint
  that its own public discovery page consumes.
- **Permission was checked, not assumed.** `robots.txt` was inspected for each
  source; no accessed path is disallowed. Document this in the paper.
- **Requests are paced and identified** (1.2 s between AllEvents pages, 0.5 s
  between Luma pages, hard page caps, identifying User-Agent).
- **Sites whose terms forbid scraping were excluded** — BookMyShow and District
  have no public interface and were deliberately not accessed, at the cost of
  coverage the paper reports as a limitation. **Say this.** Declining available
  data on ethical grounds, and eating the coverage loss, is exactly the kind of
  thing a reviewer rewards.
- **No personal data is collected from any source.** Event organiser names are
  public listing metadata.
- **On users:** no accounts required, no cookies, no persistent identifier, no
  analytics, coordinates rounded to ~110 m and never persisted.
- If you run any human evaluation, get institutional ethics clearance first.

---

## 9. Related work — areas to read

**Verify every citation yourself.** Do not take bibliographic details from me or
any LLM; pull each paper and check authors, venue and year. Fabricated citations
are the fastest way to destroy credibility with a reviewer.

Search these areas on Google Scholar / ACL Anthology / arXiv:

1. **Retrieval-augmented generation and grounding** — the core framing
2. **Hallucination in LLMs: taxonomy, measurement, mitigation** — survey papers
   give you both framing and citations
3. **Constrained decoding and structured generation** — position your allow-list
   filter as post-hoc validation rather than constrained decoding, and say why
   (you have no logit access on a hosted free-tier API — this is a genuine and
   interesting constraint worth a sentence)
4. **Abstention, selective prediction and calibration** — "know when to say I
   don't know"
5. **LLM agents for geospatial and mapping tasks** — recent, small, growing
   literature; check for direct competitors
6. **Privacy-preserving location-based services** — k-anonymity, spatial
   cloaking, and geo-indistinguishability (differential privacy for location).
   Your 110 m rounding is *spatial generalisation*, weaker than
   geo-indistinguishability; say so honestly rather than overclaiming
7. **Volunteered geographic information / OSM data quality** — there is a solid
   literature on OSM completeness and its Global-South gaps. This is where you
   evidence "data-sparse cities" rather than asserting it
8. **Uncertainty communication in user interfaces** — supports §4

**Look hard for a direct competitor** — an existing "LLM + map + grounding"
paper. If one exists, cite it and state your delta clearly. Failing to find work
a reviewer knows about is a common fatal error.

---

## 10. Venue strategy

I cannot give you current deadlines — **check live CFPs on WikiCFP, the
conference site, and your department's list.** What I can advise is fit:

- **AI track of a general computing conference** (your stated target) — good
  fit. Lead with grounding and the leak-rate measurement.
- **Responsible AI / Trustworthy AI / FAccT-style tracks** — arguably a *better*
  fit. Your abstention taxonomy and ethics posture are unusually strong, and
  these venues reward exactly that.
- **ICT for Development (ICTD) / Computing for Social Good tracks** — strong fit
  for the data-sparsity and zero-cost angle.
- **HCI venues** — only if you run a user study, which you have not.
- **Workshops attached to major conferences** — strongly consider. Shorter (4–6
  pages), faster review, genuine feedback, and a legitimate publication. For a
  first paper this is often the smarter target than a main track.

**Practical advice:** target a workshop or a regional IEEE/ACM conference first.
Getting a real acceptance and real reviewer feedback beats a main-track rejection
you learn nothing from.

Check whether your target requires anonymised submission; if so, strip the repo
URL and any identifying detail from the PDF, and prepare a non-anonymous
artifact link for camera-ready.

---

## 11. Suggested schedule

| Phase | Work |
|---|---|
| **1** | Build the 120-query benchmark. Freeze the corpus snapshot and pin model versions. |
| **2** | Get a paid key. Run E1 (three conditions) and E2 (sparsity sweep). **These two decide whether you have a paper.** |
| **3** | Run E3, E4. Label 200 events for E5. Run E6. |
| **4** | Read and write Related Work properly. This is where a weak paper is exposed. |
| **5** | Write System Design + Uncertainty sections (you can largely lift §3 of this document). |
| **6** | Write Evaluation, Results, Limitations, Ethics. Make the figures. |
| **7** | Write Abstract and Introduction **last**, once the numbers exist. |
| **8** | Internal review by someone outside the project. Fix, polish, format-check, submit. |

**Gate after Phase 2:** if E1's condition B leaks at 0% *and* E2 shows the model
abstains correctly at |C| = 0, your central claims are weaker than hoped. That is
not a disaster — pivot the framing toward the abstention taxonomy and the
privacy/cost co-design, and consider a Responsible-AI venue instead. Decide this
at Phase 2, not in the final week.

---

## 12. Five things most likely to get you rejected

1. **No evaluation section worth the name.** The single biggest risk. Fix with §5.
2. **Describing all three modes.** Cut the social features. One claim, defended.
3. **Overclaiming novelty** on RAG-style grounding. Position honestly per §0.
4. **Fabricated or unchecked citations.** Verify every single one yourself.
5. **No ethics statement** despite collecting third-party data. Use §8.

---

## 13. What you already have that most student papers don't

Do not undersell these — they are genuinely strong:

- A **working, verified deployed system**, not a prototype. 45/45 end-to-end
  tests passing against a live server.
- A **real data-sparsity regime** that makes your research question genuine
  rather than contrived.
- A **falsifiable architectural claim** (Layer 3 makes out-of-corpus IDs
  impossible) that you can state as a proof rather than a measurement.
- An **elegant co-design result** — one mechanism serving grounding, privacy and
  cost simultaneously.
- **Two independent real-world findings** about upstream data dishonesty (Luma's
  price field, AllEvents' missing times) discovered through deployment, not
  contrived for the paper.
- A **defensible ethics posture** you can document rather than assert, including
  data you deliberately declined to take.

That is a solid foundation. The work that remains is measurement and writing,
not building.
