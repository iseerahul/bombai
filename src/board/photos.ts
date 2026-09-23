/**
 * Photo handling for visits — resize, re-encode, and read the location out
 * before it's discarded.
 *
 * Two things make this necessary rather than optional:
 *
 * 1. **Size.** A photo straight off a modern phone is 3–12 MB. Uploading those
 *    raw would burn through a storage free tier in a few hundred visits and
 *    would be unusable on the 4G connection this app targets. Re-encoding to a
 *    1600px long edge at quality 0.8 typically lands at 200–400 KB — a 10–30×
 *    reduction with no visible loss at the sizes we display.
 *
 * 2. **The pin.** Phone photos usually carry GPS in EXIF. Reading it means a
 *    visit can place itself: pick a photo, and the pin lands where the photo was
 *    taken rather than where you happen to be standing when you add it. Canvas
 *    re-encoding strips EXIF as a side effect, so this has to happen on the
 *    original bytes, before compression.
 */

export interface PreparedPhoto {
  /** Re-encoded JPEG, ready to upload. */
  blob: Blob
  /** Object URL for immediate preview. Revoke when the component unmounts. */
  previewUrl: string
  width: number
  height: number
  bytes: number
  /** From EXIF, when the photo carried it. Null otherwise. */
  takenAt: number | null
  coords: { lat: number; lon: number } | null
}

const MAX_EDGE = 1600
const QUALITY = 0.8
/** Anything larger is almost certainly not a phone photo. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024

// ---------------------------------------------------------------------------
// EXIF
// ---------------------------------------------------------------------------

/**
 * Minimal EXIF reader: GPS coordinates and capture time, nothing else.
 *
 * Walks the JPEG APP1 segment by hand rather than pulling in a library — we
 * need four tags, and an EXIF parser is a large dependency to ship to a phone
 * for that. Every failure path returns nulls; a photo with no EXIF, truncated
 * EXIF, or an unexpected layout is normal input, not an error.
 */
function readExif(buffer: ArrayBuffer): {
  coords: { lat: number; lon: number } | null
  takenAt: number | null
} {
  const empty = { coords: null, takenAt: null }
  try {
    const view = new DataView(buffer)
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return empty // not a JPEG

    // --- find the APP1 (Exif) segment ---
    let offset = 2
    let app1 = -1
    while (offset < view.byteLength - 4) {
      if (view.getUint8(offset) !== 0xff) break
      const marker = view.getUint8(offset + 1)
      const size = view.getUint16(offset + 2)
      if (marker === 0xe1) {
        app1 = offset + 4
        break
      }
      // 0xDA is start-of-scan: image data begins, no more metadata.
      if (marker === 0xda) break
      offset += 2 + size
    }
    if (app1 < 0 || app1 + 14 > view.byteLength) return empty

    // "Exif\0\0"
    if (view.getUint32(app1) !== 0x45786966) return empty

    const tiff = app1 + 6
    const le = view.getUint16(tiff) === 0x4949 // "II" = little-endian
    const u16 = (o: number) => view.getUint16(o, le)
    const u32 = (o: number) => view.getUint32(o, le)

    if (u16(tiff + 2) !== 0x002a) return empty

    const ifd0 = tiff + u32(tiff + 4)
    if (ifd0 + 2 > view.byteLength) return empty

    let gpsIfd = -1
    let exifIfd = -1
    const count0 = u16(ifd0)
    for (let i = 0; i < count0; i++) {
      const entry = ifd0 + 2 + i * 12
      if (entry + 12 > view.byteLength) break
      const tag = u16(entry)
      if (tag === 0x8825) gpsIfd = tiff + u32(entry + 8)
      if (tag === 0x8769) exifIfd = tiff + u32(entry + 8)
    }

    // --- capture time ---
    let takenAt: number | null = null
    if (exifIfd > 0 && exifIfd + 2 <= view.byteLength) {
      const countE = u16(exifIfd)
      for (let i = 0; i < countE; i++) {
        const entry = exifIfd + 2 + i * 12
        if (entry + 12 > view.byteLength) break
        // DateTimeOriginal
        if (u16(entry) === 0x9003) {
          const at = tiff + u32(entry + 8)
          let s = ''
          for (let c = 0; c < 19 && at + c < view.byteLength; c++) {
            s += String.fromCharCode(view.getUint8(at + c))
          }
          // "2026:09:16 14:32:01" → ISO
          const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
          if (m) {
            const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)
            if (Number.isFinite(t)) takenAt = t
          }
          break
        }
      }
    }

    // --- GPS ---
    if (gpsIfd < 0 || gpsIfd + 2 > view.byteLength) return { coords: null, takenAt }

    /** GPS coordinates are three rationals: degrees, minutes, seconds. */
    const readDms = (entryOffset: number): number | null => {
      const at = tiff + u32(entryOffset + 8)
      if (at + 24 > view.byteLength) return null
      let deg = 0
      for (let i = 0; i < 3; i++) {
        const num = u32(at + i * 8)
        const den = u32(at + i * 8 + 4)
        if (den === 0) return null
        deg += num / den / 60 ** i
      }
      return deg
    }
    const readRef = (entryOffset: number): string =>
      String.fromCharCode(view.getUint8(entryOffset + 8))

    let lat: number | null = null
    let lon: number | null = null
    let latRef = 'N'
    let lonRef = 'E'

    const countG = u16(gpsIfd)
    for (let i = 0; i < countG; i++) {
      const entry = gpsIfd + 2 + i * 12
      if (entry + 12 > view.byteLength) break
      switch (u16(entry)) {
        case 0x0001:
          latRef = readRef(entry)
          break
        case 0x0002:
          lat = readDms(entry)
          break
        case 0x0003:
          lonRef = readRef(entry)
          break
        case 0x0004:
          lon = readDms(entry)
          break
      }
    }

    if (lat == null || lon == null) return { coords: null, takenAt }
    if (latRef === 'S') lat = -lat
    if (lonRef === 'W') lon = -lon
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { coords: null, takenAt }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { coords: null, takenAt }

    return { coords: { lat, lon }, takenAt }
  } catch {
    // Malformed EXIF is ordinary input, not an error worth surfacing.
    return empty
  }
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not decode image'))
    img.src = url
  })
}

/**
 * Prepare one picked file for upload.
 *
 * Throws only for input we genuinely cannot use — a non-image, or something so
 * large it is not a photo. Everything else degrades: no EXIF just means no
 * suggested location.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That image is too large to add.')
  }

  const buffer = await file.arrayBuffer()
  const { coords, takenAt } = readExif(buffer)

  const sourceUrl = URL.createObjectURL(file)
  let img: HTMLImageElement
  try {
    img = await loadImage(sourceUrl)
  } catch (err) {
    URL.revokeObjectURL(sourceUrl)
    throw err
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    URL.revokeObjectURL(sourceUrl)
    throw new Error('Your browser could not process that image.')
  }
  ctx.drawImage(img, 0, 0, width, height)
  URL.revokeObjectURL(sourceUrl)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY)
  )
  if (!blob) throw new Error('Your browser could not process that image.')

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width,
    height,
    bytes: blob.size,
    takenAt: takenAt ?? file.lastModified ?? null,
    coords,
  }
}

/** Prepare several files, skipping any that fail rather than losing the batch. */
export async function preparePhotos(
  files: FileList | File[],
  max = 6
): Promise<{ photos: PreparedPhoto[]; errors: string[] }> {
  const photos: PreparedPhoto[] = []
  const errors: string[] = []
  for (const file of Array.from(files).slice(0, max)) {
    try {
      photos.push(await preparePhoto(file))
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'One photo could not be added.')
    }
  }
  return { photos, errors }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Prepare a profile picture: square, centred, small.
 *
 * Avatars are drawn at 24–44 px in chat rows and map bubbles, so 512 is
 * already generous — and unlike visit photos there are many of them on screen
 * at once, so keeping each one small matters more than keeping it sharp.
 *
 * Cropped to a centre square here rather than with CSS `object-fit`, because
 * the bytes get reused everywhere: a rectangular original would need cropping
 * again at every call site, and would waste storage on pixels never shown.
 */
export async function prepareAvatar(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That image is too large.')
  }

  const url = URL.createObjectURL(file)
  let img: HTMLImageElement
  try {
    img = await loadImage(url)
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }

  const SIZE = 512
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    URL.revokeObjectURL(url)
    throw new Error('Your browser could not process that image.')
  }
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)
  URL.revokeObjectURL(url)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  )
  if (!blob) throw new Error('Your browser could not process that image.')

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: SIZE,
    height: SIZE,
    bytes: blob.size,
    takenAt: null,
    coords: null,
  }
}
