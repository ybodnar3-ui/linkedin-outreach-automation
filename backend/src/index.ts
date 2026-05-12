import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { initDb } from './services/storage';
import { logger } from './utils/logger';
import campaignsRouter from './routes/campaigns';
import leadsRouter from './routes/leads';
import analyticsRouter from './routes/analytics';
import settingsRouter from './routes/settings';

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
  res.json({ status: 'ok', ts: Date.now() });
});

app.use('/api/campaigns', campaignsRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/settings', settingsRouter);

// Pause all campaigns emergency endpoint
app.post('/api/pause-all', (_req, res) => {
  const { db } = require('./services/storage');
  db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE status = 'active'")
    .run(Math.floor(Date.now() / 1000));
  logger.warn('All campaigns paused via emergency stop');
  broadcastLog('pause_all', { message: 'All campaigns paused' });
  res.json({ ok: true });
});

initDb();
logger.info('Database initialized');

// Start campaign worker after DB init
import('./workers/campaignWorker').then(({ startWorker }) => {
  startWorker();
  logger.info('Campaign worker started');
}).catch((err) => {
  logger.error('Failed to start campaign worker', { error: err instanceof Error ? err.message : String(err) });
});

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;
