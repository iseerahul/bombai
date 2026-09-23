#!/usr/bin/env node
/**
 * Build-time data pipeline. NEVER called from the running app.
 *
 * Public Overpass instances explicitly ask apps not to use them as a live
 * backend (~10k requests/day guideline, and they shed load on heavy users).
 * So we fetch once here, bake the result into static GeoJSON, and ship that.
 * The app then does all searching locally in the browser — which is both the
 * compliant thing to do and the private, fast one.
 *
 * Usage:
 *   node scripts/build-data.mjs
 *   node scripts/build-data.mjs --only=drinking_water,toilets
 *   node scripts/build-data.mjs --mirror=https://overpass-api.de/api/interpreter
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'public', 'data')
const SEED_DIR = resolve(ROOT, 'data')

/** Greater Mumbai. south,west,north,east — the bbox used to measure the baselines below. */
const BBOX = '18.87,72.77,19.32,73.02'

/**
 * Mirrors in preference order. kumi.systems is first deliberately: during
 * planning the main overpass-api.de instance was returning timeouts/504s while
 * kumi answered reliably. Override with --mirror=...
 */
const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

const USER_AGENT =
  'MumbaiCivicMap/0.1 (semester project; build-time extract; https://github.com/)'

/**
 * Counts measured live during planning (same bbox, July 2026). Used only as a
 * sanity tripwire: if a fresh run returns wildly fewer, the pipeline broke —
 * Mumbai did not lose 90% of its toilets overnight.
 */
const BASELINES = { drinking_water: 76, toilets: 361, health: 2016 }

/** Only these tags survive into the shipped files. Payload size is the mobile constraint. */
const KEEP_TAGS = [
  'opening_hours',
  'wheelchair',
  'fee',
  'access',
  'drinking_water',
  'male',
  'female',
  'unisex',
  'operator',
  'description',
  'healthcare',
  'healthcare:speciality',
  'cuisine',
  'phone',
  'level',
]

const args = process.argv.slice(2)
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : null
}

const categories = JSON.parse(
  readFileSync(resolve(ROOT, 'shared', 'categories.json'), 'utf8')
)

const only = argOf('only')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const mirrorOverride = argOf('mirror')
const mirrors = mirrorOverride ? [mirrorOverride, ...MIRRORS] : MIRRORS

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Overpass
// ---------------------------------------------------------------------------

function buildQuery(spec) {
  const clauses = spec.overpass
    .map((rule) => {
      const values = rule.values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      return `  nwr["${rule.key}"~"^(${values.join('|')})$"](${BBOX});`
    })
    .join('\n')
  return `[out:json][timeout:180];\n(\n${clauses}\n);\nout center tags;`
}

async function overpass(query, label) {
  let lastErr
  for (const mirror of mirrors) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        process.stdout.write(
          `  → ${label}: ${new URL(mirror).host} (attempt ${attempt})… `
        )
        const res = await fetch(mirror, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: new URLSearchParams({ data: query }),
          // Without this a stalled mirror hangs the whole build instead of
          // failing over — observed in practice: an Overpass connection that
          // accepted the request and then never responded. Slightly longer than
          // the [timeout:180] in the query, so the server gets to answer first.
          signal: AbortSignal.timeout(200_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
        const json = await res.json()
        if (!json.elements) throw new Error('response had no "elements" array')
        console.log(`ok (${json.elements.length} elements)`)
        return json.elements
      } catch (err) {
        lastErr = err
        console.log(`failed: ${err.message}`)
        // Overpass sheds load on heavy users; back off rather than hammering.
        await sleep(attempt * 4000)
      }
    }
  }
  throw new Error(`all mirrors failed for "${label}": ${lastErr?.message}`)
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/**
 * Which of the category's own Overpass rules this element matched, as
 * "leisure=park" or "amenity=cinema".
 *
 * The category alone is too coarse to recommend on: a garden and a stadium are
 * both "sports & play"-adjacent leisure, but nobody asking for somewhere calm
 * wants a stadium. The mood matcher scores on this, so it has to survive into
 * the shipped file.
 */
function matchedSubtype(tags, spec) {
  for (const rule of spec?.overpass ?? []) {
    const value = tags[rule.key]
    if (value != null && rule.values.includes(String(value))) {
      return `${rule.key}=${value}`
    }
  }
  return null
}

function toFeature(el, category, source = 'osm', spec = null) {
  // Ways and relations have no lat/lon of their own; `out center` gives us one.
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number') return null

  const tags = el.tags ?? {}
  const kept = {}
  for (const key of KEEP_TAGS) {
    if (tags[key] != null) kept[key] = String(tags[key])
  }

  return {
    id: `osm:${el.type}/${el.id}`,
    name: tags.name || tags['name:en'] || null,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    category,
    subtype: matchedSubtype(tags, spec),
    source,
    tags: kept,
  }
}

/** Rough metres between two WGS84 points. Good enough for dedupe at ~50m. */
function metresBetween(aLat, aLon, bLat, bLon) {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const la1 = (aLat * Math.PI) / 180
  const la2 = (bLat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ---------------------------------------------------------------------------
// MCGM public toilets (data.opencity.in, KML, public domain)
// ---------------------------------------------------------------------------

const MCGM_TOILETS_KML =
  'https://data.opencity.in/dataset/8bdae802-bb45-446e-98d7-aa7bff0b6acb/resource/8c4bcb72-21de-44a7-a776-ffefceb450f1/download/057c0e2f-9528-426e-9c8c-5fc1720c139b.kml'

function cleanXmlText(s) {
  if (!s) return null
  const text = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/**
 * Minimal KML placemark reader. Dependency-free on purpose — we need a point
 * and a label, not a full XML tree.
 *
 * This file does NOT use <name> elements, despite that being the obvious KML
 * convention. Its placemarks carry everything in
 * <ExtendedData><SchemaData><SimpleData name="Address">…, so reading only <name>
 * would yield hundreds of unlabelled pins. Both shapes are handled so the parser
 * survives the publisher reformatting the file.
 */
function parseKmlPlacemarks(kml) {
  const out = []
  const placemarks = kml.match(/<Placemark[\s\S]*?<\/Placemark>/g) ?? []

  for (const pm of placemarks) {
    const coordMatch = pm.match(/<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/)
    if (!coordMatch) continue
    // KML orders coordinates lon,lat[,alt] — the reverse of how they're usually read.
    const [lonRaw, latRaw] = coordMatch[1].trim().split(/\s+/)[0].split(',')
    const lon = Number(lonRaw)
    const lat = Number(latRaw)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue

    // Collect every <SimpleData name="Key">value</SimpleData> pair.
    const fields = {}
    const simpleData = pm.match(/<SimpleData\s+name="([^"]+)"\s*>([\s\S]*?)<\/SimpleData>/g) ?? []
    for (const entry of simpleData) {
      const m = entry.match(/<SimpleData\s+name="([^"]+)"\s*>([\s\S]*?)<\/SimpleData>/)
      if (m) fields[m[1]] = cleanXmlText(m[2]) ?? ''
    }

    const explicitName = cleanXmlText(pm.match(/<name>([\s\S]*?)<\/name>/)?.[1])
    const description = cleanXmlText(pm.match(/<description>([\s\S]*?)<\/description>/)?.[1])

    out.push({
      name: explicitName || fields.Address || fields.Location || null,
      description,
      fields,
      lat,
      lon,
    })
  }
  return out
}

async function fetchMcgmToilets() {
  try {
    process.stdout.write('  → MCGM toilets (opencity.in)… ')
    const res = await fetch(MCGM_TOILETS_KML, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const kml = await res.text()
    const placemarks = parseKmlPlacemarks(kml)
    const named = placemarks.filter((p) => p.name).length
    console.log(`ok (${placemarks.length} placemarks, ${named} with an address)`)

    return placemarks.map((p, i) => {
      const tags = {}
      if (p.description) tags.description = p.description

      // This dataset records seat counts per gender, which is genuinely useful
      // and has no OSM equivalent tag, so surface it in the description.
      const female = Number(p.fields.Count_of_F)
      const male = Number(p.fields.Count_of_M)
      const seats = []
      if (Number.isFinite(female) && female > 0) seats.push(`${female} women's`)
      if (Number.isFinite(male) && male > 0) seats.push(`${male} men's`)
      if (seats.length) {
        tags.description = [tags.description, `${seats.join(', ')} seats`]
          .filter(Boolean)
          .join(' · ')
        if (female > 0) tags.female = 'yes'
        if (male > 0) tags.male = 'yes'
      }

      return {
        id: `mcgm:toilet/${i}`,
        // Addresses here are long; trim so a card stays readable.
        name: p.name ? p.name.slice(0, 90) : 'Public toilet (MCGM record)',
        lat: Number(p.lat.toFixed(6)),
        lon: Number(p.lon.toFixed(6)),
        category: 'toilets',
        source: 'mcgm',
        tags,
      }
    })
  } catch (err) {
    // Non-fatal: OSM toilets still ship. Municipal open data goes offline often.
    console.log(`failed: ${err.message} — continuing with OSM toilets only`)
    return []
  }
}

/** Keep MCGM entries that aren't already an OSM toilet within ~50m. */
function mergeToilets(osmFeatures, mcgmFeatures) {
  const added = []
  for (const m of mcgmFeatures) {
    const duplicate = osmFeatures.some(
      (o) => metresBetween(o.lat, o.lon, m.lat, m.lon) < 50
    )
    if (!duplicate) added.push(m)
  }
  return added
}

// ---------------------------------------------------------------------------
// Metro / rail line geometry
// ---------------------------------------------------------------------------

/**
 * Rail lines, as LineStrings rather than points.
 *
 * This is context, not routing: it lets someone see which line a station sits
 * on when planning a trip. We deliberately do NOT model schedules or ride
 * legs — Mumbai Metro publishes no openly usable GTFS, so any journey time we
 * showed would be invented.
 *
 * `out geom` returns each way's full coordinate list, which the point pipeline
 * doesn't need and can't represent.
 */
async function buildRailLines() {
  const query =
    `[out:json][timeout:180];\n` +
    `way["railway"~"^(subway|light_rail|monorail)$"](${BBOX});\n` +
    `out geom;`

  const elements = await overpass(query, 'rail lines')

  const features = []
  for (const el of elements) {
    if (!Array.isArray(el.geometry) || el.geometry.length < 2) continue
    const tags = el.tags ?? {}
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: el.geometry
          .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
          .map((p) => [Number(p.lon.toFixed(5)), Number(p.lat.toFixed(5))]),
      },
      properties: {
        id: `osm:way/${el.id}`,
        name: tags.name ?? tags.ref ?? null,
        railway: tags.railway ?? 'subway',
        // OSM sometimes carries the official line colour; the map falls back
        // to a default when it's missing.
        colour: tags.colour ?? tags.color ?? null,
      },
    })
  }

  const geojson = {
    type: 'FeatureCollection',
    attribution: '© OpenStreetMap contributors (ODbL)',
    generated: new Date().toISOString(),
    bbox: BBOX,
    features,
  }

  writeFileSync(resolve(OUT_DIR, 'rail_lines.geojson'), JSON.stringify(geojson))
  const kb = (Buffer.byteLength(JSON.stringify(geojson)) / 1024).toFixed(0)
  console.log(`  ✓ rail_lines.geojson — ${features.length} segments (${kb} KB)`)
  return features.length
}

// ---------------------------------------------------------------------------
// Chronic flooding spots (hand-seeded)
// ---------------------------------------------------------------------------

/**
 * There is no clean public API for Mumbai's chronic waterlogging spots — IIT
 * Bombay's flood system is a portal, not a feed. So this is a hand-seeded list
 * of long-documented spots, marked `manual_seed`, and the UI must present it as
 * "historically floods", never as live status. Live status comes only from
 * community reports, which expire in 8 hours.
 */
function buildFloodSpots() {
  const csvPath = resolve(SEED_DIR, 'flood-spots.csv')
  if (!existsSync(csvPath)) {
    console.log('  ! data/flood-spots.csv missing — skipping flood layer')
    return []
  }
  const rows = readFileSync(csvPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  const header = rows.shift().split(',').map((h) => h.trim())
  const idx = (k) => header.indexOf(k)

  return rows.map((line, i) => {
    // Simple split is safe here: the seed file quotes nothing and contains no commas in fields.
    const cols = line.split(',').map((c) => c.trim())
    return {
      id: `flood:${i}`,
      name: cols[idx('name')],
      lat: Number(cols[idx('lat')]),
      lon: Number(cols[idx('lon')]),
      category: 'flood_spot',
      source: 'manual_seed',
      tags: {
        ward: cols[idx('ward')] || '',
        severity: cols[idx('severity')] || 'moderate',
        note: cols[idx('note')] || '',
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function writeCategory(name, features) {
  const geojson = {
    type: 'FeatureCollection',
    // Attribution travels with the data so it can never be separated from it.
    attribution:
      '© OpenStreetMap contributors (ODbL) · MCGM public toilet data via data.opencity.in (public domain)',
    generated: new Date().toISOString(),
    bbox: BBOX,
    features: features.map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: {
        id: f.id,
        name: f.name,
        category: f.category,
        // "leisure=park", "amenity=cinema" — what the mood matcher scores on.
        ...(f.subtype ? { subtype: f.subtype } : {}),
        source: f.source,
        ...f.tags,
      },
    })),
  }
  const path = resolve(OUT_DIR, `${name}.geojson`)
  writeFileSync(path, JSON.stringify(geojson))
  const kb = (Buffer.byteLength(JSON.stringify(geojson)) / 1024).toFixed(0)
  console.log(`  ✓ ${name}.geojson — ${features.length} features (${kb} KB)`)
  return features.length
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const selected = Object.entries(categories).filter(
    ([key]) => !only || only.includes(key)
  )

  console.log(`\nMumbai Civic Map — data build`)
  console.log(`bbox ${BBOX}`)
  console.log(`categories: ${selected.map(([k]) => k).join(', ')}\n`)

  const manifest = { generated: new Date().toISOString(), bbox: BBOX, counts: {} }
  const warnings = []

  for (const [key, spec] of selected) {
    const elements = await overpass(buildQuery(spec), key)
    let features = elements
      .map((el) => toFeature(el, key, 'osm', spec))
      .filter(Boolean)

    // De-duplicate: a hospital mapped as both a node and an enclosing way is one hospital.
    const seen = new Set()
    features = features.filter((f) => {
      const fingerprint = `${f.name ?? ''}@${f.lat.toFixed(4)},${f.lon.toFixed(4)}`
      if (seen.has(fingerprint)) return false
      seen.add(fingerprint)
      return true
    })

    if (key === 'toilets') {
      const mcgm = await fetchMcgmToilets()
      const extra = mergeToilets(features, mcgm)
      console.log(
        `  + MCGM contributed ${extra.length} toilets not already in OSM ` +
          `(${mcgm.length - extra.length} were duplicates)`
      )
      features = features.concat(extra)
    }

    const baseline = BASELINES[key]
    if (baseline && features.length < baseline * 0.5) {
      warnings.push(
        `${key}: got ${features.length}, expected ~${baseline} from the planning baseline. ` +
          `Suspect a broken query or a partial Overpass response, not real-world change.`
      )
    }

    manifest.counts[key] = writeCategory(key, features)
    await sleep(3000) // be a good Overpass citizen
  }

  if (!only || only.includes('rail_lines')) {
    manifest.counts.rail_lines = await buildRailLines()
    await sleep(3000)
  }

  const floodSpots = buildFloodSpots()
  if (floodSpots.length) {
    manifest.counts.flood_spot = writeCategory('flood_spots', floodSpots)
  }

  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`  ✓ manifest.json`)

  if (warnings.length) {
    console.log('\n⚠ Sanity warnings:')
    for (const w of warnings) console.log(`  - ${w}`)
  }

  const total = Object.values(manifest.counts).reduce((a, b) => a + b, 0)
  console.log(`\nDone — ${total} features across ${Object.keys(manifest.counts).length} layers.\n`)
}

main().catch((err) => {
  // Fail loudly. A half-written data directory that looks fine is worse than no build.
  console.error(`\n✗ Build failed: ${err.message}\n`)
  process.exit(1)
})
