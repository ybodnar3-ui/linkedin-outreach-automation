import cron from 'node-cron';
import { logger } from '../utils/logger';
import { scrapeInbox } from '../services/inbox';
import { getBrowser, getBrowserForAccount } from '../services/browser';
import { listAccounts } from '../services/accounts';
import { broadcastLog } from '../index';

let isPolling = false;

async function runInboxPoll(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    // Scrape legacy single-account inbox
    try {
      const legacyContext = await getBrowser();
      const count = await scrapeInbox('__legacy__', legacyContext);
      if (count > 0) {
        broadcastLog('inbox_new_messages', { account: 'legacy', count });
      }
    } catch (err) {
      logger.warn('Legacy inbox poll failed', { error: err instanceof Error ? err.message : String(err) });
    }

    // Scrape per-account inboxes
    const accounts = listAccounts().filter(a => a.status === 'active');
    for (const account of accounts) {
      try {
        const context = await getBrowserForAccount(account.id, account.session_file);
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
