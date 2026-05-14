/**
 * linkedinScraper.ts
 * Scrapes regular LinkedIn People Search (free, no Sales Navigator required).
 *
 * Usage:
 *  - searchUrl: linkedin.com/search/results/people/?keywords=...
 *  - accountId + sessionFile: which account's cookies to use
 *  - maxLeads: 1–200
 *
 * Paginates automatically across result pages.
 */

import { getBrowserForAccount } from './browser';
import { getAccountProxy } from './accounts';
import { logger } from '../utils/logger';

export interface ScrapedLead {
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
}

export interface LinkedInScrapeResult {
  leads: ScrapedLead[];
  totalFound: number;
  pagesScraped: number;
  errors: string[];
}

const RESULTS_PER_PAGE = 10;

function parseLinkedInUrl(href: string): string | null {
  try {
    const url = new URL(href);
    // Must be a linkedin.com /in/ profile URL
    if (!url.hostname.endsWith('linkedin.com')) return null;
    const match = url.pathname.match(/^\/in\/([\w-]+)\/?/);
    if (!match) return null;
    return `https://www.linkedin.com/in/${match[1]}/`;
  } catch {
    return null;
  }
}

function parseName(full: string): { first: string | null; last: string | null } {
  const clean = full.replace(/\s+/g, ' ').trim();
  if (!clean) return { first: null, last: null };
  const parts = clean.split(' ');
  return {
    first: parts[0] || null,
    last: parts.slice(1).join(' ') || null,
  };
}

/**
 * Scrape one page of LinkedIn people search results.
 * Returns array of raw card data strings (JSON).
 */
async function scrapeOnePage(page: import('playwright').Page): Promise<ScrapedLead[]> {
  // Wait for search results to appear
  await page.waitForSelector(
    '.reusable-search__result-container, .entity-result, [data-chameleon-result-urn]',
    { timeout: 15000 },
  ).catch(() => {});

  // Scroll to trigger lazy-loading
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(400);
  }

  const results = await page.evaluate(() => {
    const cards: Array<{
      name: string;
      title: string;
      company: string;
      href: string;
    }> = [];

    // Try multiple container selectors (LinkedIn A/B tests different layouts)
    const containers = [
      ...document.querySelectorAll('li.reusable-search__result-container'),
      ...document.querySelectorAll('div.entity-result'),
      ...document.querySelectorAll('[data-chameleon-result-urn]'),
    ];

    // De-duplicate by element reference
    const seen = new Set<Element>();
    for (const el of containers) {
      if (seen.has(el)) continue;
      seen.add(el);

      // Profile link — must be /in/ URL
      const linkEl = (
        el.querySelector('a[href*="/in/"]') as HTMLAnchorElement | null
      );
      if (!linkEl?.href) continue;

      // Name — try aria-hidden span inside the link first
      const nameEl =
        linkEl.querySelector('span[aria-hidden="true"]') ||
        el.querySelector('.entity-result__title-text span[aria-hidden="true"]') ||
        el.querySelector('.actor-name') ||
        linkEl;
      const name = nameEl?.textContent?.trim() ?? '';

      // Title / headline
      const titleEl =
        el.querySelector('.entity-result__primary-subtitle') ||
        el.querySelector('.subline-level-1') ||
        el.querySelector('[class*="primary-subtitle"]');
      const title = titleEl?.textContent?.trim() ?? '';

      // Company
      const companyEl =
        el.querySelector('.entity-result__secondary-subtitle') ||
        el.querySelector('.subline-level-2') ||
        el.querySelector('[class*="secondary-subtitle"]');
      const company = companyEl?.textContent?.trim() ?? '';

      // Skip "LinkedIn Member" placeholder cards (anonymous)
      if (!name || name.toLowerCase().includes('linkedin member')) continue;

      cards.push({ name, title, company, href: linkEl.href });
    }

    return cards;
  });

  const leads: ScrapedLead[] = [];
  for (const r of results) {
    const linkedinUrl = parseLinkedInUrl(r.href);
    if (!linkedinUrl) continue;
    const { first, last } = parseName(r.name);
    leads.push({
      linkedin_url: linkedinUrl,
      first_name: first,
      last_name: last,
      title: r.title || null,
      company: r.company || null,
    });
  }

  return leads;
}

/** Build the URL for a given page number (LinkedIn uses `page=N` param) */
function buildPageUrl(baseUrl: string, pageNum: number): string {
  const url = new URL(baseUrl);
  if (pageNum > 1) {
    url.searchParams.set('page', String(pageNum));
  } else {
    url.searchParams.delete('page');
  }
  return url.toString();
}

export async function scrapeLinkedInSearch(
  accountId: string,
  sessionFile: string,
  searchUrl: string,
  maxLeads = 25,
): Promise<LinkedInScrapeResult> {
  const cappedMax = Math.min(Math.max(1, maxLeads), 200);
  const errors: string[] = [];
  const allLeads: ScrapedLead[] = [];
  const seenUrls = new Set<string>();
  let pagesScraped = 0;
  let totalFound = 0;

  if (!searchUrl.includes('linkedin.com/search/results/people')) {
    return {
      leads: [],
      totalFound: 0,
      pagesScraped: 0,
      errors: ['URL must be a LinkedIn people search URL (linkedin.com/search/results/people/...)'],
    };
  }

  const proxy = getAccountProxy(accountId);
  const ctx = await getBrowserForAccount(accountId, sessionFile, proxy);
  const page = await ctx.newPage();

  try {
    logger.info('LinkedIn search scrape started', { accountId, searchUrl, maxLeads: cappedMax });

    // Load first page
    await page.goto(buildPageUrl(searchUrl, 1), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check session is still valid
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      await page.close();
      return {
        leads: [],
        totalFound: 0,
        pagesScraped: 0,
        errors: ['LinkedIn session expired — please reconnect the account via Accounts page.'],
      };
    }

    // Extract total results count from the header
    try {
      const countText = await page.$eval(
        '.search-results-container h2, .pb2.t-black--light.t-14, [class*="results-header"]',
        el => el.textContent ?? '',
      ).catch(() => '');
      const match = countText.match(/[\d,]+/);
      if (match) totalFound = parseInt(match[0].replace(/,/g, ''), 10);
    } catch { /* ignore */ }

    const maxPages = Math.ceil(cappedMax / RESULTS_PER_PAGE);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (pageNum > 1) {
        await page.goto(buildPageUrl(searchUrl, pageNum), { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Respectful delay between pages (1.5–3s)
        await page.waitForTimeout(1500 + Math.random() * 1500);
      }

      const pageleads = await scrapeOnePage(page);

      if (pageleads.length === 0) {
        logger.info('No results on page, stopping', { accountId, pageNum });
        break;
      }

      for (const lead of pageleads) {
        if (seenUrls.has(lead.linkedin_url)) continue;
        seenUrls.add(lead.linkedin_url);
        allLeads.push(lead);
        if (allLeads.length >= cappedMax) break;
      }

      pagesScraped++;
      logger.info('Page scraped', { accountId, pageNum, found: pageleads.length, total: allLeads.length });

      if (allLeads.length >= cappedMax) break;
    }

    logger.info('LinkedIn search scrape complete', {
      accountId,
      leadsFound: allLeads.length,
      pagesScraped,
      totalFound,
    });

    return { leads: allLeads, totalFound, pagesScraped, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('LinkedIn search scrape error', { accountId, error: msg });
    return { leads: allLeads, totalFound, pagesScraped, errors: [msg] };
  } finally {
    await page.close();
  }
}
