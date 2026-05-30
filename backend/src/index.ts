import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import { WebSocketServer, WebSocket } from 'ws';
import { initDb, db } from './services/storage';
import { logger } from './utils/logger';
import campaignsRouter from './routes/campaigns';
import leadsRouter from './routes/leads';
import analyticsRouter from './routes/analytics';
import settingsRouter from './routes/settings';
import accountsRouter from './routes/accounts';
import inboxRouter from './routes/inbox';
import abTestsRouter from './routes/abTests';
import blacklistRouter from './routes/blacklist';
import crmRouter from './routes/crm';
import crmPipelineRouter from './routes/crmPipeline';
import webhooksRouter from './routes/webhooks';
import authRouter from './routes/auth';
import extensionRouter from './routes/extension';
import { requireAuth } from './middleware/auth';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

export function broadcastLog(event: string, data: unknown): void {
  const message = JSON.stringify({ event, data, ts: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        logger.warn('WebSocket send failed', { error: String(err) });
      }
    }
  });
}

wss.on('connection', (ws) => {
  logger.info('WebSocket client connected');
  ws.on('error', (err) => {
    logger.warn('WebSocket client error', { error: String(err) });
  });
  try {
    ws.send(JSON.stringify({ event: 'connected', data: { message: 'Connected to log stream' }, ts: Date.now() }));
  } catch (err) {
    logger.warn('WebSocket initial send failed', { error: String(err) });
  }
});

wss.on('error', (err) => {
  logger.error('WebSocketServer error', { error: String(err) });
});

// Public routes — no auth required
app.get('/api/health', (_req, res) => {
  // first_run = true when no accounts AND no default session cookie file
  // browser.ts saves the default session to 'linkedin.json'
  const sessionFile = path.join(process.cwd(), '..', 'data', 'sessions', 'linkedin.json');
  const hasSession = fs.existsSync(sessionFile);
  const accountCount = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }).c;
  logger.debug('Health check', { accountCount, hasSession, first_run: accountCount === 0 && !hasSession });
  res.json({ status: 'ok', ts: Date.now(), first_run: accountCount === 0 && !hasSession });
});

app.use('/api/auth', authRouter);

// Extension routes use their own token auth — must be BEFORE requireAuth
app.use('/api/extension', extensionRouter);

// All routes below this line require a valid JWT
app.use('/api', requireAuth);

app.use('/api/campaigns', campaignsRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/ab-tests', abTestsRouter);
app.use('/api/blacklist', blacklistRouter);
app.use('/api/crm', crmRouter);
app.use('/api/crm-pipeline', crmPipelineRouter);
app.use('/api/webhooks', webhooksRouter);

// Pause all campaigns emergency endpoint (protected by requireAuth above)
app.post('/api/pause-all', (_req, res) => {
  db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE status = 'active'")
    .run(Math.floor(Date.now() / 1000));
  logger.warn('All campaigns paused via emergency stop');
  broadcastLog('pause_all', { message: 'All campaigns paused' });
  res.json({ ok: true });
});

// Serve frontend static files in production
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // Catch-all for SPA — must NOT intercept /api/* routes
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// Global error handler — catches any unhandled errors thrown in routes
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Unhandled route error', { error: message });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

initDb();
logger.info('Database initialized');

// Startup recovery: reset tasks that were mid-flight when server last died.
// "claimed" = extension had the task but never reported back (crash/sleep).
// Reset to "pending" so the worker can re-queue them on the next cycle.
const recoveredTasks = db.prepare(
  "UPDATE extension_tasks SET status = 'pending', claimed_at = NULL WHERE status = 'claimed'"
).run();
if (recoveredTasks.changes > 0) {
  logger.warn('Startup recovery: reset claimed tasks to pending', { count: recoveredTasks.changes });
}

// Start campaign worker after DB init
import('./workers/campaignWorker').then(({ startWorker }) => {
  startWorker();
  logger.info('Campaign worker started');
}).catch((err) => {
  logger.error('Failed to start campaign worker', { error: err instanceof Error ? err.message : String(err) });
});

// Start inbox poller
import('./workers/inboxPoller').then(({ startInboxPoller }) => {
  startInboxPoller();
  logger.info('Inbox poller started');
}).catch((err) => {
  logger.error('Failed to start inbox poller', { error: err instanceof Error ? err.message : String(err) });
});

// Background LinkedIn feed activity — 3× per day, 70% random chance per account slot
// Runs at 09:00, 13:00, 17:00 UTC — makes the account look like an active human user
cron.schedule('0 9,13,17 * * *', async () => {
  try {
    const { doBackgroundFeedActivity } = await import('./services/linkedin');
    const accounts = db.prepare("SELECT id FROM accounts WHERE status = 'active'").all() as Array<{ id: string }>;
    logger.info('Background feed activity cron fired', { activeAccounts: accounts.length });
    for (const acc of accounts) {
      // 70% random chance — more human-like than doing it every single time
      if (Math.random() < 0.7) {
        const count = Math.floor(Math.random() * 5) + 3; // 3–7 likes
        doBackgroundFeedActivity(acc.id, count)
          .then(liked => logger.info('Background activity done', { accountId: acc.id, liked }))
          .catch(err => logger.warn('Background activity error', { accountId: acc.id, error: String(err) }));
        // Stagger accounts — wait 30-90s between each
        await new Promise(r => setTimeout(r, 30000 + Math.random() * 60000));
      }
    }
  } catch (err) {
    logger.error('Background activity cron error', { error: String(err) });
  }
});
logger.info('Background feed activity cron scheduled (09:00, 13:00, 17:00 UTC)');

// Catch unhandled promise rejections / uncaught exceptions so the process doesn't silently die
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  // Give the logger a tick to flush, then exit — let the process manager restart us
  setTimeout(() => process.exit(1), 500);
});

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;
