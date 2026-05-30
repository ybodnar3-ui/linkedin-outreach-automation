/**
 * extension.ts
 * API routes for the Chrome Extension companion.
 * Authentication: uses a dedicated extension_token (NOT the JWT used by the frontend).
 *
 * Routes:
 *   POST /api/extension/ping   — heartbeat, updates account last-seen timestamp
 *   GET  /api/extension/poll   — extension polls for next pending task
 *   POST /api/extension/result — extension reports task completion
 *   GET  /api/extension/token  — returns current extension token (requires JWT via query param or header)
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, getSetting, setSetting } from '../services/storage';
import { logger } from '../utils/logger';
import { broadcastLog } from '../index';
import { fireWebhookEvent } from '../services/webhookService';
import { syncLeadToCrm } from '../services/crmSync';

const router = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

function getOrCreateExtensionToken(): string {
  let token = getSetting('extension_token');
  if (!token) {
    // Generate a fresh random token — never hardcode a default
    token = uuidv4();
    setSetting('extension_token', token);
    logger.info('Extension token generated (first run)');
  }
  return token;
}

function verifyExtensionToken(req: Request): boolean {
  const token = getOrCreateExtensionToken(); // seeds default if missing
  const auth = req.headers.authorization;
  return auth === `Bearer ${token}`;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

/**
 * POST /api/extension/ping
 * Extension sends this every 30 s to indicate it's alive.
 * Updates ext_last_seen_<accountId> in app_settings so the worker knows
 * whether to queue tasks or fall back to Playwright.
 */
router.post('/ping', (req: Request, res: Response) => {
  if (!verifyExtensionToken(req)) return res.status(401).json({ error: 'Invalid extension token' });

  const { account_id } = req.body;
  if (!account_id) return res.status(400).json({ error: 'account_id required' });

  const now = Math.floor(Date.now() / 1000);
  setSetting(`ext_last_seen_${account_id}`, String(now));

  // Mark account as active if it isn't already
  db.prepare("UPDATE accounts SET status = 'active', updated_at = ? WHERE id = ? AND status != 'active'")
    .run(now, account_id);

  const pending = (db.prepare(
    "SELECT COUNT(*) as count FROM extension_tasks WHERE account_id = ? AND status = 'pending'",
  ).get(account_id) as { count: number }).count;

  const claimed = (db.prepare(
    "SELECT COUNT(*) as count FROM extension_tasks WHERE account_id = ? AND status = 'claimed'",
  ).get(account_id) as { count: number }).count;

  return res.json({ ok: true, pending_count: pending, claimed_count: claimed });
});

// ── Poll for next task ────────────────────────────────────────────────────────

/**
 * GET /api/extension/poll?account_id=xxx
 * Extension polls this every 30 s to pick up its next task.
 * Returns the task and marks it as 'claimed'.
 * Tasks claimed for > 30 min without a result are automatically failed.
 */
router.get('/poll', (req: Request, res: Response) => {
  if (!verifyExtensionToken(req)) return res.status(401).json({ error: 'Invalid extension token' });

  const accountId = req.query.account_id as string;
  if (!accountId) return res.status(400).json({ error: 'account_id required' });

  // Expire stale claimed tasks (> 30 min) and immediately unblock their leads
  const now = Math.floor(Date.now() / 1000);
  const staleThreshold = now - 1800;

  // Get stale task lead IDs before updating
  const staleLeadIds = (db.prepare(
    "SELECT lead_id FROM extension_tasks WHERE status = 'claimed' AND claimed_at < ? AND account_id = ?",
  ).all(staleThreshold, accountId) as Array<{ lead_id: string }>).map(r => r.lead_id);

  const stale = db.prepare(
    "UPDATE extension_tasks SET status = 'failed', error_message = 'timeout_no_result', completed_at = ? WHERE status = 'claimed' AND claimed_at < ? AND account_id = ?",
  ).run(now, staleThreshold, accountId);

  if (stale.changes > 0) {
    logger.warn('Extension tasks timed out — resetting leads for immediate retry', { accountId, count: stale.changes });
    // Reset lead next_action_at so the worker re-queues promptly (not in 1 hour)
    for (const leadId of staleLeadIds) {
      db.prepare("UPDATE leads SET next_action_at = ?, status = 'pending', updated_at = ? WHERE id = ?")
        .run(now, now, leadId);
    }
  }

  // Get next pending task
  const task = db.prepare(
    "SELECT * FROM extension_tasks WHERE account_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1",
  ).get(accountId) as Record<string, unknown> | undefined;

  if (!task) return res.json({ task: null });

  // Claim it
  db.prepare("UPDATE extension_tasks SET status = 'claimed', claimed_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000), task.id);

  logger.info('Extension task claimed', { taskId: task.id, action: task.action, accountId });

  return res.json({
    task: {
      id: task.id,
      action: task.action,
      payload: JSON.parse((task.payload as string) || '{}'),
    },
  });
});

// ── Report task result ────────────────────────────────────────────────────────

/**
 * POST /api/extension/result
 * Extension reports the result of a claimed task.
 * Advances the lead to the next step based on the action type.
 */
router.post('/result', (req: Request, res: Response) => {
  if (!verifyExtensionToken(req)) return res.status(401).json({ error: 'Invalid extension token' });

  const { task_id, status, result, error_message } = req.body as {
    task_id: string;
    status: 'done' | 'failed';
    result?: Record<string, unknown>;
    error_message?: string;
  };

  if (!task_id || !status) return res.status(400).json({ error: 'task_id and status required' });

  // Validate status is one of the allowed values
  if (status !== 'done' && status !== 'failed') {
    return res.status(400).json({ error: 'status must be "done" or "failed"' });
  }

  const task = db.prepare('SELECT * FROM extension_tasks WHERE id = ?').get(task_id) as Record<string, unknown> | undefined;
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Idempotency: if task was already processed (not claimed), skip to avoid double-advancing the lead
  if (task.status !== 'claimed') {
    logger.warn('Extension result for non-claimed task — skipping (already processed)', { taskId: task_id, currentStatus: task.status });
    return res.json({ ok: true, already_processed: true });
  }

  const now = Math.floor(Date.now() / 1000);

  // Save task result
  db.prepare(
    "UPDATE extension_tasks SET status = ?, result = ?, error_message = ?, completed_at = ? WHERE id = ?",
  ).run(
    status === 'done' ? 'done' : 'failed',
    JSON.stringify(result || {}),
    error_message ?? null,
    now,
    task_id,
  );

  logger.info('Extension task result received', {
    taskId: task_id,
    action: task.action,
    status,
    leadId: task.lead_id,
  });

  if (status === 'done') {
    handleTaskSuccess(task, result || {}, now);
  } else {
    // Detect LinkedIn safety warnings (CAPTCHA / restriction / checkpoint / weekly limit).
    // These mean we MUST stop — continuing would get the account banned.
    const isWarning = (result as { warning?: boolean } | undefined)?.warning === true ||
      /LinkedIn warning:|captcha|account_restricted|checkpoint|weekly_invite_limit|authwall/i.test(error_message || '');

    if (isWarning) {
      // Pause the campaign this lead belongs to and alert via WebSocket
      const lead = db.prepare('SELECT campaign_id FROM leads WHERE id = ?').get(task.lead_id) as { campaign_id?: string } | undefined;
      if (lead?.campaign_id) {
        db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ?").run(now, lead.campaign_id);
      }
      // Keep the lead pending but defer 24h so we don't immediately retry the warning
      db.prepare('UPDATE leads SET next_action_at = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(now + 86400, 'pending', now, task.lead_id);
      logger.error('LinkedIn safety warning — campaign paused', { taskId: task_id, leadId: task.lead_id, campaignId: lead?.campaign_id, error: error_message });
      broadcastLog('warning', { warningType: error_message, leadId: task.lead_id, campaignId: lead?.campaign_id, message: 'Campaign paused due to LinkedIn safety warning' });
    } else {
      // Normal failure: retry in 1 hour
      db.prepare('UPDATE leads SET next_action_at = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(now + 3600, 'pending', now, task.lead_id);
      logger.warn('Extension task failed — lead retry in 1h', { taskId: task_id, error: error_message });
    }
  }

  return res.json({ ok: true });
});

// ── Campaigns list (for popup) ────────────────────────────────────────────────

router.get('/campaigns', (req: Request, res: Response) => {
  if (!verifyExtensionToken(req)) return res.status(401).json({ error: 'Invalid extension token' });
  const campaigns = db.prepare(
    "SELECT id, name FROM campaigns WHERE status IN ('active','draft') ORDER BY created_at DESC",
  ).all() as Array<{ id: string; name: string }>;
  return res.json(campaigns);
});

// ── Import leads from extension scrape ───────────────────────────────────────

router.post('/import-leads', (req: Request, res: Response) => {
  if (!verifyExtensionToken(req)) return res.status(401).json({ error: 'Invalid extension token' });

  const { campaign_id, leads } = req.body as {
    campaign_id: string;
    leads: Array<{
      linkedin_url: string;
      first_name?: string;
      last_name?: string;
      title?: string;
      company?: string;
    }>;
  };

  if (!campaign_id || !Array.isArray(leads)) {
    return res.status(400).json({ error: 'campaign_id and leads[] required' });
  }

  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaign_id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const now = Math.floor(Date.now() / 1000);
  // current_step = 1 to match the first campaign step's step_order (steps start at 1, NOT 0)
  // next_action_at = now so worker picks it up immediately
  const insert = db.prepare(`
    INSERT OR IGNORE INTO leads
      (id, campaign_id, linkedin_url, first_name, last_name, title, company,
       status, current_step, next_action_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;
  for (const lead of leads) {
    if (!lead.linkedin_url?.includes('/in/')) { skipped++; continue; }
    const ins = insert.run(
      uuidv4(), campaign_id, lead.linkedin_url,
      lead.first_name || null, lead.last_name || null,
      lead.title || null, lead.company || null,
      now, now, now,
    );
    if (ins.changes > 0) { added++; } else { skipped++; }
  }

  logger.info('Extension lead import', { campaign_id, added, skipped });
  return res.json({ ok: true, added, skipped });
});

// ── Token management ──────────────────────────────────────────────────────────

/**
 * GET /api/extension/token
 * Returns (or generates) the extension token.
 * Protected by the same JWT auth as other /api routes — this is intentional,
 * the endpoint is mounted BEFORE requireAuth in index.ts so we do our own check.
 */
router.get('/token', (req: Request, res: Response) => {
  // Requires valid JWT — same auth as the rest of /api
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jwt = require('jsonwebtoken');
    jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev-secret-change-in-production');
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const token = getOrCreateExtensionToken();
  return res.json({ extension_token: token });
});

/**
 * POST /api/extension/token/regenerate
 * Creates a new extension token. Requires JWT auth.
 */
router.post('/token/regenerate', (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jwt = require('jsonwebtoken');
    jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev-secret-change-in-production');
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const token = uuidv4();
  setSetting('extension_token', token);
  logger.info('Extension token regenerated');
  return res.json({ extension_token: token });
});

// ── Result handlers ───────────────────────────────────────────────────────────

interface Lead {
  id: string;
  campaign_id: string;
  current_step: number;
  connection_sent_at: number | null;
  connected_at: number | null;
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
}

interface CampaignStep {
  id: string;
  step_order: number;
  wait_days: number;
}

function handleTaskSuccess(task: Record<string, unknown>, result: Record<string, unknown>, now: number): void {
  const leadId = task.lead_id as string;
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as Lead | undefined;
  if (!lead) return;

  const step = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? AND step_order = ?')
    .get(lead.campaign_id, lead.current_step) as CampaignStep | undefined;

  const waitDays = step?.wait_days ?? 0;

  switch (task.action as string) {
    case 'visit_profile':
    case 'follow_profile':
      advanceLeadStep(leadId, lead.current_step, waitDays, now);
      break;

    case 'send_connection':
      if (result.sent) {
        db.prepare('UPDATE leads SET connection_sent_at = ?, updated_at = ? WHERE id = ?').run(now, now, leadId);
        broadcastLog('connection_sent', { leadId, url: lead.linkedin_url });
      }
      advanceLeadStep(leadId, lead.current_step, waitDays, now);
      break;

    case 'send_message':
      if (result.sent) {
        db.prepare('UPDATE leads SET last_message_at = ?, updated_at = ? WHERE id = ?').run(now, now, leadId);
        broadcastLog('message_sent', { leadId, url: lead.linkedin_url });
      }
      advanceLeadStep(leadId, lead.current_step, waitDays, now);
      break;

    case 'check_connection': {
      const connStatus = result.connection_status as string;
      if (connStatus === 'connected') {
        db.prepare('UPDATE leads SET connected_at = ?, updated_at = ? WHERE id = ?').run(now, now, leadId);
        broadcastLog('connection_accepted', { leadId, url: lead.linkedin_url });
        // CRM sync
        syncLeadToCrm(leadId).catch(err =>
          logger.error('CRM sync error on connection', { leadId, error: String(err) }),
        );
        fireWebhookEvent('connection_accepted', {
          leadId, linkedinUrl: lead.linkedin_url,
          firstName: lead.first_name, lastName: lead.last_name,
          company: lead.company, title: lead.title,
        }).catch(() => {});
        advanceLeadStep(leadId, lead.current_step, waitDays, now);
      } else if (connStatus === 'pending') {
        const sentAt = lead.connection_sent_at ?? now;
        const daysPending = (now - sentAt) / 86400;
        if (daysPending > 14) {
          db.prepare(
            "UPDATE leads SET status = 'skipped', skip_reason = 'connection_not_accepted_14d', updated_at = ? WHERE id = ?",
          ).run(now, leadId);
        } else {
          // Check again tomorrow
          db.prepare('UPDATE leads SET next_action_at = ?, status = ?, updated_at = ? WHERE id = ?')
            .run(now + 86400, 'pending', now, leadId);
        }
      } else {
        // not_connected or unknown — advance anyway
        advanceLeadStep(leadId, lead.current_step, waitDays, now);
      }
      break;
    }

    default:
      advanceLeadStep(leadId, lead.current_step, waitDays, now);
  }
}

function advanceLeadStep(leadId: string, currentStep: number, waitDays: number, now: number): void {
  const nextActionAt = waitDays > 0 ? now + waitDays * 86400 : now;
  db.prepare(
    'UPDATE leads SET current_step = ?, next_action_at = ?, status = ?, updated_at = ? WHERE id = ?',
  ).run(currentStep + 1, nextActionAt, 'pending', now, leadId);
}

export default router;
