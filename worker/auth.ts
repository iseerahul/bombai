/**
 * Google sign-in and sessions, for the hangout app only.
 *
 * The public side of this project (Ask / Trip) has no session, no user id and
 * no access to any of this. Signing in is what you do to meet people, not what
 * you do to look at a map — that separation is the whole reason the two apps
 * are split.
 *
 * What is kept from Google: the stable subject id, a display name, a picture
 * URL and (optionally) an email. No access or refresh token is ever stored, so
 * this app cannot act on anyone's Google account afterwards.
 */

import { type Env, json, sha256Hex } from './lib'

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

const SESSION_COOKIE = 'cm_session'
const STATE_COOKIE = 'cm_oauth_state'
const SESSION_DAYS = 30

export interface User {
  id: string
  name: string
  avatarUrl: string | null
  age: number | null
  city: string | null
  bio: string | null
  email: string | null
}

/**
 * Whether sign-in can actually work.
 *
 * A non-empty value isn't enough: `.dev.vars` ships with placeholders, and a
 * truthy placeholder would render the sign-in button and then fail at Google
 * with an opaque error. Real Google web client ids always end in
 * `.apps.googleusercontent.com`.
 */
function oauthCreds(env: Env): { id: string; secret: string } | null {
  const id = env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const secret = env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
  if (!id.endsWith('.apps.googleusercontent.com') || secret.length <= 10) return null
  // Returning the pair rather than a boolean means callers get non-optional
  // strings, so the type checker enforces the check instead of trusting it.
  return { id, secret }
}

/**
 * Whether the local development sign-in may be used.
 *
 * Three conditions, all required, and it fails closed:
 *   1. Google OAuth is NOT configured. The moment real credentials exist this
 *      returns false, so the shortcut cannot linger beside working auth.
 *   2. APP_ORIGIN is explicitly plain-HTTP localhost. A deployed app is https
 *      and a missing APP_ORIGIN is the empty string — both fail the test.
 *   3. It is only ever reachable through this one endpoint, which 404s
 *      otherwise, so a probe cannot even tell it exists.
 *
 * This is a scaffold for building the app before Google Cloud is set up. It is
 * not an auth mechanism: anyone who can reach it can become anyone.
 */
function devLoginAllowed(env: Env): boolean {
  // Set by the Node shim when it is bound to a public interface, which is
  // every container. Fails closed: a deployment has to ask for the bypass
  // rather than inherit it from a default APP_ORIGIN nobody changed.
  if (env.DEV_LOGIN_DISABLED === '1') return false
  if (oauthCreds(env)) return false
  const origin = (env.APP_ORIGIN ?? '').trim()
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

function cookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean }
): string {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // Lax rather than Strict: the OAuth callback is a top-level navigation from
    // Google, and Strict would drop the cookie on the way back in.
    'SameSite=Lax',
    `Max-Age=${opts.maxAge}`,
  ]
  if (opts.secure) bits.push('Secure')
  return bits.join('; ')
}

/**
 * Where the browser is, as opposed to where the Worker is.
 *
 * In development the app is served by Vite on :5173 and proxies /api to the
 * Worker on :8787, so the Worker's own request URL is the wrong origin for an
 * OAuth redirect. APP_ORIGIN settles it explicitly.
 */
function appOrigin(request: Request, env: Env): string {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/$/, '')
  return new URL(request.url).origin
}

function redirectUri(request: Request, env: Env): string {
  return `${appOrigin(request, env)}/api/auth/callback`
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null

  // The cookie holds the raw token; the table holds only its hash, so a leaked
  // database cannot be replayed as a login.
  const hash = await sha256Hex(token)

  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.avatar_url, u.age, u.city, u.bio, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(hash, Date.now())
    .first<{
      id: string
      name: string
      avatar_url: string | null
      age: number | null
      city: string | null
      bio: string | null
      email: string | null
    }>()

  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url,
    age: row.age,
    city: row.city,
    bio: row.bio,
    email: row.email,
  }
}

/** 401 helper for the many endpoints that simply require a signed-in user. */
export function requireUser(user: User | null): Response | null {
  return user ? null : json({ error: 'sign_in_required' }, 401)
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

function startLogin(request: Request, env: Env): Response {
  const creds = oauthCreds(env)
  if (!creds) {
    return json({ error: 'google_oauth_not_configured' }, 503)
  }

  const state = randomToken(16)
  const url = new URL(GOOGLE_AUTH)
  url.searchParams.set('client_id', creds.id)
  url.searchParams.set('redirect_uri', redirectUri(request, env))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  // We only need identity once; no refresh token, no offline access.
  url.searchParams.set('prompt', 'select_account')

  const secure = appOrigin(request, env).startsWith('https://')

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      // Ten minutes is plenty to finish a sign-in and short enough to be a poor
      // CSRF target.
      'Set-Cookie': cookie(STATE_COOKIE, state, { maxAge: 600, secure }),
    },
  })
}

/** Decode a JWT payload without verifying the signature. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

async function finishLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expected = readCookie(request, STATE_COOKIE)
  const origin = appOrigin(request, env)
  const secure = origin.startsWith('https://')

  const fail = (reason: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: `${origin}/hangout?auth_error=${reason}` },
    })

  if (url.searchParams.get('error')) return fail('cancelled')
  /*
   * Four distinct failures used to share one name. "bad_state" told you the
   * sign-in broke and nothing about where, and the causes want completely
   * different fixes: a missing cookie is usually a proxy or a Secure-flag
   * problem, a missing code means Google never issued one, and a genuine
   * mismatch is the CSRF case the check exists for.
   */
  if (!code) return fail('no_code')
  if (!state) return fail('no_state_param')
  if (!expected) return fail('no_state_cookie')
  if (state !== expected) return fail('state_mismatch')
  const creds = oauthCreds(env)
  if (!creds) return fail('not_configured')

  let tokenRes: Response
  try {
    tokenRes = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.id,
        client_secret: creds.secret,
        redirect_uri: redirectUri(request, env),
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return fail('google_unreachable')
  }

  if (!tokenRes.ok) return fail('token_exchange_failed')

  const tokens = (await tokenRes.json()) as { id_token?: string }
  if (!tokens.id_token) return fail('no_id_token')

  /*
   * The id_token came straight from Google's token endpoint over TLS, in a
   * server-to-server call authenticated with our client secret. That is the
   * one case where OpenID Connect permits skipping signature verification,
   * because the transport already proves the issuer. Never do this for a token
   * handed to us by a browser.
   */
  const claims = decodeJwtPayload(tokens.id_token)
  const sub = typeof claims?.sub === 'string' ? claims.sub : null
  if (!sub) return fail('bad_id_token')

  const name =
    (typeof claims?.name === 'string' && claims.name.trim()) ||
    (typeof claims?.given_name === 'string' && claims.given_name.trim()) ||
    'Someone'
  const picture = typeof claims?.picture === 'string' ? claims.picture : null
  const email = typeof claims?.email === 'string' ? claims.email : null

  const now = Date.now()
  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?')
    .bind(sub)
    .first<{ id: string }>()

  let userId: string
  if (existing) {
    userId = existing.id
    // Refresh the things Google owns; leave bio/age/city alone, since the user
    // edits those here and shouldn't have them overwritten on every login.
    await env.DB.prepare(
      'UPDATE users SET name = ?, avatar_url = ?, email = ?, last_seen = ? WHERE id = ?'
    )
      .bind(name.slice(0, 60), picture, email, now, userId)
      .run()
  } else {
    userId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(userId, sub, email, name.slice(0, 60), picture, now, now)
      .run()
  }

  const headers = new Headers({ Location: `${origin}/hangout` })
  headers.append('Set-Cookie', await startSession(env, userId, secure))
  // Burn the state cookie.
  headers.append('Set-Cookie', cookie(STATE_COOKIE, '', { maxAge: 0, secure }))

  return new Response(null, { status: 302, headers })
}

/** Issue a session cookie for a user id. Shared by Google and dev sign-in. */
async function startSession(
  env: Env,
  userId: string,
  secure: boolean
): Promise<string> {
  const token = randomToken(32)
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 24 * 60 * 60 * 1000)
    .run()
  return cookie(SESSION_COOKIE, token, {
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure,
  })
}

/**
 * Local-only sign-in: pick a name, get an account.
 *
 * Accounts made this way are prefixed `dev:` so they can never collide with a
 * real Google subject id, and so they are easy to find and delete later.
 */
async function devLogin(request: Request, env: Env): Promise<Response> {
  if (!devLoginAllowed(env)) return json({ error: 'not_found' }, 404)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (name.length < 2) return json({ error: 'bad_name' }, 400)

  // Same name means same account, so reloading doesn't strand you with a new
  // identity every time — and a second name in a private window is a second
  // person, which is how you test two-sided flows locally.
  const sub = `dev:${name.toLowerCase().replace(/\s+/g, '-')}`
  const now = Date.now()

  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?')
    .bind(sub)
    .first<{ id: string }>()

  let userId: string
  if (existing) {
    userId = existing.id
    await env.DB.prepare('UPDATE users SET name = ?, last_seen = ? WHERE id = ?')
      .bind(name, now, userId)
      .run()
  } else {
    userId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_seen)
       VALUES (?, ?, NULL, ?, NULL, ?, ?)`
    )
      .bind(userId, sub, name, now, now)
      .run()
  }

  const setCookie = await startSession(env, userId, false)

  return new Response(JSON.stringify({ ok: true, name }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': setCookie },
  })
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE)
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(await sha256Hex(token))
      .run()
  }
  const secure = appOrigin(request, env).startsWith('https://')
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure }),
    },
  })
}

async function updateProfile(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 60)
      : user.name

  const ageRaw = Number(body.age)
  // Under-18s are out of scope for a strangers-meeting app; the field simply
  // won't accept it rather than silently storing something unusable.
  const age =
    Number.isInteger(ageRaw) && ageRaw >= 18 && ageRaw <= 120 ? ageRaw : null

  const city =
    typeof body.city === 'string' && body.city.trim()
      ? body.city.trim().slice(0, 60)
      : null

  const bio =
    typeof body.bio === 'string' && body.bio.trim()
      ? body.bio.trim().slice(0, 300)
      : null

  await env.DB.prepare(
    'UPDATE users SET name = ?, age = ?, city = ?, bio = ?, last_seen = ? WHERE id = ?'
  )
    .bind(name, age, city, bio, Date.now(), user.id)
    .run()

  return json({ ...user, name, age, city, bio })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function routeAuth(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  // `/api/avatar/...` is served here too, since it is the same storage.
  if (!url.pathname.startsWith('/api/auth') && !url.pathname.startsWith('/api/avatar/')) {
    return null
  }

  if (url.pathname === '/api/auth/google' && request.method === 'GET') {
    return startLogin(request, env)
  }

  if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
    return finishLogin(request, env)
  }

  if (url.pathname === '/api/auth/dev' && request.method === 'POST') {
    return devLogin(request, env)
  }

  /**
   * Upload a profile picture.
   *
   * Google gives us one at sign-in, but that is Google's picture, not the
   * user's choice — and someone who signed in with a work account or an empty
   * profile has nothing. The avatar shows on every activity bubble and every
   * chat line, so being unable to change it is the difference between the app
   * feeling like yours and feeling like a form.
   *
   * Stored in R2 under a fresh id each time, so a changed picture never has to
   * bust a cache: the URL itself changes.
   */
  if (url.pathname === '/api/auth/avatar' && request.method === 'POST') {
    const user = await currentUser(request, env)
    const denied = requireUser(user)
    if (denied) return denied
    if (!env.PHOTOS) return json({ error: 'photo_storage_unconfigured' }, 503)

    const me = user as User
    const type = request.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return json({ error: 'not_an_image' }, 400)

    const bytes = await request.arrayBuffer()
    if (bytes.byteLength === 0) return json({ error: 'empty' }, 400)
    // The client squares and re-encodes to ~512px before sending; anything
    // much bigger did not come from our own pipeline.
    if (bytes.byteLength > 1024 * 1024) return json({ error: 'too_large' }, 413)

    const objKey = `avatars/${me.id}/${crypto.randomUUID()}.jpg`
    await env.PHOTOS.put(objKey, bytes, {
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })

    const publicUrl = `/api/avatar/${objKey.split('/').slice(1).join('/')}`
    await env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?')
      .bind(publicUrl, me.id)
      .run()

    return json({ avatarUrl: publicUrl })
  }

  /** Serve an avatar. Immutable, because the id changes when the picture does. */
  const avatar = url.pathname.match(/^\/api\/avatar\/([0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.jpg)$/)
  if (avatar && request.method === 'GET') {
    if (!env.PHOTOS) return json({ error: 'not_found' }, 404)
    const object = await env.PHOTOS.get(`avatars/${avatar[1]}`)
    if (!object) return json({ error: 'not_found' }, 404)
    return new Response(object.body, {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    return logout(request, env)
  }

  if (url.pathname === '/api/auth/me') {
    const user = await currentUser(request, env)

    if (request.method === 'GET') {
      return json({
        user,
        // Lets the sign-in screen say "not set up yet" instead of failing at
        // the moment someone taps the button.
        configured: oauthCreds(env) !== null,
        // Only true on a local machine with Google not yet set up. The UI shows
        // the name-only shortcut solely when the server says this.
        devLogin: devLoginAllowed(env),
      })
    }

    if (request.method === 'POST') {
      const denied = requireUser(user)
      if (denied) return denied
      return updateProfile(request, env, user as User)
    }
  }

  return json({ error: 'not_found' }, 404)
}

/** Cron: drop expired sessions. */
export async function sweepSessions(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run()
}
