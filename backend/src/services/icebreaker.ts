/**
 * icebreaker.ts
 * Generates a short personalized opening line via OpenAI or Anthropic API.
 *
 * Usage in message template:
 *   "Hi {firstName}, {icebreaker} I'd love to connect!"
 *
 * The icebreaker is a single sentence (≤25 words) referencing the lead's
 * headline, company, recent activity, or skills — whatever is available.
 *
 * Settings (stored in app_settings):
 *   openai_api_key      — primary provider
 *   anthropic_api_key   — fallback if OpenAI key missing
 *   icebreaker_enabled  — '1' to enable (default off to avoid accidental API calls)
 */

import { getSetting } from './storage';
import { logger } from '../utils/logger';

interface IcebreakerContext {
  firstName: string;
  headline?: string | null;
  company?: string | null;
  title?: string | null;
  recentPost?: string | null;
  skills?: string | null;
  location?: string | null;
}

function buildPrompt(ctx: IcebreakerContext): string {
  const details = [
    ctx.headline && `Headline: "${ctx.headline}"`,
    ctx.company && `Company: ${ctx.company}`,
    ctx.title && `Title: ${ctx.title}`,
    ctx.recentPost && `Recent post snippet: "${ctx.recentPost.slice(0, 80)}"`,
    ctx.skills && `Top skills: ${ctx.skills}`,
    ctx.location && `Location: ${ctx.location}`,
  ].filter(Boolean).join('\n');

  return `You are writing a LinkedIn connection message. Generate ONE short personalized icebreaker sentence (max 20 words) for ${ctx.firstName} based on their profile. Be specific, natural, and avoid sounding salesy.

Profile:
${details || 'No additional details available.'}

Rules:
- Single sentence only
- Reference something specific from their profile
- No greeting (e.g. don't start with "Hi" or "Hello")
- No exclamation marks
- Don't mention you're an AI

Respond with ONLY the icebreaker sentence, nothing else.`;
}

async function callOpenAI(prompt: string, apiKey: string): Promise<string | null> {
  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 60,
    temperature: 0.7,
  });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

async function callAnthropic(prompt: string, apiKey: string): Promise<string | null> {
  const body = JSON.stringify({
    model: 'claude-haiku-20240307',
    max_tokens: 60,
    messages: [{ role: 'user', content: prompt }],
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content?.[0]?.text?.trim() ?? null;
}

export async function generateIcebreaker(ctx: IcebreakerContext): Promise<string> {
  const enabled = getSetting('icebreaker_enabled');
  if (enabled !== '1') return '';

  const openaiKey = getSetting('openai_api_key');
  const anthropicKey = getSetting('anthropic_api_key');

  if (!openaiKey && !anthropicKey) {
    logger.warn('Icebreaker enabled but no AI API key configured');
    return '';
  }

  const prompt = buildPrompt(ctx);

  try {
    let result: string | null = null;

    if (openaiKey) {
      result = await callOpenAI(prompt, openaiKey);
    }

    if (!result && anthropicKey) {
      result = await callAnthropic(prompt, anthropicKey);
    }

    if (result) {
      // Ensure it ends with a period and isn't too long
      const cleaned = result.replace(/^"|"$/g, '').trim();
      const safe = cleaned.length > 150 ? cleaned.slice(0, 150) + '.' : cleaned;
      logger.info('Icebreaker generated', { firstName: ctx.firstName, length: safe.length });
      return safe;
    }
  } catch (err) {
    logger.error('Icebreaker generation failed (non-fatal)', { error: String(err) });
  }

  return '';
}
