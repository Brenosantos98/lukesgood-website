CREATE TABLE leads (id TEXT PRIMARY KEY, source_id TEXT UNIQUE, name TEXT NOT NULL, phone TEXT NOT NULL, zip TEXT NOT NULL DEFAULT '', services TEXT NOT NULL DEFAULT '', timing TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'New', assignee TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', ad_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE notifications (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id), channel TEXT NOT NULL, target TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL);
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX notifications_pending ON notifications(state, attempts);
CREATE INDEX leads_created ON leads(created_at);
