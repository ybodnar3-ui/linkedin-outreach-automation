import { BrowserContext, Page } from 'playwright';
import { db } from './storage';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface InboxThread {
  thread_id: string;
  participant_name: string | null;
  last_message: string;
  timestamp: number;
}

export interface InboxMessage {
  id: string;
  thread_id: string;
  lead_id: string | null;
  direction: 'in' | 'out';
  sender_name: string | null;
  text: string;
  timestamp: number;
}

const MESSAGING_URL = 'https://www.linkedin.com/messaging/';
const THREAD_URL = (threadId: string) => `https://www.linkedin.com/messaging/thread/${threadId}/`;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scrape LinkedIn messaging page for new threads and messages.
 * Saves new messages to inbox_messages table.
 * Returns count of new messages saved.
 */
export async function scrapeInbox(accountId: string, context: BrowserContext): Promise<number> {
  const page = await context.newPage();
  let savedCount = 0;

  try {
    logger.info('Scraping inbox', { accountId });
    await page.goto(MESSAGING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.msg-conversation-listitem, .scaffold-layout__list', { timeout: 15000 })
      .catch(() => logger.warn('Inbox list not found — possibly not logged in', { accountId }));

    const threadLinks = await page.$$eval(
      '.msg-conversation-listitem a[href*="/messaging/thread/"]',
      (anchors) => (anchors as HTMLAnchorElement[]).slice(0, 20).map(a => {
        const match = a.href.match(/\/messaging\/thread\/([^/]+)/);
        return match ? match[1] : null;
      }).filter(Boolean) as string[]
    );

    for (const threadId of threadLinks) {
      try {
        savedCount += await scrapeThread(accountId, threadId, page);
        await sleep(1500 + Math.random() * 1000);
      } catch (err) {
        logger.warn('Failed to scrape thread', {
          threadId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await page.close();
  }

  return savedCount;
}

async function scrapeThread(accountId: string, threadId: string, page: Page): Promise<number> {
  await page.goto(THREAD_URL(threadId), { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.msg-s-message-list', { timeout: 10000 }).catch(() => {});

  const messages = await page.$$eval(
    '.msg-s-event-listitem',
    (items) => (items as Element[]).map(item => {
      const isOther = item.classList.contains('msg-s-event-listitem--other');
      const textEl = item.querySelector('.msg-s-event-listitem__body');
      const senderEl = item.querySelector('.msg-s-message-group__name');
      const timeEl = item.querySelector('time');

      const rawText = textEl?.textContent?.trim() ?? '';
      const senderName = senderEl?.textContent?.trim() ?? null;
      const datetimeAttr = timeEl?.getAttribute('datetime');
      const timestamp = datetimeAttr
        ? Math.floor(new Date(datetimeAttr).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      return { direction: isOther ? 'in' : 'out', text: rawText, senderName, timestamp };
    }).filter(m => m.text.length > 0)
  ) as Array<{ direction: 'in' | 'out'; text: string; senderName: string | null; timestamp: number }>;

  let savedCount = 0;
  for (const msg of messages) {
    const existing = db.prepare(
      'SELECT id FROM inbox_messages WHERE thread_id = ? AND direction = ? AND timestamp = ?'
    ).get(threadId, msg.direction, msg.timestamp);

    if (!existing) {
      db.prepare(`
        INSERT INTO inbox_messages (id, account_id, thread_id, lead_id, direction, sender_name, text, timestamp)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
      `).run(uuidv4(), accountId, threadId, msg.direction, msg.senderName, msg.text, msg.timestamp);
      savedCount++;
    }
  }

  return savedCount;
}

/**
 * Send a reply in a LinkedIn thread via Playwright.
 * Saves the sent message to inbox_messages.
 */
export async function sendReply(
  accountId: string,
  threadId: string,
  text: string,
  context: BrowserContext
): Promise<boolean> {
  const page = await context.newPage();

  try {
    await page.goto(THREAD_URL(threadId), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('.msg-form__contenteditable', { timeout: 10000 });

    const textarea = await page.$('.msg-form__contenteditable');
    if (!textarea) throw new Error('Reply textarea not found');

    await textarea.click();
    await sleep(500);

    for (const char of text) {
      await page.keyboard.type(char);
      await sleep(40 + Math.random() * 60);
    }

    await sleep(800);

    const sendBtn = await page.$('.msg-form__send-button');
    if (!sendBtn) throw new Error('Send button not found');
    await sendBtn.click();

    await sleep(1500);

    db.prepare(`
      INSERT INTO inbox_messages (id, account_id, thread_id, lead_id, direction, sender_name, text, timestamp)
      VALUES (?, ?, ?, NULL, 'out', NULL, ?, ?)
    `).run(uuidv4(), accountId, threadId, text, Math.floor(Date.now() / 1000));

    logger.info('Reply sent', { accountId, threadId });
    return true;
  } catch (err) {
    logger.error('Failed to send reply', {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    await page.close();
  }
}
