import { Page } from 'playwright';
import { getBrowser, loadSession, getBrowserForAccount } from './browser';
import { getAccountProxy } from './accounts';
import { incrementTracker } from './storage';
import { applyHealthPenalty, incrementAccountTracker } from './accountHealth';
import { scrapeProfileFields, saveEnrichedProfile } from './profileEnricher';
import { logger } from '../utils/logger';
import { broadcastLog } from '../index';

const LINKEDIN_BASE = 'https://www.linkedin.com';

/**
 * Returns a new Playwright page for the given account.
 * For __legacy__ (default session) uses the shared browser context.
 * For real accounts uses per-account browser context with proxy support.
 */
async function getPage(accountId = '__legacy__'): Promise<Page> {
  if (accountId === '__legacy__') {
    const ctx = await getBrowser();
    const cookies = loadSession();
    if (cookies) {
      await ctx.addCookies(cookies).catch(() => {});
    }
    return ctx.newPage();
  }

  // Per-account browser with proxy
  const { getAccount } = await import('./accounts');
  const account = getAccount(accountId);
  if (!account) {
    logger.error('getPage: account not found, falling back to legacy', { accountId });
    const ctx = await getBrowser();
    return ctx.newPage();
  }

  const proxy = getAccountProxy(accountId);
  const ctx = await getBrowserForAccount(accountId, account.session_file, proxy);
  return ctx.newPage();
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
  const page = await getPage(accountId);

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
  const page = await getPage(accountId);

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
  const page = await getPage(accountId);

  try {
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await gaussianDelay(2000, 4000);

    const warning = await checkForWarnings(page);
    if (warning.hasWarning) {
      logger.warn('Warning detected before sending message', warning);
      broadcastLog('warning', warning);
      if (warning.type === 'captcha') applyHealthPenalty(accountId, 'captcha');
      else if (warning.type === 'account_restriction') applyHealthPenalty(accountId, 'restriction');
      else applyHealthPenalty(accountId, 'warning');
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

/**
 * Follow a LinkedIn profile (without sending a connection request).
 * Useful as a softer first touchpoint before connecting.
 * Returns true if the Follow button was found and clicked.
 */
export async function followProfile(linkedinUrl: string, accountId = '__legacy__'): Promise<boolean> {
  const { gaussianDelay, humanMouseMove } = await import('../utils/humanizer');
  const page = await getPage(accountId);

  try {
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await gaussianDelay(1500, 3000);

    const warning = await checkForWarnings(page);
    if (warning.hasWarning) {
      logger.warn('Warning detected during follow', warning);
      broadcastLog('warning', warning);
      if (warning.type === 'captcha') applyHealthPenalty(accountId, 'captcha');
      else if (warning.type === 'account_restriction') applyHealthPenalty(accountId, 'restriction');
      else applyHealthPenalty(accountId, 'warning');
      return false;
    }

    // LinkedIn shows "Follow" button for 2nd/3rd degree connections (not yet connected)
    const followBtn = await page.$(
      'button[aria-label*="Follow"], button[aria-label*="follow"]:not([aria-label*="Unfollow"])',
    );
    if (!followBtn) {
      logger.info('No Follow button found (already following or connected)', { url: linkedinUrl });
      return false;
    }

    await humanMouseMove(page, followBtn);
    await gaussianDelay(400, 900);
    await followBtn.click();
    await gaussianDelay(1000, 2000);

    // Verify the button changed to "Following" or "Unfollow"
    const unfollowBtn = await page.$('button[aria-label*="Unfollow"], button[aria-label*="Following"]');
    if (unfollowBtn) {
      incrementAccountTracker(accountId, 'profiles_visited'); // counts as a profile interaction
      logger.info('Profile followed', { url: linkedinUrl, accountId });
      broadcastLog('profile_followed', { url: linkedinUrl, accountId });
      return true;
    }

    logger.warn('Follow click did not result in Unfollow state', { url: linkedinUrl });
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Send a LinkedIn InMail to a 2nd/3rd degree connection.
 * Requires LinkedIn Premium / Sales Navigator on the account.
 * InMail button appears as "Message" for non-connections on Premium accounts.
 *
 * Returns: 'sent' | 'no_inmail_button' | 'limit_reached' | 'error'
 */
export async function sendInMail(
  linkedinUrl: string,
  subject: string,
  body: string,
  accountId = '__legacy__',
): Promise<'sent' | 'no_inmail_button' | 'limit_reached' | 'error'> {
  const { gaussianDelay, humanMouseMove, humanType } = await import('../utils/humanizer');
  const page = await getPage(accountId);

  try {
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await gaussianDelay(2000, 3500);

    const warning = await checkForWarnings(page);
    if (warning.hasWarning) {
      logger.warn('Warning during InMail attempt', warning);
      if (warning.type === 'captcha') applyHealthPenalty(accountId, 'captcha');
      else applyHealthPenalty(accountId, 'warning');
      return 'error';
    }

    // InMail button — on Premium, non-connections have a "Message" button
    // that opens InMail composer instead of regular chat
    const inmailBtn = await page.$(
      'button[aria-label*="InMail"], button[aria-label*="Message"]:not([disabled])',
    );
    if (!inmailBtn) {
      logger.info('No InMail button found', { url: linkedinUrl });
      return 'no_inmail_button';
    }

    await humanMouseMove(page, inmailBtn);
    await inmailBtn.click();
    await gaussianDelay(1500, 2500);

    // Check for InMail limit message
    const limitMsg = await page.textContent('body').catch(() => '');
    if (limitMsg?.includes('InMail credit') || limitMsg?.includes('out of InMail')) {
      logger.warn('InMail credits exhausted', { accountId });
      return 'limit_reached';
    }

    // Fill subject
    const subjectInput = await page.$('input[name="subject"], input[placeholder*="ubject"], .compose-form__subject-field input');
    if (subjectInput) {
      await subjectInput.click();
      await gaussianDelay(300, 600);
      await humanType(page, subjectInput, subject);
      await gaussianDelay(400, 800);
    }

    // Fill body
    const bodyBox = await page.$(
      '.compose-form__message-field, div[role="textbox"], textarea[placeholder*="message" i], .msg-form__contenteditable',
    );
    if (!bodyBox) {
      logger.warn('InMail body field not found', { url: linkedinUrl });
      return 'error';
    }
    await bodyBox.click();
    await gaussianDelay(400, 800);
    await humanType(page, bodyBox as Parameters<typeof humanType>[1], body);
    await gaussianDelay(800, 1500);

    // Send
    const sendBtn = await page.$('button[type="submit"], button[aria-label*="Send"], .compose-form__send-btn');
    if (sendBtn) {
      await humanMouseMove(page, sendBtn);
      await sendBtn.click();
    } else {
      await page.keyboard.press('Control+Enter');
    }

    await gaussianDelay(1500, 2500);

    const warningAfter = await checkForWarnings(page);
    if (warningAfter.hasWarning) {
      applyHealthPenalty(accountId, 'warning');
      return 'error';
    }

    incrementAccountTracker(accountId, 'messages_sent');
    logger.info('InMail sent', { url: linkedinUrl, accountId, subject });
    broadcastLog('inmail_sent', { url: linkedinUrl, accountId });
    return 'sent';
  } finally {
    await page.close();
  }
}

export async function checkConnectionStatus(linkedinUrl: string, accountId = '__legacy__'): Promise<'connected' | 'pending' | 'none'> {
  const { gaussianDelay } = await import('../utils/humanizer');
  const page = await getPage(accountId);

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
