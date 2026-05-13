import { Router, Request, Response } from 'express';
import { getSetting, setSetting } from '../services/storage';
import { isSessionActive, startManualLogin } from '../services/browser';
import { logger } from '../utils/logger';

const router = Router();

const ALLOWED_SETTINGS = ['my_name', 'timezone', 'working_hours_start', 'working_hours_end'];

router.get('/', (_req: Request, res: Response) => {
  const settings: Record<string, string | null> = {};
  for (const key of ALLOWED_SETTINGS) {
    settings[key] = getSetting(key);
  }
  return res.json(settings);
});

router.put('/', (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_SETTINGS.includes(key)) continue;
    setSetting(key, String(value));
  }
  return res.json({ ok: true });
});

router.post('/login', (_req: Request, res: Response) => {
  // Returns immediately — login happens async in a visible browser window
  res.json({ ok: true, message: 'Manual login started. Complete login in the browser window.' });

  startManualLogin().catch((err) => {
    logger.error('Manual login failed', { error: err instanceof Error ? err.message : String(err) });
  });
});

router.get('/session', async (_req: Request, res: Response) => {
  try {
    const active = await isSessionActive();
    return res.json({ active });
  } catch {
    return res.json({ active: false });
  }
});

export default router;
