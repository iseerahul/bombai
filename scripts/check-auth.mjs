/**
 * Tell me whether Google sign-in is actually going to work.
 *
 *   node scripts/check-auth.mjs
 *
 * The failure modes here are all silent-and-confusing: a client id that looks
 * fine but is rejected as a placeholder, a redirect URI that differs from the
 * registered one by a single character, an origin mismatch that only shows up
 * as an opaque Google error page. Each check below prints the specific thing
 * that is wrong rather than "auth failed".
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const API = 'http://127.0.0.1:8787'

let problems = 0
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
const bad = (msg, fix) => {
  problems++
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
  if (fix) console.log(`      → ${fix}`)
}

console.log('\nChecking Google sign-in setup\n')

// --- 1. the file ---
const path = join(ROOT, '.dev.vars')
if (!existsSync(path)) {
  bad('.dev.vars is missing', 'Create it in the project root.')
  process.exit(1)
}

const vars = {}
for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq < 1) continue
  vars[t.slice(0, eq).replace(/^﻿/, '').trim()] = t.slice(eq + 1).trim()
}

// --- 2. client id ---
const id = vars.GOOGLE_CLIENT_ID ?? ''
if (!id || id.startsWith('PASTE')) {
  bad('GOOGLE_CLIENT_ID is still the placeholder', 'Paste the Client ID from Google.')
} else if (!id.endsWith('.apps.googleusercontent.com')) {
  bad(
    'GOOGLE_CLIENT_ID does not end in .apps.googleusercontent.com',
    'That is not a web client id — check you copied the Client ID, not the project id.'
  )
} else {
  ok(`Client ID looks right (…${id.slice(-32)})`)
}

// --- 3. secret ---
const secret = vars.GOOGLE_CLIENT_SECRET ?? ''
if (!secret || secret.startsWith('PASTE')) {
  bad('GOOGLE_CLIENT_SECRET is still the placeholder', 'Paste the Client secret.')
} else if (secret.length <= 10) {
  // The Worker applies exactly this rule, so mirror it rather than guess.
  bad(
    `GOOGLE_CLIENT_SECRET is only ${secret.length} characters`,
    'The Worker treats anything this short as a placeholder and disables sign-in.'
  )
} else {
  ok('Client secret is present')
}

// --- 4. origin ---
const origin = (vars.APP_ORIGIN ?? '').replace(/\/$/, '')
if (!origin) {
  bad('APP_ORIGIN is not set', 'Set it to the address you open in the browser.')
} else {
  ok(`APP_ORIGIN is ${origin}`)
  console.log(`      Redirect URI Google must have registered, exactly:`)
  console.log(`      \x1b[36m${origin}/api/auth/callback\x1b[0m`)
}

// --- 5. what the running Worker thinks ---
try {
  const res = await fetch(`${API}/api/auth/me`, { signal: AbortSignal.timeout(4000) })
  const body = await res.json()
  if (body.configured) {
    ok('The running Worker accepts these credentials')
  } else {
    bad(
      'The running Worker still reports configured: false',
      problems > 0
        ? 'Fix the above, then restart: node scripts/dev-server.mjs'
        : 'Restart the API so it re-reads .dev.vars: node scripts/dev-server.mjs'
    )
  }
  if (body.devLogin) {
    console.log(
      '\n  \x1b[33m!\x1b[0m Dev name-login is still active, which means Google is NOT configured.'
    )
    console.log('    It switches off automatically once real credentials are accepted.')
  }
} catch {
  bad('Could not reach the API on :8787', 'Start it: node scripts/dev-server.mjs')
}

console.log(
  problems === 0
    ? '\n\x1b[32mReady.\x1b[0m Open the app, tap "Been here", and you should reach Google.\n'
    : `\n${problems} thing${problems === 1 ? '' : 's'} to fix.\n`
)
