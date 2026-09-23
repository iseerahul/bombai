/**
 * Bundle the Worker to a single JavaScript file.
 *
 *   node scripts/build-worker.mjs   →   dist/worker.mjs
 *
 * `scripts/dev-server.mjs` normally does this itself at every boot, which is
 * right in development — you want the Worker you just edited. A container
 * wants the opposite: the image is immutable, so the bundle is produced once
 * at build time and the runtime is handed the result via `WORKER_BUNDLE`.
 *
 * That is what lets the runtime image drop esbuild, TypeScript and the whole
 * `worker/` source tree.
 *
 * Same esbuild settings as the dev server, deliberately — two bundlers with
 * drifting options would mean the container runs code nobody tested.
 */

import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'worker.mjs')

const result = await build({
  entryPoints: [join(root, 'worker', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  write: false,
  logLevel: 'warning',
  conditions: ['workerd', 'worker', 'browser'],
})

const code = result.outputFiles[0].text
await mkdir(dirname(out), { recursive: true })
await writeFile(out, code, 'utf8')

console.log(`✓ dist/worker.mjs (${(code.length / 1024).toFixed(1)} kB)`)
