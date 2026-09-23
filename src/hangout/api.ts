/**
 * Hangout app client.
 *
 * Authentication is a session cookie set by Google sign-in, so requests carry
 * no tokens of their own — `credentials: 'same-origin'` is the whole story.
 *
 * This module is only ever imported by the `/hangout` app. The public map at
 * `/` must not touch it: that separation is what keeps the public side
 * accountless.
 */

export type ActivityCategory = 'sports' | 'food' | 'study' | 'other'
export type MemberStatus = 'pending' | 'approved' | 'declined'

export interface Me {
  id: string
  name: string
  avatarUrl: string | null
  age: number | null
  city: string | null
  bio: string | null
  email: string | null
}

export interface ActivitySummary {
  id: string
  title: string
  category: ActivityCategory
  note: string | null
  emoji: string
  venueId: string | null
  venueName: string
  lat: number
  lon: number
  startsAt: number
  endsAt: number
  capacity: number
  approvedCount: number
  pendingCount: number
  isMine: boolean
  myStatus: MemberStatus | null
  /** Shown inside the activity's map bubble. */
  creatorId: string
  creatorName: string | null
  creatorAvatar: string | null
  /** Metres from the viewer, computed locally — never round-tripped. */
  distanceM?: number
}

export interface ActivityDetail extends ActivitySummary {
  expiresAt: number
  creatorId: string
  /** The activity's chat room. Null only if the room was somehow lost. */
  roomId: string | null
  members: { id: string; name: string }[]
}

export interface Room {
  id: string
  kind: 'activity' | 'destination'
  refId: string
  title: string
  emoji: string
  members: number
  lastBody: string | null
  lastName: string | null
  lastAt: number | null
}

export interface RoomDetail {
  id: string
  kind: 'activity' | 'destination'
  refId: string
  title: string
  emoji: string
  joined: boolean
  members: { id: string; name: string; avatarUrl: string | null }[]
}

export interface RoomMessage {
  id: string
  userId: string
  name: string
  /** Joined from the user, so changing your picture updates old messages. */
  avatarUrl: string | null
  body: string
  createdAt: number
  mine: boolean
}

export type EventSource =
  | 'community'
  | 'luma'
  | 'allevents'
  | 'ticketmaster'
  | 'seed'
export type EventCategory =
  | 'nightlife'
  | 'music'
  | 'festival'
  | 'comedy'
  | 'arts'
  | 'food'
  | 'outdoors'
  | 'wellness'
  | 'sport'
  | 'tech'
  | 'community'
  | 'other'

export interface EventSummary {
  id: string
  source: EventSource
  title: string
  description: string | null
  category: EventCategory
  emoji: string
  venueName: string
  address: string | null
  lat: number
  lon: number
  startsAt: number
  endsAt: number | null
  /** False when the source published a date but no clock time. */
  timeKnown: boolean
  /** Rupees, not paise. Null when unknown; 0 means genuinely free. */
  priceMin: number | null
  priceMax: number | null
  currency: string
  isFree: boolean
  ticketUrl: string | null
  imageUrl: string | null
  isMine: boolean
  going: number
  joined: boolean
  roomId: string | null
  /** Metres from the viewer, computed locally. */
  distanceM?: number
}

export interface EventDetail extends EventSummary {
  attendees: { id: string; name: string; avatarUrl: string | null }[]
}

export interface TrendingDestination {
  destination: string
  slug: string
  country: string | null
  emoji: string
  travellers: number
  nextStart: number
  /** Set when you're already in that destination's chat. */
  roomId: string | null
}

/** Who is going somewhere, fetched before deciding to join them. */
export interface DestinationDetail {
  slug: string
  title: string | null
  emoji?: string
  roomId: string | null
  joined: boolean
  members: { id: string; name: string; avatarUrl: string | null }[]
}

export interface ChatMessage {
  id: string
  profileId: string
  name: string
  body: string
  createdAt: number
  mine: boolean
}

export interface Person {
  id: string
  name: string
  avatarUrl: string | null
  lat: number
  lon: number
  updatedAt: number
}

export interface DmThread {
  id: string
  otherId: string
  otherName: string
  otherAvatar: string | null
  lastBody: string | null
  lastAt: number
}

export interface DmMessage {
  id: string
  body: string
  createdAt: number
  mine: boolean
}

export interface Trip {
  id: string
  destination: string
  country: string | null
  startsOn: number
  endsOn: number
  note: string | null
  ownerId: string
  ownerName: string
  ownerAvatar: string | null
  going: number
  isMine: boolean
  joined: boolean
}

export class HangoutError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'HangoutError'
  }
}

const MESSAGES: Record<string, string> = {
  sign_in_required: 'Sign in to do that.',
  venue_must_be_from_dataset:
    'Activities can only be created at a place already on the map — pick a venue from search.',
  outside_service_area: 'That venue is outside Mumbai.',
  starts_in_past: 'That start time has already passed.',
  too_far_ahead: 'Pick a time within the next two weeks.',
  bad_duration: 'End time must be after the start, and within 12 hours of it.',
  bad_capacity: 'Capacity must be between 2 and 50.',
  bad_title: 'Give it a title of at least 3 characters.',
  bad_destination: 'Where are you going?',
  bad_dates: 'Check the dates.',
  full: 'This one is already full.',
  not_approved: 'The chat opens once the organiser approves you.',
  not_the_creator: 'Only the organiser can decide requests.',
  not_found_or_expired: 'That activity has finished or been removed.',
  not_a_member: 'Join first to see this chat.',
  not_deletable: "Imported listings can't be deleted here.",
  organiser_must_delete: 'You created this — delete it instead of leaving.',
  blocked: "You can't message this person.",
  not_in_thread: "That conversation isn't yours.",
  rate_limited: "You've done that a lot just now. Try again shortly.",
  google_oauth_not_configured: 'Google sign-in is not set up on this server yet.',
  bad_name: 'Pick a name of at least two characters.',
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      // The session lives in an HttpOnly cookie; nothing else authenticates.
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new HangoutError("Couldn't reach the server.", 'offline')
  }

  if (res.ok) return res.json() as Promise<T>

  let code = `http_${res.status}`
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) code = body.error
  } catch {
    /* status alone will do */
  }
  throw new HangoutError(MESSAGES[code] ?? `Something went wrong (${code}).`, code)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function fetchMe(): Promise<{
  user: Me | null
  configured: boolean
  /** True only on a local machine with Google sign-in not yet configured. */
  devLogin: boolean
}> {
  return call('/api/auth/me')
}

/**
 * Local-only sign-in by name. The server 404s this unless it is running on
 * localhost with Google OAuth unconfigured, so it cannot be reached in
 * production even if this function is called.
 */
export function devSignIn(name: string): Promise<{ ok: boolean; name: string }> {
  return call('/api/auth/dev', { method: 'POST', body: JSON.stringify({ name }) })
}

export function signInUrl(): string {
  return '/api/auth/google'
}

export function signOut(): Promise<{ ok: boolean }> {
  return call('/api/auth/logout', { method: 'POST' })
}

export function updateProfile(input: {
  name: string
  age: number | null
  city: string | null
  bio: string | null
}): Promise<Me> {
  return call('/api/auth/me', { method: 'POST', body: JSON.stringify(input) })
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export function listActivities(options?: {
  category?: ActivityCategory | null
}): Promise<{ activities: ActivitySummary[]; now: number }> {
  const params = new URLSearchParams()
  if (options?.category) params.set('category', options.category)
  const qs = params.toString()
  return call(`/api/activities${qs ? `?${qs}` : ''}`)
}

export function getActivity(id: string): Promise<ActivityDetail> {
  return call(`/api/activities/${id}`)
}

export function createActivity(input: {
  title: string
  category: ActivityCategory
  emoji: string
  note?: string | null
  /** Null when the activity is "around here" rather than a named place. */
  venueId: string | null
  venueName: string
  lat: number
  lon: number
  startsAt: number
  endsAt: number
  capacity: number
}): Promise<{ id: string }> {
  return call('/api/activities', { method: 'POST', body: JSON.stringify(input) })
}

/** "I'm in" — one tap, joins the activity and its chat room. */
export function joinActivity(id: string): Promise<{ status: MemberStatus; roomId: string }> {
  return call(`/api/activities/${id}/join`, { method: 'POST' })
}

export function leaveActivity(id: string): Promise<{ left: boolean }> {
  return call(`/api/activities/${id}/leave`, { method: 'POST' })
}

export function deleteActivity(id: string): Promise<{ deleted: boolean }> {
  return call(`/api/activities/${id}/delete`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Chat rooms
// ---------------------------------------------------------------------------

export function listRooms(): Promise<{ rooms: Room[] }> {
  return call('/api/rooms')
}

export function getRoom(id: string): Promise<RoomDetail> {
  return call(`/api/rooms/${id}`)
}

export function joinRoom(id: string): Promise<{ joined: boolean }> {
  return call(`/api/rooms/${id}/join`, { method: 'POST' })
}

export function leaveRoom(id: string): Promise<{ joined: boolean }> {
  return call(`/api/rooms/${id}/leave`, { method: 'POST' })
}

export function fetchRoomMessages(
  id: string,
  since = 0
): Promise<{ messages: RoomMessage[] }> {
  return call(`/api/rooms/${id}/messages?since=${since}`)
}

export function sendRoomMessage(id: string, body: string): Promise<{ id: string }> {
  return call(`/api/rooms/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function listEvents(options?: {
  category?: EventCategory | null
  freeOnly?: boolean
  /** A single day, YYYY-MM-DD, bounded in IST by the server. */
  date?: string | null
}): Promise<{ events: EventSummary[]; now: number }> {
  const params = new URLSearchParams()
  if (options?.category) params.set('category', options.category)
  if (options?.freeOnly) params.set('free', '1')
  if (options?.date) params.set('date', options.date)
  const qs = params.toString()
  return call(`/api/events${qs ? `?${qs}` : ''}`)
}

export function getEvent(id: string): Promise<EventDetail> {
  return call(`/api/events/${id}`)
}

export function createEvent(input: {
  title: string
  description?: string | null
  category: EventCategory
  venueName: string
  address?: string | null
  lat: number
  lon: number
  startsAt: number
  endsAt?: number | null
  isFree: boolean
  priceMin?: number | null
  priceMax?: number | null
  ticketUrl?: string | null
}): Promise<{ id: string; roomId: string }> {
  return call('/api/events', { method: 'POST', body: JSON.stringify(input) })
}

export function joinEvent(id: string): Promise<{ joined: boolean; roomId: string }> {
  return call(`/api/events/${id}/join`, { method: 'POST' })
}

export function leaveEvent(id: string): Promise<{ joined: boolean }> {
  return call(`/api/events/${id}/leave`, { method: 'POST' })
}

export function deleteEvent(id: string): Promise<{ deleted: boolean }> {
  return call(`/api/events/${id}/delete`, { method: 'POST' })
}

/** Top up from the external source and the curated seed. */
export function refreshEvents(): Promise<{
  seeded?: number
  imported: number
  error?: string
}> {
  return call('/api/events/refresh', { method: 'POST' })
}

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  nightlife: 'Nightlife',
  festival: 'Festivals',
  outdoors: 'Outdoors',
  wellness: 'Wellness',
  tech: 'Tech',
  community: 'Meetup',
  music: 'Music',
  sport: 'Sport',
  arts: 'Arts',
  comedy: 'Comedy',
  food: 'Food',
  other: 'Other',
}

/** Where an event came from, said plainly. */
export const EVENT_SOURCE_LABELS: Record<EventSource, string> = {
  community: 'Posted by a member',
  luma: 'Listed on Luma',
  allevents: 'Listed on AllEvents',
  ticketmaster: 'Ticketmaster listing',
  seed: 'Known regular night',
}

export function formatPrice(e: EventSummary): string {
  if (e.isFree) return 'Free'
  if (e.priceMin == null) return 'Price unknown'
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
  if (e.priceMax != null && e.priceMax > e.priceMin) {
    return `${fmt(e.priceMin)}–${fmt(e.priceMax)}`
  }
  return fmt(e.priceMin)
}

// ---------------------------------------------------------------------------
// Trending destinations
// ---------------------------------------------------------------------------

export function listTrending(): Promise<{ trending: TrendingDestination[] }> {
  return call('/api/social/trending')
}

/** Look at a destination's group without joining it. */
export function destinationDetail(slug: string): Promise<DestinationDetail> {
  return call(`/api/social/destinations/${encodeURIComponent(slug)}`)
}

export function joinDestination(destination: string): Promise<{ roomId: string }> {
  return call('/api/social/destinations/join', {
    method: 'POST',
    body: JSON.stringify({ destination }),
  })
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

export function shareLocation(lat: number, lon: number): Promise<{ visible: boolean }> {
  return call('/api/social/presence', {
    method: 'POST',
    body: JSON.stringify({ lat, lon }),
  })
}

export function stopSharingLocation(): Promise<{ visible: boolean }> {
  return call('/api/social/presence', {
    method: 'POST',
    body: JSON.stringify({ visible: false }),
  })
}

export function listPeople(): Promise<{ people: Person[] }> {
  return call('/api/social/people')
}

// ---------------------------------------------------------------------------
// Direct messages
// ---------------------------------------------------------------------------

export function listThreads(): Promise<{ threads: DmThread[] }> {
  return call('/api/social/threads')
}

export function openThread(userId: string): Promise<{ threadId: string }> {
  return call(`/api/social/dm/${userId}`, { method: 'POST' })
}

export function fetchDm(
  threadId: string,
  since = 0
): Promise<{ messages: DmMessage[] }> {
  return call(`/api/social/threads/${threadId}/messages?since=${since}`)
}

export function sendDm(threadId: string, body: string): Promise<{ id: string }> {
  return call(`/api/social/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

// ---------------------------------------------------------------------------
// Travel trips
// ---------------------------------------------------------------------------

export function listTrips(): Promise<{ trips: Trip[] }> {
  return call('/api/social/trips')
}

export function createTrip(input: {
  destination: string
  country?: string | null
  startsOn: number
  endsOn: number
  note?: string | null
}): Promise<{ id: string; roomId: string }> {
  return call('/api/social/trips', { method: 'POST', body: JSON.stringify(input) })
}

export function joinTrip(id: string): Promise<{ joined: boolean; roomId: string }> {
  return call(`/api/social/trips/${id}/join`, { method: 'POST' })
}

export function leaveTrip(id: string): Promise<{ left: boolean }> {
  return call(`/api/social/trips/${id}/leave`, { method: 'POST' })
}

export function deleteTrip(id: string): Promise<{ deleted: boolean }> {
  return call(`/api/social/trips/${id}/delete`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export function blockUser(userId: string, blocked = true): Promise<{ blocked: boolean }> {
  return call('/api/social/block', {
    method: 'POST',
    body: JSON.stringify({ userId, blocked }),
  })
}

export function reportTarget(input: {
  targetType: 'user' | 'activity' | 'message'
  targetId: string
  reason: string
  detail?: string
}): Promise<{ received: boolean }> {
  return call('/api/social/report', { method: 'POST', body: JSON.stringify(input) })
}

export function getProfile(userId: string): Promise<{
  id: string
  name: string
  avatarUrl: string | null
  age: number | null
  city: string | null
  bio: string | null
}> {
  return call(`/api/social/users/${userId}`)
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatWhen(
  startsAt: number,
  now = Date.now(),
  /**
   * Pass false when the source gave a date only. We then say so instead of
   * printing the hour we had to invent to store the row — a confident wrong
   * time is what sends someone across the city to a locked door.
   */
  timeKnown = true
): string {
  const date = new Date(startsAt)
  const time = timeKnown
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'time unknown'

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.floor((date.getTime() - startOfToday.getTime()) / 86_400_000)

  if (days < 0) return timeKnown ? `started ${time}` : 'earlier today'
  if (days === 0) {
    if (!timeKnown) return `today · ${time}`
    const mins = Math.round((startsAt - now) / 60000)
    if (mins <= 0) return `now · ${time}`
    if (mins < 60) return `in ${mins} min · ${time}`
    return `today · ${time}`
  }
  if (days === 1) return `tomorrow · ${time}`
  return `${date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`
}

/** MigoMap's phrasing: "Kevin wants to play football on Friday". */
export function weekdayOf(ts: number): string {
  return new Date(ts).toLocaleDateString([], { weekday: 'long' })
}

export function isLive(a: { startsAt: number; endsAt: number }, now = Date.now()): boolean {
  return now >= a.startsAt && now <= a.endsAt
}

export function relativeShort(ts: number, now = Date.now()): string {
  const mins = Math.round((now - ts) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  sports: 'Sports',
  food: 'Food',
  study: 'Study',
  other: 'Other',
}

/** Replace your profile picture. Returns the new URL. */
export async function uploadAvatar(blob: Blob): Promise<{ avatarUrl: string }> {
  const res = await fetch('/api/auth/avatar', {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: blob,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new HangoutError(
      body.error === 'too_large'
        ? 'That picture is too big.'
        : body.error === 'photo_storage_unconfigured'
          ? 'Picture storage is not set up on this server.'
          : 'Could not save that picture.',
      body.error ?? 'upload_failed'
    )
  }
  return (await res.json()) as { avatarUrl: string }
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

export interface DestinationHit {
  name: string
  country: string | null
  /** What OSM calls it: country, city, town, state. */
  kind: string | null
  lat: number
  lon: number
}

/** Type-ahead over the world's cities, towns, states and countries. */
export async function searchDestinations(query: string): Promise<DestinationHit[]> {
  try {
    const res = await fetch(`/api/destinations?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const body = (await res.json()) as { results?: DestinationHit[] }
    return body.results ?? []
  } catch {
    // A dead type-ahead should never block someone typing a destination by
    // hand, so every failure is silent.
    return []
  }
}

/** A photograph of a place, or null. Cached hard on the server. */
export async function destinationImage(
  place: string,
  country?: string | null
): Promise<string | null> {
  const qs = new URLSearchParams({ q: place })
  // Disambiguates: there is a Goa in India and another in the Philippines.
  if (country) qs.set('country', country)
  try {
    const res = await fetch(`/api/destination-image?${qs}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { imageUrl?: string | null }
    return body.imageUrl ?? null
  } catch {
    return null
  }
}
