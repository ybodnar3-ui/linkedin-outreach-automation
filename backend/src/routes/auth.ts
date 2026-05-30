import { Router, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { signToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// Constant-time string compare to prevent timing attacks on credentials.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ── Simple in-memory brute-force protection ─────────────────────────────────
// Tracks failed attempts per IP. Resets on success or after the window.
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 min
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; firstAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
    attempts.set(ip, { count: 0, firstAt: now });
    return true;
  }
  return rec.count < MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: now });
  } else {
    rec.count += 1;
  }
}

// Periodically purge old entries so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) {
    if (now - rec.firstAt > LOGIN_WINDOW_MS) attempts.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref();

// POST /api/auth/login  { username, password }
router.post('/login', (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (!checkRateLimit(ip)) {
    logger.warn('Login rate limit exceeded', { ip });
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const APP_USERNAME = process.env.APP_USERNAME || 'admin';
  const APP_PASSWORD = process.env.APP_PASSWORD;

  if (!APP_PASSWORD) {
    logger.error('APP_PASSWORD env variable not set — auth disabled');
    return res.status(500).json({ error: 'Server not configured (APP_PASSWORD missing)' });
  }

  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }

  const ok = safeEqual(username, APP_USERNAME) && safeEqual(password, APP_PASSWORD);
  if (!ok) {
    recordFailure(ip);
    logger.warn('Failed login attempt', { username, ip });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  attempts.delete(ip); // reset on success
  const token = signToken(username);
  logger.info('User logged in', { username, ip });
  return res.json({ token, username });
});

export default router;
