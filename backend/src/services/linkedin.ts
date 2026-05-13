import { Page } from 'playwright';
import { getBrowser, loadSession } from './browser';
import { incrementTracker } from './storage';
import { applyHealthPenalty, incrementAccountTracker } from './accountHealth';
import { scrapeProfileFields, saveEnrichedProfile } from './profileEnricher';
import { logger } from '../utils/logger';
import { broadcastLog } from '../index';

const LINKEDIN_BASE = 'https://www.linkedin.com';

async function getPage(): Promise<Page> {
  const ctx = await getBrowser();
  const cookies = loadSession();
  if (cookies) {
    await ctx.addCookies(cookies).catch(() => {});
  }
  const page = await ctx.newPage();
  return page;
}

export interface WarningResult {
  hasWarning: boolean;
  type?: 'captcha' | 'weekly_limit' | 'account_restriction' | 'checkpoint';
  message?: string;
}

export async function checkForWarnings(page: Page): Promise<WarningResult> {
  const url = page.url();

  if (url.includes('/checkpoint/')) {
    return { hasWarning: true, type: 'checkpoint', message: 'LinkedIn checkpoint detected' };
  }

  // CAPTCHA detection
  const captcha = await page.$('[data-test-id="challenge-form"], .challenge-page, #captcha-challenge');
  if (captcha) {
    return { hasWarning: true, type: 'captcha', message: 'CAPTCHA challenge detected' };
  }

  // Weekly invitation limit
  const limitText = await page.textContent('body').catch(() => '');
  if (limitText?.includes("You've reached the weekly invitation limit") ||
      limitText?.includes('weekly invitation limit')) {
    return { hasWarning: true, type: 'weekly_limit', message: 'Weekly invitation limit reached' };
  }

  // Account restriction banner
  const restriction = await page.$('[data-test-id="restriction-banner"], .restriction-msg');
  if (restriction) {
    return { hasWarning: true, type: 'account_restriction', message: 'Account restriction detected' };
  }

  return { hasWarning: false };
}

export async function visitProfile(
  linkedinUrl: string,
  accountId = '__legacy__',
  leadId?: string,
): Promise<void> {
  const { gaussianDelay, humanScroll } = await import('../utils/humanizer');
  const page = await getPage();

  try {
    logger.info('Visiting profile', { url: linkedinUrl });
    broadcastLog('profile_visit', { url: linkedinUrl });

    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await gaussianDelay(1500, 3000);

    const warning = await checkForWarnings(page);
    if (warning.hasWarning) {
      logger.warn('Warning detected during profile visit', warning);
      broadcastLog('warning', warning);
      if (warning.type === 'captcha') applyHealthPenalty(accountId, 'captcha');
      else if (warning.type === 'account_restriction') applyHealthPenalty(accountId, 'restriction');
      else applyHealthPenalty(accountId, 'warning');
      return;
    }

    await humanScroll(page);
    await gaussianDelay(2000, 4000);

    // Scrape enrichment fields while page is open
    if (leadId) {
      try {
        const enriched = await scrapeProfileFields(page);
        saveEnrichedProfile(leadId, enriched);
      } catch (err) {
        logger.warn('Profile enrichment failed (non-fatal)', { leadId, error: String(err) });
      }
    }

    incrementTracker('profiles_visited');
    incrementAccountTracker(accountId, 'profiles_visited');
    logger.info('Profile visited', { url: linkedinUrl });
  } finally {
    await page.close();
  }
}

export async function sendConnectionRequest(linkedinUrl: string, note?: string, accountId = '__legacy__'): Promise<boolean> {
  const { gaussianDelay, humanMouseMove, humanType } = await import('../utils/humanizer');
  const page = await getPage();

  try {
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await gaussianDelay(2000, 4000);

    const warning = await checkForWarnings(page);
    if (warning.hasWarning) {
      logger.warn('Warning detected before connection request', warning);
      broadcastLog('warning', warning);
      if (warning.type === 'captcha') applyHealthPenalty(accountId, 'captcha');
      else if (warning.type === 'account_restriction') applyHealthPenalty(accountId, 'restriction');
      else applyHealthPenalty(accountId, 'warning');
      return false;
    }

    // Find Connect button
    const connectBtn = await page.$('button[aria-label*="Connect"], button[aria-label*="connect"]');
    if (!connectBtn) {
      // May already be connected or Follow-only profile
      logger.info('No connect button found', { url: linkedinUrl });
      return false;
    }

    await humanMouseMove(page, connectBtn);
    await gaussianDelay(500, 1200);
    await connectBtn.click();
    await gaussianDelay(1000, 2000);

    if (note) {
      // Click "Add a note"
      const addNoteBtn = await page.$('button[aria-label*="Add a note"]');
      if (addNoteBtn) {
        await humanMouseMove(page, addNoteBtn);
        await addNoteBtn.click();
        await gaussianDelay(800, 1500);

        const textarea = await page.$('textarea[name="message"]');
        if (textarea) {
          await humanType(page, textarea, note);
          await gaussianDelay(500, 1000);
        }
      }
    }

    // Click Send
    const sendBtn = await page.$('button[aria-label*="Send"], button[aria-label*="Send invitation"]');
    if (!sendBtn) {
      // Click "Send without a note" if note not provided
      const sendWithoutNote = await page.$('button[aria-label*="Send without a note"]');
      if (sendWithoutNote) {
        await humanMouseMove(page, sendWithoutNote);
        await sendWithoutNote.click();
      }
    } else {
      await humanMouseMove(page, sendBtn);
      await sendBtn.click();
    }

    await gaussianDelay(1500, 2500);

    const warningAfter = await checkForWarnings(page);
    if (warningAfter.hasWarning) {
      logger.warn('Warning after connection request', warningAfter);
      broadcastLog('warning', warningAfter);
      if (warningAfter.type === 'captcha') applyHealthPenalty(accountId, 'captcha');
      else if (warningAfter.type === 'account_restriction') applyHealthPenalty(accountId, 'restriction');
      else applyHealthPenalty(accountId, 'warning');
      return false;
    }

    incrementTracker('connections_sent');
    incrementAccountTracker(accountId, 'connections_sent');
    logger.info('Connection request sent', { url: linkedinUrl });
    broadcastLog('connection_sent', { url: linkedinUrl });
    return true;
  } finally {
    await page.close();
  }
}

export async function sendMessage(linkedinUrl: string, text: string, accountId = '__legacy__'): Promise<boolean> {
  const { gaussianDelay, humanMouseMove, humanType } = await import('../utils/humanizer');
  const page = await getPage();

  try {
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await gaussianDelay(2000, 4000);

    const warning = await checkForWarnings(page);
    if (warning.hasWarning) {
      broadcastLog('warning', warning);
      return false;
    }

    const messageBtn = await page.$('button[aria-label*="Message"], a[aria-label*="Message"]');
    if (!messageBtn) {
      logger.info('No message button (not connected?)', { url: linkedinUrl });
      return false;
    }

    await humanMouseMove(page, messageBtn);
    await messageBtn.click();
    await gaussianDelay(1500, 3000);

    const msgBox = await page.$('.msg-form__contenteditable, div[role="textbox"][aria-label*="message"]');
    if (!msgBox) {
      logger.warn('Message box not found', { url: linkedinUrl });
      return false;
    }

    await humanType(page, msgBox as Parameters<typeof humanType>[1], text);
    await gaussianDelay(1000, 2000);

    const sendBtn = await page.$('button[type="submit"].msg-form__send-button, button[aria-label*="Send message"]');
    if (sendBtn) {
      await humanMouseMove(page, sendBtn);
      await sendBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    await gaussianDelay(1500, 2500);

    const warningAfter = await checkForWarnings(page);
    if (warningAfter.hasWarning) {
      broadcastLog('warning', warningAfter);
      if (warningAfter.type === 'captcha') applyHealthPenalty(accountId, 'captcha');
      else if (warningAfter.type === 'account_restriction') applyHealthPenalty(accountId, 'restriction');
      else applyHealthPenalty(accountId, 'warning');
      return false;
    }

    incrementTracker('messages_sent');
    incrementAccountTracker(accountId, 'messages_sent');
    logger.info('Message sent', { url: linkedinUrl });
    broadcastLog('message_sent', { url: linkedinUrl });
    return true;
  } finally {
    await page.close();
  }
}

export async function checkConnectionStatus(linkedinUrl: string): Promise<'connected' | 'pending' | 'none'> {
  const { gaussianDelay } = await import('../utils/humanizer');
  const page = await getPage();

  try {
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await gaussianDelay(1000, 2000);

    // Check for "Message" button (connected) or "Pending" state
    const messageBtn = await page.$('button[aria-label*="Message"], a[aria-label*="Message"]');
    if (messageBtn) return 'connected';

    const pendingBtn = await page.$('button[aria-label*="Pending"]');
    if (pendingBtn) return 'pending';

    return 'none';
  } finally {
    await page.close();
  }
}
