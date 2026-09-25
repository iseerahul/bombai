/**
 * Build the landing app and fold it into the map app's `dist/`.
 *
 *   node scripts/build-landing.mjs
 *
 * The product is two separate Vite apps served from one Cloudflare origin:
 *
 *   dist/index.html      the landing (this script)      →  /
 *   dist/assets/*        its images, CSS and JS
 *   dist/app/index.html  the map (`vite build`)         →  /app/
 *   dist/app/assets/*    its bundle
 *
 * One origin matters for more than tidiness: "Explore Bambai" becomes a
 * same-origin navigation, the session cookie is shared, and there is one
 * `wrangler deploy` rather than two deployments to keep in step.
 *
 * The landing is a TanStack Start app that would normally render on every
 * request. It has no server functions — it is a poster — so its Vite config
 * prerenders it to a single HTML file at build time, which is what makes it
 * servable as plain assets from a Worker that already exists.
 *
 * Copy, never move or sync: `dist/app/` is built first and must survive.
 */

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const landing = join(root, 'landing')
const legacy = join(root, 'mumbai-zenscape')
const dist = join(root, 'dist')

/** The landing lives in its own repo; accept either name for its checkout. */
function landingDir() {
  if (existsSync(landing)) return landing
  if (existsSync(legacy)) return legacy
  throw new Error(
    'No landing app found. Expected ./landing (or ./mumbai-zenscape).' +
      ' It is vendored into this repo, so a normal clone already has it.'
  )
}

function run(command, args, cwd) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      // npm and npx are .cmd shims on Windows, which execvp cannot run directly.
      shell: process.platform === 'win32',
    })
    child.on('error', fail)
    child.on('exit', (code) =>
      code === 0 ? ok() : fail(new Error(`${command} ${args.join(' ')} exited ${code}`))
    )
  })
}

const dir = landingDir()

if (!existsSync(join(dir, 'node_modules'))) {
  console.log('→ installing landing dependencies (first run only)')
  await run('npm', ['install', '--no-audit', '--no-fund'], dir)
}

console.log('→ building the landing')
// Stale prerender output would be copied over the new build otherwise.
await rm(join(dir, '.output'), { recursive: true, force: true })
await run('npx', ['vite', 'build'], dir)

const out = join(dir, '.output', 'public')
if (!existsSync(join(out, 'index.html'))) {
  throw new Error(
    `The landing built but produced no ${join(out, 'index.html')}.\n` +
      'Prerendering is what makes it servable as static files — check that\n' +
      "`prerender: { enabled: true }` is still in the landing's vite.config.ts."
  )
}

console.log('→ copying into dist/')
await mkdir(dist, { recursive: true })

for (const entry of await readdir(out)) {
  const from = join(out, entry)
  const to = join(dist, entry)

  // `dist/app` is the map app, built before this runs. Nothing the landing
  // emits should ever land on top of it, and if a name ever collides the build
  // should stop rather than quietly overwrite the other half of the product.
  if (entry === 'app') {
    throw new Error(
      'The landing emitted an "app" entry, which would overwrite the map app.\n' +
        'Rename it, or change the map\'s base path in vite.config.ts.'
    )
  }

  await cp(from, to, { recursive: true, force: true })
  const size = (await stat(from)).isDirectory() ? '' : ` (${(await stat(from)).size} bytes)`
  console.log(`   ${entry}${size}`)
}

// Origin-wide files last, so they win over anything either app emitted. The
// headers in particular must be dist/_headers to be honoured at all — a
// _headers inside dist/app/ is simply ignored.
const staticDir = join(root, 'static')
if (existsSync(staticDir)) {
  console.log('→ copying static/ (origin-wide headers)')
  for (const entry of await readdir(staticDir)) {
    await cp(join(staticDir, entry), join(dist, entry), { recursive: true, force: true })
    console.log(`   ${entry}`)
  }
}

console.log('\n✓ dist/ now holds the landing at / and the map at /app/')
