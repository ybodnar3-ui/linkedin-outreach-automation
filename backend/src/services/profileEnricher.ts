/**
 * profileEnricher.ts
 * Scrapes extra fields from a LinkedIn profile page (already loaded in Playwright).
 * Called from visitProfile() — no extra navigation needed.
 *
 * Fields extracted:
 *   headline         — job title headline under the name
 *   summary          — "About" section text (first 300 chars)
 *   location         — city / region
 *   yearsAtCompany   — "X yrs Y mos" at current employer
 *   school           — most recent education institution
 *   recentPost       — first activity post text (first 120 chars)
 *   mutualConnections— "X mutual connections" count
 *   skills           — top 3 skills listed
 */

import { Page } from 'playwright';
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

async function safeText(page: Page, selector: string): Promise<string | null> {
  try {
    const el = await page.$(selector);
    if (!el) return null;
    const text = await el.textContent();
    return text?.trim() || null;
  } catch {
    return null;
  }
}

export async function scrapeProfileFields(page: Page): Promise<EnrichedProfile> {
  const [headline, location, summary] = await Promise.all([
    safeText(page, '.text-body-medium.break-words'),
    safeText(page, '.pv-text-details__left-panel .text-body-small:not(.break-words)'),
    safeText(page, '#about ~ .display-flex .full-width .visually-hidden, .pv-shared-text-with-see-more span[aria-hidden="true"]'),
  ]);

  // Years at company — duration of current position
  let yearsAtCompany: string | null = null;
  try {
    const durationEl = await page.$('.pv-entity__date-range span:not(.visually-hidden), .pvs-entity__caption-wrapper');
    if (durationEl) {
      const text = await durationEl.textContent();
      const match = text?.match(/(\d+\s*yr[s]?\s*\d*\s*mo[s]?|\d+\s*mo[s]?|\d+\s*yr[s]?)/i);
      yearsAtCompany = match ? match[1].trim() : null;
    }
  } catch { /* ignore */ }

  // Education — most recent school
  let school: string | null = null;
  try {
    const eduEl = await page.$('#education ~ .pvs-list__container .pvs-entity .hoverable-link-text span[aria-hidden="true"]');
    if (eduEl) school = (await eduEl.textContent())?.trim() || null;
  } catch { /* ignore */ }

  // Recent post — first text from activity section
  let recentPost: string | null = null;
  try {
    const postEl = await page.$('.pv-recent-activity-section__content .feed-shared-text span[dir="ltr"]');
    if (postEl) {
      const text = await postEl.textContent();
      recentPost = text ? text.trim().slice(0, 120) : null;
    }
  } catch { /* ignore */ }

  // Mutual connections
  let mutualConnections: string | null = null;
  try {
    const mutualEl = await page.$('a[href*="mutual"] span, .pv-browsemap-section__member-metadata span');
    if (mutualEl) {
      const text = await mutualEl.textContent();
      const match = text?.match(/(\d+)\s*mutual/i);
      mutualConnections = match ? match[1] : null;
    }
  } catch { /* ignore */ }

  // Top skills (first 3)
  let skills: string | null = null;
  try {
    const skillEls = await page.$$('#skills ~ .pvs-list__container .hoverable-link-text span[aria-hidden="true"]');
    const skillTexts = await Promise.all(
      skillEls.slice(0, 3).map(el => el.textContent().then(t => t?.trim()).catch(() => null))
    );
    const valid = skillTexts.filter(Boolean) as string[];
    skills = valid.length > 0 ? valid.join(', ') : null;
  } catch { /* ignore */ }

  return {
    headline: headline?.slice(0, 200) ?? null,
    summary: summary?.slice(0, 300) ?? null,
    location: location?.slice(0, 100) ?? null,
    yearsAtCompany,
    school: school?.slice(0, 150) ?? null,
    recentPost,
    mutualConnections,
    skills: skills?.slice(0, 200) ?? null,
  };
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
