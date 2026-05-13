import { Router, Request, Response } from 'express';
import { createAccount, listAccounts, getAccount, deleteAccount, updateAccountStatus } from '../services/accounts';
import { startManualLoginForAccount } from '../services/browser';
import { getAccountHealthInfo } from '../services/accountHealth';

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

export default router;
