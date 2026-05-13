import { Router, Request, Response } from 'express';
import { getSetting, setSetting } from '../services/storage';
import { isSessionActive, startManualLogin } from '../services/browser';
import { logger } from '../utils/logger';

const router = Router();

const ALLOWED_SETTINGS = ['my_name', 'timezone', 'working_hours_start', 'working_hours_end', 'icebreaker_enabled',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_from', 'smtp_secure'];
const API_KEY_SETTINGS = ['hunter_api_key', 'apollo_api_key', 'auto_email_discovery', 'openai_api_key', 'anthropic_api_key',
  'smtp_password'];
const MASKED_KEYS = ['hunter_api_key', 'apollo_api_key', 'openai_api_key', 'anthropic_api_key', 'smtp_password'];

router.get('/', (_req: Request, res: Response) => {
  const settings: Record<string, string | null> = {};
  for (const key of ALLOWED_SETTINGS) {
    settings[key] = getSetting(key);
  }
  // API keys — return masked values for security
  for (const key of MASKED_KEYS) {
    settings[key] = getSetting(key) ? '***' : '';
  }
  settings['auto_email_discovery'] = getSetting('auto_email_discovery') || 'false';
  settings['icebreaker_enabled'] = getSetting('icebreaker_enabled') || '0';
  // SMTP non-secret fields
  settings['smtp_host'] = getSetting('smtp_host') || '';
  settings['smtp_port'] = getSetting('smtp_port') || '587';
  settings['smtp_user'] = getSetting('smtp_user') || '';
  settings['smtp_from'] = getSetting('smtp_from') || '';
  settings['smtp_secure'] = getSetting('smtp_secure') || '0';
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
