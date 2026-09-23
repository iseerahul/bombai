-- Community reports.
--
-- Note what this schema does NOT have: no user table, no session table, no IP
-- column, no device id. A report is a claim about a place, tied to nothing and
-- no one. That is the whole point of the project, so it is enforced by the
-- absence of columns rather than by policy.

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  -- Null for standalone reports (flooding is reported at a point, not a POI).
  poi_id      TEXT,
  -- Rounded to ~110m by the Worker before insert.
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  -- working | broken | closed | flooded | clear
  kind        TEXT NOT NULL,
  -- ankle | knee | waist — only meaningful when kind = 'flooded'
  depth       TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  -- Enforced on read AND swept by cron. Flooding: +8h. Infrastructure: +30d.
  expires_at  INTEGER NOT NULL,
  up          INTEGER NOT NULL DEFAULT 0,
  down        INTEGER NOT NULL DEFAULT 0
);

-- Reads are always "live reports in this map viewport", so filter on expiry first.
CREATE INDEX IF NOT EXISTS idx_reports_live ON reports (expires_at, lat, lon);
CREATE INDEX IF NOT EXISTS idx_reports_poi ON reports (poi_id, expires_at);

-- Pseudonymous rate-limit buckets.
--
-- `bucket` is scope + a SHA-256 of (server salt | UTC date | IP), truncated.
-- Because the date is inside the hash, the same visitor hashes differently
-- tomorrow, so these rows cannot be joined into a history of anyone. Raw IPs
-- are never stored.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_window ON rate_limits (window_start);

-- ===========================================================================
-- Hangouts: activities at public venues
-- ===========================================================================
--
-- This is the first feature that needs to know who someone is across requests
-- (approve a join, attribute a chat message). It uses a pseudonymous profile
-- created locally in the browser: a random id, a chosen display name, and a
-- secret used as a bearer token. No email, no phone, no signup, no recovery.
--
-- Note what is still absent: members' own coordinates are never stored. Only
-- the VENUE's public location is, and that comes from the map dataset. So the
-- database knows "someone called Anwesha joined football at Shivaji Park",
-- never where that person actually is.

CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  -- SHA-256 of the browser-held secret. The raw secret never touches storage,
  -- so a database leak cannot be used to impersonate anyone.
  secret_hash TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,          -- sports | food | study | other
  note        TEXT,
  -- Pin glyph, chosen in the create flow. One to three code points.
  emoji       TEXT,
  -- Must be an id from the shipped map dataset ("osm:node/123", "mcgm:toilet/4").
  -- Activities cannot be created at an arbitrary dropped pin, which is what
  -- keeps every meeting at a public, already-mapped place.
  -- Null when the activity is "around here" rather than at a named place.
  -- See the venue rule in hangouts.ts: pinned activities keep exact
  -- coordinates, approximate ones are snapped to a ~250 m grid.
  venue_id    TEXT,
  venue_name  TEXT NOT NULL,
  -- The VENUE's coordinates, from the public dataset. Never a member's own.
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  capacity    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  -- Enforced on read and swept by cron. An activity and its whole chat vanish
  -- a couple of hours after it ends: nothing accumulates to be mined later.
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_live ON activities (expires_at, lat, lon);
CREATE INDEX IF NOT EXISTS idx_activities_creator ON activities (creator_id, expires_at);

CREATE TABLE IF NOT EXISTS activity_members (
  activity_id  TEXT NOT NULL,
  profile_id   TEXT NOT NULL,
  -- Denormalised so a chat transcript stays readable even if someone renames.
  name         TEXT NOT NULL,
  status       TEXT NOT NULL,         -- pending | approved | declined
  requested_at INTEGER NOT NULL,
  decided_at   INTEGER,
  PRIMARY KEY (activity_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_members_activity ON activity_members (activity_id, status);

-- Group messages only. There is deliberately no direct-message table: with no
-- schema to hold a private conversation, the feature cannot be added by
-- accident later.
CREATE TABLE IF NOT EXISTS activity_messages (
  id          TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  profile_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_activity ON activity_messages (activity_id, created_at);

-- ===========================================================================
-- v2: real accounts, DMs, presence, travel trips
-- ===========================================================================
--
-- The hangout side became a separate, logged-in app. That replaces the
-- pseudonymous browser profile with a real account, and adds features the
-- earlier design deliberately excluded — direct messages and live location —
-- at the product owner's explicit direction after the trade-offs were raised.
--
-- Because those two exist, block and report are NOT optional here. They are
-- the only thing standing between "someone is bothering me" and "I have to
-- delete the app".
--
-- The public side (Ask / Trip) still touches none of this. It has no session,
-- no user id, and no access to these tables.

-- Superseded by `users`. Kept out of the way rather than silently reused.
DROP TABLE IF EXISTS profiles;

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  -- Google's stable subject id. The only thing we keep from the OAuth
  -- provider besides a name and picture — no tokens are stored.
  google_sub   TEXT NOT NULL UNIQUE,
  email        TEXT,
  name         TEXT NOT NULL,
  avatar_url   TEXT,
  age          INTEGER,
  city         TEXT,
  bio          TEXT,
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_sub ON users (google_sub);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,   -- opaque random token, sent as an HttpOnly cookie
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, expires_at);

-- --- direct messages ---------------------------------------------------------
-- A thread is keyed by the ordered pair of user ids, so the same two people can
-- only ever have one.
CREATE TABLE IF NOT EXISTS dm_threads (
  id              TEXT PRIMARY KEY,
  user_a          TEXT NOT NULL,          -- always the lexicographically smaller id
  user_b          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);

CREATE INDEX IF NOT EXISTS idx_dm_threads_a ON dm_threads (user_a, last_message_at);
CREATE INDEX IF NOT EXISTS idx_dm_threads_b ON dm_threads (user_b, last_message_at);

CREATE TABLE IF NOT EXISTS dm_messages (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL,
  sender_id  TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages (thread_id, created_at);

-- --- live presence -----------------------------------------------------------
-- Deliberately short-lived. A row here is "where this person was recently",
-- not a history: there is one row per user, overwritten on each update, and it
-- expires on its own. No trail is kept, because none is stored.
CREATE TABLE IF NOT EXISTS presence (
  user_id    TEXT PRIMARY KEY,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Sharing is a switch the user holds. Off means the row is deleted outright.
  visible    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_presence_live ON presence (expires_at, lat, lon);

-- --- travel trips ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  destination TEXT NOT NULL,
  country     TEXT,
  starts_on   INTEGER NOT NULL,
  ends_on     INTEGER NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trips_when ON trips (starts_on);
CREATE INDEX IF NOT EXISTS idx_trips_user ON trips (user_id);

CREATE TABLE IF NOT EXISTS trip_members (
  trip_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, user_id)
);

-- --- safety ------------------------------------------------------------------
-- A block is one-directional and total: the blocker disappears from the
-- blocked user's map, chat list and activity rosters, and messages between
-- them are refused in both directions.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,        -- user | activity | message
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_target ON abuse_reports (target_type, target_id);

-- ===========================================================================
-- v3: chat rooms
-- ===========================================================================
--
-- Activity chats and destination chats ("everyone going to Bali") are the same
-- thing with different owners, so they share one model. A room is addressed by
-- (kind, ref_id): an activity id, or a destination slug.
--
-- This replaces activity_messages/activity_members-as-chat. activity_members
-- still exists, but only to record who is going; membership of the CHAT is
-- room_members.

CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,          -- activity | destination | event
  ref_id     TEXT NOT NULL,
  title      TEXT NOT NULL,
  emoji      TEXT,
  -- Destination rooms outlive any one trip; activity rooms die with theirs.
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_rooms_ref ON rooms (kind, ref_id);

CREATE TABLE IF NOT EXISTS room_members (
  room_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members (user_id);

CREATE TABLE IF NOT EXISTS room_messages (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_messages ON room_messages (room_id, created_at);

-- ===========================================================================
-- v4: events
-- ===========================================================================
--
-- Events differ from hangouts in who made them: a hangout is "I want to do
-- this, come along", an event is "this is happening, here's a ticket". So they
-- need a source, a price, and a link out — and crucially, a source LABEL, so a
-- member's post is never mistaken for a verified listing.
--
-- `source` is one of:
--   community    — posted by a member of this app
--   ticketmaster — pulled from the Ticketmaster Discovery API
--   seed         — curated list of known Mumbai venues/recurring events
--
-- External events are cached rather than owned: `external_id` is the provider's
-- id, and re-importing updates in place instead of duplicating.

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  -- Provider's own id. Null for community events. Unique per source so a
  -- re-import updates rather than duplicates.
  external_id  TEXT,
  -- Null for imported events; set for community ones so we know who to ask.
  creator_id   TEXT,
  title        TEXT NOT NULL,
  description  TEXT,
  category     TEXT,                 -- music | sport | arts | comedy | food | other
  emoji        TEXT,
  venue_name   TEXT NOT NULL,
  address      TEXT,
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER,
  -- 0 when the source gave us only a date. Imported listing pages often do;
  -- rendering that as midnight would be a fabricated time, so the UI shows
  -- "time unknown" instead.
  time_known   INTEGER NOT NULL DEFAULT 1,
  -- 0 = free. Stored in paise to avoid float money.
  price_min    INTEGER,
  price_max    INTEGER,
  currency     TEXT DEFAULT 'INR',
  -- Where to actually buy a ticket. Never faked for community events.
  ticket_url   TEXT,
  image_url    TEXT,
  created_at   INTEGER NOT NULL,
  -- Events disappear a day after they end; imported ones are refreshed instead.
  expires_at   INTEGER NOT NULL,
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_events_live ON events (expires_at, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_geo ON events (lat, lon);
CREATE INDEX IF NOT EXISTS idx_events_source ON events (source);

-- "I'm going". Separate from room membership so someone can be interested in
-- an event without being in its chat, and vice versa.
CREATE TABLE IF NOT EXISTS event_attendees (
  event_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_attendees ON event_attendees (event_id);

-- Geocoder results, cached so a repeated search never hits Nominatim twice.
-- Keyed by the normalised query, not the raw one, so case and punctuation
-- don't split rows.
CREATE TABLE IF NOT EXISTS geocode_cache (
  q          TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geocode_exp ON geocode_cache(expires_at);

-- ---------------------------------------------------------------------------
-- The board
--
-- Two separate things, deliberately not one table:
--
--   visits — "I was here on this date, here are my photos." Private to its
--            owner. No public endpoint ever reads this table for anyone but
--            the authenticated owner.
--   spots  — "This place exists and is worth going to." Public, aggregated
--            across people, and what the recommender reads.
--
-- Publishing a visit copies the shareable parts into a spot. The visit date,
-- the note and the owner stay behind.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS visits (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  -- What was visited. A baked POI, a community spot, or neither (dropped pin).
  poi_id      TEXT,
  spot_id     TEXT,
  label       TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  category    TEXT,
  visited_at  INTEGER NOT NULL,
  note        TEXT,
  -- JSON array of tag keys, kept denormalised: it is only ever read whole.
  tags        TEXT NOT NULL DEFAULT '[]',
  published   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(user_id, visited_at DESC);

CREATE TABLE IF NOT EXISTS visit_photos (
  id         TEXT PRIMARY KEY,
  visit_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  -- Object key in R2. The bytes never touch D1.
  obj_key    TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  bytes      INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_visit ON visit_photos(visit_id);

CREATE TABLE IF NOT EXISTS spots (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  lat               REAL NOT NULL,
  lon               REAL NOT NULL,
  category          TEXT NOT NULL,
  note              TEXT,
  added_by          TEXT,
  created_at        INTEGER NOT NULL,
  -- How many distinct people say this is real. One is one stranger's claim,
  -- which is why the UI shows the number rather than hiding it.
  confirmations     INTEGER NOT NULL DEFAULT 1,
  last_confirmed_at INTEGER,
  status            TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_spots_geo ON spots(lat, lon);

-- One row per (spot, tag, person). The primary key is what stops one
-- enthusiastic user from voting a place "chill" fifty times.
CREATE TABLE IF NOT EXISTS spot_tags (
  spot_id    TEXT NOT NULL,
  tag        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (spot_id, tag, user_id)
);

CREATE TABLE IF NOT EXISTS spot_confirmations (
  spot_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (spot_id, user_id)
);

-- Destination search results and photographs.
--
-- Cached hard: neither Photon nor Wikimedia Commons is ours to hammer, and a
-- country does not move. A stored empty payload means "we looked and found
-- nothing", which is worth remembering so a failed lookup is not retried on
-- every render.
CREATE TABLE IF NOT EXISTS destination_cache (
  k          TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dest_exp ON destination_cache(expires_at);
