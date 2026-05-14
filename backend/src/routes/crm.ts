import { Router, Request, Response } from 'express';
import { testCrmConnections, syncLeadToCrm } from '../services/crmSync';
import { db } from '../services/storage';
import { logger } from '../utils/logger';

const router = Router();

// POST /api/crm/test — verify CRM credentials
router.post('/test', async (_req: Request, res: Response) => {
  try {
    const result = await testCrmConnections();
    return res.json(result);
  } catch (err) {
    logger.error('CRM test failed', { error: String(err) });
    return res.status(500).json({ error: 'Test failed' });
  }
});

// POST /api/crm/sync/:leadId — manually push a single lead
router.post('/sync/:leadId', async (req: Request, res: Response) => {
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.leadId);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  try {
    await syncLeadToCrm(req.params.leadId);
    const updated = db.prepare('SELECT crm_contact_id, crm_synced_at FROM leads WHERE id = ?')
      .get(req.params.leadId) as { crm_contact_id: string | null; crm_synced_at: number | null };
    return res.json({ ok: true, ...updated });
  } catch (err) {
    logger.error('CRM manual sync failed', { leadId: req.params.leadId, error: String(err) });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

// POST /api/crm/sync-all — push all connected/replied leads that haven't been synced yet
router.post('/sync-all', async (_req: Request, res: Response) => {
  const leads = db.prepare(`
    SELECT id FROM leads
    WHERE status IN ('connected', 'replied') AND crm_synced_at IS NULL
    LIMIT 200
  `).all() as Array<{ id: string }>;

  let synced = 0;
  let failed = 0;
  for (const { id } of leads) {
    try {
      await syncLeadToCrm(id);
      synced++;
    } catch {
      failed++;
    }
  }

  return res.json({ ok: true, synced, failed, total: leads.length });
});

export default router;
