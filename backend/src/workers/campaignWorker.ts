import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { db, getSetting, acquireWorkerLease, releaseWorkerLease } from '../services/storage';
import { logger } from '../utils/logger';
import { broadcastLog } from '../index';
import { isWithinWorkingHours } from '../utils/delays';
import { canAccountPerformAction, runNightlyHealthBonus } from '../services/accountHealth';
import { leadDelay, actionDelay } from '../utils/humanizer';
import { resolveBranch } from '../services/branchResolver';
import { getAssignedText } from '../services/abTest';
import { generateIcebreaker } from '../services/icebreaker';
import { sendEmail } from '../services/emailSender';
import { fireWebhookEvent } from '../services/webhookService';
import { recordLeadEvent } from '../services/events';

const runningAccounts = new Set<string>();
let cycleRunning = false;

// Per-process identity + lease config for the cross-process worker lock.
// Two backend processes must never run the campaign worker simultaneously
// (double LinkedIn actions = ban). The in-process `cycleRunning` flag guards
// overlap within ONE process; the DB lease guards against a SECOND process.
const WORKER_LOCK_NAME = 'campaign_worker';
const WORKER_HOLDER_ID = uuidv4();
// Lease is considered dead after 3 missed ticks (worker runs every 5 min).
// A crashed holder blocks the standby for at most this long — acceptable, and
// far safer than ever double-running.
const WORKER_LEASE_TTL_SECONDS = 15 * 60;

interface Campaign {
  id: string;
  name: string;
  status: string;
  timezone: string;
  account_id: string | null;
  website: string | null;
}

interface CampaignStep {
  id: string;
  campaign_id: string;
  step_order: number;
  action: string;
  wait_days: number;
  condition: string;
  message_text: string | null;
  email_subject: string | null;
  branch_type: string | null;
  branch_condition_days: number;
  next_step_true_id: string | null;
  next_step_false_id: string | null;
  ab_test_id: string | null;
}

interface Lead {
  id: string;
  campaign_id: string;
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  status: string;
  current_step: number;
  next_action_at: number | null;
  connection_sent_at: number | null;
  connected_at: number | null;
  last_message_at: number | null;
  // Enrichment fields
  headline: string | null;
  summary: string | null;
  location: string | null;
  years_at_company: string | null;
  school: string | null;
  recent_post: string | null;
  mutual_connections: string | null;
  skills: string | null;
  email: string | null;
  replied_at: number | null;
}

async function renderTemplate(template: string, lead: Lead, campaignWebsite?: string | null): Promise<string> {
  const myName = getSetting('my_name') || '';
  const website = campaignWebsite || '';

  // Use function replacer to avoid $& / $` / $' backreference issues in replacement strings
  const sub = (str: string, pattern: RegExp, value: string): string =>
    str.replace(pattern, () => value);

  let result = template;

  // Single-brace format: {firstName} — original format
  result = sub(result, /\{firstName\}/g,         lead.first_name      || '');
  result = sub(result, /\{lastName\}/g,           lead.last_name       || '');
  result = sub(result, /\{company\}/g,            lead.company         || '');
  result = sub(result, /\{title\}/g,              lead.title           || '');
  result = sub(result, /\{myName\}/g,             myName);
  result = sub(result, /\{website\}/g,            website);
  result = sub(result, /\{headline\}/g,           lead.headline        || '');
  result = sub(result, /\{summary\}/g,            lead.summary         || '');
  result = sub(result, /\{location\}/g,           lead.location        || '');
  result = sub(result, /\{yearsAtCompany\}/g,     lead.years_at_company || '');
  result = sub(result, /\{school\}/g,             lead.school          || '');
  result = sub(result, /\{recentPost\}/g,         lead.recent_post     || '');
  result = sub(result, /\{mutualConnections\}/g,  lead.mutual_connections || '');
  result = sub(result, /\{skills\}/g,             lead.skills          || '');

  // Double-brace aliases: {{first_name}} — user-friendly format
  result = sub(result, /\{\{first_name\}\}/g,     lead.first_name      || '');
  result = sub(result, /\{\{last_name\}\}/g,      lead.last_name       || '');
  result = sub(result, /\{\{company\}\}/g,        lead.company         || '');
  result = sub(result, /\{\{title\}\}/g,          lead.title           || '');
  result = sub(result, /\{\{my_name\}\}/g,        myName);
  result = sub(result, /\{\{website\}\}/g,        website);
  result = sub(result, /\{\{headline\}\}/g,       lead.headline        || '');
  result = sub(result, /\{\{location\}\}/g,       lead.location        || '');

  // AI Icebreaker — only call API if the template actually uses {icebreaker}
  if (result.includes('{icebreaker}') || result.includes('{{icebreaker}}')) {
    const icebreaker = await generateIcebreaker({
      firstName: lead.first_name || '',
      headline: lead.headline,
      company: lead.company,
      title: lead.title,
      recentPost: lead.recent_post,
      skills: lead.skills,
      location: lead.location,
    });
    result = sub(result, /\{icebreaker\}/g, icebreaker);
    result = sub(result, /\{\{icebreaker\}\}/g, icebreaker);
  }

  return result;
}

/** Returns the matched blacklist value if lead's company/email domain is blacklisted, else null */
function checkBlacklist(lead: Lead): string | null {
  const entries = db.prepare('SELECT value, type FROM blacklist').all() as Array<{ value: string; type: string }>;
  if (entries.length === 0) return null;

  const companyLower = (lead.company ?? '').toLowerCase();
  const emailDomain = lead.email ? lead.email.split('@')[1]?.toLowerCase() : null;
  const linkedinDomain = (() => {
    try { return new URL(lead.linkedin_url).hostname.toLowerCase(); } catch { return null; }
  })();

  for (const { value, type } of entries) {
    if (type === 'domain') {
      if (emailDomain && (emailDomain === value || emailDomain.endsWith(`.${value}`))) return value;
      if (linkedinDomain && linkedinDomain.includes(value)) return value;
    }
    if (type === 'company') {
      if (companyLower.includes(value)) return value;
    }
  }
  return null;
}

async function checkCondition(condition: string, lead: Lead, accountId: string): Promise<boolean> {
  switch (condition) {
    case 'always':
      return true;
    case 'if_connected':
      // Extension-only: acceptance is detected by the check_connection task,
      // which sets connected_at. We never probe synchronously here.
      return !!lead.connected_at;
    case 'if_not_replied':
      return lead.replied_at == null; // execute only if lead has NOT replied yet
    default:
      return true;
  }
}

// ── Chrome Extension helpers ──────────────────────────────────────────────────

/** Defer a lead's next pick-up by `seconds` (e.g. daily-limit reached → tomorrow). */
function deferLead(leadId: string, seconds: number): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?')
    .run(now + seconds, now, leadId);
}

/**
 * Queue an action for the Chrome Extension to execute.
 * Sets the lead's next_action_at to 2 hours from now so the worker won't
 * pick it up again while the extension is working on it.
 * The extension result handler (routes/extension.ts) advances the step when done.
 */
function queueExtensionTask(
  lead: Lead,
  action: string,
  payload: Record<string, unknown>,
  accountId: string,
): void {
  const taskId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  // Check if there's already a pending/claimed task for this lead to avoid duplicates
  const existing = db.prepare(
    "SELECT id FROM extension_tasks WHERE lead_id = ? AND status IN ('pending','claimed') LIMIT 1",
  ).get(lead.id);
  if (existing) {
    logger.debug('Extension task already queued for lead — skipping duplicate', { leadId: lead.id });
    return;
  }

  db.prepare(`
    INSERT INTO extension_tasks (id, account_id, lead_id, action, payload, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(taskId, accountId, lead.id, action, JSON.stringify(payload), now);

  // Defer next pick-up for 2 hours (task timeout is 30 min — this is a safe buffer)
  db.prepare('UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?')
    .run(now + 7200, now, lead.id);

  recordLeadEvent(lead.id, 'task_queued', action);
  logger.info('Extension task queued', { taskId, action, leadId: lead.id, accountId });
}

// ─────────────────────────────────────────────────────────────────────────────

async function executeStep(lead: Lead, step: CampaignStep, accountId: string, website?: string | null): Promise<void> {
  const conditionMet = await checkCondition(step.condition, lead, accountId);
  if (!conditionMet) {
    logger.info('Condition not met, skipping step', { leadId: lead.id, step: step.step_order, condition: step.condition });
    db.prepare('UPDATE leads SET current_step = ?, next_action_at = ?, updated_at = ? WHERE id = ?')
      .run(step.step_order + 1, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), lead.id);
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  switch (step.action) {
    case 'visit': {
      if (!canAccountPerformAction(accountId, 'visit')) {
        logger.info('Daily visit limit reached — deferring to tomorrow', { accountId });
        deferLead(lead.id, 86400);
        return;
      }
      queueExtensionTask(lead, 'visit_profile', { profileUrl: lead.linkedin_url }, accountId);
      return; // Extension advances the step via /api/extension/result
    }
    case 'follow': {
      // Follow without connecting — softer first touchpoint
      if (!canAccountPerformAction(accountId, 'visit')) {
        logger.info('Daily visit limit reached (follow) — deferring to tomorrow', { accountId });
        deferLead(lead.id, 86400);
        return;
      }
      queueExtensionTask(lead, 'follow_profile', { profileUrl: lead.linkedin_url }, accountId);
      return;
    }
    case 'connect': {
      if (!canAccountPerformAction(accountId, 'connection')) {
        logger.info('Daily connection limit reached — deferring to tomorrow', { accountId });
        broadcastLog('limit_reached', { action: 'connection', accountId });
        deferLead(lead.id, 86400);
        return;
      }
      let rawNote = step.message_text;
      if (step.ab_test_id && rawNote) {
        rawNote = getAssignedText(lead.id, step.ab_test_id) ?? rawNote;
      }
      const note = rawNote ? await renderTemplate(rawNote, lead, website) : undefined;
      queueExtensionTask(lead, 'send_connection', { profileUrl: lead.linkedin_url, note: note ?? null }, accountId);
      return;
    }
    case 'message': {
      let rawText = step.message_text;
      if (step.ab_test_id) {
        rawText = getAssignedText(lead.id, step.ab_test_id) ?? step.message_text;
      }
      if (!rawText) {
        logger.warn('Message step has no message_text', { stepId: step.id });
        break;
      }
      // Safety: never message a lead whose connection isn't accepted yet, even
      // if the step condition is 'always'. Messaging a non-connection fails
      // (or sends a paid InMail). Instead of blind-deferring for up to 14 days,
      // actively verify acceptance via a check_connection probe so accepted
      // leads get messaged promptly. The probe sets connected_at and re-runs
      // this same message step next cycle (it does NOT advance past it).
      if (lead.connection_sent_at && !lead.connected_at) {
        const daysPending = (now - lead.connection_sent_at) / 86400;
        if (daysPending > 14) {
          db.prepare("UPDATE leads SET status = 'skipped', skip_reason = 'connection_not_accepted_14d', updated_at = ? WHERE id = ?")
            .run(now, lead.id);
          return;
        }
        // Verify acceptance via an extension probe; on success it sets
        // connected_at and re-runs this same message step next cycle.
        queueExtensionTask(lead, 'check_connection', { profileUrl: lead.linkedin_url }, accountId);
        return;
      }
      if (!canAccountPerformAction(accountId, 'message')) {
        logger.info('Daily message limit reached — deferring to tomorrow', { accountId });
        broadcastLog('limit_reached', { action: 'message', accountId });
        deferLead(lead.id, 86400);
        return;
      }
      const text = await renderTemplate(rawText, lead, website);
      queueExtensionTask(lead, 'send_message', { profileUrl: lead.linkedin_url, messageText: text }, accountId);
      return;
    }
    case 'send_email': {
      if (!lead.email) {
        logger.warn('send_email step: lead has no email, skipping', { leadId: lead.id });
        break;
      }
      if (!step.message_text) {
        logger.warn('send_email step: no message_text (body) configured', { stepId: step.id });
        break;
      }
      const subject = step.email_subject
        ? await renderTemplate(step.email_subject, lead, website)
        : `Hi ${lead.first_name || 'there'}`;
      const body = await renderTemplate(step.message_text, lead, website);
      const sent = await sendEmail({ to: lead.email, subject, body });
      if (sent) {
        broadcastLog('email_sent', { leadId: lead.id, to: lead.email });
      }
      await actionDelay();
      break;
    }
    case 'send_inmail': {
      // InMail required server-side Playwright (Premium) — not supported in
      // extension-only mode. Skip and advance so campaigns don't stall.
      logger.warn('send_inmail not supported in extension-only mode — skipping step', { leadId: lead.id, stepId: step.id });
      break;
    }
    case 'check_connection': {
      queueExtensionTask(lead, 'check_connection', { profileUrl: lead.linkedin_url }, accountId);
      return;
    }
    case 'wait':
    default:
      break;
  }

  // Branch-aware routing
  const branchResult = resolveBranch(step as import('../services/branchResolver').BranchStep, lead);

  if (branchResult.action === 'wait') {
    db.prepare('UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?')
      .run(now + 86400, now, lead.id);
    return;
  }

  if (branchResult.action === 'jump') {
    const targetStep = db.prepare('SELECT step_order FROM campaign_steps WHERE id = ?')
      .get(branchResult.next_step_id) as { step_order: number } | undefined;
    if (targetStep) {
      // Guard against backward loops
      const jumpOrder = Math.max(targetStep.step_order, lead.current_step + 1);
      db.prepare('UPDATE leads SET current_step = ?, next_action_at = ?, updated_at = ? WHERE id = ?')
        .run(jumpOrder, now, now, lead.id);
      return;
    }
  }

  // Default linear advancement
  const nextActionAt = step.wait_days > 0 ? now + step.wait_days * 86400 : now;
  db.prepare('UPDATE leads SET current_step = ?, next_action_at = ?, updated_at = ? WHERE id = ?')
    .run(step.step_order + 1, nextActionAt, now, lead.id);
}

async function processLead(lead: Lead, steps: CampaignStep[], accountId: string, website?: string | null): Promise<void> {
  const step = steps.find(s => s.step_order === lead.current_step);

  if (!step) {
    db.prepare("UPDATE leads SET status = 'completed', updated_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000), lead.id);
    logger.info('Lead completed all steps', { leadId: lead.id });
    broadcastLog('lead_completed', { leadId: lead.id, url: lead.linkedin_url });
    fireWebhookEvent('lead_completed', {
      leadId: lead.id, linkedinUrl: lead.linkedin_url,
      firstName: lead.first_name, lastName: lead.last_name,
      company: lead.company, title: lead.title,
    }).catch(() => {});
    return;
  }

  // Blacklist check — skip if company domain or company name is blacklisted
  const blacklistHit = checkBlacklist(lead);
  if (blacklistHit) {
    db.prepare("UPDATE leads SET status = 'skipped', skip_reason = ?, updated_at = ? WHERE id = ?")
      .run(`blacklisted:${blacklistHit}`, Math.floor(Date.now() / 1000), lead.id);
    recordLeadEvent(lead.id, 'skipped', `blacklisted:${blacklistHit}`);
    logger.info('Lead skipped — blacklisted', { leadId: lead.id, match: blacklistHit });
    broadcastLog('lead_skipped', { leadId: lead.id, reason: `blacklisted:${blacklistHit}` });
    fireWebhookEvent('lead_skipped', {
      leadId: lead.id, linkedinUrl: lead.linkedin_url, reason: `blacklisted:${blacklistHit}`,
    }).catch(() => {});
    return;
  }

  db.prepare("UPDATE leads SET status = 'in_progress', updated_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000), lead.id);

  await executeStep(lead, step, accountId, website);
}

/** Process all campaigns for a given accountId (or __legacy__ for unassigned campaigns) */
async function runCampaignsForAccount(accountId: string): Promise<void> {
  if (runningAccounts.has(accountId)) {
    logger.debug('Worker already running for account, skipping', { accountId });
    return;
  }
  runningAccounts.add(accountId);

  const isLegacy = accountId === '__legacy__';
  const campaignQuery = isLegacy
    ? "SELECT * FROM campaigns WHERE status = 'active' AND account_id IS NULL"
    : "SELECT * FROM campaigns WHERE status = 'active' AND account_id = ?";

  try {
    const activeCampaigns = (
      isLegacy
        ? db.prepare(campaignQuery).all()
        : db.prepare(campaignQuery).all(accountId)
    ) as Campaign[];

    if (activeCampaigns.length === 0) return;
    logger.debug('Active campaigns found for account', { accountId, count: activeCampaigns.length });

    for (const campaign of activeCampaigns) {
      if (!isWithinWorkingHours(campaign.timezone)) {
        logger.info('Outside working hours, skipping campaign', { campaignId: campaign.id, accountId, timezone: campaign.timezone });
        continue;
      }

      const steps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_order')
        .all(campaign.id) as CampaignStep[];

      if (steps.length === 0) continue;

      const now = Math.floor(Date.now() / 1000);

      // Mark replied leads as completed so they don't pollute the pending queue
      db.prepare(`
        UPDATE leads SET status = 'completed', updated_at = ?
        WHERE campaign_id = ? AND status IN ('pending','in_progress') AND replied_at IS NOT NULL
      `).run(now, campaign.id);

      const leads = db.prepare(`
        SELECT * FROM leads
        WHERE campaign_id = ?
          AND status IN ('pending', 'in_progress')
          AND replied_at IS NULL
          AND (next_action_at IS NULL OR next_action_at <= ?)
        ORDER BY created_at ASC
        LIMIT 10
      `).all(campaign.id, now) as Lead[];

      for (const lead of leads) {
        try {
          broadcastLog('lead_processing', { leadId: lead.id, url: lead.linkedin_url, campaign: campaign.name, accountId });
          await processLead(lead, steps, accountId, campaign.website);
          await leadDelay();
        } catch (err) {
          logger.error('Error processing lead', {
            leadId: lead.id,
            accountId,
            error: err instanceof Error ? err.message : String(err),
          });
          broadcastLog('lead_error', { leadId: lead.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  } catch (err) {
    logger.error('Worker cycle error', { accountId, error: err instanceof Error ? err.message : String(err) });
  } finally {
    runningAccounts.delete(accountId);
  }
}

async function runWorkerCycle(): Promise<void> {
  // 1. Run legacy (unassigned) campaigns
  await runCampaignsForAccount('__legacy__');

  // 2. Run per-account campaigns for all active accounts
  const activeAccounts = db.prepare("SELECT id FROM accounts WHERE status = 'active'")
    .all() as Array<{ id: string }>;

  await Promise.allSettled(
    activeAccounts.map(({ id }) => runCampaignsForAccount(id)),
  );
}

export function pauseAllCampaigns(): void {
  db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE status = 'active'")
    .run(Math.floor(Date.now() / 1000));
  logger.warn('All campaigns paused');
  broadcastLog('pause_all', { message: 'All campaigns paused' });
}

export function startWorker(): void {
  // Main 5-minute campaign worker
  cron.schedule('*/5 * * * *', () => {
    if (cycleRunning) {
      logger.warn('Previous worker cycle still running — skipping this tick');
      return;
    }
    // Cross-process guard: only the process holding the lease may run actions.
    // A second backend instance will never acquire it while the first is alive.
    if (!acquireWorkerLease(WORKER_LOCK_NAME, WORKER_HOLDER_ID, WORKER_LEASE_TTL_SECONDS)) {
      logger.warn('Campaign worker lease held by another process — skipping this tick', { holder: WORKER_HOLDER_ID });
      return;
    }
    cycleRunning = true;
    runWorkerCycle()
      .catch((err) => {
        logger.error('Unhandled worker error', { error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => { cycleRunning = false; });
  });

  // Nightly health bonus at 00:05 — +5 to all active accounts that had no penalties
  cron.schedule('5 0 * * *', () => {
    try {
      runNightlyHealthBonus();
    } catch (err) {
      logger.error('Nightly health bonus error', { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Release the lease on graceful shutdown so a restarted/standby process can
  // take over immediately instead of waiting out the TTL.
  const releaseOnExit = () => releaseWorkerLease(WORKER_LOCK_NAME, WORKER_HOLDER_ID);
  process.once('SIGTERM', releaseOnExit);
  process.once('SIGINT', releaseOnExit);

  logger.info('Campaign worker scheduled (every 5 minutes) + nightly health bonus (00:05)', { holder: WORKER_HOLDER_ID });
}
