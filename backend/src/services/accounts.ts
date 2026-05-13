import { db } from './storage';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export interface Account {
  id: string;
  name: string;
  email: string | null;
  status: 'disconnected' | 'active' | 'error';
  session_file: string;
  created_at: number;
  updated_at: number;
}

const SESSION_DIR = path.join(process.cwd(), '..', 'data', 'sessions');

export function createAccount(name: string, email?: string): Account {
  const id = uuidv4();
  const session_file = path.join(SESSION_DIR, `${id}.json`);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO accounts (id, name, email, status, session_file, created_at, updated_at)
    VALUES (?, ?, ?, 'disconnected', ?, ?, ?)
  `).run(id, name, email ?? null, session_file, now, now);
  return getAccount(id)!;
}

export function listAccounts(): Account[] {
  return db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all() as Account[];
}

export function getAccount(id: string): Account | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
}

export function updateAccountStatus(id: string, status: Account['status']): void {
  db.prepare('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Math.floor(Date.now() / 1000), id);
}

export function deleteAccount(id: string): void {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}
