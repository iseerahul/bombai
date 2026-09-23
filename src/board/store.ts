/**
 * On-device store for the board.
 *
 * The server side of visits and photos is not built yet, and a feature that
 * loses your photos on reload is not a feature. This keeps visits and their
 * image blobs in IndexedDB so the board works end to end today — add a place,
 * close the tab, come back, it is still there.
 *
 * IndexedDB rather than localStorage because photos are blobs: even at 200–400
 * KB each, base64 in localStorage would exhaust its ~5 MB quota after a dozen
 * visits, and encoding costs a third more bytes again.
 *
 * **This is a staging area, not the destination.** When the API lands, `sync()`
 * is where uploads go, and `remoteId` on each record is what stops a visit
 * being uploaded twice. Everything else in the app talks to this module rather
 * than to IndexedDB directly, so the swap is contained here.
 */

import type { Photo, Visit, VisitDraft } from './types'
import type { PreparedPhoto } from './photos'

const DB_NAME = 'mumbai-board'
const DB_VERSION = 1
const VISITS = 'visits'
const PHOTOS = 'photos'

interface StoredPhoto {
  id: string
  visitId: string
  blob: Blob
  width: number
  height: number
  createdAt: number
}

interface StoredVisit extends Omit<Visit, 'photos'> {
  photoIds: string[]
  /** Set once the server has it. Null means "not uploaded yet". */
  remoteId: string | null
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(VISITS)) {
        db.createObjectStore(VISITS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(PHOTOS)) {
        const store = db.createObjectStore(PHOTOS, { keyPath: 'id' })
        store.createIndex('visitId', 'visitId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the board store.'))
  })
  return dbPromise
}

function tx<T>(
  store: string | string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        let result: T
        t.oncomplete = () => resolve(result)
        t.onerror = () => reject(t.error ?? new Error('Board store write failed.'))
        t.onabort = () => reject(t.error ?? new Error('Board store write aborted.'))
        Promise.resolve(run(t)).then(
          (value) => {
            result = value
          },
          (err) => {
            try {
              t.abort()
            } catch {
              /* already finishing */
            }
            reject(err)
          }
        )
      })
  )
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Object URLs minted for photo blobs, so repeated reads don't leak one per
 * render. Cleared wholesale by `releaseUrls`.
 */
const urlCache = new Map<string, string>()

function urlFor(photo: StoredPhoto): string {
  const existing = urlCache.get(photo.id)
  if (existing) return existing
  const url = URL.createObjectURL(photo.blob)
  urlCache.set(photo.id, url)
  return url
}

export function releaseUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
}

function hydrate(stored: StoredVisit, photos: StoredPhoto[]): Visit {
  const mine = photos
    .filter((p) => p.visitId === stored.id)
    .sort((a, b) => a.createdAt - b.createdAt)
  const shaped: Photo[] = mine.map((p) => ({
    id: p.id,
    url: urlFor(p),
    width: p.width,
    height: p.height,
    byId: null,
    byName: null,
    createdAt: p.createdAt,
  }))
  const { photoIds: _ignored, remoteId: _remote, ...rest } = stored
  return { ...rest, photos: shaped }
}

export async function listVisits(): Promise<Visit[]> {
  return tx([VISITS, PHOTOS], 'readonly', async (t) => {
    const visits = await req(t.objectStore(VISITS).getAll() as IDBRequest<StoredVisit[]>)
    const photos = await req(t.objectStore(PHOTOS).getAll() as IDBRequest<StoredPhoto[]>)
    return visits
      .map((v) => hydrate(v, photos))
      .sort((a, b) => b.visitedAt - a.visitedAt)
  })
}

export async function saveVisit(
  draft: VisitDraft,
  photos: PreparedPhoto[]
): Promise<Visit> {
  const id = crypto.randomUUID()
  const now = Date.now()

  const storedPhotos: StoredPhoto[] = photos.map((p) => ({
    id: crypto.randomUUID(),
    visitId: id,
    blob: p.blob,
    width: p.width,
    height: p.height,
    createdAt: now,
  }))

  const stored: StoredVisit = {
    id,
    poiId: draft.poiId,
    spotId: draft.spotId,
    label: draft.label,
    lat: draft.lat,
    lon: draft.lon,
    category: draft.category,
    visitedAt: draft.visitedAt,
    note: draft.note || null,
    tags: draft.tags,
    published: draft.publishAsSpot,
    createdAt: now,
    photoIds: storedPhotos.map((p) => p.id),
    remoteId: null,
  }

  await tx([VISITS, PHOTOS], 'readwrite', (t) => {
    t.objectStore(VISITS).put(stored)
    const store = t.objectStore(PHOTOS)
    for (const p of storedPhotos) store.put(p)
  })

  return hydrate(stored, storedPhotos)
}

export async function deleteVisit(id: string): Promise<void> {
  await tx([VISITS, PHOTOS], 'readwrite', async (t) => {
    t.objectStore(VISITS).delete(id)
    const index = t.objectStore(PHOTOS).index('visitId')
    const keys = await req(index.getAllKeys(IDBKeyRange.only(id)))
    const store = t.objectStore(PHOTOS)
    for (const key of keys) {
      const photoId = String(key)
      const url = urlCache.get(photoId)
      if (url) {
        URL.revokeObjectURL(url)
        urlCache.delete(photoId)
      }
      store.delete(key)
    }
  })
}

/** Everything, gone. Wired to the "delete my data" control. */
export async function clearBoard(): Promise<void> {
  releaseUrls()
  await tx([VISITS, PHOTOS], 'readwrite', (t) => {
    t.objectStore(VISITS).clear()
    t.objectStore(PHOTOS).clear()
  })
}

/** Roughly how much space the board is using, for the storage line in settings. */
export async function boardBytes(): Promise<number> {
  return tx(PHOTOS, 'readonly', async (t) => {
    const photos = await req(t.objectStore(PHOTOS).getAll() as IDBRequest<StoredPhoto[]>)
    return photos.reduce((sum, p) => sum + p.blob.size, 0)
  })
}

// ---------------------------------------------------------------------------
// Migration off the device
// ---------------------------------------------------------------------------

/**
 * Push anything still sitting in IndexedDB up to the server, once.
 *
 * The local store predates the backend. Visits saved before sign-in existed
 * belong to a browser rather than to a person, which is why they used to stay
 * on the map after logging out. This moves them to the account that is signed
 * in now and clears them locally, so there is exactly one copy and it is the
 * server's.
 *
 * Deliberately best-effort: a visit that fails to upload is left in place to
 * be retried next time rather than dropped. Returns how many moved.
 */
export async function migrateLocalVisits(
  upload: (
    draft: {
      label: string
      lat: number
      lon: number
      poiId: string | null
      spotId: string | null
      category: string | null
      visitedAt: number
      note: string
      tags: string[]
      publishAsSpot: boolean
    },
    photos: { blob: Blob; width: number; height: number }[]
  ) => Promise<unknown>
): Promise<number> {
  const pending = await tx([VISITS, PHOTOS], 'readonly', async (t) => {
    const visits = await req(t.objectStore(VISITS).getAll() as IDBRequest<StoredVisit[]>)
    const photos = await req(t.objectStore(PHOTOS).getAll() as IDBRequest<StoredPhoto[]>)
    return visits
      .filter((v) => !v.remoteId)
      .map((v) => ({ visit: v, photos: photos.filter((p) => p.visitId === v.id) }))
  })

  let moved = 0
  for (const { visit, photos } of pending) {
    try {
      await upload(
        {
          label: visit.label,
          lat: visit.lat,
          lon: visit.lon,
          poiId: visit.poiId,
          spotId: visit.spotId,
          category: visit.category,
          visitedAt: visit.visitedAt,
          note: visit.note ?? '',
          tags: visit.tags,
          publishAsSpot: visit.published,
        },
        photos.map((p) => ({ blob: p.blob, width: p.width, height: p.height }))
      )
      await deleteVisit(visit.id)
      moved++
    } catch {
      // Left in place; next sign-in tries again.
    }
  }
  return moved
}

/** Whether anything is still waiting to be moved. */
export async function localVisitCount(): Promise<number> {
  return tx(VISITS, 'readonly', async (t) => {
    const visits = await req(t.objectStore(VISITS).getAll() as IDBRequest<StoredVisit[]>)
    return visits.filter((v) => !v.remoteId).length
  })
}
