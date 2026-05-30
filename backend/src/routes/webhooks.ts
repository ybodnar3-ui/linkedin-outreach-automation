import { Router, Request, Response } from 'express';
import {
  listWebhooks, createWebhook, deleteWebhook, toggleWebhook,
  fireWebhookEvent, ALL_EVENTS, WebhookEvent,
} from '../services/webhookService';
import { logger } from '../utils/logger';

const router = Router();

// GET /api/webhooks
router.get('/', (_req: Request, res: Response) => {
  return res.json(listWebhooks());
});

// POST /api/webhooks
router.post('/', (req: Request, res: Response) => {
  const { url, events, secret } = req.body as { url: string; events: string[]; secret?: string };
  if (!url || !events?.length) {
    return res.status(400).json({ error: 'url and events[] required' });
  }
  // Validate URL — must be http:// or https://
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'url must use http or https protocol' });
    }
  } catch {
    return res.status(400).json({ error: 'url is not a valid URL' });
  }
  // Validate events
  const invalid = events.filter(e => !ALL_EVENTS.includes(e as WebhookEvent));
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown events: ${invalid.join(', ')}` });
  }
  try {
    const wh = createWebhook(url, events as WebhookEvent[], secret);
    return res.status(201).json(wh);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create webhook' });
  }
});

// DELETE /api/webhooks/:id
router.delete('/:id', (req: Request, res: Response) => {
  deleteWebhook(req.params.id);
  return res.json({ ok: true });
});

// PATCH /api/webhooks/:id — toggle active
router.patch('/:id', (req: Request, res: Response) => {
  const { active } = req.body as { active: boolean };
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active (boolean) required' });
  }
  toggleWebhook(req.params.id, active);
  return res.json({ ok: true });
});

// POST /api/webhooks/:id/test — send a test ping
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    await fireWebhookEvent('connection_accepted', {
      test: true,
      leadId: 'test-lead-id',
      linkedinUrl: 'https://www.linkedin.com/in/test',
      firstName: 'Test',
      lastName: 'User',
      company: 'Acme Corp',
    });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('Webhook test failed', { error: String(err) });
    return res.status(500).json({ error: 'Test delivery failed' });
  }
});

// GET /api/webhooks/events — list all supported event names
router.get('/events', (_req: Request, res: Response) => {
  return res.json(ALL_EVENTS);
});

export default router;
