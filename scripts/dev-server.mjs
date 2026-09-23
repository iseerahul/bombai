/**
 * A plain-Node stand-in for `wrangler dev`.
 *
 *   node scripts/dev-server.mjs [--port=8787]
 *
 * Why this exists: `wrangler dev` runs the Worker inside `workerd.exe`, and on
 * some managed Windows machines Smart App Control / WDAC blocks that binary
 * outright ("An Application Control policy has blocked this file"). Moving the
 * project does not help — the block is on the binary's signature, not its path
 * — so there is no way to run the real local runtime.
 *
 * Workers are mostly standard Web APIs, and Node has all of the ones this app
 * uses: fetch, Request, Response, Headers, URL, crypto.subtle, and since Node
 * 22 a built-in SQLite. So we bundle the Worker with esbuild, hand it a `env`
 * carrying a D1-shaped wrapper around the *same* SQLite file wrangler uses, and
 * serve the result over node:http.
 *
 * It reads and writes `.wrangler/state/.../*.sqlite`, so data created here is
 * the data `wrangler dev` and `wrangler d1 execute --local` see.
 *
 * Deliberately NOT a Workers emulator. No cron triggers, no Durable Objects, no
 * KV, no cache API, and none of the platform's real limits. It runs this app's
 * routes; deployment correctness is still `wrangler deploy`'s job.
 */

import { createServer } from 'node:http'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = resolve(import.meta.dirname, '..')
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : fallback
}
const PORT = Number(arg('port', '8787'))
const DIST = join(ROOT, 'dist')

// ---------------------------------------------------------------------------
// Secrets — the same .dev.vars wrangler reads
// ---------------------------------------------------------------------------

function loadDevVars() {
  const path = join(ROOT, '.dev.vars')
  if (!existsSync(path)) return {}
  const vars = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    // Strip a BOM on the first key, and surrounding quotes on any value.
    const key = trimmed.slice(0, eq).replace(/^﻿/, '').trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    vars[key] = value
  }
  return vars
}

// ---------------------------------------------------------------------------
// D1 shim over the local SQLite file
// ---------------------------------------------------------------------------

/**
 * Where persistent state lives.
 *
 * Defaults to the same `.wrangler/state` tree wrangler uses, so this shares a
 * database with `wrangler d1 execute --local`. In a container there is no
 * wrangler and no repo checkout to write into, so DATA_DIR points at a mounted
 * volume — otherwise every account, photo and pin dies with the container.
 */
const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : join(ROOT, '.wrangler', 'state')

function findLocalD1() {
  const dir = join(DATA_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  if (!existsSync(dir)) return null
  // The database file is the long hex one; metadata.sqlite is wrangler's own.
  const candidates = readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).size - statSync(a).size)
  return candidates[0] ?? null
}

/**
 * The slice of the D1 API this Worker actually uses.
 *
 * `prepare().bind().all()/first()/run()` plus `batch()` and `exec()`. Results
 * are shaped like D1's ({ results, success, meta }) because the Worker reads
 * `.results` directly.
 */
function makeD1(db) {
  const runOne = (sql, params) => {
    const statement = db.prepare(sql)
    const isRead = /^\s*(SELECT|WITH|PRAGMA)/i.test(sql)
    if (isRead) {
      const results = statement.all(...params)
      return { results, success: true, meta: { changes: 0, last_row_id: 0 } }
    }
    const info = statement.run(...params)
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0),
      },
    }
  }

  function prepare(sql) {
    let bound = []
    const api = {
      bind(...params) {
        // D1 rejects undefined; SQLite wants null.
        bound = params.map((p) => (p === undefined ? null : p))
        return api
      },
      async all() {
        return runOne(sql, bound)
      },
      async first(column) {
        const { results } = runOne(sql, bound)
        const row = results[0]
        if (!row) return null
        return column ? (row[column] ?? null) : row
      },
      async run() {
        return runOne(sql, bound)
      },
      async raw() {
        const { results } = runOne(sql, bound)
        return results.map((r) => Object.values(r))
      },
    }
    return api
  }

  return {
    prepare,
    async batch(statements) {
      // D1 batches are atomic; mirror that so a half-applied batch can't happen.
      db.exec('BEGIN')
      try {
        const out = []
        for (const s of statements) out.push(await s.run())
        db.exec('COMMIT')
        return out
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    async exec(sql) {
      db.exec(sql)
      return { count: 0, duration: 0 }
    },
  }
}

// ---------------------------------------------------------------------------
// R2 shim — photos on the filesystem
// ---------------------------------------------------------------------------

/**
 * The slice of the R2 API the Worker uses: put, get, delete, head.
 *
 * Objects land under .wrangler/state/r2/<bucket>/ with the key's slashes turned
 * into directories, so the layout on disk mirrors the object keys and a stray
 * upload is easy to find and delete by hand.
 */
function makeR2(root) {
  const pathFor = (key) => join(root, key.replace(/\.\./g, '_'))

  return {
    async put(key, value, options = {}) {
      const file = pathFor(key)
      mkdirSync(dirname(file), { recursive: true })
      const bytes = value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value)
      writeFileSync(file, bytes)
      writeFileSync(`${file}.meta.json`, JSON.stringify(options.httpMetadata ?? {}))
      return { key, size: bytes.length }
    },
    async get(key) {
      const file = pathFor(key)
      if (!existsSync(file)) return null
      const bytes = readFileSync(file)
      return {
        key,
        size: bytes.length,
        body: bytes,
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        },
      }
    },
    async head(key) {
      const file = pathFor(key)
      if (!existsSync(file)) return null
      return { key, size: statSync(file).size }
    },
    async delete(key) {
      const file = pathFor(key)
      if (existsSync(file)) rmSync(file, { force: true })
      if (existsSync(`${file}.meta.json`)) rmSync(`${file}.meta.json`, { force: true })
    },
  }
}

// ---------------------------------------------------------------------------
// Static assets (what [assets] does in production)
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function fileAt(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return null
  return { body: readFileSync(path), type: MIME[extname(path)] ?? 'application/octet-stream' }
}

/*
 * Two front ends live in dist/: the landing at / and the map at /app/. A
 * request for a *directory* therefore has to resolve to the index.html inside
 * it, the way Cloudflare's asset handling does. Without that, "/app/" matches
 * no file, falls through to the SPA shell, and serves the landing page where
 * the map should be.
 */
function serveAsset(pathname) {
  if (pathname.includes('..')) return null
  const rel = pathname.replace(/^\/+/, '')
  const target = join(DIST, rel)

  const direct = fileAt(target)
  if (direct) return direct

  if (rel === '' || (existsSync(target) && statSync(target).isDirectory())) {
    const index = fileAt(join(target, 'index.html'))
    if (index) return index
  }

  // Single-page app: unknown non-file paths fall back to the shell.
  return fileAt(join(DIST, 'index.html'))
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/*
 * A prebuilt bundle lets the container image ship without esbuild, the
 * TypeScript sources or a build toolchain — it is handed the JavaScript the
 * build already produced. Unset in development, where rebundling on every
 * start is exactly what you want.
 */
const prebuilt = process.env.WORKER_BUNDLE ? resolve(process.env.WORKER_BUNDLE) : null

async function bundleWorker() {
  console.log('Bundling the Worker...')
  // Imported here rather than at the top so the container image, which is
  // handed a prebuilt bundle, does not need esbuild installed at all.
  const { build } = await import('esbuild')
  const bundle = await build({
    entryPoints: [join(ROOT, 'worker', 'index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'warning',
    conditions: ['workerd', 'worker', 'browser'],
  })
  return bundle.outputFiles[0].text
}

let code
if (prebuilt) {
  if (!existsSync(prebuilt)) {
    console.error(`WORKER_BUNDLE is set but ${prebuilt} does not exist.`)
    process.exit(1)
  }
  console.log(`Using prebuilt Worker bundle: ${prebuilt}`)
  code = readFileSync(prebuilt, 'utf8')
} else {
  code = await bundleWorker()
}
const module = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
)
const worker = module.default
if (typeof worker?.fetch !== 'function') {
  throw new Error('worker/index.ts does not default-export a { fetch } handler')
}

let dbPath = findLocalD1()
if (!dbPath) {
  /*
   * No database yet. Inside a container there is no wrangler to create one,
   * and an empty mounted volume on first boot is the normal case rather than
   * an error — so build it from the schema and carry on.
   */
  const schema = join(ROOT, 'worker', 'schema.sql')
  if (!existsSync(schema)) {
    console.error('No D1 database, and no worker/schema.sql to create one from.')
    process.exit(1)
  }
  const dir = join(DATA_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  mkdirSync(dir, { recursive: true })
  dbPath = join(dir, 'civic-reports.sqlite')
  console.log('No database found - creating one from worker/schema.sql')
  const fresh = new DatabaseSync(dbPath)
  fresh.exec(readFileSync(schema, 'utf8'))
  fresh.close()
}
const sqlite = new DatabaseSync(dbPath)
const photoRoot = join(DATA_DIR, 'r2', 'mumbai-civic-photos')
mkdirSync(photoRoot, { recursive: true })
/*
 * Bindings, in increasing precedence.
 *
 * The process environment comes first so a container can supply secrets the
 * ordinary way (`docker run -e`, compose, a secret store) with no .dev.vars
 * file in the image. A local .dev.vars still wins over it, which keeps
 * development behaving exactly as it did. DB and PHOTOS are set last so no
 * stray host variable of the same name can displace a binding.
 */
const env = {
  ...process.env,
  ...loadDevVars(),
  DB: makeD1(sqlite),
  PHOTOS: makeR2(photoRoot),
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.warn('! dist/ has no index.html — run `npm run build` to serve the app.')
}

const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}), passThroughOnException() {} }

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `127.0.0.1:${PORT}`}`)

  // Assets first for everything that is not an API call, matching the
  // production config where the Worker only runs first on /api/*.
  if (!url.pathname.startsWith('/api/')) {
    const asset = serveAsset(url.pathname)
    if (asset) {
      res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache' })
      res.end(asset.body)
      return
    }
  }

  let body
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    body = Buffer.concat(chunks)
    if (body.length === 0) body = undefined
  }

  const request = new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) =>
      v == null ? [] : Array.isArray(v) ? v.map((one) => [k, one]) : [[k, v]]
    ),
    body,
  })

  try {
    const response = await worker.fetch(request, env, ctx)
    const headers = {}
    // Several Set-Cookie headers must survive as separate values.
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []
    for (const [k, v] of response.headers) {
      if (k.toLowerCase() === 'set-cookie' && cookies.length) continue
      headers[k] = v
    }
    if (cookies.length) headers['set-cookie'] = cookies
    res.writeHead(response.status, headers)
    const buffer = Buffer.from(await response.arrayBuffer())
    res.end(buffer)
  } catch (err) {
    console.error(`${req.method} ${url.pathname} →`, err)
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'dev_server_error', detail: String(err?.message ?? err) }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Worker (Node shim)  http://127.0.0.1:${PORT}`)
  console.log(`  D1                  ${dbPath.replace(ROOT, '.')}`)
  console.log(`  Secrets             ${Object.keys(loadDevVars()).length} from .dev.vars`)
  console.log(`  Photos (R2 shim)    ${photoRoot.replace(ROOT, '.')}`)
  console.log(`\n  Not workerd: no cron, no DO/KV, no platform limits.\n`)
})
