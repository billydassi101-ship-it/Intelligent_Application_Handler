// Node.js 22+ built-in SQLite — no native compilation required!
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/app.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Schema initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    avatar TEXT,
    access_token TEXT,
    refresh_token TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS candidatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    entreprise TEXT NOT NULL,
    poste TEXT NOT NULL,
    type_contrat TEXT DEFAULT 'alternance',
    email_expediteur TEXT,
    date_candidature TEXT,
    date_accuse_reception TEXT NOT NULL,
    email_message_id TEXT UNIQUE,
    email_subject TEXT,
    email_body_excerpt TEXT,
    cv_mentionne INTEGER DEFAULT 0,
    statut TEXT DEFAULT 'en_attente',
    relance_message TEXT,
    relance_envoyee_at TEXT,
    reponse_recue_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    email_message_id TEXT,
    subject TEXT,
    from_address TEXT,
    received_at TEXT,
    analyzed INTEGER DEFAULT 0,
    is_candidature INTEGER DEFAULT 0,
    candidature_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_candidatures_user ON candidatures(user_id);
  CREATE INDEX IF NOT EXISTS idx_candidatures_statut ON candidatures(statut);
  CREATE INDEX IF NOT EXISTS idx_email_log_user ON email_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_email_log_msgid ON email_log(email_message_id);
`);

module.exports = db;
