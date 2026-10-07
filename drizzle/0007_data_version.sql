-- Every write to the user's data bumps one counter, so the app can ask "anything new?" with a one-row read
-- instead of re-reading every record each time it comes back to the foreground.
ALTER TABLE profiles ADD COLUMN data_version INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER IF NOT EXISTS records_insert_version AFTER INSERT ON records BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS records_update_version AFTER UPDATE ON records BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS records_delete_version AFTER DELETE ON records BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = OLD.owner; END;
CREATE TRIGGER IF NOT EXISTS messages_insert_version AFTER INSERT ON messages BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS messages_update_version AFTER UPDATE ON messages BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS messages_delete_version AFTER DELETE ON messages BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = OLD.owner; END;
CREATE TRIGGER IF NOT EXISTS training_sessions_insert_version AFTER INSERT ON training_sessions BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS training_sessions_update_version AFTER UPDATE ON training_sessions BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS training_sessions_delete_version AFTER DELETE ON training_sessions BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = OLD.owner; END;
CREATE TRIGGER IF NOT EXISTS private_config_insert_version AFTER INSERT ON private_config BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS private_config_update_version AFTER UPDATE ON private_config BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS private_config_delete_version AFTER DELETE ON private_config BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = OLD.owner; END;
CREATE TRIGGER IF NOT EXISTS plan_changes_insert_version AFTER INSERT ON plan_changes BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS plan_changes_update_version AFTER UPDATE ON plan_changes BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS plan_changes_delete_version AFTER DELETE ON plan_changes BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = OLD.owner; END;
CREATE TRIGGER IF NOT EXISTS health_sync_insert_version AFTER INSERT ON health_sync BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS health_sync_update_version AFTER UPDATE ON health_sync BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = NEW.owner; END;
CREATE TRIGGER IF NOT EXISTS health_sync_delete_version AFTER DELETE ON health_sync BEGIN UPDATE profiles SET data_version = data_version + 1 WHERE owner = OLD.owner; END;
