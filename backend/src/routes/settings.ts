import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getSetting, setSetting } from '../services/storage';
import { isSessionActive, startManualLogin } from '../services/browser';
import { testProxycurlConnection } from '../services/proxycurl';
import { logger } from '../utils/logger';

const router = Router();

const ALLOWED_SETTINGS = ['my_name', 'timezone', 'working_hours_start', 'working_hours_end', 'icebreaker_enabled',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_from', 'smtp_secure',
  'pipedrive_domain'];
const API_KEY_SETTINGS = ['hunter_api_key', 'apollo_api_key', 'auto_email_discovery', 'openai_api_key', 'anthropic_api_key',
  'smtp_password', 'hubspot_api_key', 'pipedrive_api_token', 'proxycurl_api_key'];
const MASKED_KEYS = ['hunter_api_key', 'apollo_api_key', 'openai_api_key', 'anthropic_api_key', 'smtp_password',
  'hubspot_api_key', 'pipedrive_api_token', 'proxycurl_api_key'];

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
  // CRM non-secret fields
  settings['pipedrive_domain'] = getSetting('pipedrive_domain') || '';
  // Extension token — generate a random one if not yet set (never hardcode)
  let extToken = getSetting('extension_token') ?? '';
  if (!extToken) {
    extToken = randomUUID();
    setSetting('extension_token', extToken);
    logger.info('Extension token generated on settings read');
  }
  settings['extension_token'] = extToken;
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

// POST /api/settings/proxycurl/test — check credits + connectivity
router.post('/proxycurl/test', async (_req: Request, res: Response) => {
  try {
    const result = await testProxycurlConnection();
    return res.json(result);
  } catch (err) {
    logger.error('Proxycurl test failed', { error: String(err) });
    return res.status(500).json({ ok: false, error: 'Request failed' });
  }
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
