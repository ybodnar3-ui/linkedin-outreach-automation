/**
 * backup.ts — periodic online backups of the SQLite database.
 *
 * All the value of this product lives in `leads` + history, so a daily snapshot
 * (plus one on startup) is cheap insurance. Uses better-sqlite3's online backup
 * API, which is safe to run against the live DB. Keeps the most recent N files.
 */

import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { db } from './storage';
import { logger } from '../utils/logger';

const BACKUP_DIR = path.join(process.cwd(), '..', 'data', 'backups');
const KEEP = 7;

export async function backupDatabase(): Promise<string | null> {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(BACKUP_DIR, `database-${stamp}.sqlite`);

    await db.backup(dest);

    // Prune oldest, keep most recent KEEP.
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^database-.*\.sqlite$/.test(f))
      .sort(); // ISO timestamps sort chronologically
    while (files.length > KEEP) {
      const old = files.shift();
      if (old) fs.unlinkSync(path.join(BACKUP_DIR, old));
    }

    logger.info('Database backup written', { dest, kept: Math.min(files.length, KEEP) });
    return dest;
  } catch (err) {
    logger.error('Database backup failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Daily backup at 03:00 + one shortly after startup. */
export function startBackupScheduler(): void {
  cron.schedule('0 3 * * *', () => { void backupDatabase(); });
  setTimeout(() => { void backupDatabase(); }, 10_000);
  logger.info('Backup scheduler started (daily 03:00 + startup)');
}
