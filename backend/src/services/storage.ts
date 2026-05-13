import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), '..', 'data');
const DB_PATH = path.join(DB_DIR, 'database.sqlite');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function addColumnIfNotExists(table: string, column: string, definition: string): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS campaign_steps (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      action TEXT NOT NULL,
      wait_days INTEGER NOT NULL DEFAULT 0,
      condition TEXT NOT NULL DEFAULT 'always',
      template_id TEXT,
      message_text TEXT,
      UNIQUE(campaign_id, step_order)
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      linkedin_url TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      company TEXT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step INTEGER NOT NULL DEFAULT 0,
      next_action_at INTEGER,
      connection_sent_at INTEGER,
      connected_at INTEGER,
      last_message_at INTEGER,
      skip_reason TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(campaign_id, linkedin_url)
    );

    CREATE TABLE IF NOT EXISTS daily_tracker (
      date TEXT PRIMARY KEY,
      connections_sent INTEGER NOT NULL DEFAULT 0,
      messages_sent INTEGER NOT NULL DEFAULT 0,
      profiles_visited INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'disconnected',
      session_file TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS inbox_messages (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      direction TEXT NOT NULL CHECK(direction IN ('in','out')),
      sender_name TEXT,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ab_tests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      step_id TEXT REFERENCES campaign_steps(id) ON DELETE CASCADE,
      sent_a INTEGER NOT NULL DEFAULT 0,
      sent_b INTEGER NOT NULL DEFAULT 0,
      replies_a INTEGER NOT NULL DEFAULT 0,
      replies_b INTEGER NOT NULL DEFAULT 0,
      winner TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ab_test_variants (
      id TEXT PRIMARY KEY,
      ab_test_id TEXT NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
      variant TEXT NOT NULL CHECK(variant IN ('a','b')),
      text TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leads_campaign_status ON leads(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_leads_next_action ON leads(next_action_at);
    CREATE INDEX IF NOT EXISTS idx_campaign_steps_order ON campaign_steps(campaign_id, step_order);
    CREATE INDEX IF NOT EXISTS idx_inbox_thread ON inbox_messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_inbox_account ON inbox_messages(account_id);
    CREATE INDEX IF NOT EXISTS idx_ab_test_step ON ab_tests(step_id);
  `);

  // Column migrations — idempotent, safe to run on existing data
  // campaigns migrations
  addColumnIfNotExists('campaigns', 'account_id', 'TEXT REFERENCES accounts(id) ON DELETE SET NULL');

  // campaign_steps migrations
  addColumnIfNotExists('campaign_steps', 'branch_type', "TEXT CHECK(branch_type IN ('if_connected','if_not_connected','if_replied','if_not_replied'))");
  addColumnIfNotExists('campaign_steps', 'branch_condition_days', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfNotExists('campaign_steps', 'next_step_true_id', 'TEXT REFERENCES campaign_steps(id) ON DELETE SET NULL');
  addColumnIfNotExists('campaign_steps', 'next_step_false_id', 'TEXT REFERENCES campaign_steps(id) ON DELETE SET NULL');
  addColumnIfNotExists('campaign_steps', 'ab_test_id', 'TEXT REFERENCES ab_tests(id) ON DELETE SET NULL');

  // leads migrations
  addColumnIfNotExists('leads', 'email', 'TEXT');
  addColumnIfNotExists('leads', 'email_source', "TEXT CHECK(email_source IN ('hunter','apollo','manual'))");
  addColumnIfNotExists('leads', 'email_found_at', 'INTEGER');
  addColumnIfNotExists('leads', 'email_status', "TEXT NOT NULL DEFAULT 'pending'");
}

export function getTodayTracker(): { connections_sent: number; messages_sent: number; profiles_visited: number } {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare('SELECT * FROM daily_tracker WHERE date = ?').get(today) as
    | { date: string; connections_sent: number; messages_sent: number; profiles_visited: number }
    | undefined;

  if (!row) {
    db.prepare('INSERT OR IGNORE INTO daily_tracker (date) VALUES (?)').run(today);
    return { connections_sent: 0, messages_sent: 0, profiles_visited: 0 };
  }
  return row;
}

export function incrementTracker(field: 'connections_sent' | 'messages_sent' | 'profiles_visited'): void {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`INSERT INTO daily_tracker (date, ${field}) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + 1`).run(today);
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

export { db };
export type { DatabaseType };
