import { db } from './storage';
import { v4 as uuidv4 } from 'uuid';

// Create ab_assignments table at module init (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS ab_assignments (
    lead_id TEXT NOT NULL,
    ab_test_id TEXT NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
    variant TEXT NOT NULL CHECK(variant IN ('a','b')),
    PRIMARY KEY (lead_id, ab_test_id)
  )
`);

export interface ABTest {
  id: string;
  name: string;
  step_id: string | null;
  sent_a: number;
  sent_b: number;
  replies_a: number;
  replies_b: number;
  winner: 'a' | 'b' | null;
  created_at: number;
  updated_at: number;
}

export interface ABTestResults {
  test: ABTest;
  variant_a_text: string;
  variant_b_text: string;
  reply_rate_a: number;
  reply_rate_b: number;
  winner: 'a' | 'b' | null;
  winner_determined: boolean;
}

const MIN_SENDS_PER_VARIANT = 20;
const MIN_REPLY_RATE_DIFF = 0.05;

export function createTest(name: string, stepId: string | null, textA: string, textB: string): ABTest {
  const testId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO ab_tests (id, name, step_id, sent_a, sent_b, replies_a, replies_b, created_at, updated_at)
    VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)
  `).run(testId, name, stepId, now, now);

  db.prepare('INSERT INTO ab_test_variants (id, ab_test_id, variant, text) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), testId, 'a', textA);
  db.prepare('INSERT INTO ab_test_variants (id, ab_test_id, variant, text) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), testId, 'b', textB);

  return getTest(testId)!;
}

export function listTests(): ABTest[] {
  return db.prepare('SELECT * FROM ab_tests ORDER BY created_at DESC').all() as ABTest[];
}

export function getTest(id: string): ABTest | undefined {
  return db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(id) as ABTest | undefined;
}

export function deleteTest(id: string): void {
  db.prepare('DELETE FROM ab_tests WHERE id = ?').run(id);
}

/**
 * Assign variant to a lead for a given test. Deterministic: once assigned, returns same variant.
 */
export function assignVariant(leadId: string, abTestId: string): 'a' | 'b' {
  const existing = db.prepare(
    'SELECT variant FROM ab_assignments WHERE lead_id = ? AND ab_test_id = ?'
  ).get(leadId, abTestId) as { variant: 'a' | 'b' } | undefined;

  if (existing) return existing.variant;

  const variant: 'a' | 'b' = Math.random() < 0.5 ? 'a' : 'b';
  db.prepare('INSERT INTO ab_assignments (lead_id, ab_test_id, variant) VALUES (?, ?, ?)')
    .run(leadId, abTestId, variant);

  const field = variant === 'a' ? 'sent_a' : 'sent_b';
  db.prepare(`UPDATE ab_tests SET ${field} = ${field} + 1, updated_at = ? WHERE id = ?`)
    .run(Math.floor(Date.now() / 1000), abTestId);

  recalculateWinner(abTestId);
  return variant;
}

/**
 * Get the variant text assigned to this lead. Assigns if not yet assigned.
 */
export function getAssignedText(leadId: string, abTestId: string): string | null {
  const variant = assignVariant(leadId, abTestId);
  const row = db.prepare(
    'SELECT text FROM ab_test_variants WHERE ab_test_id = ? AND variant = ?'
  ).get(abTestId, variant) as { text: string } | undefined;
  return row?.text ?? null;
}

export function recordReply(leadId: string, abTestId: string): void {
  const assignment = db.prepare(
    'SELECT variant FROM ab_assignments WHERE lead_id = ? AND ab_test_id = ?'
  ).get(leadId, abTestId) as { variant: 'a' | 'b' } | undefined;

  if (!assignment) return;

  const field = assignment.variant === 'a' ? 'replies_a' : 'replies_b';
  db.prepare(`UPDATE ab_tests SET ${field} = ${field} + 1, updated_at = ? WHERE id = ?`)
    .run(Math.floor(Date.now() / 1000), abTestId);

  recalculateWinner(abTestId);
}

function recalculateWinner(abTestId: string): void {
  const test = getTest(abTestId);
  if (!test || test.winner) return;

  if (test.sent_a < MIN_SENDS_PER_VARIANT || test.sent_b < MIN_SENDS_PER_VARIANT) return;

  const rateA = test.sent_a > 0 ? test.replies_a / test.sent_a : 0;
  const rateB = test.sent_b > 0 ? test.replies_b / test.sent_b : 0;
  const diff = Math.abs(rateA - rateB);

  if (diff >= MIN_REPLY_RATE_DIFF) {
    const winner = rateA >= rateB ? 'a' : 'b';
    db.prepare('UPDATE ab_tests SET winner = ?, updated_at = ? WHERE id = ?')
      .run(winner, Math.floor(Date.now() / 1000), abTestId);
  }
}

export function getResults(abTestId: string): ABTestResults | null {
  const test = getTest(abTestId);
  if (!test) return null;

  const variants = db.prepare(
    'SELECT variant, text FROM ab_test_variants WHERE ab_test_id = ? ORDER BY variant'
  ).all(abTestId) as Array<{ variant: 'a' | 'b'; text: string }>;

  const varA = variants.find(v => v.variant === 'a');
  const varB = variants.find(v => v.variant === 'b');

  const rateA = test.sent_a > 0 ? test.replies_a / test.sent_a : 0;
  const rateB = test.sent_b > 0 ? test.replies_b / test.sent_b : 0;

  return {
    test,
    variant_a_text: varA?.text ?? '',
    variant_b_text: varB?.text ?? '',
    reply_rate_a: Math.round(rateA * 1000) / 10,
    reply_rate_b: Math.round(rateB * 1000) / 10,
    winner: test.winner as 'a' | 'b' | null,
    winner_determined: test.winner != null,
  };
}
