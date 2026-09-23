-- One-off for databases created before the emoji column existed.
ALTER TABLE activities ADD COLUMN emoji TEXT;
