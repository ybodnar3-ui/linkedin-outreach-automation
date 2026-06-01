/**
 * accountHealth.ts
 * Dynamic daily limits based on Account Health Score + Warmup schedule.
 *
 * Health Score (0-100):
 *   - Starts at 100 for new accounts
 *   - -30 on CAPTCHA detection
 *   - -20 on any LinkedIn warning
 *   - -50 on account restriction
 *   - +5 each healthy calendar day (no penalties)
 *   - Clamped to [0, 100]
 *
 * Warmup schedule (for accounts < 22 days old):
 *   Day  1-7  → max  5 connection requests/day
 *   Day  8-14 → max 10/day
 *   Day 15-21 → max 15/day
 *   Day 22+   → full limit (20/day)
 *
 * Effective limit = MIN(floor(MAX_LIMIT × health/100), warmupCap)
 */

import { db } from './storage';
import { SAFE_LIMITS } from '../utils/delays';
import { logger } from '../utils/logger';

// ─── Warmup schedule ──────────────────────────────────────────────────────────
const WARMUP_SCHEDULE: Array<{ untilDay: number; maxConnections: number }> = [
  { untilDay: 7,        maxConnections: 5  },
  { untilDay: 14,       maxConnections: 10 },
  { untilDay: 21,       maxConnections: 15 },
  { untilDay: Infinity, maxConnections: SAFE_LIMITS.connectionRequestsPerDay },
];

const WARMUP_GRADUATION_DAY = 22;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AccountHealthInfo {
  accountId: string;
  healthScore: number;        // 0-100
  accountAgeDays: number;
  isWarmingUp: boolean;
  warmupCap: number;          // max connections allowed by warmup stage
  effectiveConnectionLimit: number;
  effectiveMessageLimit: number;
  effectiveVisitLimit: number;
  connectionsUsedToday: number;
  messagesUsedToday: number;
  visitsUsedToday: number;
}

// ─── Core queries ─────────────────────────────────────────────────────────────

export function getAccountHealthInfo(accountId: string): AccountHealthInfo {
  const account = db.prepare('SELECT health_score, created_at FROM accounts WHERE id = ?')
    .get(accountId) as { health_score: number; created_at: number } | undefined;

  if (!account) {
    // Fallback for legacy (__legacy__) account — return full limits, still track daily usage
    const today = new Date().toISOString().split('T')[0];
    const legacyTracker = db.prepare(
      'SELECT connections_sent, messages_sent, profiles_visited FROM account_daily_tracker WHERE account_id = ? AND date = ?'
    ).get(accountId, today) as { connections_sent: number; messages_sent: number; profiles_visited: number } | undefined;
    return {
      accountId,
      healthScore: 100,
      accountAgeDays: 999,
      isWarmingUp: false,
      warmupCap: SAFE_LIMITS.connectionRequestsPerDay,
      effectiveConnectionLimit: SAFE_LIMITS.connectionRequestsPerDay,
      effectiveMessageLimit: SAFE_LIMITS.messagesPerDay,
      effectiveVisitLimit: SAFE_LIMITS.profileVisitsPerDay,
      connectionsUsedToday: legacyTracker?.connections_sent ?? 0,
      messagesUsedToday: legacyTracker?.messages_sent ?? 0,
      visitsUsedToday: legacyTracker?.profiles_visited ?? 0,
    };
  }

  const healthScore = Math.max(0, Math.min(100, account.health_score ?? 100));
  const nowSec = Math.floor(Date.now() / 1000);
  const accountAgeDays = Math.floor((nowSec - account.created_at) / 86400);
  const isWarmingUp = accountAgeDays < WARMUP_GRADUATION_DAY;

  // Warmup cap
  const warmupEntry = WARMUP_SCHEDULE.find(w => accountAgeDays < w.untilDay)
    ?? WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1];
  const warmupCap = warmupEntry.maxConnections;

  // Dynamic limits
  const healthMultiplier = healthScore / 100;
  const effectiveConnectionLimit = Math.min(
    Math.max(1, Math.floor(SAFE_LIMITS.connectionRequestsPerDay * healthMultiplier)),
    warmupCap,
  );
  const effectiveMessageLimit = Math.max(1, Math.floor(SAFE_LIMITS.messagesPerDay * healthMultiplier));
  const effectiveVisitLimit = Math.max(1, Math.floor(SAFE_LIMITS.profileVisitsPerDay * healthMultiplier));

  // Today's usage
  const today = new Date().toISOString().split('T')[0];
  const tracker = db.prepare(
    'SELECT connections_sent, messages_sent, profiles_visited FROM account_daily_tracker WHERE account_id = ? AND date = ?'
  ).get(accountId, today) as { connections_sent: number; messages_sent: number; profiles_visited: number } | undefined;

  return {
    accountId,
    healthScore,
    accountAgeDays,
    isWarmingUp,
    warmupCap,
    effectiveConnectionLimit,
    effectiveMessageLimit,
    effectiveVisitLimit,
    connectionsUsedToday: tracker?.connections_sent ?? 0,
    messagesUsedToday: tracker?.messages_sent ?? 0,
    visitsUsedToday: tracker?.profiles_visited ?? 0,
  };
}

// ─── Penalty / bonus ──────────────────────────────────────────────────────────

const PENALTY_MAP: Record<'captcha' | 'warning' | 'restriction', number> = {
  captcha:     30,
  warning:     20,
  restriction: 50,
};

export function applyHealthPenalty(
  accountId: string,
  event: 'captcha' | 'warning' | 'restriction',
): void {
  const penalty = PENALTY_MAP[event];
  db.prepare(`
    UPDATE accounts
    SET health_score = MAX(0, COALESCE(health_score, 100) - ?),
        updated_at   = ?
    WHERE id = ?
  `).run(penalty, Math.floor(Date.now() / 1000), accountId);

  const updated = db.prepare('SELECT health_score FROM accounts WHERE id = ?')
    .get(accountId) as { health_score: number } | undefined;
  logger.warn('Health penalty applied', { accountId, event, penalty, newScore: updated?.health_score });
}

export function applyDailyHealthBonus(accountId: string): void {
  db.prepare(`
    UPDATE accounts
    SET health_score = MIN(100, COALESCE(health_score, 100) + 5),
        updated_at   = ?
    WHERE id = ?
  `).run(Math.floor(Date.now() / 1000), accountId);
}

// ─── Per-account tracker ──────────────────────────────────────────────────────

export function incrementAccountTracker(
  accountId: string,
  field: 'connections_sent' | 'messages_sent' | 'profiles_visited',
): void {
  // Column names can't be parameterized — guard against a non-literal field
  // ever reaching the interpolated SQL (defense-in-depth vs injection).
  if (!['connections_sent', 'messages_sent', 'profiles_visited'].includes(field)) {
    throw new Error(`Invalid tracker field: ${field}`);
  }
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO account_daily_tracker (account_id, date, ${field}) VALUES (?, ?, 1)
    ON CONFLICT(account_id, date) DO UPDATE SET ${field} = ${field} + 1
  `).run(accountId, today);
}

// ─── Can-perform check ────────────────────────────────────────────────────────

export function canAccountPerformAction(
  accountId: string,
  action: 'connection' | 'message' | 'visit',
): boolean {
  const info = getAccountHealthInfo(accountId);
  switch (action) {
    case 'connection': return info.connectionsUsedToday < info.effectiveConnectionLimit;
    case 'message':    return info.messagesUsedToday    < info.effectiveMessageLimit;
    case 'visit':      return info.visitsUsedToday      < info.effectiveVisitLimit;
  }
}

// ─── Nightly bonus cron ───────────────────────────────────────────────────────
// Called once per day by campaignWorker midnight cron

export function runNightlyHealthBonus(): void {
  const accounts = db.prepare("SELECT id FROM accounts WHERE status = 'active'")
    .all() as Array<{ id: string }>;
  for (const { id } of accounts) {
    applyDailyHealthBonus(id);
  }
  logger.info('Nightly health bonus applied', { count: accounts.length });
}
