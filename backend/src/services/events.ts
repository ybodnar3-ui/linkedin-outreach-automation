/**
 * events.ts — per-lead append-only event log.
 *
 * Every meaningful transition (queued / connection sent / accepted / messaged /
 * replied / failed / dead-lettered / warning) is recorded here so the lead's
 * full history is auditable from the dashboard — no SQLite surgery needed.
 */

import { randomUUID } from 'crypto';
import { db } from './storage';

export type LeadEventType =
  | 'task_queued'
  | 'visited'
  | 'connection_sent'
  | 'connection_accepted'
  | 'message_sent'
  | 'replied'
  | 'skipped'
  | 'failed'
  | 'dead_lettered'
  | 'warning'
  | 'not_connected';

export interface LeadEvent {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  type: string;
  message: string | null;
  metadata: string | null;
  created_at: number;
}

/** Append an event for a lead. Never throws — observability must not break flow. */
export function recordLeadEvent(
  leadId: string,
  type: LeadEventType,
  message?: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    const campaign = db.prepare('SELECT campaign_id FROM leads WHERE id = ?').get(leadId) as
      | { campaign_id: string }
      | undefined;
    db.prepare(`
      INSERT INTO lead_events (id, lead_id, campaign_id, type, message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      leadId,
      campaign?.campaign_id ?? null,
      type,
      message ?? null,
      metadata ? JSON.stringify(metadata) : null,
      Math.floor(Date.now() / 1000),
    );
  } catch {
    /* swallow — event logging is best-effort */
  }
}

/** Recent events for a single lead, newest first. */
export function getLeadEvents(leadId: string, limit = 100): LeadEvent[] {
  return db.prepare(
    'SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
  ).all(leadId, limit) as LeadEvent[];
}
