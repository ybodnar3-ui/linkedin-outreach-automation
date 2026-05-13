/**
 * salesNavScraper.ts
 * Scrapes LinkedIn Sales Navigator search results to import leads.
 *
 * Requirements:
 *  - Active LinkedIn session with Sales Navigator subscription
 *  - searchUrl: a Sales Navigator search URL (linkedin.com/sales/search/people?...)
 *  - maxLeads: max number of leads to scrape (default 25, max 100)
 *
 * Returns array of partial Lead objects ready for DB insertion.
 */

import { getBrowser, loadSession } from './browser';
import { logger } from '../utils/logger';

export interface ScrapedLead {
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
}

export interface SalesNavImportResult {
  leads: ScrapedLead[];
  totalFound: number;
  errors: string[];
}

export async function scrapeSalesNav(
  searchUrl: string,
  maxLeads = 25,
): Promise<SalesNavImportResult> {
  const cappedMaxLeads = Math.min(Math.max(1, maxLeads), 100); // server-side cap: 1–100
  const errors: string[] = [];
  const leads: ScrapedLead[] = [];

  if (!searchUrl.includes('linkedin.com/sales/')) {
    return { leads: [], totalFound: 0, errors: ['URL must be a LinkedIn Sales Navigator URL (linkedin.com/sales/...)'] };
  }

  const ctx = await getBrowser();
  const cookies = loadSession();
  if (cookies) {
    await ctx.addCookies(cookies).catch(() => {});
  }

  const page = await ctx.newPage();

  try {
    logger.info('Sales Nav import started', { searchUrl, maxLeads: cappedMaxLeads });

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(3000);

    // Check if Sales Navigator is accessible
    const url = page.url();
    if (url.includes('/login') || url.includes('/checkpoint/')) {
      return { leads: [], totalFound: 0, errors: ['LinkedIn session expired or Sales Navigator not accessible. Please reconnect your account.'] };
    }

    if (!url.includes('/sales/')) {
      return { leads: [], totalFound: 0, errors: ['Redirected away from Sales Navigator — session may have expired.'] };
    }

    // Get total results count
    let totalFound = 0;
    try {
      const countEl = await page.$('.artdeco-typography--display-small, [data-test-search-results-header-count]');
      if (countEl) {
        const text = await countEl.textContent();
        const match = text?.match(/[\d,]+/);
        totalFound = match ? parseInt(match[0].replace(/,/g, ''), 10) : 0;
      }
    } catch { /* ignore */ }

    // Scroll to load all visible results
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(800);
    }

    // Extract lead cards
    // Sales Navigator uses .artdeco-entity-lockup or [data-chameleon-result-urn] selectors
    const cardSelectors = [
      '[data-chameleon-result-urn]',
      '.artdeco-entity-lockup',
      '.search-results__result-item',
      'li.artdeco-list__item',
    ];

    let cards: string[] = [];
    for (const selector of cardSelectors) {
      const count = await page.$$(selector).then(els => els.length);
      if (count > 0) {
        cards = await page.evaluate((sel) => {
          const elements = document.querySelectorAll(sel);
          const results: string[] = [];
          elements.forEach(el => {
            const nameEl = el.querySelector('.artdeco-entity-lockup__title, [data-anonymize="person-name"], .result-lockup__name');
            const titleEl = el.querySelector('.artdeco-entity-lockup__subtitle, [data-anonymize="title"], .result-lockup__highlight-keyword');
            const companyEl = el.querySelector('.artdeco-entity-lockup__caption, [data-anonymize="company-name"], .result-lockup__position-company');
            const linkEl = el.querySelector('a[href*="/sales/lead/"], a[href*="/in/"]');

            if (!nameEl && !linkEl) return;

            results.push(JSON.stringify({
              name: nameEl?.textContent?.trim() || '',
              title: titleEl?.textContent?.trim() || '',
              company: companyEl?.textContent?.trim() || '',
              href: linkEl ? (linkEl as HTMLAnchorElement).href : '',
            }));
          });
          return results;
        }, selector);

        if (cards.length > 0) break;
      }
    }

    logger.info('Sales Nav cards found', { count: cards.length });

    for (const cardJson of cards.slice(0, cappedMaxLeads)) {
      try {
        const card = JSON.parse(cardJson) as { name: string; title: string; company: string; href: string };

        // Parse name into first/last
        const parts = card.name.trim().split(/\s+/);
        const firstName = parts[0] || null;
        const lastName = parts.slice(1).join(' ') || null;

        // Convert sales navigator profile URL to regular LinkedIn URL
        let linkedinUrl = card.href;
        if (linkedinUrl.includes('/sales/lead/')) {
          // Sales Nav URL: /sales/lead/ACwAA....,name,Title
          // Extract linkedin profile from the URL if possible, otherwise keep as-is
          const match = linkedinUrl.match(/\/sales\/lead\/([^,]+)/);
          if (match) {
            // We keep the sales nav URL but we'll need to resolve it
            // For now just use the href as-is — the worker can handle sales nav URLs
            linkedinUrl = card.href;
          }
        }

        if (!linkedinUrl || (!linkedinUrl.includes('linkedin.com'))) {
          errors.push(`Skipped: no LinkedIn URL for "${card.name}"`);
          continue;
        }

        leads.push({
          linkedin_url: linkedinUrl,
          first_name: firstName,
          last_name: lastName,
          company: card.company || null,
          title: card.title || null,
        });
      } catch (err) {
        errors.push(`Parse error: ${String(err)}`);
      }
    }

    logger.info('Sales Nav import completed', { leadsFound: leads.length, errors: errors.length });
    return { leads, totalFound, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Sales Nav scrape error', { error: msg });
    return { leads, totalFound: 0, errors: [msg] };
  } finally {
    await page.close();
  }
}
