# Pilot experiment: does grounding contain place fabrication?

Run 2026-09-15 against the live corpus and the production prompt.
Raw data: `scripts/pilot-results.json` · Harness: `scripts/pilot-grounding.mjs`

---

## 1. Method

12 natural-language queries, each run in two conditions on the **same model at
the same temperature (0.6)**, replicated across both production models.

| Condition | Setup |
|---|---|
| **A — Ungrounded** | Question only. No candidate list. Model asked to name up to 5 real Mumbai places, structured output. |
| **B — Grounded** | The production path: candidate list built on-device from the baked corpus + the Worker's **exact** `SYSTEM_PROMPT` and `responseSchema`. Raw `picks` captured **before** filtering, then the production allow-list filter applied. |

The harness reads `SYSTEM_PROMPT` directly out of `worker/index.ts` at runtime,
so the prompt under test cannot drift from the deployed one.

**Completed runs:** 21 grounded, 22 ungrounded (2 lost — one HTTP 503, one
quota 429 on the second model at query D5).

**Candidate-set sizes were measured, not assumed.** My a-priori "sparse"
labelling was wrong in one case: Powai has 28 named drinking-water points, so S1
is a dense query despite being in a sparse category. Buckets below use the
measured `|C|`.

---

## 2. Headline result — and it is a null result

**Out-of-set identifier rate: 0 out of 36 raw picks, across all 21 grounded
runs, on both models.**

The model never once emitted a place identifier that was not in the candidate
list it was given. The prompt-level constraint (Layer 2) held completely; the
server-side filter (Layer 3) discarded nothing because there was nothing to
discard.

**Correct abstention at |C| = 0: 6 of 6.** Every time the corpus offered zero
candidates, the grounded model returned `mode: "search"` rather than inventing
a recommendation — exactly as instructed.

### Sparsity sweep

| Candidate set | Runs | Abstained | Raw picks | Out-of-set |
|---|---|---|---|---|
| \|C\| = 0 | 6 | 6 | 0 | **0** |
| \|C\| = 1–3 | 3 | 1 | 2 | **0** |
| \|C\| = 4–20 | 4 | 0 | 18 | **0** |
| \|C\| = 21–40 | 8 | 4 | 16 | **0** |

**Read this honestly.** The experiment as originally designed — "measure how
often prompt-level constraints leak" — found that at this sample size they do
not leak at all. That is the gate condition I flagged in
`RESEARCH-PAPER-STRATEGY.md` §11. You cannot claim Layer 3 is empirically
necessary on this evidence. What you *can* claim is that Layer 3 converts a
behavioural regularity into a structural guarantee, which is a weaker but still
defensible argument (and the honest one).

---

## 3. The result that actually matters

The interesting contrast is not grounded-vs-prompted. It is
**grounded vs ungrounded**, and the failure mode is not what the literature
usually means by hallucination.

### Per-query summary

| Q | \|C\| | Category / Area | A: named / in corpus | B: mode, picks kept |
|---|---|---|---|---|
| S1 | 28 | drinking_water / Powai | 3/2 · 5/4 | recommend 5 · search 0 |
| S2 | **0** | drinking_water / Bandra West | 0/0 · 0/0 | **search · search** |
| S3 | 1 | drinking_water / Chembur | 3/2 · 3/2 | recommend 1 · recommend 1 |
| S4 | **0** | shelter / Dadar | 4/1 · 5/0 | **search · search** |
| S5 | **0** | bench / Worli | 3/0 · 3/0 | **search · search** |
| S6 | 3 | police / Vile Parle | 1/1 · 1/1 | search · (503) |
| D1 | 40 | food / Bandra West | 4/2 · 5/4 | recommend 2 · recommend 4 |
| D2 | 40 | health / Andheri East | 4/0 · 5/0 | **search · search** |
| D3 | 17 | food / Colaba | 5/5 · 5/5 | recommend 5 · recommend 5 |
| D4 | 12 | pharmacy / Dadar | 3/2 · 5/5 | recommend 3 · recommend 5 |
| D5 | 40 | health / Borivali | 5/4 · (429) | recommend 5 |
| D6 | 40 | toilets / Andheri East | 3/3 | search 0 |

*(two values = model 1 · model 2)*

### Finding 1 — Under sparsity, the ungrounded model attributes amenities to real landmarks

On the three queries where the corpus offers **nothing** (S2, S4, S5), the
ungrounded condition named **15 places, of which 1 was in the corpus**. But
almost none of those 15 are invented businesses. They are **real Mumbai
landmarks with a public amenity asserted onto them**:

> "Worli Sea Face Promenade", "Dr. Annie Besant Road Footpath",
> "Shivaji Park Ground (under the tree canopy)", "Chaityabhoomi garden area",
> "Dadar Railway Station Waiting Rooms", "Indu Mill Compound area"

Worli Sea Face exists. Whether it has a usable public bench is a claim the model
had no basis for. Likewise "Powai Lake Promenade **Public Tap**" and "Supreme
Business Park **Public Water Dispenser**" (S1) — the locations are real; the
named public facility is not established.

**This is a distinct and more interesting failure mode than name invention**,
and it is exactly the one that matters for civic infrastructure. A user sent to
a real park that has no working tap has been failed just as badly as one sent to
a park that does not exist — arguably worse, because the destination is
plausible enough that they will actually go.

### Finding 2 — Grounding abstains correctly even on a dense but mismatched candidate set

**D2 ("Good dermatologist near Andheri East")** is the sharpest case.

- Ungrounded named **9 clinics across the two models; 0 matched the corpus.**
  Several are real, well-known Mumbai dermatologists — but the model had no way
  to know which are near Andheri East, and some are not.
- Grounded had **40 candidates** and still returned `mode: "search"` on **both
  models** — because those 40 were general health POIs carrying no dermatology
  specialty tag, and the prompt forbids claiming specialist information it was
  not given.

The system declined to answer a question it could not ground, *despite having
plenty of candidates to pick from*. That is calibrated abstention working on a
density-vs-relevance mismatch, which nothing in your current framing predicts.
The same pattern appears at D6 (40 toilets, still `search` — "cleanest" is not
inferable from a name).

### Finding 3 — Where the corpus is good, both conditions agree

D3 (dinner in Colaba): ungrounded named 5, **all 5 in the corpus**, on both
models. Grounded recommended 5. When OSM coverage is dense and the places are
famous, grounding costs nothing and the model's parametric knowledge is
accurate. **Grounding earns its keep specifically in the sparse regime** —
which is your paper's thesis, now with evidence.

---

## 4. Adjudication of unmatched names — provisional, verify before citing

32 of the 75 names in condition A did not match the corpus. **"Not in corpus"
is not "fabricated"** — OSM's Mumbai coverage is thin. My provisional reading:

| Bucket | Count | Examples |
|---|---|---|
| Real entity, genuinely absent from OSM | ~10 | Le 15 Patisserie, Kaya Clinic, Dr. Rinky Kapoor — The Esthetic Clinics |
| Real place, **amenity attributed without basis** | ~13 | Worli Sea Face Promenade (bench), Powai Lake Promenade Public Tap, Dadar Railway Station Waiting Rooms |
| Plausible, unverifiable from here | ~7 | Daniel Patissier, JK Kapur Garden, Bhagwan Buddha Garden |
| Likely wrong location | ~2 | Kala Talao Park Pyau (Kala Talao is in Kalyan, not Chembur) |

⚠️ **This adjudication is mine, from general knowledge of Mumbai, and is not
authoritative.** Before any of it goes in a paper you must verify each name
yourself — field check, municipal records, or at minimum a second annotator.
Do not cite my bucket counts as a result.

---

## 5. What this means for the paper

**Your original E1 framing does not survive contact with the data.** You cannot
write "prompt-level constraints leak at X%" — at n=36 picks, X = 0.

Three honest options, in order of strength:

**Option 1 — Reframe around the ungrounded/grounded contrast (recommended).**
The claim becomes: *in data-sparse categories, an ungrounded LLM does not
fabricate business names so much as attribute public amenities to real
landmarks, and corpus grounding eliminates this by construction.* You have clean
evidence: 15 places named where the corpus holds none, 1 of which was real-and-
mapped, versus 6/6 correct abstentions. The amenity-attribution failure mode is
more specific than generic "hallucination" and is genuinely under-described for
civic/geospatial settings.

**Option 2 — Report the null result as a contribution.** "Contemporary instruct-
tuned models comply with candidate-set constraints reliably (0/36 violations
across two models); the architectural filter is therefore cheap insurance rather
than a necessity." Negative results about when safety machinery *isn't* needed
are publishable and honest, but they are a harder sell at a main track.

**Option 3 — Scale up and see if the null holds.** 36 picks is small. Run the
full 120-query set on a paid key. If even 2–3 violations appear at n≈400, Option
1 regains its original sharpness. **Do this if you have runway** — it is the
single highest-value remaining experiment.

**Either way, Proposition 1 stands unchanged.** Layer 3 makes out-of-corpus
identifiers *impossible*, and that is a proof, not a measurement. The pilot
simply shows the model didn't test the guarantee. Say exactly that.

### Suggested revision to the abstract

> ...we find that the grounded system correctly abstains in **6 of 6** queries
> where the corpus offers no candidates, while an ungrounded model given the
> same questions names **15** places, only **1** of which is present in the
> corpus — and whose dominant failure mode is not name invention but the
> attribution of public amenities to real, unverified landmarks.

---

## 6. Limitations of this pilot

- **n = 12 queries, 21 grounded runs, 36 picks.** Small. A 0% leak rate here is
  consistent with a true rate of several percent.
- **One city, one language, two closely-related models** from the same family.
  The null result may not hold for other model families.
- **Ground truth is the corpus**, which is exactly the thing under study. Names
  absent from OSM are not thereby fabricated.
- **The adjudication in §4 is single-annotator and unverified.**
- **Two runs lost** to a 503 and a quota 429; results are not a complete 2×12
  grid.
- Condition A uses a different prompt and schema from condition B by necessity
  (it has no candidate list to reference), so the two are not perfectly matched
  on prompt length or structure.

---

## 7. Reproducing

```bash
node scripts/pilot-grounding.mjs --model=gemini-3.1-flash-lite
node scripts/pilot-grounding.mjs --model=gemini-3.5-flash
```

Appends to `scripts/pilot-results.json` and skips `(model, query)` pairs already
recorded, so a run interrupted by the 20-request/day/model free-tier quota
resumes without re-spending successful calls.
