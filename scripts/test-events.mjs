/**
 * End-to-end check of the events feature, run against a live Worker.
 *
 *   npm run worker:dev          # in one terminal
 *   node scripts/test-events.mjs
 *
 * It exercises the real HTTP surface with real sessions rather than mocking,
 * because the things most likely to break here are authorisation boundaries
 * and import idempotency — neither of which a unit test would catch.
 *
 * It creates and then deletes its own event, so it is safe to re-run. Note the
 * create endpoint is rate-limited to 10/hour; several runs in quick succession
 * will trip it.
 */

const BASE = 'http://127.0.0.1:8787'
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${extra}`) }
}

// session cookie jar
function jar() {
  let cookie = ''
  return {
    get cookie() { return cookie },
    async fetch(path, init = {}) {
      const res = await fetch(BASE + path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
        redirect: 'manual',
      })
      const set = res.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0]
      let body = null
      try { body = await res.json() } catch {}
      return { status: res.status, body }
    },
  }
}

const a = jar()   // creator
const b = jar()   // joiner
const anon = jar()

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
let r = await a.fetch('/api/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'Ava Tester' }) })
ok('dev login A', r.status === 200 && r.body?.ok === true, JSON.stringify(r.body))
r = await b.fetch('/api/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'Bo Tester' }) })
ok('dev login B', r.status === 200 && r.body?.ok === true)

console.log('\n— browse without an account —')
r = await anon.fetch('/api/events')
ok('anonymous can list events', r.status === 200 && Array.isArray(r.body?.events))
const baseline = r.body.events.length
console.log(`       ${baseline} events on the board`)
ok('every event carries a source', r.body.events.every(e => e.source))
ok('every event has coordinates', r.body.events.every(e => Number.isFinite(e.lat) && Number.isFinite(e.lon)))
ok('seeded events invent no price', r.body.events.filter(e => e.source === 'seed').every(e => e.priceMin == null))
ok('seeded events invent no ticket link', r.body.events.filter(e => e.source === 'seed').every(e => !e.ticketUrl))
ok('no event already finished', r.body.events.every(e => e.startsAt > Date.now() - 36e5 * 48))

console.log('\n— filters —')
r = await anon.fetch('/api/events?free=1')
ok('free filter returns only free', r.status === 200 && r.body.events.every(e => e.isFree))
r = await anon.fetch('/api/events?category=music')
ok('category filter works', r.status === 200 && r.body.events.every(e => e.category === 'music'))
r = await anon.fetch('/api/events?category=nonsense')
ok('bad category is ignored, not fatal', r.status === 200)

console.log('\n— create —')
const starts = Date.now() + 3 * 86400000
const payload = {
  title: 'End to end test event',
  description: 'Created by the automated check.',
  category: 'food',
  venueName: 'Test Venue, Bandra',
  lat: 19.0596, lon: 72.8295,
  startsAt: starts, endsAt: starts + 7200000,
  isFree: true,
}
r = await anon.fetch('/api/events', { method: 'POST', body: JSON.stringify(payload) })
ok('anonymous cannot create', r.status === 401, `${r.status}`)

r = await a.fetch('/api/events', { method: 'POST', body: JSON.stringify(payload) })
ok('member can create', r.status === 201 && r.body?.id, JSON.stringify(r.body))
const id = r.body?.id
ok('create opens a chat room', !!r.body?.roomId)

r = await a.fetch('/api/events', { method: 'POST', body: JSON.stringify({ ...payload, lat: 28.61, lon: 77.20 }) })
ok('out-of-area event rejected', r.status === 400, `${r.status}`)
r = await a.fetch('/api/events', { method: 'POST', body: JSON.stringify({ ...payload, startsAt: Date.now() - 86400000 }) })
ok('past event rejected', r.status === 400, `${r.status}`)
r = await a.fetch('/api/events', { method: 'POST', body: JSON.stringify({ ...payload, title: '' }) })
ok('empty title rejected', r.status === 400, `${r.status}`)

console.log('\n— detail + join + chat —')
r = await anon.fetch(`/api/events/${id}`)
ok('anonymous can read detail', r.status === 200 && r.body?.id === id, JSON.stringify(r.body).slice(0,120))
ok('created event is source=community', r.body?.source === 'community')
ok('creator is the sole attendee', r.body?.going === 1, `going=${r.body?.going}`)

r = await b.fetch(`/api/events/${id}/join`, { method: 'POST' })
ok('member can join', r.status === 200, JSON.stringify(r.body))
const roomId = r.body?.roomId ?? null
r = await anon.fetch(`/api/events/${id}`)
ok('going count went up', r.body?.going === 2, `going=${r.body?.going}`)
ok('attendee list is exposed', Array.isArray(r.body?.attendees) && r.body.attendees.length === 2)

r = await b.fetch(`/api/events/${id}`)
ok('joiner sees a room id', !!r.body?.roomId, JSON.stringify(r.body?.roomId))
const room = r.body?.roomId ?? roomId
if (room) {
  r = await b.fetch(`/api/rooms/${room}/messages`, { method: 'POST', body: JSON.stringify({ body: 'see you there' }) })
  ok('attendee can post to the event chat', r.status === 200 || r.status === 201, JSON.stringify(r.body))
  r = await a.fetch(`/api/rooms/${room}/messages`)
  ok('creator sees the message', r.status === 200 && r.body?.messages?.some(m => m.body === 'see you there' || m.text === 'see you there'))
  r = await anon.fetch(`/api/rooms/${room}/messages`)
  ok('non-attendee is shut out of the chat', r.status === 401 || r.status === 403, `${r.status}`)
} else { fail += 3; console.log('  FAIL chat tests — no room id') }

r = await b.fetch(`/api/events/${id}/leave`, { method: 'POST' })
ok('member can leave', r.status === 200)
r = await anon.fetch(`/api/events/${id}`)
ok('going count went down', r.body?.going === 1, `going=${r.body?.going}`)

console.log('\n— delete —')
r = await b.fetch(`/api/events/${id}/delete`, { method: 'POST' })
ok('non-creator cannot delete', r.status === 403, `${r.status}`)
r = await a.fetch(`/api/events/${id}/delete`, { method: 'POST' })
ok('creator can delete', r.status === 200, JSON.stringify(r.body))
r = await anon.fetch(`/api/events/${id}`)
ok('deleted event is gone', r.status === 404, `${r.status}`)

console.log('\n— refresh / sources —')
r = await a.fetch('/api/events/refresh', { method: 'POST' })
ok('refresh runs', r.status === 200, JSON.stringify(r.body))
console.log(`       refresh said: ${JSON.stringify(r.body)}`)
r = await anon.fetch('/api/events')
ok('refresh does not duplicate rows', new Set(r.body.events.map(e => e.source + '|' + e.title + '|' + e.startsAt)).size === r.body.events.length, `${r.body.events.length} rows`)

console.log('\n— imported source integrity —')
r = await anon.fetch('/api/events')
const luma = r.body.events.filter(e => e.source === 'luma')
if (luma.length === 0) {
  console.log('  --   no Luma events imported (source unreachable?) — skipping its checks')
} else {
  ok('Luma events are inside the service area',
     luma.every(e => e.lat > 18.8 && e.lat < 19.4 && e.lon > 72.7 && e.lon < 73.1))
  // Luma's discovery feed marks every event free with a null price, including
  // paid conferences. Importing that verbatim would put "Free" on a ticketed
  // summit, so the adapter must drop it and say nothing instead.
  ok('no Luma event is claimed to be free', luma.every(e => !e.isFree))
  ok('every Luma event links to its page', luma.every(e => e.ticketUrl?.startsWith('https://lu.ma/')))
  ok('Luma events carry a real venue', luma.every(e => e.venueName && e.venueName.length > 1))
  ok('Luma events are categorised', luma.every(e => e.category))
  console.log(`       ${luma.length} Luma events, ${new Set(luma.map(e => e.category)).size} categories`)
}
const ae = r.body.events.filter(e => e.source === 'allevents')
if (ae.length === 0) {
  console.log('  --   no AllEvents listings imported (source unreachable?) — skipping its checks')
} else {
  ok('AllEvents listings are inside the service area',
     ae.every(e => e.lat > 18.8 && e.lat < 19.4 && e.lon > 72.7 && e.lon < 73.1))
  ok('every AllEvents listing links to its page', ae.every(e => e.ticketUrl?.startsWith('https://')))
  // The listing pages give a date but no clock time. Rendering that as midnight
  // would be a fabricated time, so the row must say the time is unknown.
  ok('date-only listings are flagged, not faked', ae.every(e => e.timeKnown === false))
  // Titles arrive HTML-escaped because the JSON-LD is embedded in a page.
  ok('no HTML entities leak into titles',
     ae.every(e => !/&(amp|lt|gt|quot|apos|#\d+);/.test(e.title)), ae.find(e => /&amp;/.test(e.title))?.title ?? '')
  ok('prices, where given, are positive', ae.every(e => e.priceMin == null || e.priceMin >= 0))
  console.log(`       ${ae.length} AllEvents listings, ${ae.filter(e => e.priceMin != null).length} with a real price`)
}

ok('no duplicate external ids', (() => {
  const keys = r.body.events.filter(e => e.source !== 'community').map(e => e.source + '|' + e.title + '|' + e.startsAt)
  return new Set(keys).size === keys.length
})())

const bySource = {}
for (const e of r.body.events) bySource[e.source] = (bySource[e.source] || 0) + 1
console.log(`\n  sources on the board: ${JSON.stringify(bySource)}`)
const titles = new Set(r.body.events.map(e => e.title))
console.log(`  distinct titles: ${titles.size}`)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
