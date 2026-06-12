import { logger } from '../utils/logger';

/**
 * Inbox polling (reply detection).
 *
 * The server-side Playwright inbox scraper was removed in Phase 1 (ADR-001:
 * extension-only execution). Reply detection will be reintroduced as an
 * extension task type (`poll_threads`): the Chrome extension scrapes the
 * LinkedIn messaging inbox in the user's real session and POSTs replies to
 * the backend, which matches them to leads and sets `replied_at`.
 *
 * Until that lands, this is a no-op so the backend ships with zero browser code.
 */
export function startInboxPoller(): void {
  logger.info('Inbox poller disabled (extension-based reply detection pending — see ADR-001)');
}
