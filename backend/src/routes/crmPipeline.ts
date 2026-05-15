import { Router, Request, Response } from 'express';
import { db } from '../services/storage';
import { logger } from '../utils/logger';

const router = Router();

const STAGES = ['new', 'contacted', 'replied', 'call_booked', 'won', 'lost'] as const;
type Stage = typeof STAGES[number];

/**
 * GET /api/crm-pipeline
 * Returns leads that have been interacted with (connected or in-progress),
 * along with their CRM stage for Kanban display.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const leads = db.prepare(`
      SELECT l.id, l.first_name, l.last_name, l.company, l.title, l.linkedin_url,
             l.email, l.status, l.replied_at, l.connected_at,
             COALESCE(l.crm_stage, 'contacted') as crm_stage,
             l.crm_notes, l.crm_next_follow_up,
             c.name as campaign_name
      FROM leads l
      LEFT JOIN campaigns c ON c.id = l.campaign_id
      WHERE l.status IN ('in_progress', 'completed')
         OR l.connected_at IS NOT NULL
         OR l.replied_at IS NOT NULL
      ORDER BY l.updated_at DESC
      LIMIT 500
    `).all();
    return res.json(leads);
  } catch (err) {
    logger.error('CRM pipeline GET error', { error: String(err) });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/crm-pipeline/:leadId
 * Update a lead's CRM stage, notes, and next follow-up date.
 */
router.put('/:leadId', (req: Request, res: Response) => {
  const { stage, notes, next_follow_up } = req.body as {
    stage?: string;
    notes?: string;
    next_follow_up?: number | null;
  };

  if (stage && !STAGES.includes(stage as Stage)) {
    return res.status(400).json({ error: `Invalid stage. Must be one of: ${STAGES.join(', ')}` });
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    const result = db.prepare(`
      UPDATE leads
      SET crm_stage = COALESCE(?, crm_stage),
          crm_notes = ?,
          crm_next_follow_up = ?,
          updated_at = ?
      WHERE id = ?
    `).run(stage ?? null, notes ?? null, next_follow_up ?? null, now, req.params.leadId);

    if (result.changes === 0) return res.status(404).json({ error: 'Lead not found' });

    logger.info('CRM stage updated', { leadId: req.params.leadId, stage, hasNotes: !!notes });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('CRM pipeline PUT error', { leadId: req.params.leadId, error: String(err) });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
