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

// Comparison across all campaigns for bar chart
router.get('/campaigns-summary', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT
      c.id,
      c.name,
      COUNT(l.id) as total_leads,
      SUM(CASE WHEN l.connection_sent_at IS NOT NULL THEN 1 ELSE 0 END) as connections_sent,
      SUM(CASE WHEN l.connected_at IS NOT NULL THEN 1 ELSE 0 END) as connected,
      SUM(CASE WHEN l.last_message_at IS NOT NULL THEN 1 ELSE 0 END) as messaged,
      ROUND(100.0 * SUM(CASE WHEN l.connected_at IS NOT NULL THEN 1 ELSE 0 END)
        / MAX(1, SUM(CASE WHEN l.connection_sent_at IS NOT NULL THEN 1 ELSE 0 END)), 1) as acceptance_rate
    FROM campaigns c
    LEFT JOIN leads l ON l.campaign_id = c.id
    GROUP BY c.id
    ORDER BY acceptance_rate DESC
  `).all();
  return res.json(rows);
});

// GET /api/analytics/health — operational health for "is the machine OK?"
// Surfaces dead-letters, recent failures/warnings, retrying leads, and whether
// the extension is alive — so an operator can spot trouble without SQLite surgery.
router.get('/health', (_req: Request, res: Response) => {
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  const statusCounts = db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status')
    .all() as Array<{ status: string; n: number }>;
  const deadLettered = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'error' AND skip_reason = 'max_retries'").get() as { n: number };
  const retrying = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE fail_count > 0 AND status = 'pending'").get() as { n: number };
  const failures24h = db.prepare("SELECT COUNT(*) AS n FROM lead_events WHERE type IN ('failed','dead_lettered') AND created_at >= ?").get(dayAgo) as { n: number };
  const warnings24h = db.prepare("SELECT COUNT(*) AS n FROM lead_events WHERE type = 'warning' AND created_at >= ?").get(dayAgo) as { n: number };
  const lastActivity = db.prepare('SELECT MAX(created_at) AS ts FROM lead_events').get() as { ts: number | null };
  const extLastSeen = db.prepare("SELECT MAX(CAST(value AS INTEGER)) AS ts FROM app_settings WHERE key LIKE 'ext_last_seen_%'").get() as { ts: number | null };
  const pausedCampaigns = db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE status = 'paused'").get() as { n: number };

  const extensionActive = !!extLastSeen.ts && extLastSeen.ts >= now - 300;

  return res.json({
    extension: { active: extensionActive, last_seen: extLastSeen.ts },
    leads_by_status: statusCounts.reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {} as Record<string, number>),
    dead_lettered: deadLettered.n,
    retrying: retrying.n,
    failures_24h: failures24h.n,
    warnings_24h: warnings24h.n,
    paused_campaigns: pausedCampaigns.n,
    last_activity: lastActivity.ts,
    status: !extensionActive ? 'extension_offline'
      : warnings24h.n > 0 ? 'warning'
      : failures24h.n > 10 ? 'degraded'
      : 'ok',
  });
});

export default router;
