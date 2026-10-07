CREATE TABLE IF NOT EXISTS auth_sessions (id_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_attempts (ip_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_end INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS auth_attempts_expiry ON auth_attempts(window_end);
CREATE TABLE IF NOT EXISTS photo_objects (key TEXT PRIMARY KEY, size INTEGER NOT NULL CHECK(size > 0), checksum TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photo_chunks (key TEXT NOT NULL REFERENCES photo_objects(key) ON DELETE CASCADE, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(key, part));
