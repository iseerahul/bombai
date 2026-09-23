-- Remove every account made by the local dev sign-in, and everything it owns.
-- Real Google accounts (google_sub not starting with 'dev:') are untouched.
DELETE FROM activity_messages WHERE profile_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM activity_members  WHERE profile_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM activity_messages WHERE activity_id IN (SELECT id FROM activities WHERE creator_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%'));
DELETE FROM activity_members  WHERE activity_id IN (SELECT id FROM activities WHERE creator_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%'));
DELETE FROM activities        WHERE creator_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM dm_messages       WHERE thread_id IN (SELECT id FROM dm_threads WHERE user_a IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%') OR user_b IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%'));
DELETE FROM dm_threads        WHERE user_a IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%') OR user_b IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM trip_members      WHERE user_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM trips             WHERE user_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM presence          WHERE user_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM blocks            WHERE blocker_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%') OR blocked_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM abuse_reports     WHERE reporter_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM sessions          WHERE user_id IN (SELECT id FROM users WHERE google_sub LIKE 'dev:%');
DELETE FROM users             WHERE google_sub LIKE 'dev:%';
