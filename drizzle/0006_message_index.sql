-- Opening the app reads the newest 150 messages; without this index D1 scans (and bills) every message ever written.
CREATE INDEX IF NOT EXISTS messages_owner_created ON messages(owner, created_at);
-- Lets the weekly job prune old idempotency receipts without a full scan.
CREATE INDEX IF NOT EXISTS operations_created ON operations(created_at);
