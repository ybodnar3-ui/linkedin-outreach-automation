/**
 * CRM Sync — HubSpot and Pipedrive
 *
 * Syncs leads to CRM on connection_accepted and replied events.
 * Upserts contacts by email (falls back to LinkedIn URL as identifier).
 * Stores crm_contact_id and crm_synced_at on the lead row.
 *
 * crm_contact_id format: "hubspot:123" or "pipedrive:456" or "hubspot:123|pipedrive:456"
 */

import { getSetting, db } from './storage';
import { logger } from '../utils/logger';

const CRM_TIMEOUT_MS = 10_000;

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  linkedin_url: string;
  crm_contact_id: string | null;
  crm_synced_at: number | null;
}

/** Parse a composite crm_contact_id and return the ID for a given CRM */
function extractCrmId(composite: string | null, crm: 'hubspot' | 'pipedrive'): string | null {
  if (!composite) return null;
  const parts = composite.split('|');
  for (const part of parts) {
    if (part.startsWith(`${crm}:`)) return part.slice(crm.length + 1);
  }
  return null;
}

// ─── HubSpot ────────────────────────────────────────────────────────────────

async function hubspotUpsert(lead: LeadRow, apiKey: string): Promise<string> {
  const HUBSPOT_BASE = 'https://api.hubapi.com';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const signal = AbortSignal.timeout(CRM_TIMEOUT_MS);

  const properties: Record<string, string> = {
    ...(lead.first_name && { firstname: lead.first_name }),
    ...(lead.last_name  && { lastname: lead.last_name }),
    ...(lead.email      && { email: lead.email }),
    ...(lead.company    && { company: lead.company }),
    ...(lead.title      && { jobtitle: lead.title }),
    linkedinbio: lead.linkedin_url,
  };

  const existingHubspotId = extractCrmId(lead.crm_contact_id, 'hubspot');

  // 1. Already have HubSpot ID — patch it
  if (existingHubspotId) {
    const patchRes = await fetch(
      `${HUBSPOT_BASE}/crm/v3/objects/contacts/${existingHubspotId}`,
      { method: 'PATCH', headers, body: JSON.stringify({ properties }), signal },
    );
    if (!patchRes.ok) {
      const err = await patchRes.text().catch(() => patchRes.statusText);
      throw new Error(`HubSpot PATCH failed (${patchRes.status}): ${err.slice(0, 200)}`);
    }
    const data = await patchRes.json() as { id: string };
    logger.debug('HubSpot: contact updated', { leadId: lead.id, contactId: data.id });
    return data.id;
  }

  // 2. Search by email
  if (lead.email) {
    const searchRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }],
        }],
        properties: ['id'],
        limit: 1,
      }),
      signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json() as { results: Array<{ id: string }> };
      if (searchData.results.length > 0) {
        const existingId = searchData.results[0].id;
        await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${existingId}`, {
          method: 'PATCH', headers, body: JSON.stringify({ properties }),
          signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
        });
        logger.debug('HubSpot: contact found by email + updated', { leadId: lead.id, contactId: existingId });
        return existingId;
      }
    } else {
      logger.warn('HubSpot: email search failed', { status: searchRes.status, leadId: lead.id });
    }
  }

  // 3. Create new contact
  const createRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ properties }),
    signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`HubSpot create failed (${createRes.status}): ${err.slice(0, 200)}`);
  }
  const created = await createRes.json() as { id: string };
  logger.debug('HubSpot: contact created', { leadId: lead.id, contactId: created.id });
  return created.id;
}

// ─── Pipedrive ───────────────────────────────────────────────────────────────

// Pipedrive subdomain is a user-supplied setting — must be a bare alphanumeric
// subdomain, never a path or full host (prevents SSRF via crafted domain).
function assertValidPipedriveDomain(domain: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(domain)) {
    throw new Error('Invalid Pipedrive domain');
  }
}

async function pipedriveUpsert(lead: LeadRow, apiToken: string, domain: string): Promise<string> {
  assertValidPipedriveDomain(domain);
  const BASE = `https://${domain}.pipedrive.com/api/v1`;
  const q = `?api_token=${apiToken}`;
  const jsonHeaders = { 'Content-Type': 'application/json' };

  const personPayload = {
    name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown',
    ...(lead.email   && { email: [{ value: lead.email, primary: true }] }),
    ...(lead.company && { org_name: lead.company }),
  };

  const existingPipedriveId = extractCrmId(lead.crm_contact_id, 'pipedrive');

  // 1. Already have Pipedrive ID — update it
  if (existingPipedriveId) {
    const updRes = await fetch(`${BASE}/persons/${existingPipedriveId}${q}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(personPayload),
      signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
    });
    if (!updRes.ok) {
      const err = await updRes.text().catch(() => updRes.statusText);
      throw new Error(`Pipedrive PUT failed (${updRes.status}): ${err.slice(0, 200)}`);
    }
    const updData = await updRes.json() as { data: { id: number } };
    logger.debug('Pipedrive: person updated', { leadId: lead.id, personId: updData.data.id });
    return String(updData.data.id);
  }

  // 2. Search by email
  if (lead.email) {
    const searchRes = await fetch(
      `${BASE}/persons/search${q}&term=${encodeURIComponent(lead.email)}&fields=email&limit=1`,
      { signal: AbortSignal.timeout(CRM_TIMEOUT_MS) },
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json() as { data: { items: Array<{ item: { id: number } }> } | null };
      const items = searchData.data?.items ?? [];
      if (items.length > 0) {
        const existingId = items[0].item.id;
        await fetch(`${BASE}/persons/${existingId}${q}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(personPayload),
          signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
        });
        logger.debug('Pipedrive: person found by email + updated', { leadId: lead.id, personId: existingId });
        return String(existingId);
      }
    } else {
      logger.warn('Pipedrive: email search failed', { status: searchRes.status, leadId: lead.id });
    }
  }

  // 3. Create new person
  const createRes = await fetch(`${BASE}/persons${q}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(personPayload),
    signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`Pipedrive create failed (${createRes.status}): ${err.slice(0, 200)}`);
  }
  const created = await createRes.json() as { data: { id: number } };
  logger.debug('Pipedrive: person created', { leadId: lead.id, personId: created.data.id });
  return String(created.data.id);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sync a lead to all configured CRMs.
 * Non-blocking — called fire-and-forget from the campaign worker and inbox.
 */
export async function syncLeadToCrm(leadId: string): Promise<void> {
  const lead = db.prepare(`
    SELECT id, first_name, last_name, email, company, title,
           linkedin_url, crm_contact_id, crm_synced_at
    FROM leads WHERE id = ?
  `).get(leadId) as LeadRow | undefined;

  if (!lead) {
    logger.warn('crmSync: lead not found', { leadId });
    return;
  }

  const hubspotKey    = getSetting('hubspot_api_key');
  const pipedriveToken  = getSetting('pipedrive_api_token');
  const pipedriveDomain = getSetting('pipedrive_domain');

  if (!hubspotKey && !pipedriveToken) {
    logger.debug('CRM: no CRM configured, skipping sync', { leadId });
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // HubSpot
  if (hubspotKey) {
    try {
      const contactId = await hubspotUpsert(lead, hubspotKey);
      const currentId = (db.prepare('SELECT crm_contact_id FROM leads WHERE id = ?').get(leadId) as LeadRow | undefined)?.crm_contact_id;
      const hubPart = `hubspot:${contactId}`;
      const pipePart = extractCrmId(currentId ?? null, 'pipedrive');
      const newId = pipePart ? `${hubPart}|pipedrive:${pipePart}` : hubPart;
      db.prepare('UPDATE leads SET crm_contact_id = ?, crm_synced_at = ?, updated_at = ? WHERE id = ?')
        .run(newId, now, now, leadId);
      logger.info('CRM: HubSpot synced', { leadId, contactId });
    } catch (err) {
      logger.error('CRM: HubSpot sync failed', { leadId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Pipedrive
  if (pipedriveToken && pipedriveDomain) {
    try {
      // Re-read lead so we have the latest crm_contact_id (HubSpot may have just written it)
      const freshLead = db.prepare('SELECT crm_contact_id FROM leads WHERE id = ?').get(leadId) as LeadRow | undefined;
      const leadForPipedrive = { ...lead, crm_contact_id: freshLead?.crm_contact_id ?? lead.crm_contact_id };

      const personId = await pipedriveUpsert(leadForPipedrive, pipedriveToken, pipedriveDomain);
      const currentId = (db.prepare('SELECT crm_contact_id FROM leads WHERE id = ?').get(leadId) as LeadRow | undefined)?.crm_contact_id;
      const hubPart = extractCrmId(currentId ?? null, 'hubspot');
      const newId = hubPart ? `hubspot:${hubPart}|pipedrive:${personId}` : `pipedrive:${personId}`;
      db.prepare('UPDATE leads SET crm_contact_id = ?, crm_synced_at = ?, updated_at = ? WHERE id = ?')
        .run(newId, now, now, leadId);
      logger.info('CRM: Pipedrive synced', { leadId, personId });
    } catch (err) {
      logger.error('CRM: Pipedrive sync failed', { leadId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/**
 * Test CRM connections — used by the settings page "Test" button.
 */
export async function testCrmConnections(): Promise<{
  hubspot: { ok: boolean; error?: string };
  pipedrive: { ok: boolean; error?: string };
}> {
  const result = {
    hubspot:   { ok: false as boolean, error: undefined as string | undefined },
    pipedrive: { ok: false as boolean, error: undefined as string | undefined },
  };

  const hubspotKey = getSetting('hubspot_api_key');
  if (hubspotKey) {
    try {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
        headers: { Authorization: `Bearer ${hubspotKey}` },
        signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
      });
      if (res.ok) {
        result.hubspot.ok = true;
      } else {
        const text = await res.text().catch(() => res.statusText);
        result.hubspot.error = `HTTP ${res.status}: ${text.slice(0, 100)}`;
      }
    } catch (err) {
      result.hubspot.error = err instanceof Error ? err.message : String(err);
    }
  } else {
    result.hubspot.error = 'No API key configured';
  }

  const pipedriveToken  = getSetting('pipedrive_api_token');
  const pipedriveDomain = getSetting('pipedrive_domain');
  if (pipedriveToken && pipedriveDomain && /^[a-zA-Z0-9-]+$/.test(pipedriveDomain)) {
    try {
      const res = await fetch(
        `https://${pipedriveDomain}.pipedrive.com/api/v1/persons?api_token=${pipedriveToken}&limit=1`,
        { signal: AbortSignal.timeout(CRM_TIMEOUT_MS) },
      );
      if (res.ok) {
        result.pipedrive.ok = true;
      } else {
        const text = await res.text().catch(() => res.statusText);
        result.pipedrive.error = `HTTP ${res.status}: ${text.slice(0, 100)}`;
      }
    } catch (err) {
      result.pipedrive.error = err instanceof Error ? err.message : String(err);
    }
  } else {
    result.pipedrive.error = !pipedriveToken ? 'No API token configured' : 'No domain configured';
  }

  return result;
}
