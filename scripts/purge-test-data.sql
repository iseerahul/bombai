-- Wipe every account and everything attached to it.
--
-- Written for the moment Google sign-in replaced the local name-login: every
-- account created before that point was a dev shortcut that can no longer be
-- recreated, and the activities, trips and spots attached to them were test
-- fixtures showing up in shared lists as if they were real.
--
-- Deliberately NOT touched: `events` (imported from Luma and AllEvents, real),
-- `geocode_cache` (a cache, expensive to refill) and `reports` (anonymous, not
-- tied to any account).
DELETE FROM spot_tags;
DELETE FROM spot_confirmations;
DELETE FROM spots;
DELETE FROM visit_photos;
DELETE FROM visits;
DELETE FROM activity_members;
DELETE FROM activities;
DELETE FROM trip_members;
DELETE FROM trips;
DELETE FROM room_messages;
DELETE FROM room_members;
DELETE FROM rooms;
DELETE FROM dm_messages;
DELETE FROM dm_threads;
DELETE FROM event_attendees;
DELETE FROM presence;
DELETE FROM blocks;
DELETE FROM abuse_reports;
DELETE FROM sessions;
DELETE FROM users;
