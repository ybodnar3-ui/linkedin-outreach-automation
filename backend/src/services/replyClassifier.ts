/**
 * replyClassifier.ts
 * Classifies inbound LinkedIn messages using OpenAI or Anthropic.
 *
 * Sentiment values:
 *   positive       — interested, wants to learn more, positive tone
 *   negative       — rude, dismissive, angry
 *   neutral        — polite decline or generic response
 *   question       — asking a specific question back
 *   not_interested — explicitly not interested but polite
 */

import { getSetting } from './storage';
import { logger } from '../utils/logger';

export type Sentiment = 'positive' | 'negative' | 'neutral' | 'question' | 'not_interested';

export interface ClassificationResult {
  sentiment: Sentiment;
  note: string; // 1-sentence explanation
}

const PROMPT = (text: string) => `You are analyzing a LinkedIn message reply from a prospect.

Classify the reply into exactly ONE of these categories:
- positive: interested, wants to learn more, open to a call, excited
- question: asking a specific question back (even if interested)
- not_interested: polite but clear decline ("not the right time", "happy with current solution")
- neutral: generic / vague response, hard to tell
- negative: rude, angry, dismissive, "stop messaging me"

Message:
"${text.slice(0, 500)}"

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{"sentiment":"<category>","note":"<one sentence why>"}`;

async function callAI(prompt: string): Promise<ClassificationResult | null> {
  const openaiKey = getSetting('openai_api_key');
  const anthropicKey = getSetting('anthropic_api_key');

  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 80,
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        return safeParseClassification(data.choices?.[0]?.message?.content);
      }
    } catch { /* fall through to anthropic */ }
  }

  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-20240307',
          max_tokens: 80,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data = await res.json() as { content: Array<{ text: string }> };
        return safeParseClassification(data.content?.[0]?.text);
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Tolerantly extract a classification JSON object from an LLM response.
 * Handles markdown-fenced ```json blocks and surrounding prose. Returns null
 * if no valid JSON object can be parsed (never throws).
 */
function safeParseClassification(raw: string | undefined): ClassificationResult | null {
  if (!raw || typeof raw !== 'string') return null;
  // Grab the first {...} block, stripping markdown fences/prose around it
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as ClassificationResult;
  } catch {
    return null;
  }
}

export async function classifyReply(messageId: string, text: string): Promise<void> {
  try {
    const result = await callAI(PROMPT(text));
    if (!result?.sentiment) return;

    const { db } = await import('./storage');
    db.prepare('UPDATE inbox_messages SET sentiment = ?, sentiment_note = ? WHERE id = ?')
      .run(result.sentiment, result.note ?? null, messageId);

    logger.info('Reply classified', { messageId, sentiment: result.sentiment });
  } catch (err) {
    logger.warn('Reply classification failed (non-fatal)', { error: String(err) });
  }
}
