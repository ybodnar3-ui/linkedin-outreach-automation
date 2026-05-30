import { Router, Request, Response } from 'express';
import fs from 'fs';
import { createAccount, listAccounts, getAccount, deleteAccount, updateAccountStatus, updateAccountProxy } from '../services/accounts';
import { startManualLoginForAccount, getBrowserForAccount, closeAccountBrowser } from '../services/browser';
import { getAccountHealthInfo } from '../services/accountHealth';
import { logger } from '../utils/logger';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const accounts = listAccounts();
  const enriched = accounts.map(acc => ({
    ...acc,
    health: getAccountHealthInfo(acc.id),
  }));
  return res.json(enriched);
});

router.get('/:id', (req: Request, res: Response) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  return res.json(account);
});

router.post('/', (req: Request, res: Response) => {
  const { name, email } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const account = createAccount(name, email);
  return res.status(201).json(account);
});

router.delete('/:id', (req: Request, res: Response) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  deleteAccount(req.params.id);
  return res.json({ ok: true });
});

// PUT /api/accounts/:id/proxy — set proxy config (pass null values to clear)
router.put('/:id/proxy', (req: Request, res: Response) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  const { host, port, user, password } = req.body;
  updateAccountProxy(req.params.id, {
    host: host || null,
    port: port || null,
    user: user || null,
    password: password || null,
  });
  return res.json({ ok: true });
});

router.get('/:id/health', (req: Request, res: Response) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  return res.json(getAccountHealthInfo(req.params.id));
});

router.post('/:id/login', async (req: Request, res: Response) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  updateAccountStatus(req.params.id, 'disconnected');
  startManualLoginForAccount(req.params.id, account.session_file)
    .then(() => updateAccountStatus(req.params.id, 'active'))
    .catch(() => updateAccountStatus(req.params.id, 'error'));
  return res.json({ ok: true, message: 'Manual login started — complete in the browser window' });
});

/**
 * POST /api/accounts/:id/import-cookies
 * Body: { cookies: Array<{name,value,domain,...}> }
 *
 * Accepts a LinkedIn cookies JSON (exported via browser extension),
 * validates it contains the li_at session cookie, saves it as the
 * account session file, and marks the account active.
 * Optionally verifies the session against LinkedIn before confirming.
 */
router.post('/:id/import-cookies', async (req: Request, res: Response) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const { cookies } = req.body as { cookies?: unknown };
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return res.status(400).json({ error: 'cookies must be a non-empty array' });
  }

  // Must contain li_at — the LinkedIn session cookie
  const hasSession = (cookies as Array<{ name?: string }>).some(c => c.name === 'li_at');
  if (!hasSession) {
    return res.status(400).json({
      error: 'Invalid cookies: li_at cookie not found. Make sure you exported cookies from linkedin.com while logged in.',
    });
  }

  // Normalize cookies to Playwright format (add required fields if missing)
  const normalized = (cookies as Array<Record<string, unknown>>).map(c => ({
    name:     String(c.name   ?? ''),
    value:    String(c.value  ?? ''),
    domain:   String(c.domain ?? '.linkedin.com'),
    path:     String(c.path   ?? '/'),
    secure:   Boolean(c.secure  ?? true),
    httpOnly: Boolean(c.httpOnly ?? false),
    sameSite: (['Strict', 'Lax', 'None'].includes(String(c.sameSite)) ? c.sameSite : 'None') as 'Strict' | 'Lax' | 'None',
    ...(c.expires !== undefined ? { expires: Number(c.expires) } : {}),
  }));

  try {
    // Save session file
    fs.mkdirSync(require('path').dirname(account.session_file), { recursive: true });
    fs.writeFileSync(account.session_file, JSON.stringify(normalized, null, 2));

    // Close any existing browser so next access loads fresh cookies
    await closeAccountBrowser(req.params.id);

    // Quick LinkedIn session verification (headless)
    let verified = false;
    try {
      const ctx = await getBrowserForAccount(req.params.id, account.session_file);
      const page = await ctx.newPage();
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      const url = page.url();
      await page.close();
      verified = !url.includes('/login') && !url.includes('/checkpoint');
    } catch (verifyErr) {
      logger.warn('Cookie verification request failed (non-fatal)', { accountId: req.params.id, error: String(verifyErr) });
    }

    if (verified) {
      updateAccountStatus(req.params.id, 'active');
      logger.info('Cookies imported and verified — account active', { accountId: req.params.id });
      return res.json({ ok: true, verified: true, message: 'LinkedIn session verified — account is now active!' });
    } else {
      // Save but mark as disconnected — cookies may still be valid (verification can fail due to bot checks)
      updateAccountStatus(req.params.id, 'disconnected');
      logger.info('Cookies imported but verification inconclusive', { accountId: req.params.id });
      return res.json({
        ok: true,
        verified: false,
        message: 'Cookies saved. Verification was inconclusive (LinkedIn may have detected automation). The account will become active once used in a campaign.',
      });
    }
  } catch (err) {
    logger.error('Failed to import cookies', { accountId: req.params.id, error: String(err) });
    // Don't leak internal error/stack to the client
    return res.status(500).json({ error: 'Failed to save cookies' });
  }
});

export default router;
