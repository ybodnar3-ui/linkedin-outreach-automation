/**
 * profileEnricher.ts
 * EnrichedProfile shape + DB persistence for enrichment fields.
 *
 * The Playwright DOM scraper (scrapeProfileFields) was removed in Phase 1
 * (ADR-001: extension-only). Enrichment data now comes from the Proxycurl API
 * (see proxycurl.ts → toEnrichedProfile) or the extension. This module just
 * defines the shape and persists it.
 */

import { db } from './storage';
import { logger } from '../utils/logger';

export interface EnrichedProfile {
  headline: string | null;
  summary: string | null;
  location: string | null;
  yearsAtCompany: string | null;
  school: string | null;
  recentPost: string | null;
  mutualConnections: string | null;
  skills: string | null;
}

export function saveEnrichedProfile(leadId: string, profile: EnrichedProfile): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE leads SET
      headline           = COALESCE(?, headline),
      summary            = COALESCE(?, summary),
      location           = COALESCE(?, location),
      years_at_company   = COALESCE(?, years_at_company),
      school             = COALESCE(?, school),
      recent_post        = COALESCE(?, recent_post),
      mutual_connections = COALESCE(?, mutual_connections),
      skills             = COALESCE(?, skills),
      enriched_at        = ?,
      updated_at         = ?
    WHERE id = ?
  `).run(
    profile.headline,
    profile.summary,
    profile.location,
    profile.yearsAtCompany,
    profile.school,
    profile.recentPost,
    profile.mutualConnections,
    profile.skills,
    now,
    now,
    leadId,
  );
  logger.info('Profile enriched', { leadId, fields: Object.keys(profile).filter(k => profile[k as keyof EnrichedProfile]) });
}
