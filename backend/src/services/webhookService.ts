/**
 * Webhook service — fire HTTP POST notifications to registered URLs when events occur.
 *
 * Events fired:
 *   connection_accepted  — lead accepted connection request
 *   replied              — lead sent an inbound message
 *   lead_completed       — lead finished all campaign steps
 *   lead_skipped         — lead was skipped (blacklist / manual / timeout)
 *   campaign_started     — campaign status changed to active
 *   campaign_paused      — campaign status changed to paused
 *
 * Payload shape (all events):
 *   { event: string, ts: number, data: object }
 *
 * If a webhook has a secret, the request includes header:
 *   X-Webhook-Signature: sha256=<hex>
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from './storage';
import { logger } from '../utils/logger';

/**
 * SSRF guard: reject webhook URLs that target internal/private networks.
 * Only public https:// (or http:// for explicit non-local hosts) is allowed.
 */
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;

  const host = u.hostname.toLowerCase();
  // Block obvious local names
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;

  // Block private / loopback / link-local IP ranges
  const privatePatterns = [
    /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[01])\./,      // 172.16-31.x
    /^0\./, /^::1$/, /^fe80:/i, /^fc00:/i, /^fd00:/i,
  ];
  if (privatePatterns.some(re => re.test(host))) return false;
  // Cloud metadata endpoint
  if (host === '169.254.169.254') return false;

  return true;
}

export interface Webhook {
  id: string;
  url: string;
  events: string;        // JSON-encoded string[]
  secret: string | null;
  active: number;        // 1 | 0
  created_at: number;
}

export type WebhookEvent =
  | 'connection_accepted'
  | 'replied'
  | 'lead_completed'
  | 'lead_skipped'
  | 'campaign_started'
  | 'campaign_paused';

export const ALL_EVENTS: WebhookEvent[] = [
  'connection_accepted',
  'replied',
  'lead_completed',
  'lead_skipped',
  'campaign_started',
  'campaign_paused',
];

function sign(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Fire an event to all active webhooks subscribed to it.
 * Non-blocking — errors are logged but not thrown.
 */
export async function fireWebhookEvent(event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  const webhooks = db.prepare(
    "SELECT * FROM webhooks WHERE active = 1"
  ).all() as Webhook[];

  if (webhooks.length === 0) return;

  const payload = JSON.stringify({ event, ts: Math.floor(Date.now() / 1000), data });

  const targets = webhooks.filter(wh => {
    try {
      const events: string[] = JSON.parse(wh.events);
      return events.includes(event);
    } catch {
      return false;
    }
  });

  await Promise.allSettled(
    targets.map(async (wh) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (wh.secret) {
        headers['X-Webhook-Signature'] = sign(wh.secret, payload);
      }

      // Skip any URL that fails the SSRF check (covers legacy rows in DB)
      if (!isSafeWebhookUrl(wh.url)) {
        logger.warn('Webhook skipped — unsafe URL', { event, url: wh.url });
        return;
      }

      try {
        const res = await fetch(wh.url, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(10_000),
        });
        logger.info('Webhook fired', { event, url: wh.url, status: res.status });
      } catch (err) {
        logger.warn('Webhook delivery failed', { event, url: wh.url, error: String(err) });
      }
    }),
  );
}

// ─── CRUD helpers used by the route ─────────────────────────────────────────

export function listWebhooks(): Webhook[] {
  return db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as Webhook[];
}

export function createWebhook(url: string, events: WebhookEvent[], secret?: string): Webhook {
  if (!isSafeWebhookUrl(url)) {
    throw new Error('Webhook URL must be a public http(s) address (private/internal hosts are not allowed)');
  }
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO webhooks (id, url, events, secret, active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, url, JSON.stringify(events), secret || null, now);
  return db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Webhook;
}

export function deleteWebhook(id: string): void {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
}

export function toggleWebhook(id: string, active: boolean): void {
  db.prepare('UPDATE webhooks SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}
