# Mumbai Civic Map — Frontend Specification

A complete description of every screen, component, state and data shape in this
project, written so it can be handed to a design tool (Lovable, v0, Figma Make)
as a brief.

Everything below describes what **actually exists and works today**. Nothing here
is aspirational.

> **Correction, 2026-09-23 — the LLM path has been removed.** `/api/ask`, the
> Gemini client and `GEMINI_API_KEY` no longer exist. Ask map is now
> **fully on-device**: `src/search/interpret.ts` parses the query and
> `src/search/rank.ts` ranks the results, with no network call at all. The
> affected passages below (§1's honesty principle, §5.2, §8's API table and
> §10's paste-ready brief) have been corrected. Note also that §5.2 still names
> `ChatPanel`; the component is now `src/chat/AskPanel.tsx`, and `PoiCard` has
> been folded into `src/ui/ResultRail.tsx`. That renaming has not been chased
> through the rest of this document.

---

## 1. What the product is

A mobile-first web app for Mumbai with **three modes on one page**, switched by
three small chips over a full-screen map:

| Mode | What it does |
|---|---|
| **Ask map** | Type a plain-language question, get pins. Public toilets, drinking water, flooding, "best cheesecake in Bandra", multi-stop trip planning, turn-by-turn navigation. |
| **Hang out** | Create or join real-world activities at verified venues. Group chat per activity, DMs, travel trips, live people on the map, profiles. |
| **Events** | 200+ real Mumbai events — tech meetups, gigs, comedy, theatre, workshops — imported from public sources. Join, see who's going, chat. |

**No account is needed to browse anything.** Accounts appear inline, only at the
moment one is actually required (joining, chatting, posting).

### The defining product principle: visible honesty

This app never pretends to know something it doesn't. This is not a footnote —
it is the design brief. Every surface must carry provenance and admit gaps:

- Every answer is resolved on-device, and every result card shows the facts it
  was ranked on (`park · 310 m · open now`) rather than an opaque suggestion.
- Every event carries a source badge; a member's post never looks like a
  verified listing.
- A route drawn from a straight-line fallback renders **dashed**, never solid.
- An event whose source gave a date but no time shows **"time unknown"**, never
  a fabricated midnight.
- An empty result explains *why* it's empty ("only ~76 drinking water points are
  mapped in OpenStreetMap for the whole city") rather than showing a shrug.
- The events board states plainly that it is partial, not broken.

Design accordingly: **the caveat is part of the component, not an afterthought.**

---

## 2. Technical constraints

- **React 18 + TypeScript + Vite + Tailwind**
- **MapLibre GL JS** with OpenFreeMap "Liberty" vector tiles (no API key). The
  basemap is always the standard light OSM style — it does **not** follow dark
  mode.
- Backend is a single **Cloudflare Worker + D1 (SQLite)**, same origin as the app
- **No cookies for tracking, no localStorage identifier, no analytics, no
  third-party scripts.** A CSP blocks all external origins except map tiles.
- **No webfonts** — CSP forbids external font origins. System font stack only.
- Target device: mid-range Android on 4G. Payload discipline matters.

---

## 3. Design system

### 3.1 Colour tokens

Defined once as `R G B` channels in CSS variables, so Tailwind opacity modifiers
(`bg-surface/90`) work and **no component carries a `dark:` class** — dark mode
is a redefinition of the same names.

**Light (default)**

| Token | Value | Use |
|---|---|---|
| `canvas` | `241 245 249` | app background behind everything |
| `surface` | `255 255 255` | sheets, cards, chips |
| `raised` | `255 255 255` | popovers |
| `sunken` | `248 250 252` | inset fields, inner cards |
| `hover` | `241 245 249` | hover fill |
| `ink` | `15 23 42` | primary text |
| `muted` | `71 85 105` | secondary text |
| `subtle` | `129 140 158` | tertiary / metadata |
| `line` | `226 232 240` | hairline borders |
| `line-strong` | `203 213 225` | emphasised borders, grab handles |
| `accent` | `13 110 118` | teal — focus, links, active state |
| `accent-ink` | `11 87 94` | text on accent-soft |
| `accent-soft` | `236 250 250` | accent background wash |
| `positive` / `-soft` / `-ink` | `5 150 105` / `236 253 245` / `6 95 70` | working, confirmed, free |
| `caution` / `-soft` / `-ink` | `217 119 6` / `255 251 235` / `146 64 14` | caveats, uncertainty, "hours unknown" |
| `critical` / `-soft` / `-ink` | `220 38 38` / `254 242 242` / `153 27 27` | broken, errors |
| `info` / `-soft` / `-ink` | `2 132 199` / `240 249 255` / `7 89 133` | external source badges |
| `inverse` / `-ink` | `15 23 42` / `255 255 255` | primary buttons, own chat bubbles |

**Dark** (same names redefined)

`canvas 9 13 20` · `surface 18 24 33` · `raised 24 31 42` · `sunken 14 19 27` ·
`hover 30 39 51` · `ink 237 242 249` · `muted 158 170 186` · `subtle 118 130 146` ·
`line 35 45 58` · `line-strong 52 65 82` · `accent 45 212 191` ·
`accent-ink 153 246 228` · `accent-soft 19 45 48` · `positive 52 211 153` ·
`caution 251 191 36` · `critical 248 113 113` · `info 56 189 248` ·
`inverse 237 242 249` / `inverse-ink 12 17 24` (inverted surfaces flip too).

**Colour discipline:** the accent is used for focus, links and active state —
*never* for status. Status colours carry meaning. When something on screen is
coloured, it always means something.

### 3.2 Type scale

Deliberately short. Every size has a matching line-height and tracking so
vertical rhythm never drifts.

| Name | Size | Line height | Tracking |
|---|---|---|---|
| `2xs` | 0.6875rem (11px) | 1rem | +0.01em |
| `xs` | 0.75rem (12px) | 1.125rem | — |
| `sm` | 0.8125rem (13px) | 1.25rem | — |
| `base` | 0.9375rem (15px) | 1.4rem | — |
| `lg` | 1.0625rem (17px) | 1.5rem | −0.01em |
| `xl` | 1.3125rem (21px) | 1.75rem | −0.02em |
| `2xl` | 1.625rem (26px) | 2rem | −0.02em |

Font stack: `ui-sans-serif, system-ui, -apple-system, 'Segoe UI Variable Text',
'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` with
`font-feature-settings: 'cv02','cv03','cv04','cv11'`.

`.tabular` applies `font-variant-numeric: tabular-nums` — used on every distance,
time, price and count so numbers never jitter as they update.

### 3.3 Radii, shadows, motion

- **Radii:** `card` = 0.875rem, `sheet` = 1.25rem, buttons/chips/fields = fully round (`9999px`)
- **Shadows** — three levels, no more. Ambient + direct in each:
  - `low` — `0 1px 2px /0.06, 0 1px 1px /0.04`
  - `mid` — `0 4px 12px -2px /0.10, 0 2px 4px -2px /0.06`
  - `high` — `0 16px 40px -12px /0.22, 0 4px 12px -4px /0.10`
  - `sheet` — `0 -12px 40px -12px /0.18` (upward, for bottom sheets)
- **Easing:** one curve everywhere — `cubic-bezier(0.22, 1, 0.36, 1)`
- **Animations:** `slide-up` 220ms · `fade-in` 160ms · `sheet-in` 260ms ·
  `pulse-soft` 1.4s infinite
- `prefers-reduced-motion` collapses every animation and transition to 0.01ms

### 3.4 Component classes

```
.btn            round, 2.25rem min-height, gap-1.5, 150ms, disabled:opacity-40
.btn-primary    bg-inverse text-inverse-ink shadow-low, active:scale-[0.98]
.btn-secondary  border-line-strong bg-surface, hover:bg-hover
.btn-ghost      text-muted, hover:bg-hover
.btn-accent     bg-accent text-white shadow-low

.chip           .btn + border + px-3 py-1.5, 2rem min-height
.chip-idle      border-line bg-surface/90 text-muted shadow-low backdrop-blur-md
.chip-active    border-transparent bg-inverse text-inverse-ink shadow-mid

.field          round, border-line, bg-sunken, px-4, 2.75rem min-height,
                focus:border-accent focus:bg-surface
.card           rounded-card border-line bg-surface
.tag            rounded-md px-1.5 py-0.5 text-2xs font-medium
.notice         rounded-lg px-2.5 py-1.5 text-xs leading-snug
.eyebrow        text-2xs font-semibold uppercase tracking-wider text-subtle
.sheet          padding-bottom: max(0.75rem, env(safe-area-inset-bottom))
.scrollbar-slim 6px thin scrollbar, line-strong thumb
```

**Chips are the signature control.** Map chrome sits on imagery, so chips are
translucent + backdrop-blurred rather than flat white. Active state inverts.

**Focus:** one ring for the whole app, keyboard-only — `ring-2 ring-accent
ring-offset-2` with the offset colour set to `surface`.

**Touch targets:** minimum 2.25rem on buttons, 2.75rem on fields, even when the
visual box is smaller.

### 3.5 Icon set

A single stroke icon set (`src/ui/Icon.tsx`), inheriting `currentColor`, sized by
prop. Names in use:

`water · toilet · health · pharmacy · food · atm · police · transit · shelter ·
bench · flood · pin · rail · close · locate · send · shield · flag · external ·
route · clock · check · alert · info · accessible · coin · plus · sparkle`

Emoji are used **only** for user-generated and event content (activity/event
glyphs and map pins), never for UI chrome.

---

## 4. Global layout

```
┌─────────────────────────────────────────┐
│ [Ask map] [Hang out] [Events]           │ ← mode chips, z-10, p-3
│ [Monsoon] [Metro]              [shield] │ ← layer chips + privacy
│                                         │
│                                         │
│            FULL-SCREEN MAP              │ ← MapLibre, z-0, always mounted
│         (one instance, shared)          │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│        MODE-SPECIFIC BOTTOM UI          │ ← z-10/20
└─────────────────────────────────────────┘
```

- The map is **one instance owned by the app shell**. Modes draw chrome over it;
  they never mount their own map.
- Top chrome is `pointer-events-none` with `pointer-events-auto` on the controls,
  so the map stays draggable between chips.
- Mode chips are the **same size and shape** as the Monsoon/Metro layer toggles.
  (An earlier version made them a large segmented bar; it read as a page title
  rather than a control and ate the top of the map. Don't do that.)
- All top chrome **hides entirely during navigation**.
- **Toast banner:** centred pill at `top-32`, `bg-inverse text-inverse-ink`,
  `rounded-full`, `shadow-high`, `animate-slide-up`, `role="status"`.
- Desktop: bottom sheets become a fixed `420px` right rail
  (`sm:right-4 sm:bottom-4 sm:w-[420px] sm:rounded-sheet`).

---

## 5. Screens and components

### 5.1 Map (`MapView`) — always present

Renders, in layers:
- **POI pins** coloured per category (see §7.1)
- **Community report status** merged onto civic pins — red for broken, green for working
- **Flood layer** (toggle): 44 chronic waterlogging spots + live flood reports
  colour-coded by depth, fading toward expiry
- **Metro/rail layer** (toggle): 390 rail line segments
- **Activity pins** (hangout mode): HTML markers with the activity emoji
- **Event pins** (events mode): HTML markers with the event emoji
- **People** (hangout mode, only those sharing): avatar markers
- **Route line**: split into two layers — `route-line` solid `#1a73e8` for real
  routed geometry, `route-line-approx` **dashed** for straight-line fallback,
  each with a white casing underneath
- **Live puck** + follow camera during navigation

Interactions: tap any pin → detail; tap empty map → "report a point here".

### 5.2 Ask map mode

#### `ChatPanel` — bottom sheet
Collapsed `max-h-[46vh]`, expanded `max-h-[80vh]`, toggled by a grab handle
(`h-1 w-9 rounded-full bg-line-strong`).

**Empty state:** h1 "Ask Mumbai's map", subtitle, a green pill button reading
"No account, no cookies, no location history" (opens the privacy dialog), then an
eyebrow "Try asking" and 6 suggestion rows — each a bordered `bg-sunken` card
with a leading icon, the text, and a `send` icon that fades in on hover:

1. Working drinking water near me — `water`
2. Public toilet in Andheri East — `toilet`
3. Wheelchair accessible toilet in Bandra — `accessible`
4. Which spots flood in Dadar? — `flood`
5. I want to take the metro at MIDC but first I want to eat — `route`
6. Best cheesecake in Bandra West — `sparkle`

**Conversation:** user turns are right-aligned `bg-inverse` bubbles
(`rounded-2xl rounded-br-md`, max 85% width). App turns are plain left-aligned
text with, beneath them:
- a pending indicator — three `pulse-soft` dots + "Working it out"
- an error notice (`bg-critical-soft`, `alert` icon)
- for recommendations, a caution notice (`bg-caution-soft`, `sparkle` icon)
- **a provenance line on every turn** — `shield` icon + "Answered on your device
  — nothing was sent anywhere." There is no second, server-side branch any more:
  since the LLM was removed on 2026-09-23 the query never leaves the device, so
  the line is unconditional. (Routing is the one thing that still goes out, and
  it is disclosed separately in the privacy dialog.)
- result cards (`PoiCard`)
- or an empty-state card explaining OSM sparsity

**Composer:** a "Near me" pill (toggles location, turns accent when active, tooltip
states the blur radius), a round input (`autoComplete="off"`, no name that could
be autofilled), and a round 2.75rem accent send button.

#### `PoiCard`
Props: `poi`, `selected`, `why?`, `onSelect`, `onReport`.
Shows name, category, distance, community status verdict, accessibility/fee tags,
opening hours (or "hours unknown"), and the ranker's explanation — `why` is a
list of the facts the score was built from (`park · 310 m · open now`), not a
model's prose. Every component of it is checkable, so it is shown plainly rather
than with an "unverified" treatment.

#### `DetailPanel` — replaces ChatPanel when a POI is selected
Props: `poi`, `reports`, `onClose`, `onReport`, `onGo(poi, mode)`, `onAddToTrip`,
`goBusy`.
Google-Maps-style: name, category, address, tags, community report history, and a
primary **Go** button with a travel-mode choice — **walk / car / public transport**.

#### `TripPanel` — pinned above the conversation while a trip is active
Props: `stops`, `route`, `routing`, `error`, `onChoose`, `onClearChoice`,
`onSelectPoi`, `onClear`, `onGo`, `goBusy`.
Numbered itinerary. Stops needing a choice ("somewhere to eat") show candidate
options **ranked by least extra walking (detour)**, not raw distance — a stall
further away but in the right direction beats a closer one that doubles you back.
Shows total distance/duration and warns when the route is approximate.

#### `NavPanel` — replaces everything during navigation
Props: `nav`, `followingMe`, `onToggleFollow`, `onRecenter`, `onStop`.
Distance remaining, ETA, follow toggle, recentre, and Stop.
**No turn-by-turn instructions** — the routing service returns geometry only, so
inventing "turn left" is not done.

### 5.3 Hang out mode (`HangoutHome`)

Full-screen experience with **its own bottom navigation** (4 tabs, `border-t`,
`bg-surface`, icon above an 11px label, active = `text-accent`):

**Explore · Trips · Chats · You**

The "You" tab shows the user's avatar with an accent ring when active, instead of
an icon. Tapping Trips/Chats/You without an account triggers the inline account
prompt, phrased for the purpose ("…to plan trips with people").

#### Explore — chrome over the live map
- **Floating category chips** at `top-28`: All · Sports · Food · Study · Other,
  plus a **Visible / Invisible** toggle (`locate` icon) for presence sharing
- **People count pill** below, when > 0: pulsing accent dot + "3 people sharing"
- **Bottom row** at `bottom-[4.5rem]`: round recentre button (left), "See list" /
  "See map" pill (centre), round 3.25rem accent **+ FAB** (right)
- **Pull-up list** (`bottom-16`, `max-h-[60vh]`, `animate-sheet-in`): activity rows
  with emoji circle, title, a pulsing **"Now"** tag when live, venue, and a meta
  line — time · distance · "3 of 8" · "full" · "you're in". Sorted nearest first.
- Empty: "Nothing on yet. / Be the first — tap the + and pick a park, a café, a station."

#### Trips (`TripsScreen`)
Travel trips with a destination city picker, dates, and a note. Joining a trip
auto-joins that destination's group chat. **Trending cards** show destinations by
traveller count.

#### Chats (`ChatScreen`)
Two lists: group rooms (activities, destinations, events) and one-to-one DM
threads. Each row shows emoji/avatar, title, last message, member count, timestamp.

#### You (`ProfileScreen`)
Name, avatar, age, city, bio, email. Presence toggle. Sign out.
A "profile complete" badge — which means exactly that, and says so. It is **not**
identity verification and must never be styled to imply it is.

### 5.4 Events mode (`EventsHome`)

Same shape as Hangout, but **no bottom nav** and the **list is open by default** —
most events are not near you right now, so an empty-looking map is the wrong first
impression.

- **Row 1 of chips** (`top-28`): All · Tech · Meetups · Music · Comedy · Arts · Sport · Food
- **Row 2 of chips:** Free (`coin` icon) · Anytime · Today · This week
- **Bottom row** (`bottom-4`): recentre · "See map"/"See list" · **+ FAB**
- **List sheet** (`max-h-[62vh]`): header "What's on" + a Refresh button
  (`route` icon, shows "Fetching…" while running), a count line
  ("84 events · free only"), then event cards.

#### Event card
Emoji circle (2.75rem, `bg-sunken`) · title · venue with `pin` icon · time line
(`formatWhen` + distance) · **price, right-aligned** (green when free).
Below: a **source tag**, a category tag, "12 going", and "You're going" with a
check when joined.

**Source tags — visually distinct, never flattened:**

| Source | Label | Style |
|---|---|---|
| `community` | Member post | `bg-accent-soft text-accent-ink` |
| `luma` | Luma | `bg-info-soft text-info-ink` |
| `allevents` | Ticketed | `bg-info-soft text-info-ink` |
| `ticketmaster` | Ticketed | `bg-info-soft text-info-ink` |
| `seed` | Regular night | `bg-sunken text-muted` |

**Empty state** must say: *"No free service lists every event in a city, so this
board combines Luma and AllEvents' public listings, member posts, Ticketmaster
and a small curated set of regular nights. It is genuinely partial, not broken."*

#### `EventSheet` — full detail
Image, title, venue, date/time, price, category tag, source tag, and then a
**source-specific honesty line**:

- **ticketmaster** — "Listed by Ticketmaster. Details and price come from them — check the ticket page before travelling."
- **allevents** — "Listed on AllEvents, which aggregates ticketed events. Their city listing gives the date but not the start time, so check the listing before you go."
- **luma** — "Listed publicly on Luma by its organiser. Luma's city feed does not expose the real price, so we show none rather than guess — open the Luma page for the cost and to RSVP."
- **community** — "Posted by a member of this app. Nobody has verified it — treat it like a message from a stranger, because it is."
- **seed** — "A regular night this venue is known for, from a hand-compiled list. No ticket and no price, because we do not know either — check with the venue."

Then: attendee avatars, **I'm in / Leave**, Open chat, Go (navigate), ticket link,
and Delete for the creator.

### 5.5 Shared sheets and modals

| Component | Purpose |
|---|---|
| `ActivitySheet` | Activity detail — members, join/leave, open chat, delete (creator only) |
| `CreateFlow` | Create an activity — category, title, note, **venue picked from real mapped places**, time, capacity |
| `CreateEvent` | Post an event — category (8 options), title, description, venue, time, free/paid |
| `ChatRoom` | Full-screen group chat — message list, composer, member list, tap a name to open their profile |
| `DmConversation` | Full-screen one-to-one thread, with block |
| `AccountPrompt` | Inline one-time account creation. Props: `purpose` (phrased to finish "…to <purpose>"), `googleConfigured`, `devAllowed`. Never a login wall. |
| `ReportSheet` | One-tap community report. Under three taps — people use it standing in the rain. Kinds: working / broken / closed / flooded / clear, with ankle/knee/waist depth for flooding. |
| `PrivacyDialog` | "What this app does and doesn't collect", in plain language |
| Person mini-card | Centred modal — avatar, name, Message, Block |

---

## 6. Data models (TypeScript)

```ts
type Mode = 'ask' | 'hangout' | 'events'

interface Poi {
  id: string; name: string | null; lat: number; lon: number
  category: string
  source: 'osm' | 'mcgm' | 'manual_seed'
  tags: Record<string, string>
  distanceM?: number
  detourM?: number          // extra walking vs going straight there
  status?: PoiStatus
}

interface PoiStatus {
  working: number; broken: number; lastReportAt: number
  verdict: 'working' | 'broken' | 'contested' | 'unknown'
}

interface Fix { lat: number; lon: number; precisionM: number }

interface EventSummary {
  id: string
  source: 'community' | 'luma' | 'allevents' | 'ticketmaster' | 'seed'
  title: string; description: string | null
  category: 'tech'|'music'|'sport'|'arts'|'comedy'|'food'|'community'|'other'
  emoji: string
  venueName: string; address: string | null
  lat: number; lon: number
  startsAt: number; endsAt: number | null
  timeKnown: boolean        // false → render "time unknown", never midnight
  priceMin: number | null   // rupees; null = unknown, 0 = genuinely free
  priceMax: number | null
  currency: string
  isFree: boolean
  ticketUrl: string | null; imageUrl: string | null
  isMine: boolean; going: number; joined: boolean; roomId: string | null
  distanceM?: number
}

interface ActivitySummary {
  id: string; title: string
  category: 'sports' | 'food' | 'study' | 'other'
  note: string | null; emoji: string
  venueId: string; venueName: string
  lat: number; lon: number
  startsAt: number; endsAt: number
  capacity: number; approvedCount: number; pendingCount: number
  isMine: boolean
  myStatus: 'pending' | 'approved' | 'declined' | null
  distanceM?: number
}

interface Me {
  id: string; name: string; avatarUrl: string | null
  age: number | null; city: string | null; bio: string | null
  email: string | null
}

interface Person {
  id: string; name: string; avatarUrl: string | null
  lat: number; lon: number; updatedAt: number
}

interface Room {
  id: string; kind: 'activity' | 'destination' | 'event'
  refId: string; title: string; emoji: string; members: number
  lastBody: string | null; lastName: string | null; lastAt: number | null
}

interface RoomMessage {
  id: string; userId: string; name: string
  body: string; createdAt: number; mine: boolean
}

interface DmThread {
  id: string; otherId: string; otherName: string
  otherAvatar: string | null; lastBody: string | null; lastAt: number
}

interface Trip {
  id: string; destination: string; country: string | null
  startsOn: number; endsOn: number; note: string | null
  ownerId: string; ownerName: string; ownerAvatar: string | null
  going: number; isMine: boolean; joined: boolean
}

interface RouteResult {
  coordinates: [number, number][]   // [lon, lat]
  distanceM: number; durationS: number
  legs: { distanceM: number; durationS: number }[]
  profile: string
  approximate?: boolean             // true → dashed line + a spoken caveat
}
```

**Formatting helpers the UI relies on:**
- `formatWhen(startsAt, now, timeKnown)` → "in 12 min · 6:30 pm", "today · time
  unknown", "tomorrow · 8:00 pm", "Sat 19 Sep · 8:00 pm"
- `formatPrice(event)` → "Free" · "Price unknown" · "₹999" · "₹2,999–17,999"
- `formatDistance(m)` → "320 m" · "1.2 km"

---

## 7. Reference data

### 7.1 Civic categories (baked GeoJSON, searched entirely on-device)

| Key | Label | Colour | Features | Eager |
|---|---|---|---|---|
| `drinking_water` | Drinking water | `#0284c7` | 72 | yes |
| `toilets` | Public toilets | `#7c3aed` | 8,638 | no (2.4 MB) |
| `health` | Hospitals & clinics | `#dc2626` | 1,805 | no |
| `pharmacy` | Pharmacies | `#059669` | 205 | no |
| `food` | Food & drink | `#ea580c` | 2,332 | no |
| `atm` | ATMs & banks | `#0891b2` | 980 | no |
| `police` | Police stations | `#1d4ed8` | 129 | no |
| `transit` | Stations & bus depots | `#4338ca` | 318 | no |
| `shelter` | Shelters | `#65a30d` | 100 | no |
| `bench` | Benches & seating | `#a16207` | 260 | no |
| `flood_spot` | Flood-prone spot | `#0369a1` | 44 | — |
| `rail_lines` | Metro/rail geometry | — | 390 | — |

Only `drinking_water` loads on startup; everything else is lazy per query.

### 7.2 Event sources, live counts

| Source | Count | Notes |
|---|---|---|
| `allevents` | 136 | schema.org JSON-LD from public city pages. Date only, no clock time. 17 carry real prices. |
| `luma` | 58 | Public city discovery feed. Price never trusted (feed marks everything free). |
| `seed` | 26 | 8 hand-compiled recurring nights × 3 weeks |
| `ticketmaster` | 0 | Needs a free API key; adapter is wired and dormant |
| `community` | varies | Member posts |

**Total: ~220 events, ~200 distinct titles, all 8 categories populated.**

---

## 8. API contract

Same origin, `/api/*`. Session is an opaque cookie (SHA-256 hashed server-side).

### Ask map
| Method | Path | Notes |
|---|---|---|
| — | *(no interpretation endpoint)* | Removed 2026-09-23. `/api/ask` is gone; the question is parsed and ranked in the browser and **never leaves the device**. |
| POST | `/api/route` | `{coordinates[], profile}` → route geometry |
| GET/POST | `/api/reports` | Community reports (anonymous, rate-limited) |
| POST | `/api/reports/:id/vote` | Up/down |
| GET | `/api/health` | Liveness |

### Auth
| Method | Path |
|---|---|
| GET | `/api/auth/me` → `{user, configured, devLogin}` |
| GET | `/api/auth/google` → OAuth redirect |
| GET | `/api/auth/callback` |
| POST | `/api/auth/dev` → local-only name sign-in |
| POST | `/api/auth/logout` |

### Events
| Method | Path |
|---|---|
| GET | `/api/events?category=&free=1` → `{now, events[]}` (LIMIT 400) |
| POST | `/api/events` → `{id, roomId}` (201) |
| GET | `/api/events/:id` → event fields + `attendees[]` + `isMine` |
| POST | `/api/events/:id/join` → `{joined, roomId}` |
| POST | `/api/events/:id/leave` |
| POST | `/api/events/:id/delete` (creator only, community only) |
| POST | `/api/events/refresh` → `{seeded, luma, allevents, ticketmaster, imported}` |

### Activities
`GET/POST /api/activities` · `GET /api/activities/:id` ·
`POST /api/activities/:id/{join,leave,delete}`

### Rooms (unified chat: activity · destination · event)
`GET /api/rooms` · `GET /api/rooms/:id` ·
`POST /api/rooms/:id/{join,leave}` · `GET/POST /api/rooms/:id/messages`
— message body field is `body`, not `text`.

### Social
`POST /api/social/presence` · `GET /api/social/people` ·
`GET /api/social/threads` · `POST /api/social/dm/:userId` ·
`GET/POST /api/social/threads/:id/messages` ·
`GET/POST /api/social/trips` · `POST /api/social/trips/:id/join` ·
`GET /api/social/trending` · `POST /api/social/destinations/join` ·
`POST /api/social/block` · `GET /api/social/blocks` ·
`POST /api/social/report` · `GET /api/social/users/:id`

**Error shape:** `{error: "snake_case_code"}` with a real HTTP status —
`401 unauthorised`, `403 not_the_creator` / `blocked`, `400 bad_*`,
`429 rate_limited`, `404 not_found`.

---

## 9. Microcopy rules

1. **Never state a fact the data doesn't support.** "Price unknown" beats "Free".
   "time unknown" beats a fabricated hour. "hours unknown" beats guessing open.
2. **Attribute everything.** Every answer and every event says where it came from.
3. **Explain emptiness.** An empty result says why — usually "nobody has mapped
   it", not "nothing exists".
4. **Sentence case** everywhere. No Title Case buttons.
5. **Second person, plain words.** "Nobody has verified it — treat it like a
   message from a stranger, because it is."
6. **Never imply verification you don't do.** The profile badge means "profile
   complete" and says exactly that.
7. Em dashes for asides. No exclamation marks.

---

## 10. Ready-to-paste brief

> Build a mobile-first React + TypeScript + Tailwind web app called **Mumbai Civic
> Map**: a full-screen MapLibre map with three modes switched by small translucent
> chips in the top-left — **Ask map**, **Hang out**, **Events** — plus **Monsoon**
> and **Metro** layer toggle chips beneath them and a round privacy (shield) chip
> on the right. No login wall: everything is browsable anonymously, and an account
> is offered inline only when the user tries to join, post or chat.
>
> **Design system.** Semantic colour tokens as CSS variables in `R G B` form so one
> set of class names renders light and dark (no `dark:` classes). Light: canvas
> `#f1f5f9`, surface white, sunken `#f8fafc`, ink `#0f172a`, muted `#475569`,
> subtle `#818c9e`, line `#e2e8f0`, accent teal `#0d6e76`. Dark: canvas `#090d14`,
> surface `#121821`, ink `#edf2f9`, accent `#2dd4bf`. Status colours — positive
> `#059669`, caution `#d97706`, critical `#dc2626`, info `#0284c7` — each with a
> `-soft` background and `-ink` text variant. The accent is only ever used for
> focus, links and active state, never for status.
>
> Type scale: 11 / 12 / 13 / 15 / 17 / 21 / 26px, system font stack, no webfonts,
> tabular numerals on all distances, times, prices and counts. Radii: cards
> 0.875rem, sheets 1.25rem, buttons and chips fully round. Three shadow levels
> only. One easing curve, `cubic-bezier(0.22, 1, 0.36, 1)`. Honour
> `prefers-reduced-motion`.
>
> The signature control is the **chip**: a round translucent pill with
> `backdrop-blur`, `bg-surface/90`, muted text and a low shadow when idle;
> inverted to dark fill with light text when active. Mode chips and layer chips
> are the same size — never turn the mode switcher into a large segmented bar.
>
> **Ask map** shows a bottom sheet with a grab handle that expands from 46vh to
> 80vh. Empty state: "Ask Mumbai's map", a green privacy pill, and six suggestion
> cards with leading icons. Conversation: right-aligned dark user bubbles, plain
> left-aligned answers, a three-dot "Working it out" indicator, and — on every
> single answer — a provenance line reading "Answered on your device — nothing
> was sent anywhere". There is no server-side answering path: the question is
> parsed and ranked in the browser, and each result card shows the facts it was
> ranked on ("park · 310 m · open now"). Composer: a "Near me" toggle pill, a round input, and a
> round accent send button. Selecting a place swaps the sheet for a detail panel
> with a **Go** button offering walk / car / public transport.
>
> **Hang out** is a full screen with its own bottom navigation — Explore, Trips,
> Chats, You — where the You tab shows the user's avatar with an accent ring when
> active. Explore keeps the map visible with floating category chips, a
> Visible/Invisible presence toggle, a "3 people sharing" pill with a pulsing dot,
> a round recentre button, a "See list" pill, and a 3.25rem round accent **+** FAB.
> The list slides up as a sheet with activity rows: emoji circle, title, a pulsing
> "Now" tag for live ones, venue, and a meta line of time · distance · "3 of 8".
>
> **Events** has the same shape but no bottom nav and the list open by default.
> Two rows of chips: All / Tech / Meetups / Music / Comedy / Arts / Sport / Food,
> then Free / Anytime / Today / This week. Event cards show an emoji circle,
> title, venue, time, right-aligned price (green when free), and tags for source,
> category, attendee count and "You're going". **Every event carries a source
> badge** — Member post (accent), Luma (info), Ticketed (info), Regular night
> (grey) — and they must stay visually distinct, never flattened into one
> confident list.
>
> **The governing principle is visible honesty.** This app never states what it
> doesn't know. Show "Price unknown" rather than "Free"; show "time unknown"
> rather than a made-up hour; render an approximated route as a dashed line, never
> solid; explain why a result list is empty; and say plainly that the events board
> is partial rather than implying it is complete. Build the caveat into the
> component, not as an afterthought.
>
> Everything must work at 400px wide, keep a 16px side gutter, use minimum
> 2.25rem touch targets, respect `env(safe-area-inset-bottom)` on bottom sheets,
> and show one keyboard-only focus ring (`ring-2 ring-accent ring-offset-2`).
