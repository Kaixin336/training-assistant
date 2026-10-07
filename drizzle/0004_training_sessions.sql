CREATE TABLE IF NOT EXISTS training_sessions (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  payload TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  ended_at TEXT,
  PRIMARY KEY(owner,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS training_sessions_open_date ON training_sessions(owner,date) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS training_sessions_recent ON training_sessions(owner,last_activity_at);
