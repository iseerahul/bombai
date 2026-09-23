const BASE = 'http://127.0.0.1:8787'
let pass = 0, fail = 0
const ok = (n, c, x='') => { if (c) { pass++; console.log(`  ok   ${n}`) } else { fail++; console.log(`  FAIL ${n} ${x}`) } }
function jar() { let cookie=''
  return { async fetch(p, init={}) {
    const r = await fetch(BASE+p, { ...init, headers:{ 'content-type':'application/json', ...(cookie?{cookie}:{}) , ...(init.headers||{})}, redirect:'manual' })
    const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]
    let b = null; try { b = await r.json() } catch {}
    return { status: r.status, body: b } } } }
const a = jar(), b = jar()

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

await a.fetch('/api/auth/dev',{method:'POST',body:JSON.stringify({name:'Ann Trip'})})
await b.fetch('/api/auth/dev',{method:'POST',body:JSON.stringify({name:'Ben Trip'})})

const soon = Date.now() + 14*86400000
let r = await a.fetch('/api/social/trips',{method:'POST',body:JSON.stringify({
  destination:'Thailand', country:'Thailand', startsOn:soon, endsOn:soon+5*86400000, note:'Islands' })})
ok('A creates a trip', r.status===200||r.status===201, JSON.stringify(r.body))
const tripId = r.body?.id ?? r.body?.tripId
ok('creating returns a room', !!r.body?.roomId, JSON.stringify(r.body))

r = await a.fetch('/api/social/trips')
const mine = r.body?.trips?.find(t=>t.id===tripId)
ok('A sees it as theirs', mine?.isMine === true)

// The bug: the owner had no way to open their own trip's chat.
r = await a.fetch(`/api/social/trips/${tripId}/join`,{method:'POST'})
ok('owner can open their own trip chat', r.status===200 && !!r.body?.roomId, JSON.stringify(r.body))

r = await b.fetch(`/api/social/trips/${tripId}/join`,{method:'POST'})
ok('B joins', r.status===200 && !!r.body?.roomId)

r = await a.fetch(`/api/social/trips/${tripId}/leave`,{method:'POST'})
ok('owner cannot leave their own trip', r.status===400, `${r.status}`)

r = await b.fetch(`/api/social/trips/${tripId}/leave`,{method:'POST'})
ok('B can leave', r.status===200 && r.body?.left===true, JSON.stringify(r.body))

r = await b.fetch(`/api/social/trips/${tripId}/delete`,{method:'POST'})
ok('non-owner cannot delete', r.status===403, `${r.status}`)

r = await a.fetch(`/api/social/trips/${tripId}/delete`,{method:'POST'})
ok('owner can delete', r.status===200 && r.body?.deleted===true, JSON.stringify(r.body))

r = await a.fetch('/api/social/trips')
ok('trip is gone', !(r.body?.trips??[]).some(t=>t.id===tripId))

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail?1:0)
