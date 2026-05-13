import cron from 'node-cron';
import { db, getSetting } from '../services/storage';
import { logger } from '../utils/logger';
import { broadcastLog } from '../index';
import { isWithinWorkingHours } from '../utils/delays';
import { canAccountPerformAction, runNightlyHealthBonus } from '../services/accountHealth';
import { visitProfile, sendConnectionRequest, sendMessage, checkConnectionStatus } from '../services/linkedin';
import { leadDelay, actionDelay } from '../utils/humanizer';
import { resolveBranch } from '../services/branchResolver';
import { getAssignedText } from '../services/abTest';
import { generateIcebreaker } from '../services/icebreaker';
import { sendEmail } from '../services/emailSender';

const runningAccounts = new Set<string>();

interface Campaign {
  id: string;
  name: string;
  status: string;
  timezone: string;
  account_id: string | null;
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
}

async function renderTemplate(template: string, lead: Lead): Promise<string> {
  const myName = getSetting('my_name') || '';
  let result = template
    .replace(/\{firstName\}/g, lead.first_name || '')
    .replace(/\{lastName\}/g, lead.last_name || '')
    .replace(/\{company\}/g, lead.company || '')
    .replace(/\{title\}/g, lead.title || '')
    .replace(/\{myName\}/g, myName)
    // Enrichment variables
    .replace(/\{headline\}/g, lead.headline || '')
    .replace(/\{summary\}/g, lead.summary || '')
    .replace(/\{location\}/g, lead.location || '')
    .replace(/\{yearsAtCompany\}/g, lead.years_at_company || '')
    .replace(/\{school\}/g, lead.school || '')
    .replace(/\{recentPost\}/g, lead.recent_post || '')
    .replace(/\{mutualConnections\}/g, lead.mutual_connections || '')
    .replace(/\{skills\}/g, lead.skills || '');

  // AI Icebreaker — only call API if the template actually uses {icebreaker}
  if (result.includes('{icebreaker}')) {
    const icebreaker = await generateIcebreaker({
      firstName: lead.first_name || '',
      headline: lead.headline,
      company: lead.company,
      title: lead.title,
      recentPost: lead.recent_post,
      skills: lead.skills,
      location: lead.location,
    });
    result = result.replace(/\{icebreaker\}/g, icebreaker);
  }

  return result;
}

async function checkCondition(condition: string, lead: Lead, accountId: string): Promise<boolean> {
  switch (condition) {
    case 'always':
      return true;
    case 'if_connected':
      if (lead.connected_at) return true;
      // Check live using the correct account's browser context
      const status = await checkConnectionStatus(lead.linkedin_url, accountId);
      if (status === 'connected') {
        db.prepare('UPDATE leads SET connected_at = ?, updated_at = ? WHERE id = ?')
          .run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), lead.id);
        return true;
      }
      return false;
    case 'if_not_replied':
      return lead.connected_at != null;
    default:
      return true;
  }
}

async function executeStep(lead: Lead, step: CampaignStep, accountId: string): Promise<void> {
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
        logger.info('Daily visit limit reached', { accountId });
        return;
      }
      await visitProfile(lead.linkedin_url, accountId, lead.id);
      await actionDelay();
      break;
    }
    case 'connect': {
      if (!canAccountPerformAction(accountId, 'connection')) {
        logger.info('Daily connection limit reached', { accountId });
        broadcastLog('limit_reached', { action: 'connection', accountId });
        return;
      }
      let rawNote = step.message_text;
      if (step.ab_test_id && rawNote) {
        rawNote = getAssignedText(lead.id, step.ab_test_id) ?? rawNote;
      }
      const note = rawNote ? await renderTemplate(rawNote, lead) : undefined;
      const sent = await sendConnectionRequest(lead.linkedin_url, note, accountId);
      if (sent) {
        db.prepare('UPDATE leads SET connection_sent_at = ?, updated_at = ? WHERE id = ?').run(now, now, lead.id);
      }
      await actionDelay();
      break;
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
      if (!canAccountPerformAction(accountId, 'message')) {
        logger.info('Daily message limit reached', { accountId });
        broadcastLog('limit_reached', { action: 'message', accountId });
        return;
      }
      const text = await renderTemplate(rawText, lead);
      const sent = await sendMessage(lead.linkedin_url, text, accountId);
      if (sent) {
        db.prepare('UPDATE leads SET last_message_at = ?, updated_at = ? WHERE id = ?').run(now, now, lead.id);
      }
      await actionDelay();
      break;
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
        ? await renderTemplate(step.email_subject, lead)
        : `Hi ${lead.first_name || 'there'}`;
      const body = await renderTemplate(step.message_text, lead);
      const sent = await sendEmail({ to: lead.email, subject, body });
      if (sent) {
        broadcastLog('email_sent', { leadId: lead.id, to: lead.email });
      }
      await actionDelay();
      break;
    }
    case 'check_connection': {
      const connStatus = await checkConnectionStatus(lead.linkedin_url, accountId);
      if (connStatus === 'connected') {
        db.prepare('UPDATE leads SET connected_at = ?, updated_at = ? WHERE id = ?').run(now, now, lead.id);
        logger.info('Connection accepted', { leadId: lead.id });
        broadcastLog('connection_accepted', { leadId: lead.id, url: lead.linkedin_url });
      } else if (connStatus === 'pending') {
        const sentAt = lead.connection_sent_at || now;
        const daysPending = (now - sentAt) / 86400;
        if (daysPending > 14) {
          db.prepare("UPDATE leads SET status = 'skipped', skip_reason = 'connection_not_accepted_14d', updated_at = ? WHERE id = ?")
            .run(now, lead.id);
          return;
        }
        db.prepare('UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?')
          .run(now + 86400, now, lead.id);
        return;
      }
      await actionDelay();
      break;
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

async function processLead(lead: Lead, steps: CampaignStep[], accountId: string): Promise<void> {
  const step = steps.find(s => s.step_order === lead.current_step);

  if (!step) {
    db.prepare("UPDATE leads SET status = 'completed', updated_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000), lead.id);
    logger.info('Lead completed all steps', { leadId: lead.id });
    broadcastLog('lead_completed', { leadId: lead.id, url: lead.linkedin_url });
    return;
  }

  db.prepare("UPDATE leads SET status = 'in_progress', updated_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000), lead.id);

  await executeStep(lead, step, accountId);
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
      const leads = db.prepare(`
        SELECT * FROM leads
        WHERE campaign_id = ?
          AND status IN ('pending', 'in_progress')
          AND (next_action_at IS NULL OR next_action_at <= ?)
        ORDER BY created_at ASC
        LIMIT 10
      `).all(campaign.id, now) as Lead[];

      for (const lead of leads) {
        try {
          broadcastLog('lead_processing', { leadId: lead.id, url: lead.linkedin_url, campaign: campaign.name, accountId });
          await processLead(lead, steps, accountId);
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
    runWorkerCycle().catch((err) => {
      logger.error('Unhandled worker error', { error: err instanceof Error ? err.message : String(err) });
    });
  });

  // Nightly health bonus at 00:05 — +5 to all active accounts that had no penalties
  cron.schedule('5 0 * * *', () => {
    try {
      runNightlyHealthBonus();
    } catch (err) {
      logger.error('Nightly health bonus error', { error: err instanceof Error ? err.message : String(err) });
    }
  });

  logger.info('Campaign worker scheduled (every 5 minutes) + nightly health bonus (00:05)');
}
