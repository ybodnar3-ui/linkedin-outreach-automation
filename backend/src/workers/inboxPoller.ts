import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { scrapeInbox } from '../services/inbox';
import { getBrowser, getBrowserForAccount } from '../services/browser';
import { listAccounts, getAccountProxy } from '../services/accounts';
import { broadcastLog } from '../index';

let isPolling = false;

async function runInboxPoll(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    // Scrape legacy single-account inbox (only when a session file exists)
    const legacySessionFile = path.join(process.cwd(), '..', 'data', 'sessions', 'linkedin.json');
    if (fs.existsSync(legacySessionFile)) {
      try {
        const legacyContext = await getBrowser();
        const count = await scrapeInbox('__legacy__', legacyContext);
        if (count > 0) {
          broadcastLog('inbox_new_messages', { account: 'legacy', count });
        }
      } catch (err) {
        logger.warn('Legacy inbox poll failed', { error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      logger.debug('No legacy session file — skipping legacy inbox poll');
    }

    // Scrape per-account inboxes
    const accounts = listAccounts().filter(a => a.status === 'active');
    for (const account of accounts) {
      try {
        const proxy = getAccountProxy(account.id);
        const context = await getBrowserForAccount(account.id, account.session_file, proxy);
        const count = await scrapeInbox(account.id, context);
        if (count > 0) {
          broadcastLog('inbox_new_messages', { accountId: account.id, count });
        }
      } catch (err) {
        logger.error('Inbox poll failed for account', {
          accountId: account.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error('Inbox poll error', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isPolling = false;
  }
}

export function startInboxPoller(): void {
  cron.schedule('*/15 * * * *', () => {
    runInboxPoll().catch(err => {
      logger.error('Unhandled inbox poller error', { error: err instanceof Error ? err.message : String(err) });
    });
  });
  logger.info('Inbox poller scheduled (every 15 minutes)');
}
