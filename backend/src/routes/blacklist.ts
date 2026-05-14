import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../services/storage';
import { logger } from '../utils/logger';

const router = Router();

// GET /api/blacklist
router.get('/', (_req: Request, res: Response) => {
  const items = db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC').all();
  return res.json(items);
});

// POST /api/blacklist  { value: 'google.com', type: 'domain' | 'company' }
router.post('/', (req: Request, res: Response) => {
  const { value, type = 'domain' } = req.body;
  if (!value) return res.status(400).json({ error: 'value required' });
  if (!['domain', 'company'].includes(type)) {
    return res.status(400).json({ error: "type must be 'domain' or 'company'" });
  }
  const cleaned = value.trim().toLowerCase();
  try {
    db.prepare('INSERT INTO blacklist (id, value, type) VALUES (?, ?, ?)').run(uuidv4(), cleaned, type);
    logger.info('Blacklist entry added', { value: cleaned, type });
    return res.status(201).json({ ok: true });
  } catch {
    return res.status(409).json({ error: 'Already in blacklist' });
  }
});

// DELETE /api/blacklist/:id
router.delete('/:id', (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM blacklist WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
});

export default router;
