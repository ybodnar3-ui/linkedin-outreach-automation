import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { initDb } from './services/storage';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket log broadcast
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

// Routes will be mounted here in Plan 1.5

// Initialize DB and start server
initDb();
logger.info('Database initialized');

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;
