/*
 * The design's images came straight off Lovable at full size: 15 MB in the
 * source tree, 11.2 MB shipped. This app's audience is on 4G in Mumbai, and a
 * landing page is the one screen where a slow first paint costs you the visit.
 *
 * Caps are ~2x the largest size anything renders at, so retina still has more
 * pixels than it needs. Nothing is upscaled and nothing changes format — the
 * imports keep working untouched.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('This needs sharp, which is dev-only and not worth shipping.')
  console.error('  npm i -D sharp')
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'landing', 'src', 'assets')
// Stickers are cutouts rendered at 150-350px; the hero map is full-bleed.
const cap = (name) =>
  name.startsWith('sticker-') ? 800 : name.includes('map') ? 2000 : 1400

let before = 0
let after = 0

for (const file of (await readdir(dir)).filter((f) => /\.(jpe?g|png)$/i.test(f))) {
  const path = join(dir, file)
  /*
   * Read into memory rather than handing sharp the path. On Windows sharp
   * keeps a handle on the input open while the pipeline is alive, and writing
   * back to the same path then fails with an opaque UNKNOWN error.
   */
  const input = await readFile(path)
  const size = input.length
  before += size

  const img = sharp(input)
  const meta = await img.metadata()
  const width = Math.min(meta.width ?? cap(file), cap(file))

  const out = /\.png$/i.test(file)
    ? await img
        .resize({ width, withoutEnlargement: true })
        // Stickers are flat-ish artwork with alpha: a palette holds up well
        // and is dramatically smaller than truecolour PNG.
        .png({ compressionLevel: 9, palette: true, quality: 82 })
        .toBuffer()
    : await img
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 76, mozjpeg: true })
        .toBuffer()

  // Never make a file bigger than it was.
  if (out.length < size) {
    await writeFile(path, out)
    after += out.length
    console.log(
      `  ${file.padEnd(34)} ${(size / 1024).toFixed(0).padStart(5)} -> ${(out.length / 1024).toFixed(0).padStart(5)} kB  (${meta.width}px -> ${width}px)`
    )
  } else {
    after += size
    console.log(`  ${file.padEnd(34)} left alone (already small)`)
  }
}

console.log(
  `\n  ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB` +
    `  (${(100 - (after / before) * 100).toFixed(0)}% smaller)`
)
