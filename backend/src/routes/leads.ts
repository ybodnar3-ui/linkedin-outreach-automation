import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import { db } from '../services/storage';
import { logger } from '../utils/logger';
import { discoverEmail } from '../services/emailDiscovery';
import { scrapeSalesNav } from '../services/salesNavScraper';

const router = Router();
const upload = multer({ dest: '../data/uploads/' });

const LINKEDIN_URL_PATTERN = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+(\/)?$/i;

router.get('/', (req: Request, res: Response) => {
  const { campaign_id, status, page = '1', limit = '50' } = req.query;
  const pageNum  = Math.max(1, parseInt(page  as string, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
  const offset   = (pageNum - 1) * limitNum;

  let query = 'SELECT * FROM leads WHERE 1=1';
  const params: unknown[] = [];

  if (campaign_id) { query += ' AND campaign_id = ?'; params.push(campaign_id); }
  if (status) { query += ' AND status = ?'; params.push(status); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const leads = db.prepare(query).all(...params);
  const total = (db.prepare('SELECT COUNT(*) as n FROM leads WHERE 1=1' +
    (campaign_id ? ' AND campaign_id = ?' : '') +
    (status ? ' AND status = ?' : ''))
    .get(...params.slice(0, -2)) as { n: number }).n;

  return res.json({ leads, total, page: pageNum, limit: limitNum });
});

// GET /api/leads/export/csv — MUST be registered before /:id
router.get('/export/csv', (req: Request, res: Response) => {
  const { campaign_id } = req.query;

  let leads: Record<string, unknown>[];
  if (campaign_id) {
    leads = db.prepare('SELECT * FROM leads WHERE campaign_id = ? ORDER BY created_at ASC').all(campaign_id as string) as Record<string, unknown>[];
  } else {
    leads = db.prepare('SELECT * FROM leads ORDER BY created_at ASC').all() as Record<string, unknown>[];
  }

  if (leads.length === 0) {
    return res.status(404).json({ error: 'No leads found' });
  }

  const COLUMNS = [
    'id', 'campaign_id', 'linkedin_url',
    'first_name', 'last_name', 'company', 'title', 'email',
    'status', 'headline', 'location', 'years_at_company', 'school',
    'skills', 'recent_post', 'mutual_connections', 'summary',
    'connection_sent_at', 'connected_at', 'replied_at', 'last_message_at',
    'created_at', 'updated_at',
  ];

  // Formula injection guard — prefix =+-@ with a single quote so spreadsheets treat it as text
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    if (/^[=+\-@]/.test(str)) str = `'${str}`;
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = COLUMNS.join(',');
  const rows = leads.map(lead =>
    COLUMNS.map(col => escape(lead[col])).join(',')
  );

  const csvOutput = [header, ...rows].join('\n');
  const filename = campaign_id
    ? `leads-campaign-${campaign_id}-${Date.now()}.csv`
    : `leads-all-${Date.now()}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  logger.info('Leads exported', { campaign_id: campaign_id ?? 'all', count: leads.length });
  return res.send(csvOutput);
});

router.get('/:id', (req: Request, res: Response) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  return res.json(lead);
});

router.post('/', (req: Request, res: Response) => {
  const { campaign_id, linkedin_url, first_name, last_name, company, title } = req.body;

  if (!campaign_id || !linkedin_url) {
    return res.status(400).json({ error: 'campaign_id and linkedin_url are required' });
  }
  if (!LINKEDIN_URL_PATTERN.test(linkedin_url)) {
    return res.status(400).json({ error: 'Invalid LinkedIn URL' });
  }

  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  try {
    db.prepare('INSERT INTO leads (id, campaign_id, linkedin_url, first_name, last_name, company, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, campaign_id, linkedin_url, first_name ?? null, last_name ?? null, company ?? null, title ?? null, now, now);
    return res.status(201).json({ id });
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Lead already exists in this campaign' });
    }
    logger.error('Failed to insert lead', { error: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  const { first_name, last_name, company, title } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare('UPDATE leads SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), company = COALESCE(?, company), title = COALESCE(?, title), updated_at = ? WHERE id = ?')
    .run(first_name ?? null, last_name ?? null, company ?? null, title ?? null, now, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
});

router.delete('/:id', (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
});

router.post('/:id/skip', (req: Request, res: Response) => {
  const { reason } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare("UPDATE leads SET status = 'skipped', skip_reason = ?, updated_at = ? WHERE id = ?")
    .run(reason ?? 'manual', now, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ ok: true });
});

router.post('/import/csv', upload.single('file'), async (req: Request, res: Response) => {
  const { campaign_id } = req.body;
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });
  if (!req.file) return res.status(400).json({ error: 'file is required' });

  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaign_id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const results: Array<Record<string, string>> = [];
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(req.file!.path)
      .pipe(csv())
      .on('data', (data: Record<string, string>) => results.push(data))
      .on('end', resolve)
      .on('error', reject);
  });

  fs.unlinkSync(req.file.path);

  let added = 0, skipped = 0;
  const errors: string[] = [];
  const errorDetails: Array<{ row: number; url: string; reason: string }> = [];

  const now = Math.floor(Date.now() / 1000);
  const insertLead = db.prepare('INSERT OR IGNORE INTO leads (id, campaign_id, linkedin_url, first_name, last_name, company, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

  results.forEach((row, i) => {
    const url = row.linkedin_url || row.url || row.LinkedIn || row.profile_url || '';
    if (!url) {
      errors.push(`Row ${i + 2}: missing linkedin_url`);
      errorDetails.push({ row: i + 2, url: '', reason: 'missing linkedin_url' });
      return;
    }

    if (!LINKEDIN_URL_PATTERN.test(url.trim())) {
      errors.push(`Row ${i + 2}: invalid LinkedIn URL "${url}"`);
      errorDetails.push({ row: i + 2, url, reason: 'invalid LinkedIn URL' });
      return;
    }

    const result = insertLead.run(
      uuidv4(), campaign_id, url.trim(),
      row.first_name || null, row.last_name || null,
      row.company || null, row.title || null,
      now, now
    );

    if (result.changes > 0) { added++; } else { skipped++; }
  });

  logger.info('CSV import complete', { campaign_id, added, skipped, errors: errors.length });
  return res.json({ added, skipped, errors: errors.length, errorDetails });
});

// POST /api/leads/import-sales-nav — scrape leads from Sales Navigator search URL
router.post('/import-sales-nav', async (req: Request, res: Response) => {
  const { campaign_id, search_url, max_leads = 25 } = req.body;

  if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });
  if (!search_url) return res.status(400).json({ error: 'search_url required' });

  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaign_id) as { id: string } | undefined;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const result = await scrapeSalesNav(search_url, Math.min(Number(max_leads), 100));

  if (result.errors.length > 0 && result.leads.length === 0) {
    return res.status(422).json({ error: result.errors[0], errors: result.errors });
  }

  const now = Math.floor(Date.now() / 1000);
  const insertLead = db.prepare(`
    INSERT OR IGNORE INTO leads (id, campaign_id, linkedin_url, first_name, last_name, company, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  for (const lead of result.leads) {
    const ins = insertLead.run(
      uuidv4(), campaign_id, lead.linkedin_url,
      lead.first_name, lead.last_name,
      lead.company, lead.title,
      now, now
    );
    if (ins.changes > 0) { added++; } else { skipped++; }
  }

  logger.info('Sales Nav import complete', { campaign_id, added, skipped, totalFound: result.totalFound });
  return res.json({ added, skipped, total_found: result.totalFound, errors: result.errors.length, error_details: result.errors });
});

// POST /api/leads/:id/discover-email — trigger async email discovery
router.post('/:id/discover-email', async (req: Request, res: Response) => {
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id) as { id: string } | undefined;
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  discoverEmail(req.params.id).catch(err => {
    logger.error('Email discovery failed', {
      leadId: req.params.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return res.status(202).json({ ok: true, message: 'Email discovery started' });
});

export default router;
