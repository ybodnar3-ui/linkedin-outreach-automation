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
 * Uses a layout-agnostic approach: finds all /in/ profile links,
 * then walks up the DOM to find the card container and extract name/title/company.
 * This is resilient to LinkedIn's frequent HTML structure changes.
 */
async function scrapeOnePage(page: import('playwright').Page): Promise<ScrapedLead[]> {
  // Wait for any profile link to appear — works regardless of container class names
  await page.waitForSelector('a[href*="/in/"]', { timeout: 15000 }).catch(() => {});

  // Scroll to trigger lazy-loading of all cards
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(350);
  }

  const results = await page.evaluate(() => {
    const cards: Array<{ name: string; title: string; company: string; href: string }> = [];
    const seenHrefs = new Set<string>();

    // Grab every /in/ profile link on the page
    const allLinks = Array.from(document.querySelectorAll('a[href*="/in/"]')) as HTMLAnchorElement[];

    for (const linkEl of allLinks) {
      const href = linkEl.href || '';
      // Must be a clean profile URL — skip nav links, "people also viewed", etc.
      if (!href.includes('linkedin.com/in/')) continue;
      // Normalise: strip query params and trailing slash variations
      const cleanHref = href.split('?')[0].replace(/\/$/, '');
      if (seenHrefs.has(cleanHref)) continue;
      seenHrefs.add(cleanHref);

      // Walk up to find the card container (li or div that holds the full result)
      let card: Element = linkEl;
      for (let i = 0; i < 8; i++) {
        const parent = card.parentElement;
        if (!parent) break;
        // Stop at list items or large divs that look like result cards
        const tag = parent.tagName.toLowerCase();
        if (tag === 'li' || (tag === 'div' && (parent.getAttribute('data-view-name') || parent.className.includes('result')))) {
          card = parent;
          break;
        }
        card = parent;
      }

      // Name: prefer aria-hidden span inside the link (LinkedIn's pattern for screen-reader dupe text)
      const nameEl =
        linkEl.querySelector('span[aria-hidden="true"]') ||
        linkEl.querySelector('span:not([class*="visually"])') ||
        linkEl;
      const rawName = nameEl?.textContent?.trim() ?? '';
      // Skip anonymous "LinkedIn Member" cards
      if (!rawName || rawName.toLowerCase().includes('linkedin member')) continue;
      // Skip "Connect", "Follow" button text that sometimes appears in links
      if (rawName.length > 60 || rawName.toLowerCase().includes('connect')) continue;

      // Title/headline: first non-name text block below the link within the card
      let title = '';
      let company = '';
      const textNodes = Array.from(card.querySelectorAll('span, div, p'))
        .filter(el => {
          const t = el.textContent?.trim() ?? '';
          return (
            t.length > 0 &&
            t !== rawName &&
            !t.includes('Connect') &&
            !t.includes('Follow') &&
            !t.includes('Message') &&
            !t.includes('Premium') &&
            el.children.length === 0 // leaf nodes only
          );
        })
        .map(el => el.textContent!.trim());

      // First distinct text is headline/title, second may be company
      const filtered = textNodes.filter(t => t !== rawName);
      if (filtered[0]) title = filtered[0].substring(0, 120);
      if (filtered[1] && filtered[1] !== title) company = filtered[1].substring(0, 120);

      cards.push({ name: rawName, title, company, href: cleanHref });
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
    const pageTitle = await page.title().catch(() => '');
    logger.info('Page loaded', { accountId, currentUrl: currentUrl.substring(0, 100), pageTitle });

    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || currentUrl.includes('/authwall')) {
      await page.close();
      return {
        leads: [],
        totalFound: 0,
        pagesScraped: 0,
        errors: ['LinkedIn session expired — please reconnect the account via Accounts page.'],
      };
    }

    // Count /in/ links as a quick diagnostic
    const linkCount = await page.evaluate(() =>
      document.querySelectorAll('a[href*="/in/"]').length,
    );
    logger.info('Profile links found on page', { accountId, linkCount });

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
