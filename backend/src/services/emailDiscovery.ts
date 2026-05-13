import { db, getSetting } from './storage';
import { logger } from '../utils/logger';

export interface EmailDiscoveryResult {
  email: string | null;
  source: 'hunter' | 'apollo' | null;
  status: 'found' | 'not_found';
}

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  linkedin_url: string;
  email: string | null;
}

function deriveDomain(company: string | null): string | null {
  if (!company) return null;
  const cleaned = company
    .replace(/\b(inc|llc|ltd|corp|co|company|group|technologies|solutions|services)\b/gi, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .trim();
  if (cleaned.length < 2) return null;
  return `${cleaned}.com`;
}

async function lookupHunter(
  firstName: string,
  lastName: string,
  domain: string,
  apiKey: string
): Promise<string | null> {
  const url = new URL('https://api.hunter.io/v2/email-finder');
  url.searchParams.set('domain', domain);
  url.searchParams.set('first_name', firstName);
  url.searchParams.set('last_name', lastName);
  url.searchParams.set('api_key', apiKey);

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { email?: string | null } };
    return json.data?.email ?? null;
  } catch (err) {
    logger.warn('Hunter.io request failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function lookupApollo(
  firstName: string,
  lastName: string,
  linkedinUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    const res = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        api_key: apiKey,
        first_name: firstName,
        last_name: lastName,
        linkedin_url: linkedinUrl,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { person?: { email?: string | null } | null };
    return json.person?.email ?? null;
  } catch (err) {
    logger.warn('Apollo.io request failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Discover email for a lead. Tries Hunter.io first, Apollo.io as fallback.
 * Updates leads table with result.
 */
export async function discoverEmail(leadId: string): Promise<EmailDiscoveryResult> {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as LeadRow | undefined;
  if (!lead) throw new Error(`Lead not found: ${leadId}`);

  db.prepare("UPDATE leads SET email_status = 'pending', updated_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000), leadId);

  const firstName = lead.first_name ?? '';
  const lastName = lead.last_name ?? '';

  if (!firstName && !lastName) {
    db.prepare("UPDATE leads SET email_status = 'not_found', updated_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000), leadId);
    return { email: null, source: null, status: 'not_found' };
  }

  let email: string | null = null;
  let source: 'hunter' | 'apollo' | null = null;

  const hunterKey = getSetting('hunter_api_key');
  if (hunterKey) {
    const domain = deriveDomain(lead.company);
    if (domain) {
      logger.info('Trying Hunter.io', { leadId, domain });
      email = await lookupHunter(firstName, lastName, domain, hunterKey);
      if (email) source = 'hunter';
    }
  }

  if (!email) {
    const apolloKey = getSetting('apollo_api_key');
    if (apolloKey) {
      logger.info('Trying Apollo.io', { leadId, linkedinUrl: lead.linkedin_url });
      email = await lookupApollo(firstName, lastName, lead.linkedin_url, apolloKey);
      if (email) source = 'apollo';
    }
  }

  const now = Math.floor(Date.now() / 1000);
  if (email) {
    db.prepare(`
      UPDATE leads SET email = ?, email_source = ?, email_found_at = ?, email_status = 'found', updated_at = ?
      WHERE id = ?
    `).run(email, source, now, now, leadId);
    logger.info('Email discovered', { leadId, email, source });
    return { email, source, status: 'found' };
  }

  db.prepare("UPDATE leads SET email_status = 'not_found', updated_at = ? WHERE id = ?")
    .run(now, leadId);
  logger.info('Email not found', { leadId });
  return { email: null, source: null, status: 'not_found' };
}
