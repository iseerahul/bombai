const BASE = 'http://127.0.0.1:8787'
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`) } else { fail++; console.log(`  FAIL ${n} ${x}`) } }
function jar() {
  let cookie = ''
  return { async fetch(path, init = {}) {
    const res = await fetch(BASE + path, { ...init,
      headers: { ...(init.body instanceof ArrayBuffer ? {} : { 'content-type': 'application/json' }),
                 ...(cookie ? { cookie } : {}), ...(init.headers || {}) }, redirect: 'manual' })
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
    let body = null; try { body = await res.json() } catch {}
    return { status: res.status, body, res }
  } }
}
const a = jar(), b = jar(), anon = jar()

/*
 * These suites sign in through the local dev shortcut, which the Worker
 * disables the moment real Google credentials exist. That is deliberate — a
 * bypass must never sit beside working auth — but it means this file cannot
 * run against a Google-configured server. Say so plainly instead of reporting
 * every authenticated assertion as a failure.
 */
{
  const probe = await fetch(`${BASE}/api/auth/me`).then((r) => r.json()).catch(() => null)
  if (probe && !probe.devLogin) {
    console.log('')
    console.log('  SKIPPED - Google sign-in is configured, so the dev login this')
    console.log('  suite uses is switched off. To run it, blank GOOGLE_CLIENT_ID')
    console.log('  in .dev.vars and restart the API.')
    console.log('')
    process.exit(0)
  }
}

console.log('\n— auth —')
let r = await a.fetch('/api/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'Ava Board' }) })
ok('sign in A', r.status === 200)
r = await b.fetch('/api/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'Bo Board' }) })
ok('sign in B', r.status === 200)

console.log('\n— visits are private —')
r = await anon.fetch('/api/visits')
ok('anonymous cannot list visits', r.status === 401, `${r.status}`)

const visit = { label: 'Kitab Khana', lat: 18.9320612, lon: 72.8318427, category: 'culture',
  visitedAt: Date.now() - 86400000, note: 'Upstairs café is quiet on weekday mornings.',
  tags: ['quiet', 'hidden'], publishAsSpot: true }
r = await a.fetch('/api/visits', { method: 'POST', body: JSON.stringify(visit) })
ok('A creates a visit', r.status === 201 && r.body?.id, JSON.stringify(r.body))
const visitId = r.body?.id
ok('publishing created a spot', !!r.body?.spotId)
const spotId = r.body?.spotId

r = await a.fetch('/api/visits')
ok('A sees their visit', r.body?.visits?.length >= 1)
r = await b.fetch('/api/visits')
ok('B does NOT see A\u2019s visit', (r.body?.visits ?? []).every(v => v.id !== visitId), 'LEAK')

console.log('\n— validation —')
r = await a.fetch('/api/visits', { method: 'POST', body: JSON.stringify({ ...visit, lat: 28.6, lon: 77.2 }) })
ok('out-of-area rejected', r.status === 400, `${r.status}`)
r = await a.fetch('/api/visits', { method: 'POST', body: JSON.stringify({ ...visit, label: '' }) })
ok('empty label rejected', r.status === 400, `${r.status}`)

console.log('\n— photos —')
// Smallest valid JPEG the encoder will accept.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
r = await a.fetch(`/api/visits/${visitId}/photo`, { method: 'POST',
  headers: { 'content-type': 'image/jpeg', 'x-image-width': '1', 'x-image-height': '1' },
  body: jpeg })
ok('A uploads a photo', r.status === 201 && r.body?.url, JSON.stringify(r.body))
const photoUrl = r.body?.url

r = await b.fetch(`/api/visits/${visitId}/photo`, { method: 'POST',
  headers: { 'content-type': 'image/jpeg' }, body: jpeg })
ok('B cannot upload to A\u2019s visit', r.status === 403, `${r.status}`)

if (photoUrl) {
  const img = await fetch(BASE + photoUrl)
  ok('photo serves', img.status === 200 && img.headers.get('content-type') === 'image/jpeg')
  ok('photo is cached immutably', (img.headers.get('cache-control') ?? '').includes('immutable'))
  const bytes = await img.arrayBuffer()
  ok('photo bytes round-trip', bytes.byteLength === jpeg.length, `${bytes.byteLength} vs ${jpeg.length}`)
}

r = await a.fetch('/api/visits')
ok('visit carries its photo', r.body?.visits?.[0]?.photos?.length === 1)

console.log('\n— spots are public —')
r = await anon.fetch('/api/spots')
ok('anonymous can list spots', r.status === 200 && Array.isArray(r.body?.spots))
const spot = (r.body?.spots ?? []).find(s => s.id === spotId)
ok('the published spot is there', !!spot)
ok('spot carries tag counts', spot && spot.tagCounts?.quiet === 1, JSON.stringify(spot?.tagCounts))
ok('spot starts at 1 confirmation', spot?.confirmations === 1, `${spot?.confirmations}`)
ok('spot exposes the trust threshold', typeof r.body?.trustedAt === 'number')
ok('spot does NOT leak the visit note', !JSON.stringify(spot ?? {}).includes('weekday mornings'), 'LEAK')

console.log('\n— confirmation and tagging —')
r = await b.fetch(`/api/spots/${spotId}/confirm`, { method: 'POST' })
ok('B confirms', r.status === 200 && r.body?.confirmed)
r = await b.fetch(`/api/spots/${spotId}/confirm`, { method: 'POST' })
ok('double confirm is a no-op', r.body?.alreadyDone === true)
r = await anon.fetch('/api/spots')
ok('confirmations went to 2', r.body.spots.find(s => s.id === spotId)?.confirmations === 2)

r = await b.fetch(`/api/spots/${spotId}/tag`, { method: 'POST', body: JSON.stringify({ tag: 'quiet' }) })
ok('B tags it quiet too', r.status === 200)
r = await anon.fetch('/api/spots')
ok('quiet now has 2 votes', r.body.spots.find(s => s.id === spotId)?.tagCounts?.quiet === 2)
r = await b.fetch(`/api/spots/${spotId}/tag`, { method: 'POST', body: JSON.stringify({ tag: 'BAD TAG!' }) })
ok('malformed tag rejected', r.status === 400, `${r.status}`)

console.log('\n— dedupe —')
r = await b.fetch('/api/visits', { method: 'POST', body: JSON.stringify({
  ...visit, note: null, tags: ['scenic'], label: 'Kitab Khana', lat: 18.93208, lon: 72.83186 }) })
ok('B publishes the same place', r.status === 201)
ok('it merged into the existing spot', r.body?.spotId === spotId, `${r.body?.spotId}`)

console.log('\n— delete —')
r = await b.fetch(`/api/visits/${visitId}/delete`, { method: 'POST' })
ok('B cannot delete A\u2019s visit', r.status === 403, `${r.status}`)
r = await a.fetch(`/api/visits/${visitId}/delete`, { method: 'POST' })
ok('A deletes their own', r.status === 200)
if (photoUrl) {
  const img = await fetch(BASE + photoUrl)
  ok('photo bytes are gone too', img.status === 404, `${img.status}`)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
