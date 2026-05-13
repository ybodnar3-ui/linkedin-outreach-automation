import { db } from './storage';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export interface Account {
  id: string;
  name: string;
  email: string | null;
  status: 'disconnected' | 'active' | 'error';
  session_file: string;
  health_score: number;
  proxy_host: string | null;
  proxy_port: string | null;
  proxy_user: string | null;
  proxy_password: string | null;
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

export function updateAccountProxy(
  id: string,
  proxy: { host: string | null; port: string | null; user: string | null; password: string | null }
): void {
  db.prepare(`
    UPDATE accounts
    SET proxy_host = ?, proxy_port = ?, proxy_user = ?, proxy_password = ?, updated_at = ?
    WHERE id = ?
  `).run(proxy.host, proxy.port, proxy.user, proxy.password, Math.floor(Date.now() / 1000), id);
}

export function getAccountProxy(id: string): { server: string; username?: string; password?: string } | undefined {
  const acc = db.prepare('SELECT proxy_host, proxy_port, proxy_user, proxy_password FROM accounts WHERE id = ?')
    .get(id) as { proxy_host: string | null; proxy_port: string | null; proxy_user: string | null; proxy_password: string | null } | undefined;
  if (!acc?.proxy_host) return undefined;
  const port = acc.proxy_port || '8080';
  return {
    server: `http://${acc.proxy_host}:${port}`,
    username: acc.proxy_user || undefined,
    password: acc.proxy_password || undefined,
  };
}
