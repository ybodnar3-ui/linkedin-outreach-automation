import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../services/storage';
import { logger } from '../utils/logger';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  res.json(campaigns);
});

router.get('/:id', (req: Request, res: Response) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  const steps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_order').all(req.params.id);
  return res.json({ ...campaign as object, steps });
});

router.post('/', (req: Request, res: Response) => {
  const { name, timezone = 'America/New_York', steps = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  db.prepare('INSERT INTO campaigns (id, name, timezone, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, timezone, 'draft', now, now);

  const insertStep = db.prepare(
    'INSERT INTO campaign_steps (id, campaign_id, step_order, action, wait_days, condition, message_text, email_subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  for (const step of steps) {
    insertStep.run(uuidv4(), id, step.step_order, step.action, step.wait_days ?? 0, step.condition ?? 'always', step.message_text ?? null, step.email_subject ?? null);
  }

  logger.info('Campaign created', { id, name });
  return res.status(201).json({ id });
});

router.put('/:id', (req: Request, res: Response) => {
  const { name, timezone } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare('UPDATE campaigns SET name = COALESCE(?, name), timezone = COALESCE(?, timezone), updated_at = ? WHERE id = ?')
    .run(name ?? null, timezone ?? null, now, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
});

router.delete('/:id', (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
});

router.post('/:id/start', (req: Request, res: Response) => {
  const result = db.prepare("UPDATE campaigns SET status = 'active', updated_at = ? WHERE id = ? AND status != 'active'")
    .run(Math.floor(Date.now() / 1000), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found or already active' });
  logger.info('Campaign started', { id: req.params.id });
  return res.json({ ok: true });
});

router.post('/:id/pause', (req: Request, res: Response) => {
  const result = db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
});

router.post('/:id/resume', (req: Request, res: Response) => {
  const result = db.prepare("UPDATE campaigns SET status = 'active', updated_at = ? WHERE id = ? AND status = 'paused'")
    .run(Math.floor(Date.now() / 1000), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found or not paused' });
  return res.json({ ok: true });
});

router.get('/:id/stats', (req: Request, res: Response) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
      SUM(CASE WHEN connected_at IS NOT NULL THEN 1 ELSE 0 END) as connected,
      SUM(CASE WHEN last_message_at IS NOT NULL THEN 1 ELSE 0 END) as messaged
    FROM leads WHERE campaign_id = ?
  `).get(req.params.id);
  return res.json(stats);
});

export default router;
