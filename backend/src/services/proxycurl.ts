/**
 * Proxycurl API client
 * https://nubela.co/proxycurl/docs
 *
 * Used as a richer, more reliable alternative to Playwright profile scraping.
 * When a Proxycurl API key is configured, visitProfile() calls this instead of
 * scraping the page DOM — no LinkedIn selector fragility, more data, email included.
 *
 * Pricing: ~$0.01 per profile (pay-as-you-go).
 * Sign up at https://nubela.co/proxycurl and add the key in Settings.
 */

import { getSetting, db } from './storage';
import { logger } from '../utils/logger';
import { EnrichedProfile } from './profileEnricher';

const PROXYCURL_BASE = 'https://nubela.co/proxycurl/api/v2/linkedin';

// Shape of the Proxycurl LinkedIn Profile endpoint response (partial)
interface ProxycurlProfile {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  headline: string | null;
  summary: string | null;
  city: string | null;
  state: string | null;
  country_full_name: string | null;
  skills: string[] | null;
  personal_emails: string[] | null;
  recommendations: string[] | null;
  connections: number | null;
  experiences: Array<{
    company: string | null;
    title: string | null;
    duration_short: string | null;  // e.g. "2 yrs 3 mos"
    starts_at: { year: number } | null;
  }> | null;
  education: Array<{
    school: string | null;
    degree_name: string | null;
  }> | null;
  activities: Array<{
    title: string | null;
    link: string | null;
    activity_status: string | null;
  }> | null;
}

/**
 * Fetch profile data from Proxycurl.
 * Returns null if no API key configured or request fails.
 */
export async function fetchProxycurlProfile(linkedinUrl: string): Promise<ProxycurlProfile | null> {
  const apiKey = getSetting('proxycurl_api_key');
  if (!apiKey) return null;

  const params = new URLSearchParams({
    url: linkedinUrl,
    skills: 'include',
    personal_email: 'include',
    extra: 'include',
    use_cache: 'if-present',
    fallback_to_cache: 'on-error',
  });

  try {
    const res = await fetch(`${PROXYCURL_BASE}?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 404) {
      logger.warn('Proxycurl: profile not found', { url: linkedinUrl });
      return null;
    }
    if (res.status === 401) {
      logger.error('Proxycurl: invalid API key');
      return null;
    }
    if (!res.ok) {
      logger.warn('Proxycurl: non-OK response', { status: res.status, url: linkedinUrl });
      return null;
    }

    return await res.json() as ProxycurlProfile;
  } catch (err) {
    logger.warn('Proxycurl: request failed', { url: linkedinUrl, error: String(err) });
    return null;
  }
}

/**
 * Convert Proxycurl response to our EnrichedProfile shape.
 */
export function toEnrichedProfile(p: ProxycurlProfile): EnrichedProfile {
  const location = [p.city, p.country_full_name].filter(Boolean).join(', ') || null;

  const yearsAtCompany = p.experiences?.[0]?.duration_short ?? null;
  const school = p.education?.[0]?.school ?? null;

  // Recent post: first activity title
  const recentPost = p.activities?.[0]?.title?.slice(0, 120) ?? null;

  // Mutual connections not available via API — leave null
  const mutualConnections = p.connections ? String(p.connections) : null;

  const skills = p.skills?.slice(0, 5).join(', ') ?? null;

  return {
    headline: p.headline?.slice(0, 200) ?? null,
    summary: p.summary?.slice(0, 300) ?? null,
    location: location?.slice(0, 100) ?? null,
    yearsAtCompany: yearsAtCompany?.slice(0, 50) ?? null,
    school: school?.slice(0, 150) ?? null,
    recentPost,
    mutualConnections,
    skills: skills?.slice(0, 200) ?? null,
  };
}

/**
 * If Proxycurl profile includes a personal email, save it to the lead row.
 * Only writes if the lead doesn't already have a discovered email.
 */
export function saveProxycurlEmail(leadId: string, profile: ProxycurlProfile): void {
  const email = profile.personal_emails?.[0] ?? null;
  if (!email) return;

  const existing = db.prepare('SELECT email FROM leads WHERE id = ?').get(leadId) as { email: string | null } | undefined;
  if (existing?.email) return; // already have one

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE leads SET email = ?, email_source = 'proxycurl',
    email_found_at = ?, email_status = 'found', updated_at = ?
    WHERE id = ?
  `).run(email, now, now, leadId);
  logger.info('Proxycurl: email saved', { leadId, email });
}

/**
 * Update first_name / last_name / company / title on the lead if they are currently empty.
 * Proxycurl often has cleaner data than what was manually imported.
 */
export function enrichLeadBasicFields(leadId: string, profile: ProxycurlProfile): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE leads SET
      first_name = COALESCE(NULLIF(first_name, ''), ?),
      last_name  = COALESCE(NULLIF(last_name, ''), ?),
      title      = COALESCE(NULLIF(title, ''), ?),
      updated_at = ?
    WHERE id = ?
  `).run(
    profile.first_name,
    profile.last_name,
    profile.experiences?.[0]?.title ?? null,
    now,
    leadId,
  );
}

/**
 * Test Proxycurl credentials by fetching a well-known public profile.
 * Returns { ok, credits } on success or { ok: false, error } on failure.
 */
export async function testProxycurlConnection(): Promise<{ ok: boolean; credits?: number; error?: string }> {
  const apiKey = getSetting('proxycurl_api_key');
  if (!apiKey) return { ok: false, error: 'No API key configured' };

  try {
    const res = await fetch('https://nubela.co/proxycurl/api/credit-balance', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json() as { credit_balance: number };
      return { ok: true, credits: data.credit_balance };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
