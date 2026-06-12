import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const DB_DIR = path.join(process.cwd(), '..', 'data');
const DB_PATH = path.join(DB_DIR, 'database.sqlite');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function addColumnIfNotExists(table: string, column: string, definition: string): void {
  // SQLite cannot parameterize identifiers, so validate them strictly.
  // Only simple [a-zA-Z_] names are allowed — prevents SQL injection if a
  // future caller ever passes non-literal input.
  const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!IDENT.test(table) || !IDENT.test(column)) {
    throw new Error(`Invalid identifier in addColumnIfNotExists: table=${table} column=${column}`);
  }
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Migration v1 (baseline): the full current schema, expressed idempotently
 * (CREATE TABLE IF NOT EXISTS + addColumnIfNotExists). Safe to run on a fresh
 * DB (builds everything) or an existing one (no-ops). Recorded as version 1.
 */
function applyBaselineSchema(): void {
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
  addColumnIfNotExists('campaign_steps', 'email_subject', 'TEXT');

  // leads migrations
  addColumnIfNotExists('leads', 'email', 'TEXT');
  addColumnIfNotExists('leads', 'email_source', "TEXT CHECK(email_source IN ('hunter','apollo','manual'))");
  addColumnIfNotExists('leads', 'email_found_at', 'INTEGER');
  addColumnIfNotExists('leads', 'email_status', "TEXT NOT NULL DEFAULT 'pending'");
  // enrichment fields scraped from LinkedIn profile
  addColumnIfNotExists('leads', 'headline', 'TEXT');
  addColumnIfNotExists('leads', 'summary', 'TEXT');
  addColumnIfNotExists('leads', 'location', 'TEXT');
  addColumnIfNotExists('leads', 'years_at_company', 'TEXT');
  addColumnIfNotExists('leads', 'school', 'TEXT');
  addColumnIfNotExists('leads', 'recent_post', 'TEXT');
  addColumnIfNotExists('leads', 'mutual_connections', 'TEXT');
  addColumnIfNotExists('leads', 'skills', 'TEXT');
  addColumnIfNotExists('leads', 'enriched_at', 'INTEGER');
  // reply detection
  addColumnIfNotExists('leads', 'replied_at', 'INTEGER');
  // CRM sync (HubSpot / Pipedrive)
  addColumnIfNotExists('leads', 'crm_contact_id', 'TEXT');
  addColumnIfNotExists('leads', 'crm_synced_at', 'INTEGER');
  // Built-in CRM pipeline
  addColumnIfNotExists('leads', 'crm_stage', "TEXT CHECK(crm_stage IN ('new','contacted','replied','call_booked','won','lost'))");
  addColumnIfNotExists('leads', 'crm_notes', 'TEXT');
  addColumnIfNotExists('leads', 'crm_next_follow_up', 'INTEGER');

  // Reliability: consecutive-failure counter for retry/backoff/dead-letter.
  addColumnIfNotExists('leads', 'fail_count', 'INTEGER NOT NULL DEFAULT 0');

  // Per-lead append-only event log (observability without SQLite surgery).
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_events (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      campaign_id TEXT,
      type TEXT NOT NULL,
      message TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_lead_events_type ON lead_events(type, created_at);
  `);

  // Webhooks
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      secret TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  // AI reply classification on inbox_messages
  addColumnIfNotExists('inbox_messages', 'sentiment', "TEXT CHECK(sentiment IN ('positive','negative','neutral','question','not_interested'))");
  addColumnIfNotExists('inbox_messages', 'sentiment_note', 'TEXT');

  // accounts health migrations
  addColumnIfNotExists('accounts', 'health_score', 'INTEGER NOT NULL DEFAULT 100');
  // accounts proxy migrations
  addColumnIfNotExists('accounts', 'proxy_host', 'TEXT');
  addColumnIfNotExists('accounts', 'proxy_port', 'TEXT');
  addColumnIfNotExists('accounts', 'proxy_user', 'TEXT');
  addColumnIfNotExists('accounts', 'proxy_password', 'TEXT');

  // blacklist table — domains and company names to never contact
  db.exec(`
    CREATE TABLE IF NOT EXISTS blacklist (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'domain',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // per-account daily tracker table
  // Migrations — safe on existing DBs
  addColumnIfNotExists('campaigns', 'website', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS account_daily_tracker (
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      connections_sent INTEGER NOT NULL DEFAULT 0,
      messages_sent INTEGER NOT NULL DEFAULT 0,
      profiles_visited INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, date)
    );
  `);

  // Seed extension token on first run — generate a random UUID, never hardcode
  const existingExtToken = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('extension_token');
  if (!existingExtToken) {
    db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)').run('extension_token', randomUUID());
  }

  // Chrome Extension task queue
  db.exec(`
    CREATE TABLE IF NOT EXISTS extension_tasks (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','claimed','done','failed')),
      result TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      claimed_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ext_tasks_account_status
      ON extension_tasks(account_id, status);
    CREATE INDEX IF NOT EXISTS idx_ext_tasks_lead
      ON extension_tasks(lead_id);

    -- Cross-process lease lock. Guarantees only ONE process runs the campaign
    -- worker at a time even if the backend is accidentally started twice
    -- (two workers = double LinkedIn actions = ban risk).
    CREATE TABLE IF NOT EXISTS worker_lock (
      name TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      heartbeat_at INTEGER NOT NULL
    );
  `);
}

// ── Versioned migrations ────────────────────────────────────────────────────────
// Replaces ad-hoc addColumnIfNotExists-at-startup. Every schema change is an
// ordered, recorded migration. The runner applies only versions newer than the
// max recorded, each inside a transaction. Add NEW changes as new entries below
// (never edit a shipped migration).

interface Migration {
  version: number;
  name: string;
  up: () => void;
}

const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline_schema', up: applyBaselineSchema },
  // Future schema changes go here as { version: 2, name: '...', up: () => { db.exec(...) } }
];

export interface MigrationRecord { version: number; name: string; applied_at: number; }

/** Apply any migrations newer than the recorded version. Idempotent. */
export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  const current = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
  const pending = MIGRATIONS.filter(m => m.version > current).sort((a, b) => a.version - b.version);

  for (const m of pending) {
    const apply = db.transaction(() => {
      m.up();
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, Math.floor(Date.now() / 1000));
    });
    apply();
  }
}

/** Migration history (for /health or ops introspection). */
export function getMigrations(): MigrationRecord[] {
  return db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all() as MigrationRecord[];
}

/** Entry point called on startup. */
export function initDb(): void {
  runMigrations();
}

/**
 * Try to acquire (or renew) a leased lock. Returns true if THIS holder owns it.
 *
 * The lease is stolen only if the current holder's heartbeat is older than
 * `ttlSeconds` (i.e. the previous owner died). The holder must call this again
 * each cycle to renew its heartbeat. Atomic via a single conditional UPSERT.
 */
export function acquireWorkerLease(name: string, holder: string, ttlSeconds: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO worker_lock (name, holder, heartbeat_at)
    VALUES (@name, @holder, @now)
    ON CONFLICT(name) DO UPDATE SET
      holder = @holder,
      heartbeat_at = @now
    WHERE worker_lock.holder = @holder
       OR worker_lock.heartbeat_at < @now - @ttl
  `).run({ name, holder, now, ttl: ttlSeconds });

  const row = db.prepare('SELECT holder FROM worker_lock WHERE name = ?').get(name) as { holder: string } | undefined;
  return row?.holder === holder;
}

/** Release a leased lock if held by this holder (best-effort, e.g. on shutdown). */
export function releaseWorkerLease(name: string, holder: string): void {
  db.prepare('DELETE FROM worker_lock WHERE name = ? AND holder = ?').run(name, holder);
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
  if (!['connections_sent', 'messages_sent', 'profiles_visited'].includes(field)) {
    throw new Error(`Invalid tracker field: ${field}`);
  }
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
