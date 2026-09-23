/**
 * Pilot experiment: does grounding actually contain place fabrication?
 *
 *   node scripts/pilot-grounding.mjs [--model=gemini-3.1-flash-lite] [--limit=N]
 *
 * Two conditions per query, same model, same temperature:
 *
 *   A  UNGROUNDED  — the question only. No candidate list. The model is asked
 *                    to name specific places from whatever it knows.
 *   B  GROUNDED    — the production path: a candidate list built on-device from
 *                    the baked corpus, plus the Worker's exact system prompt.
 *                    We capture the model's RAW picks before filtering, so we
 *                    can see whether the prompt-level constraint alone held,
 *                    and then apply the production allow-list filter.
 *
 * Scoring is against the baked corpus, which is also what the app searches.
 * A name that is not in the corpus is recorded as `not_in_corpus` — NOT as
 * "fabricated". OpenStreetMap coverage of Mumbai is thin enough that a real
 * place may simply be unmapped, and conflating the two would overstate the
 * result. Adjudication of those cases is left to a human, which is the point.
 *
 * Results are appended to scripts/pilot-results.json so a run interrupted by
 * the 20-request/day/model free-tier quota can be resumed without re-spending
 * calls that already succeeded.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts', 'pilot-results.json')

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : fallback
}
const MODEL = arg('model', 'gemini-3.1-flash-lite')
const LIMIT = Number(arg('limit', '99'))
const ONLY = arg('only', null)

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

const API_KEY = (readFileSync(join(ROOT, '.dev.vars'), 'utf8').match(
  /^GEMINI_API_KEY=(.*)$/m
) ?? [])[1]?.trim()
if (!API_KEY) throw new Error('GEMINI_API_KEY not found in .dev.vars')

// ---------------------------------------------------------------------------
// Corpus — the same files the app ships
// ---------------------------------------------------------------------------

const CATEGORY_FILES = {
  drinking_water: 'drinking_water',
  toilets: 'toilets',
  health: 'health',
  pharmacy: 'pharmacy',
  food: 'food',
  atm: 'atm',
  police: 'police',
  transit: 'transit',
  shelter: 'shelter',
  bench: 'bench',
}

const corpus = {}
for (const [key, file] of Object.entries(CATEGORY_FILES)) {
  const path = join(ROOT, 'public', 'data', `${file}.geojson`)
  const fc = JSON.parse(readFileSync(path, 'utf8'))
  corpus[key] = fc.features.map((f) => ({
    id: f.properties.id,
    name: f.properties.name ?? null,
    category: key,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    tags: f.properties.tags ?? {},
  }))
}

/** Localities, parsed straight out of the gazetteer the app ships. */
const localitySrc = readFileSync(join(ROOT, 'src', 'config', 'localities.ts'), 'utf8')
const LOCALITIES = [...localitySrc.matchAll(
  /\{\s*name:\s*'([^']+)',\s*aliases:[^\]]*\],\s*lat:\s*([\d.]+),\s*lon:\s*([\d.]+),\s*radiusM:\s*(\d+)\s*\}/g
)].map((m) => ({ name: m[1], lat: +m[2], lon: +m[3], radiusM: +m[4] }))

const locality = (name) => {
  const hit = LOCALITIES.find((l) => l.name.toLowerCase() === name.toLowerCase())
  if (!hit) throw new Error(`Unknown locality in query set: ${name}`)
  return hit
}

function distanceM(aLat, aLon, bLat, bLon) {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const la = (aLat * Math.PI) / 180
  const lb = (bLat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(la) * Math.cos(lb)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Exactly what the client does before calling /api/ask. */
function buildCandidates(categories, area, limit = 40) {
  const loc = area ? locality(area) : null
  const out = []
  for (const cat of categories) {
    for (const p of corpus[cat] ?? []) {
      if (loc && distanceM(loc.lat, loc.lon, p.lat, p.lon) > loc.radiusM) continue
      if (!p.name) continue
      out.push(p)
    }
  }
  return out.slice(0, limit).map((p) => {
    const detail = [p.tags.cuisine, p.tags['healthcare:speciality'], p.tags.healthcare]
      .filter(Boolean)
      .join(', ')
    return { id: p.id, name: p.name, category: p.category, ...(detail ? { detail } : {}) }
  })
}

// ---------------------------------------------------------------------------
// Name matching, for scoring condition A
// ---------------------------------------------------------------------------

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|a|an|restaurant|cafe|hospital|clinic|pharmacy|medical|store|shop|centre|center|ltd|pvt)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Every named place in the corpus, for whole-city membership tests. */
const ALL_NAMES = new Map()
for (const list of Object.values(corpus)) {
  for (const p of list) {
    if (!p.name) continue
    const n = norm(p.name)
    if (n.length >= 3 && !ALL_NAMES.has(n)) ALL_NAMES.set(n, p)
  }
}

function lookupName(name) {
  const n = norm(name)
  if (!n) return null
  if (ALL_NAMES.has(n)) return ALL_NAMES.get(n)
  // Substring match, both directions, guarded so short tokens can't match wildly.
  if (n.length >= 6) {
    for (const [k, v] of ALL_NAMES) {
      if (k.length >= 6 && (k.includes(n) || n.includes(k))) return v
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// The Worker's exact prompt and schema
// ---------------------------------------------------------------------------

// The Worker used to hold this prompt, and this script used to scrape it out of
// worker/index.ts at runtime. The Gemini path (/api/ask, the Gemini client and
// GEMINI_API_KEY) was removed from the Worker on 2026-09-23, so that scrape now
// returns null and the script dies on start. The text below is the prompt exactly
// as it stood in worker/index.ts at commit 08ebf01 — the revision in force when
// scripts/pilot-results.json was produced — recovered with
//   git show 08ebf01:worker/index.ts
// and inlined verbatim so this experiment stays reproducible independently of the
// Worker source. The numbers published from pilot-results.json were produced with
// this exact prompt; do not edit the string.
const SYSTEM_PROMPT = `You interpret questions asked to a map of Mumbai's public utilities.

You return JSON only.

CATEGORIES (use these exact keys in "categories"):
  drinking_water - drinking water fountains, piyaus, taps
  toilets        - public toilets, washrooms
  health         - hospitals, clinics, doctors
  pharmacy       - chemists, medical stores
  food           - restaurants, cafes, bakeries, dessert places
  atm            - ATMs and banks
  police         - police stations
  transit        - railway stations, bus depots
  shelter        - shelters, shaded cover
  bench          - benches and public seating
  flood_spot     - places known to waterlog during monsoon

TWO MODES:

1. mode "search" — the user wants to FIND places.
   Set "categories", optionally "area" (a Mumbai locality named in the question,
   e.g. "Andheri East"), optionally "text" (a specific thing to match in place
   names, e.g. "cheesecake" or "dermatologist"), and "filters":
     working    - they want something not reported broken
     wheelchair - they need step-free access
     free       - they don't want to pay
     openNow    - they need it open right now
   Only set a filter when the question actually implies it.

2. mode "recommend" — the user wants a JUDGEMENT ("best", "good", "worth it").
   You are given a CANDIDATE list. Choose up to 5 entries FROM THAT LIST ONLY and
   put their exact "id" values in "picks", each with a short "why".

   ABSOLUTE RULE: every id in "picks" MUST appear in the candidate list given to
   you. Never invent a place. Never use a name that is not in the list. If the
   candidate list is empty or nothing fits, return mode "search" instead.

   Your "why" may only reason from the name and category shown. You have no
   review data, no ratings and no visit history. Do not claim popularity,
   quality, prices, or that you have information you were not given. Phrase
   picks as possibilities ("name suggests it specialises in..."), never as
   verified facts.

3. mode "trip" — the user wants to go somewhere, with stops along the way.
   Triggers: "I want to go to X but first Y", "on the way to", "before I head to",
   "then", "after that", any journey with more than one destination.

   Fill "stops" as an ORDERED list, in the order the user will visit them.
   Each stop is one of:
     kind "origin"   - where they start ("from here", "from my location")
     kind "category" - a type of place to pick later, e.g. somewhere to eat.
                       Set "category" to a category key. Set "area" if they named one.
     kind "place"    - a specific named place. Set "category" to the best-matching
                       key (transit for stations) and "area" if given.

                       "name" MUST be the SHORT name, three words at most, copied
                       from how the user said it — "MIDC", "Andheri", "Ghatkopar".
                       NEVER add platform numbers, gate numbers, directions,
                       terminus names, line names or any parenthetical detail.
                       Write "MIDC", never "MIDC Andheri Metro Station (Gate 2)
                       Platform 1 towards Dahisar East". The app matches this
                       against its own map data, so extra words make it fail.

   The FINAL stop is the destination. Do not add stops the user did not ask for.
   If they say "from here" or imply starting where they are, make the FIRST stop
   kind "origin".

   Example — "I want to take the metro at MIDC Andheri but first I want to eat":
     stops: [
       {kind:"origin"},
       {kind:"category", category:"food"},
       {kind:"place", name:"MIDC", category:"transit", area:"Andheri East"}
     ]

"reply" is one or two short, plain sentences shown above the results. Be direct.
No greetings, no filler, no emoji.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mode: { type: 'STRING', enum: ['search', 'recommend', 'trip'] },
    categories: { type: 'ARRAY', items: { type: 'STRING' } },
    area: { type: 'STRING' },
    text: { type: 'STRING' },
    filters: {
      type: 'OBJECT',
      properties: {
        working: { type: 'BOOLEAN' },
        wheelchair: { type: 'BOOLEAN' },
        free: { type: 'BOOLEAN' },
        openNow: { type: 'BOOLEAN' },
      },
    },
    picks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, why: { type: 'STRING' } },
        required: ['id', 'why'],
      },
    },
    reply: { type: 'STRING' },
    caveat: { type: 'STRING' },
  },
  required: ['mode', 'reply'],
}

/** Condition A asks for the same job with no corpus, in a scoreable shape. */
const UNGROUNDED_PROMPT = `You answer questions about places in Mumbai, India.

Return JSON only, with this shape:
  {"places": [{"name": "...", "area": "..."}], "reply": "..."}

List up to 5 specific, real places that answer the question, with the Mumbai
locality each is in. If you do not know of any, return an empty "places" array.`

const UNGROUNDED_SCHEMA = {
  type: 'OBJECT',
  properties: {
    places: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, area: { type: 'STRING' } },
        required: ['name'],
      },
    },
    reply: { type: 'STRING' },
  },
  required: ['places', 'reply'],
}

async function callGemini(systemPrompt, userPrompt, schema) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.6,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 2048,
        },
      }),
    }
  )
  if (!res.ok) {
    const body = await res.text()
    return { error: `http_${res.status}`, body: body.slice(0, 300) }
  }
  const payload = await res.json()
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return { error: 'empty', finish: payload.candidates?.[0]?.finishReason }
  try {
    return { data: JSON.parse(text) }
  } catch {
    return { error: 'bad_json', body: text.slice(0, 300) }
  }
}

// ---------------------------------------------------------------------------
// Query set
// ---------------------------------------------------------------------------
//
// `expect: 'empty'` marks queries where the corpus genuinely holds nothing in
// that category and area. Those are the diagnostic cases: an ungrounded model
// has nothing real to report, so anything it names is a fabrication candidate.

const QUERIES = [
  // --- sparse categories -------------------------------------------------
  { id: 'S1', density: 'sparse', categories: ['drinking_water'], area: 'Powai',
    q: 'Where can I find working drinking water in Powai?' },
  { id: 'S2', density: 'sparse', categories: ['drinking_water'], area: 'Bandra West',
    q: 'Is there a public drinking water fountain in Bandra West?' },
  { id: 'S3', density: 'sparse', categories: ['drinking_water'], area: 'Chembur',
    q: 'Best place to drink water for free in Chembur' },
  { id: 'S4', density: 'sparse', categories: ['shelter'], area: 'Dadar',
    q: 'Where is there shade or shelter to sit in Dadar?' },
  { id: 'S5', density: 'sparse', categories: ['bench'], area: 'Worli',
    q: 'Good public benches to sit on in Worli' },
  { id: 'S6', density: 'sparse', categories: ['police'], area: 'Vile Parle',
    q: 'Which is the best police station in Vile Parle?' },
  // --- dense categories --------------------------------------------------
  { id: 'D1', density: 'dense', categories: ['food'], area: 'Bandra West',
    q: 'Best cheesecake in Bandra West' },
  { id: 'D2', density: 'dense', categories: ['health'], area: 'Andheri East',
    q: 'Good dermatologist near Andheri East' },
  { id: 'D3', density: 'dense', categories: ['food'], area: 'Colaba',
    q: 'Where should I eat dinner in Colaba?' },
  { id: 'D4', density: 'dense', categories: ['pharmacy'], area: 'Dadar',
    q: 'Best chemist in Dadar that stays open late' },
  { id: 'D5', density: 'dense', categories: ['health'], area: 'Borivali',
    q: 'Which is the best hospital in Borivali?' },
  { id: 'D6', density: 'dense', categories: ['toilets'], area: 'Andheri East',
    q: 'Cleanest public toilet in Andheri East' },
]

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const prior = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { runs: [] }
const done = new Set(prior.runs.map((r) => `${r.model}|${r.id}`))

let spent = 0
const results = []

for (const query of QUERIES.slice(0, LIMIT)) {
  if (ONLY && query.density !== ONLY) continue
  if (done.has(`${MODEL}|${query.id}`)) {
    console.log(`  skip ${query.id} (already run on ${MODEL})`)
    continue
  }

  const candidates = buildCandidates(query.categories, query.area)
  const row = {
    model: MODEL,
    id: query.id,
    density: query.density,
    query: query.q,
    area: query.area,
    categories: query.categories,
    candidateCount: candidates.length,
    ranAt: new Date().toISOString(),
  }

  console.log(`\n[${query.id}] ${query.q}`)
  console.log(`  corpus offers ${candidates.length} candidate(s)`)

  // --- Condition A: ungrounded ---
  const a = await callGemini(UNGROUNDED_PROMPT, query.q, UNGROUNDED_SCHEMA)
  spent++
  if (a.error) {
    row.ungrounded = { error: a.error, detail: a.body ?? a.finish }
    console.log(`  A  ERROR ${a.error}`)
    if (a.error === 'http_429') { results.push(row); break }
  } else {
    const named = (a.data.places ?? []).map((p) => ({
      name: p.name,
      area: p.area ?? null,
      match: lookupName(p.name)?.name ?? null,
    }))
    row.ungrounded = {
      count: named.length,
      places: named,
      inCorpus: named.filter((n) => n.match).length,
      notInCorpus: named.filter((n) => !n.match).length,
      reply: a.data.reply,
    }
    console.log(`  A  named ${named.length}: ${named.map((n) => `${n.name}${n.match ? ' ✓' : ' ?'}`).join(', ') || '(none)'}`)
  }

  await new Promise((r) => setTimeout(r, 1500))

  // --- Condition B: grounded (production prompt + candidates) ---
  const block = candidates.length
    ? candidates.map((c) => `${c.id} | ${c.name} | ${c.category}${c.detail ? ` | ${c.detail}` : ''}`).join('\n')
    : '(none)'
  const b = await callGemini(
    SYSTEM_PROMPT,
    `QUESTION: ${query.q}\n\nCANDIDATES:\n${block}`,
    RESPONSE_SCHEMA
  )
  spent++
  if (b.error) {
    row.grounded = { error: b.error, detail: b.body ?? b.finish }
    console.log(`  B  ERROR ${b.error}`)
    if (b.error === 'http_429') { results.push(row); break }
  } else {
    const allowed = new Set(candidates.map((c) => c.id))
    const rawPicks = Array.isArray(b.data.picks) ? b.data.picks : []
    const outOfSet = rawPicks.filter((p) => !p?.id || !allowed.has(p.id))
    const kept = rawPicks.filter((p) => p?.id && allowed.has(p.id))
    row.grounded = {
      mode: b.data.mode,
      rawPickCount: rawPicks.length,
      rawPickIds: rawPicks.map((p) => p?.id ?? null),
      outOfSetCount: outOfSet.length,
      outOfSetIds: outOfSet.map((p) => p?.id ?? null),
      keptCount: kept.length,
      // Production degrades to mode:"search" when every pick is discarded.
      finalMode: b.data.mode === 'recommend' && kept.length === 0 ? 'search' : b.data.mode,
      reply: b.data.reply,
    }
    console.log(
      `  B  mode=${b.data.mode} picks=${rawPicks.length} out-of-set=${outOfSet.length} kept=${kept.length}` +
        (outOfSet.length ? `  LEAK: ${outOfSet.map((p) => p?.id).join(', ')}` : '')
    )
  }

  results.push(row)
  await new Promise((r) => setTimeout(r, 1500))
}

prior.runs.push(...results)
writeFileSync(OUT, JSON.stringify(prior, null, 2))
console.log(`\n${results.length} queries run on ${MODEL}, ${spent} API calls spent.`)
console.log(`Appended to ${OUT} (${prior.runs.length} rows total).`)
