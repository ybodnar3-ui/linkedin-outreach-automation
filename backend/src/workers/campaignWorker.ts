import cron from 'node-cron';
import { db, getSetting } from '../services/storage';
import { logger } from '../utils/logger';
import { broadcastLog } from '../index';
import { isWithinWorkingHours, canPerformAction, SAFE_LIMITS } from '../utils/delays';
import { visitProfile, sendConnectionRequest, sendMessage, checkConnectionStatus } from '../services/linkedin';
import { leadDelay, actionDelay } from '../utils/humanizer';

let isRunning = false;

interface Campaign {
  id: string;
  name: string;
  status: string;
  timezone: string;
}

interface CampaignStep {
  id: string;
  campaign_id: string;
  step_order: number;
  action: string;
  wait_days: number;
  condition: string;
  message_text: string | null;
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
}

function renderTemplate(template: string, lead: Lead): string {
  const myName = getSetting('my_name') || '';
  return template
    .replace(/\{firstName\}/g, lead.first_name || '')
    .replace(/\{lastName\}/g, lead.last_name || '')
    .replace(/\{company\}/g, lead.company || '')
    .replace(/\{title\}/g, lead.title || '')
    .replace(/\{myName\}/g, myName);
}

async function checkCondition(condition: string, lead: Lead): Promise<boolean> {
  switch (condition) {
    case 'always':
      return true;
    case 'if_connected':
      if (lead.connected_at) return true;
      // Check live if not tracked
      const status = await checkConnectionStatus(lead.linkedin_url);
      if (status === 'connected') {
        db.prepare('UPDATE leads SET connected_at = ?, updated_at = ? WHERE id = ?')
          .run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), lead.id);
        return true;
      }
      return false;
    case 'if_not_replied':
      // Treat as connected but no reply — check connection, skip message check for now
      return lead.connected_at != null;
    default:
      return true;
  }
}

async function executeStep(lead: Lead, step: CampaignStep): Promise<void> {
  const conditionMet = await checkCondition(step.condition, lead);
  if (!conditionMet) {
    logger.info('Condition not met, skipping step', { leadId: lead.id, step: step.step_order, condition: step.condition });
    // Advance to next step with 0 wait
    db.prepare('UPDATE leads SET current_step = ?, next_action_at = ?, updated_at = ? WHERE id = ?')
      .run(step.step_order + 1, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), lead.id);
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  switch (step.action) {
    case 'visit': {
      if (!canPerformAction('visit')) {
        logger.info('Daily visit limit reached');
        return;
      }
      await visitProfile(lead.linkedin_url);
      await actionDelay();
      break;
    }
    case 'connect': {
      if (!canPerformAction('connection')) {
        logger.info('Daily connection limit reached');
        broadcastLog('limit_reached', { action: 'connection' });
        return;
      }
      const note = step.message_text ? renderTemplate(step.message_text, lead) : undefined;
      const sent = await sendConnectionRequest(lead.linkedin_url, note);
      if (sent) {
        db.prepare('UPDATE leads SET connection_sent_at = ?, updated_at = ? WHERE id = ?').run(now, now, lead.id);
      }
      await actionDelay();
      break;
    }
    case 'message': {
      if (!step.message_text) {
        logger.warn('Message step has no message_text', { stepId: step.id });
        break;
      }
      if (!canPerformAction('message')) {
        logger.info('Daily message limit reached');
        broadcastLog('limit_reached', { action: 'message' });
        return;
      }
      const text = renderTemplate(step.message_text, lead);
      const sent = await sendMessage(lead.linkedin_url, text);
      if (sent) {
        db.prepare('UPDATE leads SET last_message_at = ?, updated_at = ? WHERE id = ?').run(now, now, lead.id);
      }
      await actionDelay();
      break;
    }
    case 'check_connection': {
      const connStatus = await checkConnectionStatus(lead.linkedin_url);
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
        // Re-check in 24h
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

  // Advance to next step
  const nextActionAt = step.wait_days > 0 ? now + step.wait_days * 86400 : now;
  db.prepare('UPDATE leads SET current_step = ?, next_action_at = ?, updated_at = ? WHERE id = ?')
    .run(step.step_order + 1, nextActionAt, now, lead.id);
}

async function processLead(lead: Lead, steps: CampaignStep[]): Promise<void> {
  const step = steps.find(s => s.step_order === lead.current_step);

  if (!step) {
    // All steps done
    db.prepare("UPDATE leads SET status = 'completed', updated_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000), lead.id);
    logger.info('Lead completed all steps', { leadId: lead.id });
    broadcastLog('lead_completed', { leadId: lead.id, url: lead.linkedin_url });
    return;
  }

  db.prepare("UPDATE leads SET status = 'in_progress', updated_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000), lead.id);

  await executeStep(lead, step);
}

async function runWorkerCycle(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    const activeCampaigns = db.prepare("SELECT * FROM campaigns WHERE status = 'active'").all() as Campaign[];

    for (const campaign of activeCampaigns) {
      if (!isWithinWorkingHours(campaign.timezone)) {
        logger.info('Outside working hours, skipping campaign', { campaignId: campaign.id, timezone: campaign.timezone });
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
          broadcastLog('lead_processing', { leadId: lead.id, url: lead.linkedin_url, campaign: campaign.name });
          await processLead(lead, steps);
          await leadDelay();
        } catch (err) {
          logger.error('Error processing lead', {
            leadId: lead.id,
            error: err instanceof Error ? err.message : String(err),
          });
          broadcastLog('lead_error', { leadId: lead.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  } catch (err) {
    logger.error('Worker cycle error', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isRunning = false;
  }
}

export function pauseAllCampaigns(): void {
  db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE status = 'active'")
    .run(Math.floor(Date.now() / 1000));
  logger.warn('All campaigns paused');
  broadcastLog('pause_all', { message: 'All campaigns paused' });
}

export function startWorker(): void {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    runWorkerCycle().catch((err) => {
      logger.error('Unhandled worker error', { error: err instanceof Error ? err.message : String(err) });
    });
  });

  logger.info('Campaign worker scheduled (every 5 minutes)');
}
