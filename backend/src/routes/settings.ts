import { Router, Request, Response } from 'express';
import { getSetting, setSetting } from '../services/storage';
import { isSessionActive, startManualLogin } from '../services/browser';
import { logger } from '../utils/logger';

const router = Router();

const ALLOWED_SETTINGS = ['my_name', 'timezone', 'working_hours_start', 'working_hours_end'];
const API_KEY_SETTINGS = ['hunter_api_key', 'apollo_api_key', 'auto_email_discovery'];

router.get('/', (_req: Request, res: Response) => {
  const settings: Record<string, string | null> = {};
  for (const key of ALLOWED_SETTINGS) {
    settings[key] = getSetting(key);
  }
  // API keys — return masked values for security
  settings['hunter_api_key'] = getSetting('hunter_api_key') ? '***' : '';
  settings['apollo_api_key'] = getSetting('apollo_api_key') ? '***' : '';
  settings['auto_email_discovery'] = getSetting('auto_email_discovery') || 'false';
  return res.json(settings);
});

router.put('/', (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_SETTINGS.includes(key)) continue;
    setSetting(key, String(value));
  }
  // Handle API keys separately — skip masked placeholder '***'
  for (const key of API_KEY_SETTINGS) {
    if (updates[key] !== undefined && updates[key] !== '***') {
      setSetting(key, String(updates[key]));
    }
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
