/**
 * CRM Sync — HubSpot and Pipedrive
 *
 * Syncs leads to CRM on connection_accepted and replied events.
 * Upserts contacts by email (falls back to LinkedIn URL as identifier).
 * Stores crm_contact_id and crm_synced_at on the lead row.
 */

import { getSetting, db } from './storage';
import { logger } from '../utils/logger';

export type CrmType = 'hubspot' | 'pipedrive';

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

// ─── HubSpot ────────────────────────────────────────────────────────────────

async function hubspotUpsert(lead: LeadRow, apiKey: string): Promise<string> {
  const HUBSPOT_BASE = 'https://api.hubapi.com';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const properties: Record<string, string> = {
    ...(lead.first_name && { firstname: lead.first_name }),
    ...(lead.last_name  && { lastname: lead.last_name }),
    ...(lead.email      && { email: lead.email }),
    ...(lead.company    && { company: lead.company }),
    ...(lead.title      && { jobtitle: lead.title }),
    linkedinbio: lead.linkedin_url,           // custom property (LinkedIn URL)
  };

  // 1. Try to find existing contact by email first
  if (lead.crm_contact_id) {
    // Already have an ID — patch it
    const patchRes = await fetch(
      `${HUBSPOT_BASE}/crm/v3/objects/contacts/${lead.crm_contact_id}`,
      { method: 'PATCH', headers, body: JSON.stringify({ properties }) },
    );
    if (!patchRes.ok) {
      const err = await patchRes.text().catch(() => patchRes.statusText);
      throw new Error(`HubSpot PATCH failed: ${err}`);
    }
    const data = await patchRes.json() as { id: string };
    return data.id;
  }

  // 2. Search by email (if we have one)
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
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json() as { results: Array<{ id: string }> };
      if (searchData.results.length > 0) {
        const existingId = searchData.results[0].id;
        // Update the found contact
        await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${existingId}`, {
          method: 'PATCH', headers, body: JSON.stringify({ properties }),
        });
        return existingId;
      }
    }
  }

  // 3. Create new contact
  const createRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ properties }),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`HubSpot create failed: ${err}`);
  }
  const created = await createRes.json() as { id: string };
  return created.id;
}

// ─── Pipedrive ───────────────────────────────────────────────────────────────

async function pipedriveUpsert(lead: LeadRow, apiToken: string, domain: string): Promise<string> {
  const BASE = `https://${domain}.pipedrive.com/api/v1`;
  const q = `?api_token=${apiToken}`;

  const personPayload = {
    name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown',
    ...(lead.email && { email: [{ value: lead.email, primary: true }] }),
    ...(lead.company && { org_name: lead.company }),
  };

  // 1. Already synced — update existing
  if (lead.crm_contact_id) {
    const updRes = await fetch(`${BASE}/persons/${lead.crm_contact_id}${q}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(personPayload),
    });
    if (!updRes.ok) {
      const err = await updRes.text().catch(() => updRes.statusText);
      throw new Error(`Pipedrive PUT failed: ${err}`);
    }
    const updData = await updRes.json() as { data: { id: number } };
    return String(updData.data.id);
  }

  // 2. Search by email
  if (lead.email) {
    const searchRes = await fetch(`${BASE}/persons/search${q}&term=${encodeURIComponent(lead.email)}&fields=email&limit=1`);
    if (searchRes.ok) {
      const searchData = await searchRes.json() as { data: { items: Array<{ item: { id: number } }> } | null };
      const items = searchData.data?.items ?? [];
      if (items.length > 0) {
        const existingId = items[0].item.id;
        await fetch(`${BASE}/persons/${existingId}${q}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(personPayload),
        });
        return String(existingId);
      }
    }
  }

  // 3. Create new person
  const createRes = await fetch(`${BASE}/persons${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(personPayload),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`Pipedrive create failed: ${err}`);
  }
  const created = await createRes.json() as { data: { id: number } };
  return String(created.data.id);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sync a lead to all configured CRMs.
 * Non-blocking — called fire-and-forget from the campaign worker.
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

  const hubspotKey = getSetting('hubspot_api_key');
  const pipedriveToken = getSetting('pipedrive_api_token');
  const pipedriveDomain = getSetting('pipedrive_domain');

  const synced: string[] = [];
  const errors: string[] = [];

  // HubSpot
  if (hubspotKey) {
    try {
      const contactId = await hubspotUpsert(lead, hubspotKey);
      db.prepare(`
        UPDATE leads SET crm_contact_id = ?, crm_synced_at = ?, updated_at = ?
        WHERE id = ?
      `).run(`hubspot:${contactId}`, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), leadId);
      synced.push('hubspot');
      logger.info('CRM: HubSpot synced', { leadId, contactId });
    } catch (err) {
      errors.push(`HubSpot: ${err instanceof Error ? err.message : String(err)}`);
      logger.error('CRM: HubSpot sync failed', { leadId, error: String(err) });
    }
  }

  // Pipedrive
  if (pipedriveToken && pipedriveDomain) {
    try {
      const personId = await pipedriveUpsert(lead, pipedriveToken, pipedriveDomain);
      // If HubSpot already wrote crm_contact_id, append Pipedrive ID as a note in the DB
      const currentId = (db.prepare('SELECT crm_contact_id FROM leads WHERE id = ?').get(leadId) as { crm_contact_id: string | null })?.crm_contact_id;
      const newId = currentId?.startsWith('hubspot:')
        ? `${currentId}|pipedrive:${personId}`
        : `pipedrive:${personId}`;
      db.prepare(`
        UPDATE leads SET crm_contact_id = ?, crm_synced_at = ?, updated_at = ?
        WHERE id = ?
      `).run(newId, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), leadId);
      synced.push('pipedrive');
      logger.info('CRM: Pipedrive synced', { leadId, personId });
    } catch (err) {
      errors.push(`Pipedrive: ${err instanceof Error ? err.message : String(err)}`);
      logger.error('CRM: Pipedrive sync failed', { leadId, error: String(err) });
    }
  }

  if (synced.length === 0 && errors.length === 0) {
    logger.debug('CRM: no CRM configured, skipping sync', { leadId });
  }
}

/**
 * Test CRM connection — used by the settings page "Test" button.
 * Returns an object with success/error per CRM.
 */
export async function testCrmConnections(): Promise<{
  hubspot: { ok: boolean; error?: string };
  pipedrive: { ok: boolean; error?: string };
}> {
  const result = {
    hubspot: { ok: false as boolean, error: undefined as string | undefined },
    pipedrive: { ok: false as boolean, error: undefined as string | undefined },
  };

  const hubspotKey = getSetting('hubspot_api_key');
  if (hubspotKey) {
    try {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
        headers: { Authorization: `Bearer ${hubspotKey}` },
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

  const pipedriveToken = getSetting('pipedrive_api_token');
  const pipedriveDomain = getSetting('pipedrive_domain');
  if (pipedriveToken && pipedriveDomain) {
    try {
      const res = await fetch(
        `https://${pipedriveDomain}.pipedrive.com/api/v1/persons?api_token=${pipedriveToken}&limit=1`,
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
