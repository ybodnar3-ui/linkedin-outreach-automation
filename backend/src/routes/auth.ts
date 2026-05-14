import { Router, Request, Response } from 'express';
import { signToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// POST /api/auth/login  { username, password }
router.post('/login', (req: Request, res: Response) => {
  const APP_USERNAME = process.env.APP_USERNAME || 'admin';
  const APP_PASSWORD = process.env.APP_PASSWORD;

  if (!APP_PASSWORD) {
    logger.error('APP_PASSWORD env variable not set — auth disabled');
    return res.status(500).json({ error: 'Server not configured (APP_PASSWORD missing)' });
  }

  const { username, password } = req.body as { username: string; password: string };

  if (username !== APP_USERNAME || password !== APP_PASSWORD) {
    logger.warn('Failed login attempt', { username });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(username);
  logger.info('User logged in', { username });
  return res.json({ token, username });
});

export default router;
