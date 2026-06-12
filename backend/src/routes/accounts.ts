import { Router, Request, Response } from 'express';
import { createAccount, listAccounts, getAccount, deleteAccount, updateAccountStatus, updateAccountProxy } from '../services/accounts';
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

router.post('/:id/login', (req: Request, res: Response) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  // Extension-only (ADR-001): the LinkedIn session lives in the user's Chrome.
  // There is no server-side login; the account goes active once its extension
  // pings the backend.
  return res.json({
    ok: true,
    message: 'Extension-only mode: log into LinkedIn in your Chrome and connect the extension for this account. No server login needed.',
  });
});

/**
 * POST /api/accounts/:id/import-cookies
 * Body: { cookies: Array<{name,value,...}> }
 *
 * Extension-only: cookies are no longer driven server-side. We only confirm the
 * export contains the `li_at` session cookie (proof the user is logged in) and
 * mark the account active. Automation executes through the extension.
 */
router.post('/:id/import-cookies', (req: Request, res: Response) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const { cookies } = req.body as { cookies?: unknown };
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return res.status(400).json({ error: 'cookies must be a non-empty array' });
  }

  const hasSession = (cookies as Array<{ name?: string }>).some(c => c.name === 'li_at');
  if (!hasSession) {
    return res.status(400).json({
      error: 'Invalid cookies: li_at cookie not found. Make sure you exported cookies from linkedin.com while logged in.',
    });
  }

  updateAccountStatus(req.params.id, 'active');
  logger.info('Account activated (extension-only, li_at present)', { accountId: req.params.id });
  return res.json({ ok: true, verified: true, message: 'Account activated. Automation runs through the extension in your Chrome.' });
});

export default router;
