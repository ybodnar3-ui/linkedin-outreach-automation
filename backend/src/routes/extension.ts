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
import { db, getSetting, setSetting, incrementTracker } from '../services/storage';
import { logger } from '../utils/logger';
import { broadcastLog } from '../index';
import { fireWebhookEvent } from '../services/webhookService';
import { syncLeadToCrm } from '../services/crmSync';
import { incrementAccountTracker } from '../services/accountHealth';
import { recordLeadEvent } from '../services/events';
import { nextFailureAction } from '../utils/retry';
import { classifyReply } from '../services/replyClassifier';
import { discoverEmail } from '../services/emailDiscovery';

const router = Router();

// Strict LinkedIn profile URL — same pattern enforced by CSV/manual import.
// Prevents storing arbitrary URLs the worker would later navigate to (SSRF).
const LINKEDIN_URL_PATTERN = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+(\/)?$/i;

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
    // Use ONLY reliable signals: the explicit warning flag, or the exact sentinel
    // prefix that content.js emits ("LinkedIn warning: <type>"). Avoid loose word
    // matching — error_message contains free-form page text (button labels) that
    // could otherwise trigger a false-positive pause.
    const isWarning = (result as { warning?: boolean } | undefined)?.warning === true ||
      (error_message ?? '').startsWith('LinkedIn warning:');

    // The recipient turned out NOT to be an accepted 1st-degree connection
    // (extension hit the Premium/InMail wall). A prior check_connection probe
    // false-positived. Clear connected_at and send the lead back to awaiting
    // acceptance so we re-verify instead of retrying messaging against the wall.
    const notConnected = (result as { not_connected?: boolean } | undefined)?.not_connected === true;

    // Systemic selector breakage reported by content.js — NOT a lead-specific
    // failure, so it must not count toward dead-lettering (it would kill every
    // lead). Alert loudly and retry soon.
    const domBroken = (result as { dom_broken?: boolean } | undefined)?.dom_broken === true;

    const leadIdStr = task.lead_id as string;
    const leadRow = db.prepare('SELECT campaign_id, fail_count FROM leads WHERE id = ?')
      .get(task.lead_id) as { campaign_id?: string; fail_count?: number } | undefined;

    if (isWarning) {
      // Pause the campaign this lead belongs to and alert via WebSocket
      if (leadRow?.campaign_id) {
        db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ?").run(now, leadRow.campaign_id);
      }
      // Keep the lead pending but defer 24h so we don't immediately retry the warning
      db.prepare('UPDATE leads SET next_action_at = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(now + 86400, 'pending', now, task.lead_id);
      recordLeadEvent(leadIdStr, 'warning', String(error_message ?? 'LinkedIn safety warning'), { action: task.action });
      logger.error('LinkedIn safety warning — campaign paused', { taskId: task_id, leadId: task.lead_id, campaignId: leadRow?.campaign_id, error: error_message });
      broadcastLog('warning', { warningType: error_message, leadId: task.lead_id, campaignId: leadRow?.campaign_id, message: 'Campaign paused due to LinkedIn safety warning' });
    } else if (domBroken) {
      db.prepare("UPDATE leads SET next_action_at = ?, status = 'pending', updated_at = ? WHERE id = ?")
        .run(now + 3600, now, task.lead_id);
      recordLeadEvent(leadIdStr, 'warning', 'LinkedIn DOM changed — selector failed', { action: task.action, error: error_message });
      broadcastLog('dom_broken', { leadId: task.lead_id, action: task.action, message: 'LinkedIn DOM changed — automation selectors need updating' });
      logger.error('content.js reported DOM breakage', { taskId: task_id, action: task.action, error: error_message });
    } else if (notConnected) {
      // Reset the false "connected" state; re-check acceptance tomorrow. Not a
      // real failure (a state correction) — don't count toward dead-letter.
      db.prepare("UPDATE leads SET connected_at = NULL, next_action_at = ?, status = 'pending', updated_at = ? WHERE id = ?")
        .run(now + 86400, now, task.lead_id);
      recordLeadEvent(leadIdStr, 'not_connected', 'Premium/InMail wall — not an accepted 1st-degree connection');
      logger.warn('send_message hit Premium wall — cleared connected_at', { taskId: task_id, leadId: task.lead_id });
      broadcastLog('not_connected', { leadId: task.lead_id, message: 'Recipient is not an accepted connection — re-checking later' });
    } else {
      // Normal failure → exponential backoff, or dead-letter after MAX attempts.
      const failCount = (leadRow?.fail_count ?? 0) + 1;
      const verdict = nextFailureAction(failCount);
      if (verdict.action === 'dead_letter') {
        db.prepare("UPDATE leads SET status = 'error', skip_reason = 'max_retries', fail_count = ?, updated_at = ? WHERE id = ?")
          .run(failCount, now, task.lead_id);
        recordLeadEvent(leadIdStr, 'dead_lettered', `Gave up after ${failCount} consecutive failures`, { action: task.action, error: error_message });
        broadcastLog('lead_dead_lettered', { leadId: task.lead_id, action: task.action, failCount });
        logger.error('Lead dead-lettered after repeated failures', { taskId: task_id, leadId: task.lead_id, failCount, error: error_message });
      } else {
        db.prepare("UPDATE leads SET next_action_at = ?, status = 'pending', fail_count = ?, updated_at = ? WHERE id = ?")
          .run(now + verdict.delaySeconds, failCount, now, task.lead_id);
        recordLeadEvent(leadIdStr, 'failed', `Attempt ${failCount} failed — retry in ${Math.round(verdict.delaySeconds / 3600)}h`, { action: task.action, error: error_message });
        logger.warn('Extension task failed — backoff retry', { taskId: task_id, failCount, retryInSeconds: verdict.delaySeconds, error: error_message });
      }
    }
  }

  return res.json({ ok: true });
});

// ── Inbox ingest (reply detection via extension) ──────────────────────────────

/**
 * POST /api/extension/inbox
 * The extension periodically scrapes the LinkedIn messaging list in the user's
 * real session and posts the recent threads here. We match inbound threads to
 * leads we've messaged (by participant name) and set replied_at — which the
 * campaign worker treats as "conversation handed off to a human".
 * Body: { account_id, threads: [{ name, snippet, isInbound, unread, time }] }
 */
router.post('/inbox', (req: Request, res: Response) => {
  if (!verifyExtensionToken(req)) return res.status(401).json({ error: 'Invalid extension token' });

  const { account_id, threads } = req.body as {
    account_id?: string;
    threads?: Array<{ name?: string; snippet?: string; isInbound?: boolean }>;
  };
  if (!account_id || !Array.isArray(threads)) {
    return res.status(400).json({ error: 'account_id and threads[] required' });
  }

  const now = Math.floor(Date.now() / 1000);
  let repliesDetected = 0;

  const findLead = db.prepare(`
    SELECT l.id, l.linkedin_url, l.first_name, l.last_name, l.company, l.title
    FROM leads l
    JOIN campaigns c ON c.id = l.campaign_id
    WHERE c.account_id = ?
      AND l.replied_at IS NULL
      AND l.last_message_at IS NOT NULL
      AND lower(trim(COALESCE(l.first_name,'') || ' ' || COALESCE(l.last_name,''))) = lower(trim(?))
    LIMIT 1
  `);

  for (const t of threads) {
    // Only inbound (their last message, not "You: …") counts as a reply.
    if (!t || t.isInbound !== true || !t.name) continue;
    const lead = findLead.get(account_id, t.name) as
      | { id: string; linkedin_url: string; first_name: string | null; last_name: string | null; company: string | null; title: string | null }
      | undefined;
    if (!lead) continue;

    db.prepare('UPDATE leads SET replied_at = ?, updated_at = ? WHERE id = ?').run(now, now, lead.id);
    const messageId = uuidv4();
    const replyText = (t.snippet || '(reply)').slice(0, 2000);
    db.prepare(`
      INSERT INTO inbox_messages (id, account_id, thread_id, lead_id, direction, sender_name, text, timestamp)
      VALUES (?, ?, ?, ?, 'in', ?, ?, ?)
    `).run(messageId, account_id, `ext_${lead.id}`, lead.id, t.name, replyText, now);

    // Auto-classify the reply's sentiment (fire-and-forget; LLM, optional key).
    classifyReply(messageId, replyText).catch(() => {});

    broadcastLog('reply', { leadId: lead.id, name: t.name, url: lead.linkedin_url });
    recordLeadEvent(lead.id, 'replied', t.snippet || undefined);
    syncLeadToCrm(lead.id).catch(() => {});
    fireWebhookEvent('replied', {
      leadId: lead.id, linkedinUrl: lead.linkedin_url,
      firstName: lead.first_name, lastName: lead.last_name,
      company: lead.company, title: lead.title,
    }).catch(() => {});
    repliesDetected++;
  }

  if (repliesDetected > 0) {
    broadcastLog('inbox_new_messages', { accountId: account_id, count: repliesDetected });
    logger.info('Inbox poll: replies detected', { account_id, replies: repliesDetected, threads: threads.length });
  }
  return res.json({ ok: true, threads: threads.length, replies: repliesDetected });
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
    if (!lead.linkedin_url || !LINKEDIN_URL_PATTERN.test(lead.linkedin_url)) { skipped++; continue; }
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
  action: string;
}

function handleTaskSuccess(task: Record<string, unknown>, result: Record<string, unknown>, now: number): void {
  const leadId = task.lead_id as string;
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as Lead | undefined;
  if (!lead) return;

  // Any successful task clears the consecutive-failure streak.
  db.prepare('UPDATE leads SET fail_count = 0 WHERE id = ? AND fail_count > 0').run(leadId);

  const step = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? AND step_order = ?')
    .get(lead.campaign_id, lead.current_step) as CampaignStep | undefined;

  const waitDays = step?.wait_days ?? 0;

  const accountId = task.account_id as string;

  switch (task.action as string) {
    case 'visit_profile':
    case 'follow_profile':
      // Count the visit: account_daily_tracker enforces the cap, daily_tracker
      // feeds dashboard analytics — increment both (mirrors the Playwright path).
      incrementAccountTracker(accountId, 'profiles_visited');
      incrementTracker('profiles_visited');
      recordLeadEvent(leadId, 'visited');
      advanceLeadStep(leadId, lead.current_step, waitDays, now);
      break;

    case 'send_connection':
      if (result.sent) {
        // CRITICAL for ban prevention: enforced counter + analytics counter
        incrementAccountTracker(accountId, 'connections_sent');
        incrementTracker('connections_sent');
        db.prepare('UPDATE leads SET connection_sent_at = ?, updated_at = ? WHERE id = ?').run(now, now, leadId);
        broadcastLog('connection_sent', { leadId, url: lead.linkedin_url });
        recordLeadEvent(leadId, 'connection_sent');
        advanceLeadStep(leadId, lead.current_step, waitDays, now);
      } else if (result.reason === 'already_connected') {
        // Lead is already a 1st-degree connection — record it so the message
        // step's guard passes, then advance.
        db.prepare('UPDATE leads SET connected_at = COALESCE(connected_at, ?), connection_sent_at = COALESCE(connection_sent_at, ?), updated_at = ? WHERE id = ?')
          .run(now, now, now, leadId);
        advanceLeadStep(leadId, lead.current_step, waitDays, now);
      } else if (result.reason === 'already_pending') {
        // Invite was sent earlier but not yet accepted — record sent time and
        // advance; the message step will probe acceptance before messaging.
        db.prepare('UPDATE leads SET connection_sent_at = COALESCE(connection_sent_at, ?), updated_at = ? WHERE id = ?')
          .run(now, now, leadId);
        advanceLeadStep(leadId, lead.current_step, waitDays, now);
      } else {
        // Connection NOT sent (no recognizable reason). Do NOT advance to the
        // message step — messaging a non-connection fails. Retry connect in 1h.
        db.prepare("UPDATE leads SET next_action_at = ?, status = 'pending', updated_at = ? WHERE id = ?")
          .run(now + 3600, now, leadId);
        logger.warn('send_connection not sent — staying on connect step for retry', { leadId, reason: result.reason });
      }
      break;

    case 'send_message':
      if (result.sent) {
        incrementAccountTracker(accountId, 'messages_sent');
        incrementTracker('messages_sent');
        db.prepare('UPDATE leads SET last_message_at = ?, updated_at = ? WHERE id = ?').run(now, now, leadId);
        broadcastLog('message_sent', { leadId, url: lead.linkedin_url });
        recordLeadEvent(leadId, 'message_sent');
      }
      advanceLeadStep(leadId, lead.current_step, waitDays, now);
      break;

    case 'check_connection': {
      const connStatus = result.connection_status as string;
      // A check_connection task is either a dedicated campaign step, or a probe
      // queued by the message step to verify acceptance before messaging.
      const isDedicatedStep = step?.action === 'check_connection';
      if (connStatus === 'connected') {
        db.prepare('UPDATE leads SET connected_at = ?, updated_at = ? WHERE id = ?').run(now, now, leadId);
        broadcastLog('connection_accepted', { leadId, url: lead.linkedin_url });
        recordLeadEvent(leadId, 'connection_accepted');
        // Auto email discovery on acceptance (opt-in toggle, fire-and-forget).
        if (getSetting('auto_email_discovery') === 'true') {
          discoverEmail(leadId).catch(() => {});
        }
        // CRM sync
        syncLeadToCrm(leadId).catch(err =>
          logger.error('CRM sync error on connection', { leadId, error: String(err) }),
        );
        fireWebhookEvent('connection_accepted', {
          leadId, linkedinUrl: lead.linkedin_url,
          firstName: lead.first_name, lastName: lead.last_name,
          company: lead.company, title: lead.title,
        }).catch(() => {});
        if (isDedicatedStep) {
          advanceLeadStep(leadId, lead.current_step, waitDays, now);
        } else {
          // Probe before a message step — connected_at is now set, so re-run the
          // SAME step (do NOT advance past it) and the message will send.
          db.prepare("UPDATE leads SET next_action_at = ?, status = 'pending', updated_at = ? WHERE id = ?")
            .run(now, now, leadId);
        }
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
      } else if (isDedicatedStep) {
        // not_connected / unknown on a dedicated step — advance, don't block the funnel.
        advanceLeadStep(leadId, lead.current_step, waitDays, now);
      } else {
        // Probe before message but lead is not connected yet. Don't advance past
        // the message step (would fail). If an invite was sent, defer like
        // 'pending'; if none was ever sent, route back to the connect step.
        if (lead.connection_sent_at) {
          const daysPending = (now - lead.connection_sent_at) / 86400;
          if (daysPending > 14) {
            db.prepare("UPDATE leads SET status = 'skipped', skip_reason = 'connection_not_accepted_14d', updated_at = ? WHERE id = ?")
              .run(now, leadId);
          } else {
            db.prepare("UPDATE leads SET next_action_at = ?, status = 'pending', updated_at = ? WHERE id = ?")
              .run(now + 86400, now, leadId);
          }
        } else {
          const connectStep = db.prepare(
            "SELECT step_order FROM campaign_steps WHERE campaign_id = ? AND action = 'connect' ORDER BY step_order LIMIT 1",
          ).get(lead.campaign_id) as { step_order: number } | undefined;
          if (connectStep) {
            db.prepare("UPDATE leads SET current_step = ?, next_action_at = ?, status = 'pending', updated_at = ? WHERE id = ?")
              .run(connectStep.step_order, now, now, leadId);
          } else {
            db.prepare("UPDATE leads SET next_action_at = ?, status = 'pending', updated_at = ? WHERE id = ?")
              .run(now + 86400, now, leadId);
          }
        }
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
