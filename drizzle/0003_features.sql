CREATE TABLE IF NOT EXISTS private_config (owner TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner,key));
CREATE TABLE IF NOT EXISTS health_sync (owner TEXT PRIMARY KEY, token_hash TEXT, last_sync_at TEXT, item_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS weekly_reports (owner TEXT NOT NULL, week_end TEXT NOT NULL, payload TEXT NOT NULL, generated_at TEXT NOT NULL, PRIMARY KEY(owner,week_end));
