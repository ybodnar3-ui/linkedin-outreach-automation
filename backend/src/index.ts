import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
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

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

export function broadcastLog(event: string, data: unknown): void {
  const message = JSON.stringify({ event, data, ts: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  logger.info('WebSocket client connected');
  ws.send(JSON.stringify({ event: 'connected', data: { message: 'Connected to log stream' }, ts: Date.now() }));
});

app.get('/api/health', (_req, res) => {
  // first_run = true when no accounts AND no default session cookie file
  // browser.ts saves the default session to 'linkedin.json'
  const sessionFile = path.join(process.cwd(), '..', 'data', 'sessions', 'linkedin.json');
  const hasSession = fs.existsSync(sessionFile);
  const accountCount = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }).c;
  logger.debug('Health check', { accountCount, hasSession, first_run: accountCount === 0 && !hasSession });
  res.json({ status: 'ok', ts: Date.now(), first_run: accountCount === 0 && !hasSession });
});

app.use('/api/campaigns', campaignsRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/ab-tests', abTestsRouter);

// Pause all campaigns emergency endpoint
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
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

initDb();
logger.info('Database initialized');

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

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;
