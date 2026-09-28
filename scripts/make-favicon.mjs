/*
 * Generate the app's own favicon.
 *
 * The landing shipped Lovable's template icon, which is what showed in the
 * browser tab on the deployed site. The mark is the same red push-pin the map
 * uses for a saved place — it already means "a place I went" everywhere else
 * in the product, and it reads at 16px, which a wordmark would not.
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'

// Squarer and heavier than the map marker: at 16px a long thin needle
// disappears, so the head carries the shape and the needle just anchors it.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0d1b2a"/>
  <defs>
    <radialGradient id="h" cx="34%" cy="28%" r="78%">
      <stop offset="0%" stop-color="#ff7d6b"/>
      <stop offset="45%" stop-color="#f5261a"/>
      <stop offset="100%" stop-color="#ad1109"/>
    </radialGradient>
    <linearGradient id="n" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7c8794"/>
      <stop offset="40%" stop-color="#eef2f6"/>
      <stop offset="100%" stop-color="#68727e"/>
    </linearGradient>
  </defs>
  <path d="M29.6 36 L32 55 L34.4 36 Z" fill="url(#n)"/>
  <circle cx="32" cy="26" r="14" fill="url(#h)"/>
  <ellipse cx="27" cy="20" rx="5.2" ry="3.4" transform="rotate(-38 27 20)" fill="#ffffff" opacity="0.85"/>
</svg>`

const out = 'landing/public'
await mkdir(out, { recursive: true })

for (const size of [32, 180, 512]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `favicon-${size}.png`
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()
  await writeFile(`${out}/${name}`, buf)
  console.log(`  ${name.padEnd(24)} ${(buf.length / 1024).toFixed(1)} kB`)
}
await writeFile(`${out}/favicon.svg`, svg.trim())
console.log('  favicon.svg              vector, used where supported')
