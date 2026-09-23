import type { PreparedPhoto } from './photos'
import type { Visit, VisitDraft } from './types'

/**
 * Visits, server-side.
 *
 * This replaces IndexedDB as the source of truth. The local store was a
 * staging area written before the backend existed, and it had a bug that only
 * showed once real sign-in arrived: a visit belongs to a *person*, but
 * IndexedDB belongs to a *browser*. Signing out left the pins on the map, and
 * anyone else opening the app on that machine saw where you had been.
 *
 * Now the server owns them, scoped to the session, and the local store is kept
 * only long enough to migrate what it already holds.
 */

export class BoardError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'BoardError'
  }
}

const MESSAGES: Record<string, string> = {
  unauthorised: 'Sign in to keep a map of your places.',
  rate_limited: "That's a lot of places at once — try again shortly.",
  outside_service_area: 'That spot is outside Mumbai.',
  too_many_photos: 'Six photos is the limit for one place.',
  too_large: 'That photo is too big even after resizing.',
  not_yours: "That isn't yours to change.",
  photo_storage_unconfigured: 'Photo storage is not set up on this server.',
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body instanceof Blob ? {} : { 'content-type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new BoardError('Could not reach the server.', 'offline')
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* some responses have no body */
  }

  if (!res.ok) {
    const code =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `http_${res.status}`
    throw new BoardError(MESSAGES[code] ?? 'Something went wrong.', code)
  }
  return body as T
}

export function listVisits(): Promise<{ visits: Visit[] }> {
  return call('/api/visits')
}

/**
 * Create a visit, then upload its photos.
 *
 * Two steps rather than one multipart request: the visit is the thing worth
 * saving, and a photo that fails to upload should not lose the note and the
 * date along with it. Each photo is posted as raw bytes with its dimensions in
 * headers, which avoids multipart parsing in the Worker entirely.
 */
export async function createVisit(
  draft: VisitDraft,
  photos: PreparedPhoto[]
): Promise<{ id: string; spotId: string | null; photoFailures: number }> {
  const created = await call<{ id: string; spotId: string | null }>('/api/visits', {
    method: 'POST',
    body: JSON.stringify(draft),
  })

  let photoFailures = 0
  for (const photo of photos) {
    try {
      await call(`/api/visits/${created.id}/photo`, {
        method: 'POST',
        headers: {
          'content-type': 'image/jpeg',
          'x-image-width': String(photo.width),
          'x-image-height': String(photo.height),
        },
        body: photo.blob,
      })
    } catch {
      photoFailures++
    }
  }

  return { ...created, photoFailures }
}

export function deleteVisit(id: string): Promise<{ deleted: boolean }> {
  return call(`/api/visits/${id}/delete`, { method: 'POST' })
}

export function listSpots(): Promise<{
  spots: {
    id: string
    name: string
    lat: number
    lon: number
    category: string
    tagCounts: Record<string, number>
    confirmations: number
    confirmedByMe: boolean
  }[]
  trustedAt: number
}> {
  return call('/api/spots')
}

export function confirmSpot(id: string): Promise<{ confirmed: boolean }> {
  return call(`/api/spots/${id}/confirm`, { method: 'POST' })
}

export function tagSpot(id: string, tag: string, remove = false): Promise<{ tagged: boolean }> {
  return call(`/api/spots/${id}/tag`, {
    method: 'POST',
    body: JSON.stringify({ tag, remove }),
  })
}
