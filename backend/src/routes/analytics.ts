import { Router, Request, Response } from 'express';
import { db } from '../services/storage';

const router = Router();

router.get('/overview', (_req: Request, res: Response) => {
  const campaigns = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM campaigns").get() as { total: number; active: number };
  const leads = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN connected_at IS NOT NULL THEN 1 ELSE 0 END) as connected, SUM(CASE WHEN last_message_at IS NOT NULL THEN 1 ELSE 0 END) as messaged FROM leads").get() as { total: number; connected: number; messaged: number };
  const today = db.prepare('SELECT * FROM daily_tracker WHERE date = ?').get(new Date().toISOString().split('T')[0]) as { connections_sent: number; messages_sent: number; profiles_visited: number } | undefined;

  return res.json({
    campaigns,
    leads,
    today: today ?? { connections_sent: 0, messages_sent: 0, profiles_visited: 0 },
  });
});

router.get('/daily', (req: Request, res: Response) => {
  const days = Math.min(90, parseInt((req.query.days as string) || '30', 10));
  const rows = db.prepare(`
    SELECT date, connections_sent, messages_sent, profiles_visited
    FROM daily_tracker
    ORDER BY date DESC
    LIMIT ?
  `).all(days);
  return res.json(rows);
});

router.get('/campaign/:id', (req: Request, res: Response) => {
  const stats = db.prepare(`
    SELECT
      l.status,
      COUNT(*) as count,
      SUM(CASE WHEN l.connected_at IS NOT NULL THEN 1 ELSE 0 END) as connected,
      SUM(CASE WHEN l.last_message_at IS NOT NULL THEN 1 ELSE 0 END) as messaged,
      SUM(CASE WHEN l.connection_sent_at IS NOT NULL THEN 1 ELSE 0 END) as connection_sent
    FROM leads l
    WHERE l.campaign_id = ?
    GROUP BY l.status
  `).all(req.params.id);
  return res.json(stats);
});

export default router;
