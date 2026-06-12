import { Router, Request, Response } from 'express';
import { db } from '../services/storage';
import { classifyReply } from '../services/replyClassifier';

const router = Router();

// GET /api/inbox — list distinct threads with last message info + latest sentiment
router.get('/', (_req: Request, res: Response) => {
  const threads = db.prepare(`
    SELECT
      thread_id,
      MAX(CASE WHEN direction = 'in' THEN sender_name ELSE NULL END) AS participant_name,
      text AS last_message,
      MAX(timestamp) AS timestamp,
      account_id,
      MAX(CASE WHEN direction = 'in' THEN sentiment ELSE NULL END) AS sentiment,
      MAX(CASE WHEN direction = 'in' THEN sentiment_note ELSE NULL END) AS sentiment_note
    FROM inbox_messages
    GROUP BY thread_id
    ORDER BY MAX(timestamp) DESC
    LIMIT 100
  `).all();

  return res.json(threads);
});

// POST /api/inbox/:messageId/classify — manually trigger AI classification
router.post('/:messageId/classify', async (req: Request, res: Response) => {
  const msg = db.prepare('SELECT id, text FROM inbox_messages WHERE id = ?')
    .get(req.params.messageId) as { id: string; text: string } | undefined;
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  await classifyReply(msg.id, msg.text);
  const updated = db.prepare('SELECT sentiment, sentiment_note FROM inbox_messages WHERE id = ?')
    .get(msg.id) as { sentiment: string; sentiment_note: string } | undefined;
  return res.json(updated);
});

// GET /api/inbox/:threadId — all messages in thread ordered by time
router.get('/:threadId', (req: Request, res: Response) => {
  const messages = db.prepare(`
    SELECT * FROM inbox_messages
    WHERE thread_id = ?
    ORDER BY timestamp ASC
  `).all(req.params.threadId);

  return res.json(messages);
});

// POST /api/inbox/:threadId/reply
// Extension-only (ADR-001): server-side Playwright replies were removed.
// Reply-via-extension will return with the `poll_threads` work. Until then,
// reply from LinkedIn directly.
router.post('/:threadId/reply', (_req: Request, res: Response) => {
  return res.status(501).json({
    error: 'Replies via the app are temporarily unavailable in extension-only mode. Reply from LinkedIn directly — extension reply support is coming next.',
  });
});

export default router;
