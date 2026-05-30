import { Router, Request, Response } from 'express';
import { db } from '../services/storage';
import { sendReply } from '../services/inbox';
import { classifyReply } from '../services/replyClassifier';
import { getBrowser, getBrowserForAccount } from '../services/browser';
import { getAccount } from '../services/accounts';
import { logger } from '../utils/logger';

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
router.post('/:threadId/reply', async (req: Request, res: Response) => {
  const { text, account_id } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    let context;
    if (account_id) {
      const account = getAccount(account_id);
      if (!account) return res.status(404).json({ error: 'Account not found' });
      context = await getBrowserForAccount(account_id, account.session_file);
    } else {
      context = await getBrowser();
    }

    const ok = await sendReply(account_id || '__legacy__', req.params.threadId, text, context);
    if (!ok) return res.status(500).json({ error: 'Failed to send reply' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to send reply', { threadId: req.params.threadId, error: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: 'Failed to send reply' });
  }
});

export default router;
