/**
 * background.js — LI Outreach Chrome Extension Service Worker
 *
 * Flow:
 *   1. Every 30 s: POST /api/extension/ping (heartbeat)
 *   2. Every 30 s: GET  /api/extension/poll?account_id=xxx
 *   3. If a task arrives: open/reuse a LinkedIn tab, navigate to profile, send
 *      message to content.js, await result
 *   4. POST /api/extension/result with outcome
 *
 *   5. LI_OUTREACH_START_IMPORT: calls LinkedIn Voyager API directly, paginates,
 *      and bulk-imports leads to backend. No manual profile visits needed.
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let isProcessing = false;
let linkedInTabId = null;

// ── Voyager URL capture via webRequest ────────────────────────────────────────
// webRequest.onCompleted fires for ALL requests from a tab (incl. service worker).
// This is the only reliable way to capture LinkedIn's internal Voyager API URLs.

const _voyagerByTab = new Map(); // tabId → { url, resolvers: [] }

// Capture the exact csrf-token header LinkedIn uses (most reliable — bypasses JSESSIONID parsing)
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!details.url.includes('/voyager/api/search/') && !details.url.includes('/voyager/api/graphql')) return;
    const csrfHeader = (details.requestHeaders || []).find(h => h.name.toLowerCase() === 'csrf-token');
    if (csrfHeader?.value) {
      const entry = _voyagerByTab.get(details.tabId) || { url: null, csrfToken: null, resolvers: [] };
      entry.csrfToken = csrfHeader.value;
      _voyagerByTab.set(details.tabId, entry);
      console.log('[LI Outreach] Captured CSRF token:', csrfHeader.value.substring(0, 20) + '…');
    }
  },
  { urls: ['https://www.linkedin.com/voyager/api/*'] },
  ['requestHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const url = details.url;
    if (!url.includes('/voyager/api/search/') && !url.includes('/voyager/api/graphql')) return;

    console.log('[LI Outreach] webRequest captured URL:', url.substring(0, 150));

    const entry = _voyagerByTab.get(details.tabId) || { url: null, csrfToken: null, resolvers: [] };
    entry.url = url;
    _voyagerByTab.set(details.tabId, entry);

    // Resolve any promises waiting for this URL
    const resolvers = entry.resolvers.splice(0);
    for (const resolve of resolvers) resolve(url);
  },
  { urls: ['https://www.linkedin.com/voyager/api/*'] }
);

/**
 * Wait until webRequest captures a Voyager search URL for the given tab.
 * Resolves with { url, csrfToken } once available.
 */
function waitForVoyagerUrl(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const entry = _voyagerByTab.get(tabId);
    if (entry?.url) { resolve({ url: entry.url, csrfToken: entry.csrfToken || '' }); return; }

    const timer = setTimeout(() => {
      const e2 = _voyagerByTab.get(tabId);
      if (e2) e2.resolvers = e2.resolvers.filter(r => r !== resolve);
      reject(new Error('Timeout — LinkedIn не зробив пошукового запиту'));
    }, timeoutMs);

    if (!_voyagerByTab.has(tabId)) _voyagerByTab.set(tabId, { url: null, csrfToken: null, resolvers: [] });
    _voyagerByTab.get(tabId).resolvers.push((url) => {
      clearTimeout(timer);
      const e3 = _voyagerByTab.get(tabId);
      resolve({ url, csrfToken: e3?.csrfToken || '' });
    });
  });
}

// ── Config helpers ────────────────────────────────────────────────────────────

async function getConfig() {
  return chrome.storage.local.get(['apiUrl', 'apiToken', 'accountId']);
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function apiFetch(apiUrl, apiToken, path, options = {}) {
  const url = `${apiUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function sendHeartbeat(apiUrl, apiToken, accountId) {
  try {
    const data = await apiFetch(apiUrl, apiToken, '/api/extension/ping', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId }),
    });
    const count = data.pending_count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: count > 0 ? '#0077b5' : '#ccc' });
    return data;
  } catch (e) {
    console.warn('[LI Outreach] Heartbeat failed:', e.message);
    chrome.action.setBadgeText({ text: '?' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    return null;
  }
}

async function pollForTask(apiUrl, apiToken, accountId) {
  return apiFetch(apiUrl, apiToken, `/api/extension/poll?account_id=${accountId}`);
}

async function reportResult(apiUrl, apiToken, taskId, status, result, errorMessage) {
  return apiFetch(apiUrl, apiToken, '/api/extension/result', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, status, result, error_message: errorMessage }),
  });
}

// ── Tab management ────────────────────────────────────────────────────────────

async function getOrCreateLinkedInTab() {
  if (linkedInTabId !== null) {
    try {
      const tab = await chrome.tabs.get(linkedInTabId);
      if (tab && tab.url && tab.url.includes('linkedin.com')) {
        return linkedInTabId;
      }
    } catch {
      linkedInTabId = null;
    }
  }

  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (tabs.length > 0) {
    linkedInTabId = tabs[0].id;
    return linkedInTabId;
  }

  const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/', active: false });
  linkedInTabId = tab.id;
  await waitForTabLoad(linkedInTabId);
  return linkedInTabId;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 30000);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function navigateTab(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabLoad(tabId);
  await sleep(3000);
}

// ── Content script communication ──────────────────────────────────────────────

async function sendToContentScript(tabId, message, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, message);
      return result;
    } catch (e) {
      console.warn(`[LI Outreach] sendMessage attempt ${attempt + 1} failed:`, e.message);
      if (attempt < retries - 1) await sleep(1500);
    }
  }
  throw new Error('Content script not responding after 3 attempts');
}

// ── Task execution ────────────────────────────────────────────────────────────

async function processTask(task, apiUrl, apiToken) {
  console.log('[LI Outreach] Processing task:', task.action, task.id);

  try {
    const tabId = await getOrCreateLinkedInTab();
    const profileUrl = task.payload.profileUrl;

    if (!profileUrl) throw new Error('No profileUrl in task payload');

    await navigateTab(tabId, profileUrl);

    const result = await sendToContentScript(tabId, {
      type: 'LI_OUTREACH_EXECUTE',
      action: task.action,
      payload: task.payload,
    });

    if (!result) throw new Error('No response from content script');

    if (result.success) {
      await reportResult(apiUrl, apiToken, task.id, 'done', result, null);
      console.log('[LI Outreach] Task done:', task.action, result);
    } else {
      await reportResult(apiUrl, apiToken, task.id, 'failed', null, result.error || 'Unknown error');
      console.warn('[LI Outreach] Task failed:', task.action, result.error);
    }
  } catch (e) {
    console.error('[LI Outreach] Task error:', e.message);
    await reportResult(apiUrl, apiToken, task.id, 'failed', null, e.message).catch(() => {});
  }
}

// ── Voyager API bulk import ───────────────────────────────────────────────────

/**
 * Send a progress message back to the popup (if it's open).
 */
function reportProgress(text, done = false) {
  chrome.runtime.sendMessage({ type: 'LI_OUTREACH_IMPORT_PROGRESS', text, done }).catch(() => {});
}

/**
 * Walk Voyager API JSON and extract profile leads.
 */
function extractLeadsFromVoyager(data) {
  const leads = [];
  const seen = new Set();
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (obj.publicIdentifier && typeof obj.publicIdentifier === 'string') {
      const slug = obj.publicIdentifier;
      if (!seen.has(slug) && slug.length > 2) {
        seen.add(slug);
        leads.push({
          linkedin_url: `https://www.linkedin.com/in/${slug}`,
          first_name: obj.firstName || '',
          last_name: obj.lastName || '',
          title: obj.headline || '',
          company: '',
        });
      }
    }
    Object.values(obj).forEach(walk);
  }
  walk(data);
  return leads;
}

/**
 * Runs in MAIN world (page context).
 * csrfToken is read via chrome.cookies in the service worker (bypasses HttpOnly restriction)
 * and passed as an argument — do NOT try to read document.cookie here.
 */
function paginateVoyagerInPage(voyagerUrl, maxLeads, csrfToken) {
  return (async () => {
    if (!csrfToken) return { error: 'Не знайдено CSRF токен — переконайся що увійшов у LinkedIn.', leads: [] };

    const leads = [];
    const seen = new Set();

    function extractLeads(data) {
      function walk(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(walk); return; }
        if (obj.publicIdentifier && typeof obj.publicIdentifier === 'string') {
          const slug = obj.publicIdentifier;
          if (!seen.has(slug) && slug.length > 2) {
            seen.add(slug);
            leads.push({
              linkedin_url: `https://www.linkedin.com/in/${slug}`,
              first_name: obj.firstName || '',
              last_name: obj.lastName || '',
              title: obj.headline || '',
              company: '',
            });
          }
        }
        try { Object.values(obj).forEach(walk); } catch {}
      }
      walk(data);
    }

    const pageSize = 10;
    const maxPages = Math.ceil(maxLeads / pageSize);
    const isGraphQL = voyagerUrl.includes('/voyager/api/graphql');
    const baseUrl = new URL(voyagerUrl);

    for (let page = 0; page < maxPages; page++) {
      const start = page * pageSize;

      // Build paginated URL — handle both blended search and GraphQL
      if (isGraphQL) {
        // GraphQL uses variables=(start:0,count:10,...) syntax
        let vars = baseUrl.searchParams.get('variables') || '';
        vars = vars.replace(/\bstart:\d+/, `start:${start}`);
        vars = vars.replace(/\bcount:\d+/, `count:${pageSize}`);
        if (!vars.includes('start:')) vars = `(start:${start},count:${pageSize})`;
        baseUrl.searchParams.set('variables', vars);
      } else {
        baseUrl.searchParams.set('start', String(start));
        baseUrl.searchParams.set('count', String(pageSize));
      }

      try {
        const res = await fetch(baseUrl.toString(), {
          credentials: 'include',
          headers: {
            'csrf-token': csrfToken,
            'x-restli-protocol-version': '2.0.0',
            'accept': 'application/vnd.linkedin.normalized+json+2.1',
            'accept-language': 'en-US,en;q=0.9',
            'x-li-lang': 'en_US',
            'x-li-page-instance': 'urn:li:page:d_flagship3_search_srp_people',
            'x-li-track': JSON.stringify({
              clientVersion: '1.13.14973',
              mpVersion: '1.13.14973',
              osName: 'web',
              timezoneOffset: -5,
              timezone: 'America/New_York',
              deviceFormFactor: 'DESKTOP',
              mpName: 'voyager-web',
              displayDensity: 1,
              displayWidth: 1440,
              displayHeight: 900,
            }),
          },
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          if (page === 0) return { error: `Voyager API: HTTP ${res.status} — ${errText.slice(0, 200)}`, leads };
          break;
        }

        const data = await res.json();
        const before = leads.length;
        extractLeads(data);
        if (leads.length === before) break; // no new leads → end of results
      } catch (e) {
        if (page === 0) return { error: `Fetch error: ${e.message}`, leads };
        break;
      }

      if (page < maxPages - 1) {
        await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      }
    }

    return { leads };
  })();
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM SCRAPER (runs inside the LinkedIn tab via executeScript)
// Modern LinkedIn returns search results in SSR'd HTML, not a Voyager API call.
// So we read the rendered DOM instead of intercepting fetch.
// ═══════════════════════════════════════════════════════════════════════════
function scrapeSearchResultsInPage() {
  const leads = [];
  const seen = new Set();
  const debug = { strategies: {}, totalAnchors: 0, sampleHtml: '' };

  try {
    // ── Strategy 1: rendered profile cards (most common) ─────────────────────
    const anchors = document.querySelectorAll('a[href*="/in/"]');
    debug.totalAnchors = anchors.length;

    anchors.forEach(link => {
      try {
        const m = link.href.match(/linkedin\.com\/in\/([^/?#&]+)/i);
        if (!m) return;
        const slug = decodeURIComponent(m[1]);
        if (!slug || slug.length < 3 || slug === 'UNAVAILABLE' || slug === 'headless') return;
        const cleanUrl = `https://www.linkedin.com/in/${slug}`;
        if (seen.has(cleanUrl)) return;
        seen.add(cleanUrl);

        const container = link.closest(
          'li[class*="reusable-search__result-container"], li[class*="result"], div[class*="entity-result"], div[data-chameleon-result-urn], [data-view-name]'
        );

        let name = '', title = '', location = '';
        if (container) {
          const nameEl =
            container.querySelector('[class*="entity-result__title-text"] span[aria-hidden="true"]') ||
            container.querySelector('[class*="title"] span[aria-hidden="true"]') ||
            container.querySelector('span[aria-hidden="true"]');
          name = (nameEl?.textContent || '').trim().replace(/^LinkedIn Member$/, '');

          const titleEl =
            container.querySelector('[class*="entity-result__primary-subtitle"]') ||
            container.querySelector('[class*="subline-level-1"]') ||
            container.querySelector('div[class*="t-14"][class*="t-black"]');
          title = (titleEl?.textContent || '').trim();

          const locEl =
            container.querySelector('[class*="entity-result__secondary-subtitle"]') ||
            container.querySelector('[class*="subline-level-2"]');
          location = (locEl?.textContent || '').trim();
        }

        if (!name) name = (link.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);

        const parts = name.split(/\s+/).filter(Boolean);
        leads.push({
          linkedin_url: cleanUrl,
          first_name: parts[0] || '',
          last_name: parts.slice(1).join(' ') || '',
          title: title.split(/\s+/).filter(Boolean).slice(0, 30).join(' '),
          company: '',
        });
      } catch (e) {
        // skip this link
      }
    });
    debug.strategies.cardScrape = leads.length;

    // ── Strategy 2: scrape embedded JSON in <code> tags (SSR data) ───────────
    if (leads.length < 5) {
      const before = leads.length;
      document.querySelectorAll('code[id^="bpr-guid"], code[style*="display:none"]').forEach(el => {
        try {
          const text = el.textContent || '';
          // Find profile slugs in JSON
          const matches = text.matchAll(/"publicIdentifier":"([\w-]{3,100})"/g);
          for (const m of matches) {
            const slug = m[1];
            const cleanUrl = `https://www.linkedin.com/in/${slug}`;
            if (seen.has(cleanUrl)) continue;
            seen.add(cleanUrl);
            leads.push({
              linkedin_url: cleanUrl,
              first_name: '',
              last_name: '',
              title: '',
              company: '',
            });
          }
        } catch {}
      });
      debug.strategies.jsonScrape = leads.length - before;
    }

    // ── Strategy 3: regex sweep of entire HTML (last resort) ─────────────────
    if (leads.length < 5) {
      const before = leads.length;
      try {
        const html = document.documentElement.outerHTML;
        const matches = html.matchAll(/\/in\/([a-zA-Z0-9-]{3,100})(?:\/|"|'|\?|&|#)/g);
        const blacklist = new Set(['search', 'jobs', 'company', 'school', 'groups', 'learning', 'feed', 'mynetwork', 'messaging', 'notifications', 'me', 'profile', 'in', 'UNAVAILABLE', 'headless']);
        for (const m of matches) {
          const slug = m[1];
          if (blacklist.has(slug)) continue;
          const cleanUrl = `https://www.linkedin.com/in/${slug}`;
          if (seen.has(cleanUrl)) continue;
          seen.add(cleanUrl);
          leads.push({
            linkedin_url: cleanUrl,
            first_name: '',
            last_name: '',
            title: '',
            company: '',
          });
        }
      } catch {}
      debug.strategies.regexSweep = leads.length - before;
    }

    debug.sampleHtml = (document.querySelector('main')?.innerHTML || '').slice(0, 400);

    return {
      leads,
      pageUrl: location.href,
      pageTitle: document.title,
      debug,
    };
  } catch (e) {
    return { leads: [], error: e.message, pageUrl: location.href, debug };
  }
}

/**
 * Deep page diagnostic — runs after a "0 leads" failure to figure out WHY.
 * Looks for anchors, iframes, shadow DOM, virtualization markers, etc.
 */
async function deepDebugPage(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN', // try MAIN world to see if isolated-vs-main makes a difference
      func: () => {
        const data = {};
        data.url = location.href;
        data.title = document.title;
        data.readyState = document.readyState;
        data.bodyLength = document.body?.innerHTML?.length || 0;

        // ── All anchors and their href patterns ──
        const anchors = Array.from(document.querySelectorAll('a'));
        data.totalAnchors = anchors.length;
        data.first30Hrefs = anchors.slice(0, 30).map(a => (a.href || '').substring(0, 100));
        data.inAnchors = document.querySelectorAll('a[href*="/in/"]').length;
        data.profileAnchorsByClass = document.querySelectorAll('a.app-aware-link').length;
        data.dataTestAppAwareLink = document.querySelectorAll('[data-test-app-aware-link]').length;

        // ── Iframes (results might be in one) ──
        const iframes = Array.from(document.querySelectorAll('iframe'));
        data.iframeCount = iframes.length;
        data.iframeSrcs = iframes.map(i => (i.src || '').substring(0, 100));

        // ── Shadow DOM detection ──
        const shadowRoots = [];
        document.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) shadowRoots.push({ tag: el.tagName, class: el.className });
        });
        data.shadowRoots = shadowRoots;

        // ── Search result containers ──
        data.resultContainers = {
          ulSearchResults: document.querySelectorAll('ul.reusable-search__entity-result-list, ul[class*="results-list"]').length,
          liResults: document.querySelectorAll('li[class*="reusable-search__result"], li[class*="entity-result"]').length,
          divEntityResult: document.querySelectorAll('div[class*="entity-result"]').length,
          searchResultsContainer: document.querySelectorAll('[class*="search-results-container"]').length,
          dataChameleonResult: document.querySelectorAll('[data-chameleon-result-urn]').length,
          dataViewName: document.querySelectorAll('[data-view-name]').length,
        };

        // ── Sample of main element HTML ──
        const main = document.querySelector('main, [role="main"], .scaffold-layout__main, #main-content');
        if (main) {
          data.mainTag = main.tagName;
          data.mainClass = main.className;
          data.mainHtmlLength = main.outerHTML.length;
          data.mainHtmlSample = main.outerHTML.substring(0, 2500);
        } else {
          data.mainTag = 'NOT FOUND';
        }

        // ── Shadow-piercing anchor search ──
        function piercingAnchorCount() {
          let count = 0;
          function search(root) {
            count += root.querySelectorAll('a[href*="/in/"]').length;
            root.querySelectorAll('*').forEach(el => {
              if (el.shadowRoot) search(el.shadowRoot);
            });
          }
          search(document);
          return count;
        }
        data.piercingInAnchors = piercingAnchorCount();

        return data;
      },
    });
    return injection?.result;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Scroll the page through several positions to trigger any lazy-load / IntersectionObserver.
 */
async function triggerLazyLoad(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const startY = window.scrollY;
        // Scroll through page to fire IntersectionObserver-based lazy loads
        for (const y of [200, 600, 1200, 2000, 2800, 3600, 4400, 0]) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await sleep(300);
        }
        window.scrollTo({ top: startY, behavior: 'instant' });
      },
    });
    console.log('[LI Outreach] Lazy-load scroll triggered');
  } catch (e) {
    console.warn('[LI Outreach] Scroll trigger failed:', e.message);
  }
}

/**
 * Wait until LinkedIn search page actually has profile <a href="/in/SLUG"> anchors.
 * Returns { ready, anchorCount, profileAnchorCount, waitedMs, url, title, bodyTextSnippet }
 */
async function waitForProfileAnchors(tabId, timeoutMs = 15000) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (timeoutMs) => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const anchors = document.querySelectorAll('a[href*="/in/"]');
          const profileAnchors = Array.from(anchors).filter(a => {
            const m = a.href.match(/\/in\/([^/?#&]+)/);
            return m && m[1].length > 3 && m[1] !== 'me' && m[1] !== 'UNAVAILABLE' && m[1] !== 'headless';
          });
          if (profileAnchors.length >= 3) {
            return {
              ready: true,
              anchorCount: anchors.length,
              profileAnchorCount: profileAnchors.length,
              waitedMs: Date.now() - start,
              url: location.href,
              title: document.title,
            };
          }
          await sleep(500);
        }
        return {
          ready: false,
          anchorCount: document.querySelectorAll('a[href*="/in/"]').length,
          profileAnchorCount: 0,
          waitedMs: Date.now() - start,
          url: location.href,
          title: document.title,
          bodyTextSnippet: (document.body?.innerText || '').substring(0, 500),
        };
      },
      args: [timeoutMs],
    });
    return injection?.result || { ready: false, anchorCount: 0 };
  } catch (e) {
    console.error('[LI Outreach] waitForProfileAnchors failed:', e);
    return { ready: false, anchorCount: 0, error: e.message };
  }
}

/**
 * Scrape leads from a LinkedIn tab's rendered DOM.
 * Tries content.js message first, falls back to direct executeScript.
 */
async function scrapeTabDOM(tabId) {
  // Try sending message to content.js
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'LI_OUTREACH_SCRAPE_SEARCH' });
    if (res && Array.isArray(res.leads) && res.leads.length > 0) {
      console.log(`[LI Outreach] content.js scrape: ${res.leads.length} leads`);
      return { leads: res.leads, source: 'content.js' };
    }
    console.warn('[LI Outreach] content.js returned no leads, trying executeScript fallback');
  } catch (e) {
    console.warn('[LI Outreach] content.js sendMessage failed:', e.message);
  }

  // Fallback: direct executeScript with comprehensive scraper
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeSearchResultsInPage,
    });
    const result = injection?.result || { leads: [] };
    console.log(`[LI Outreach] executeScript scrape:`, {
      leads: result.leads?.length || 0,
      url: result.pageUrl,
      title: result.pageTitle,
      debug: result.debug,
    });
    return { leads: result.leads || [], source: 'executeScript', debug: result.debug, pageUrl: result.pageUrl, pageTitle: result.pageTitle };
  } catch (e) {
    console.error('[LI Outreach] executeScript scrape failed:', e);
    return { leads: [], source: 'failed', error: e.message };
  }
}

/**
 * Core import — DOM SCRAPING approach (the simple, robust one).
 *
 * Why DOM scraping (not API interception):
 *  - LinkedIn renders search results in SSR'd HTML (no Voyager call to intercept)
 *  - Direct Voyager API replay fails with 400/403 due to URL encoding + CSRF
 *  - The page already has all the data we need rendered in the DOM
 *
 * Flow:
 *  1. Find user's LinkedIn tab. Navigate it to the search URL if needed.
 *  2. executeScript scrapes profile links from rendered DOM (~10 per page).
 *  3. For more leads: navigate ?page=2, ?page=3, scrape each.
 *  4. Send accumulated leads to backend in chunks.
 *  5. Show result via popup progress + badge + chrome notification.
 *
 * Caveats:
 *  - If user is on the LinkedIn tab AND we navigate, the popup will close.
 *    Badge + notification handle that case.
 *  - 3rd-degree connections show as "LinkedIn Member" with /in/UNAVAILABLE
 *    links — we skip those (no real profile to import).
 */
async function importLeadsFromSearch(searchUrl, campaignId, accountId, apiUrl, apiToken, maxLeads) {
  console.log('[LI Outreach] ═══ IMPORT START ═══', { searchUrl, maxLeads });

  try {
    let fullSearchUrl = searchUrl.trim();
    if (!fullSearchUrl.startsWith('http')) {
      fullSearchUrl = 'https://www.linkedin.com/search/results/people/?' + fullSearchUrl;
    }

    // ── STEP 1: find the BEST LinkedIn tab to use ────────────────────────────
    reportProgress('🔍 Шукаю вкладку LinkedIn…');
    const allLinkedInTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    console.log('[LI Outreach] All LinkedIn tabs:', allLinkedInTabs.map(t => ({
      id: t.id, active: t.active, windowId: t.windowId, url: t.url?.substring(0, 100)
    })));

    if (allLinkedInTabs.length === 0) {
      reportProgress('❌ Не знайдено вкладки LinkedIn. Відкрий LinkedIn і увійди в акаунт.', true);
      return;
    }

    // Priority: (1) active tab on people search → (2) any people search tab →
    // (3) active LinkedIn tab → (4) any LinkedIn tab
    const targetTab =
      allLinkedInTabs.find(t => t.active && t.url?.includes('/search/results/people/')) ||
      allLinkedInTabs.find(t => t.url?.includes('/search/results/people/')) ||
      allLinkedInTabs.find(t => t.active) ||
      allLinkedInTabs[0];
    console.log('[LI Outreach] Selected tab:', { id: targetTab.id, active: targetTab.active, url: targetTab.url?.substring(0, 120) });

    // ── STEP 2: detect whether popup will close on navigation ────────────────
    let popupWillClose = false;
    try {
      const currentWindow = await chrome.windows.getCurrent();
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: currentWindow.id });
      popupWillClose = activeTab?.id === targetTab.id;
      console.log('[LI Outreach] popupWillClose:', popupWillClose, '(active tab:', activeTab?.url?.substring(0, 60), ')');
    } catch (e) {
      console.warn('[LI Outreach] Could not determine active tab:', e.message);
    }

    // ── STEP 3: navigate to the search URL if not already there ──────────────
    const isOnSearchPage = (targetTab.url || '').includes('/search/results/people/');

    if (!isOnSearchPage) {
      if (popupWillClose) {
        reportProgress('⚠️ Навігую LinkedIn на пошук — попап закриється. Слідкуй за бейджем 📊');
      } else {
        reportProgress('🔄 Навігую LinkedIn вкладку на сторінку пошуку…');
      }
      await sleep(1500); // give user time to read warning
      console.log('[LI Outreach] Navigating to:', fullSearchUrl);
      await chrome.tabs.update(targetTab.id, { url: fullSearchUrl });
      await waitForTabLoad(targetTab.id);
    } else {
      console.log('[LI Outreach] Tab already on search page — scraping in place');
    }

    // ── STEP 3.5: trigger lazy-load via scroll, then wait for anchors ────────
    reportProgress('⏳ Скролю сторінку для тригера lazy-load…');
    await triggerLazyLoad(targetTab.id);

    reportProgress('⏳ Чекаю поки результати відрендеряться…');
    const waitResult = await waitForProfileAnchors(targetTab.id, 12000);
    console.log('[LI Outreach] Wait result:', waitResult);

    if (!waitResult?.ready) {
      // Run deep diagnostic to figure out what's actually in the DOM
      reportProgress('🔬 0 anchors — запускаю діагностику…');
      const debug = await deepDebugPage(targetTab.id);
      console.error('[LI Outreach] ═══ DEEP DEBUG ═══', debug);

      const summary = debug ? [
        `anchors=${debug.totalAnchors}`,
        `inAnchors=${debug.inAnchors}`,
        `piercing=${debug.piercingInAnchors}`,
        `appAware=${debug.profileAnchorsByClass}`,
        `iframes=${debug.iframeCount}`,
        `shadowDOMs=${debug.shadowRoots?.length || 0}`,
        `entityResults=${debug.resultContainers?.divEntityResult}`,
        `mainHtmlLen=${debug.mainHtmlLength}`,
      ].join(', ') : 'no debug data';

      reportProgress(`❌ DOM аналіз: ${summary}. Перевір service worker console для деталей.`, true);
      return;
    }

    console.log(`[LI Outreach] DOM ready: ${waitResult.profileAnchorCount} profile anchors after ${waitResult.waitedMs}ms`);

    // ── STEP 4: scrape current (first) page ──────────────────────────────────
    reportProgress(`📄 Зчитую ліди (знайдено ${waitResult.profileAnchorCount} anchors)…`);
    const allLeads = new Map();
    const first = await scrapeTabDOM(targetTab.id);

    if (first.error) {
      reportProgress(`❌ Помилка скрапінгу: ${first.error}`, true);
      return;
    }

    for (const lead of (first.leads || [])) {
      if (lead.linkedin_url && !allLeads.has(lead.linkedin_url)) {
        allLeads.set(lead.linkedin_url, lead);
      }
    }
    console.log(`[LI Outreach] After page 1: ${allLeads.size} valid leads (anchors found: ${waitResult.profileAnchorCount})`);

    if (allLeads.size === 0) {
      reportProgress(
        `⚠️ ${waitResult.profileAnchorCount} anchors знайдено, але 0 валідних лідів. Профілі можуть бути anonymized.`,
        true,
      );
      return;
    }

    reportProgress(`✅ Стор. 1: ${allLeads.size} лідів`);

    // ── STEP 5: paginate if more leads needed ────────────────────────────────
    if (allLeads.size < maxLeads) {
      const remainingPages = Math.min(20, Math.ceil((maxLeads - allLeads.size) / Math.max(allLeads.size, 1)));
      console.log(`[LI Outreach] Need ${maxLeads - allLeads.size} more leads, paginating up to ${remainingPages} more pages`);

      if (popupWillClose) {
        reportProgress(`⚠️ Завантажую ще сторінки — попап закриється. Бейдж покаже результат.`);
        await sleep(1500);
      }

      for (let p = 2; p <= 1 + remainingPages; p++) {
        if (allLeads.size >= maxLeads) break;

        const u = new URL(fullSearchUrl);
        u.searchParams.set('page', String(p));
        const pageUrl = u.toString();

        console.log(`[LI Outreach] → Navigating to page ${p}`);
        reportProgress(`🔄 Стор. ${p}: ${allLeads.size} лідів так далеко…`);

        try {
          await chrome.tabs.update(targetTab.id, { url: pageUrl });
          await waitForTabLoad(targetTab.id);
          await sleep(3500);
        } catch (e) {
          console.error(`[LI Outreach] Navigation to page ${p} failed:`, e);
          break;
        }

        const scrape = await scrapeTabDOM(targetTab.id);
        const prevSize = allLeads.size;
        for (const lead of (scrape.leads || [])) {
          if (lead.linkedin_url && !allLeads.has(lead.linkedin_url)) {
            allLeads.set(lead.linkedin_url, lead);
          }
        }
        const added = allLeads.size - prevSize;
        console.log(`[LI Outreach] Page ${p}: +${added} leads, total ${allLeads.size}`);

        if (added === 0) {
          console.log('[LI Outreach] No new leads — end of results, stopping');
          break;
        }
      }
    }

    // ── STEP 6: send to backend in chunks ────────────────────────────────────
    const leads = Array.from(allLeads.values()).slice(0, maxLeads);
    console.log(`[LI Outreach] Final lead count: ${leads.length}`);
    reportProgress(`📤 Відправляю ${leads.length} лідів на сервер…`);

    let totalImported = 0;
    let totalSkipped  = 0;

    for (let i = 0; i < leads.length; i += 50) {
      const chunk = leads.slice(i, i + 50);
      console.log(`[LI Outreach] Sending chunk ${Math.floor(i / 50) + 1}/${Math.ceil(leads.length / 50)}, size=${chunk.length}`);
      try {
        const res = await fetch(`${apiUrl}/api/extension/import-leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
          body: JSON.stringify({ campaign_id: campaignId, account_id: accountId, leads: chunk }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          console.error(`[LI Outreach] Backend HTTP ${res.status}:`, errBody);
          throw new Error(`Backend HTTP ${res.status}: ${errBody.slice(0, 100)}`);
        }
        const data = await res.json();
        console.log('[LI Outreach] Backend response:', data);
        totalImported += data.added   || 0;
        totalSkipped  += data.skipped || 0;
      } catch (e) {
        console.error('[LI Outreach] Chunk send failed:', e);
      }
    }

    // ── STEP 7: show result ──────────────────────────────────────────────────
    const summary = `Імпортовано ${totalImported} лідів (${totalSkipped} дублікатів пропущено)`;
    console.log('[LI Outreach] ═══ IMPORT DONE ═══', { totalImported, totalSkipped, totalScraped: leads.length });

    try {
      chrome.notifications.create('li-import-done', {
        type: 'basic',
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAAA30lEQVRYhe2WMQ6CMBRAX6GJC3AB4gEcXDgBR/AIHkAXj+DkCTiBg4uDCxfwCM7GpWkTSmhLS/8r8F5a+pIWyrMQQgghpAXwBa4Zx3VLdQAAAABJRU5ErkJggg==',
        title: 'LI Outreach — Імпорт завершено',
        message: summary,
      });
    } catch {}

    chrome.action.setBadgeText({ text: `+${totalImported}` });
    chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 15000);

    reportProgress(`✅ ${summary}`, true);
    return;
  } catch (e) {
    console.error('[LI Outreach] ═══ IMPORT CRASHED ═══', e);
    reportProgress(`❌ Критична помилка: ${e.message}`, true);
    return;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEB SEARCH IMPORT — finds LinkedIn profiles via Bing/DuckDuckGo
// Bypasses LinkedIn's Commercial Use Limit entirely!
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search the web for LinkedIn profile URLs matching the query.
 * Opens search engine in an ACTIVE tab (so it loads without throttling), scrapes
 * the DOM, then closes it. Active tab briefly steals focus but completes in 3-5s.
 */
async function searchWebForLinkedInProfiles(keywords, maxResults = 50) {
  const query = `site:linkedin.com/in ${keywords}`;
  console.log(`[LI Outreach Web] === SEARCH START === query="${query}", max=${maxResults}`);

  const allLeads = new Map();

  // Try Google first — better quality results, less aggressive bot detection on first query
  const googleResult = await searchEngine('google', query, Math.min(maxResults, 100));
  console.log(`[LI Outreach Web] Google → ${googleResult.leads.length} leads. Debug:`, googleResult.debug);
  for (const lead of googleResult.leads) {
    if (!allLeads.has(lead.linkedin_url)) allLeads.set(lead.linkedin_url, lead);
  }

  // If Google failed or returned little, try Bing
  if (allLeads.size < 5) {
    console.log('[LI Outreach Web] Google returned few results, trying Bing…');
    const bingResult = await searchEngine('bing', query, Math.min(maxResults, 50));
    console.log(`[LI Outreach Web] Bing → ${bingResult.leads.length} leads. Debug:`, bingResult.debug);
    for (const lead of bingResult.leads) {
      if (!allLeads.has(lead.linkedin_url)) allLeads.set(lead.linkedin_url, lead);
    }
  }

  // Last resort: DuckDuckGo
  if (allLeads.size < 5) {
    console.log('[LI Outreach Web] Trying DuckDuckGo…');
    const ddgResult = await searchEngine('ddg', query, maxResults);
    console.log(`[LI Outreach Web] DDG → ${ddgResult.leads.length} leads. Debug:`, ddgResult.debug);
    for (const lead of ddgResult.leads) {
      if (!allLeads.has(lead.linkedin_url)) allLeads.set(lead.linkedin_url, lead);
    }
  }

  const final = Array.from(allLeads.values()).slice(0, maxResults);
  console.log(`[LI Outreach Web] === SEARCH DONE === ${final.length} unique leads`);
  return final;
}

async function searchEngine(engine, query, count) {
  let url;
  if (engine === 'google') {
    url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(100, count)}&hl=en`;
  } else if (engine === 'bing') {
    url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(50, count)}`;
  } else if (engine === 'ddg') {
    url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&kl=us-en`;
  } else {
    return { leads: [], debug: { error: 'unknown engine' } };
  }

  console.log(`[LI Outreach Web] Opening ${engine} tab (active=true): ${url.substring(0, 120)}`);
  const tab = await chrome.tabs.create({ url, active: true });

  try {
    await waitForTabLoad(tab.id);

    // Poll until results actually rendered (look for <cite> with linkedin OR <h3>)
    // Search engines load skeleton first, then results — give them time
    const polledOk = await waitForSearchResultsRendered(tab.id, 8000);
    console.log(`[LI Outreach Web] Results ready after polling: ${polledOk}`);
    if (!polledOk) await sleep(2000); // extra grace period

    const result = await scrapeSearchEngineTab(tab.id, engine);
    return result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Poll until search results contain at least one LinkedIn-referencing element.
 * Returns true if rendered, false if timeout.
 */
async function waitForSearchResultsRendered(tabId, timeoutMs = 8000) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (timeoutMs) => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          // Look for any element that contains "linkedin.com" text
          const cites = Array.from(document.querySelectorAll('cite, h3, a'));
          const found = cites.some(el => {
            const t = el.textContent || '';
            const h = el.getAttribute?.('href') || '';
            return t.toLowerCase().includes('linkedin.com') || h.includes('linkedin.com');
          });
          if (found) return true;
          await sleep(400);
        }
        return false;
      },
      args: [timeoutMs],
    });
    return !!injection?.result;
  } catch (e) {
    console.warn('[LI Outreach Web] waitForSearchResultsRendered failed:', e);
    return false;
  }
}

/**
 * Universal scraper that works for Google/Bing/DDG.
 * Extracts ALL linkedin.com/in/SLUG URLs from anchors + plain text + decoded redirects.
 */
async function scrapeSearchEngineTab(tabId, engine) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (engine) => {
        const leads = [];
        const seen = new Set();
        const blacklist = new Set([
          'me', 'in', 'UNAVAILABLE', 'headless', 'login', 'signup',
          'pub', 'directory', 'jobs', 'company', 'school', 'groups',
          'learning', 'feed', 'mynetwork', 'messaging',
        ]);

        function tryDecode(href) {
          // Bing: bing.com/ck/a?...&u=a1<base64>
          let m = href.match(/[?&]u=a1([A-Za-z0-9+/=_-]+)/);
          if (m) {
            try {
              let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
              while (b64.length % 4) b64 += '=';
              return atob(b64);
            } catch {}
          }
          // Google: /url?q=ACTUAL_URL&...
          m = href.match(/[?&]q=([^&]+)/);
          if (m && href.includes('/url')) {
            try { return decodeURIComponent(m[1]); } catch {}
          }
          // DDG: /l/?uddg=ACTUAL_URL
          m = href.match(/[?&]uddg=([^&]+)/);
          if (m) {
            try { return decodeURIComponent(m[1]); } catch {}
          }
          return href;
        }

        function tryAddFromUrl(url, contextEl) {
          const m = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]{2,100})/i);
          if (!m) return;
          // Trim any trailing punctuation/fragment markers (#, /, etc.)
          const slug = m[1].replace(/[^a-zA-Z0-9_-]+$/, '').toLowerCase();
          if (!slug || slug.length < 3 || blacklist.has(slug)) return;
          const cleanUrl = `https://www.linkedin.com/in/${slug}`;
          if (seen.has(cleanUrl)) return;
          seen.add(cleanUrl);

          // Extract name/title from context
          let firstName = '', lastName = '', title = '';
          if (contextEl) {
            const text = (contextEl.textContent || '').trim().substring(0, 250);
            const titleMatch = text.match(/^([^-|·—]+)\s*[-—|·]\s*([^|]+?)(?:\s*[-—|·]\s*LinkedIn|\s*\|\s*LinkedIn|$)/);
            if (titleMatch) {
              const parts = titleMatch[1].trim().split(/\s+/);
              firstName = parts[0] || '';
              lastName = parts.slice(1).join(' ');
              title = titleMatch[2].trim().substring(0, 100);
            }
          }

          leads.push({ linkedin_url: cleanUrl, first_name: firstName, last_name: lastName, title, company: '' });
        }

        // Strategy 1: all anchors (after decoding redirects)
        const anchors = document.querySelectorAll('a[href]');
        anchors.forEach(a => {
          const decoded = tryDecode(a.href || '');
          const context = a.closest('div.g, li.b_algo, .b_algo, article, .result, [data-hveid], [jscontroller]') || a.parentElement;
          tryAddFromUrl(decoded, context);
          // Also check data-* attributes that might contain destination URLs
          for (const attr of a.attributes) {
            if (attr.name.startsWith('data-') && attr.value.includes('linkedin.com')) {
              tryAddFromUrl(attr.value, context);
            }
          }
        });

        // Strategy 2: scan visible <cite> elements (Google/Bing show URL as cite)
        document.querySelectorAll('cite').forEach(cite => {
          // Google cite shows "linkedin.com › in › slug" — replace › with /
          const text = (cite.textContent || '')
            .replace(/[›»]/g, '/')
            .replace(/\s+/g, '');
          tryAddFromUrl(text, cite.closest('div.g, article, .result, .b_algo'));
        });

        // Strategy 3: regex over entire body innerHTML (most permissive)
        const bodyHtml = document.body?.innerHTML || '';
        const re = /linkedin\.com[/\\]+in[/\\]+([a-zA-Z0-9_%-]{3,100})/gi;
        let match;
        while ((match = re.exec(bodyHtml)) !== null) {
          let slug = match[1].replace(/[^a-zA-Z0-9_-]+$/, '');
          try { slug = decodeURIComponent(slug); } catch {}
          if (!slug || slug.length < 3 || blacklist.has(slug.toLowerCase())) continue;
          const cleanUrl = `https://www.linkedin.com/in/${slug}`;
          if (seen.has(cleanUrl)) continue;
          seen.add(cleanUrl);
          leads.push({ linkedin_url: cleanUrl, first_name: '', last_name: '', title: '', company: '' });
        }

        // Strategy 4: scan inline <script> tags for JSON-embedded URLs
        document.querySelectorAll('script').forEach(s => {
          const txt = s.textContent || '';
          if (!txt.includes('linkedin.com/in/')) return;
          const r2 = /linkedin\.com[\\\/]+in[\\\/]+([a-zA-Z0-9_%-]{3,100})/gi;
          let m;
          while ((m = r2.exec(txt)) !== null) {
            let slug = m[1].replace(/[^a-zA-Z0-9_-]+$/, '');
            try { slug = decodeURIComponent(slug); } catch {}
            if (!slug || slug.length < 3 || blacklist.has(slug.toLowerCase())) continue;
            const cleanUrl = `https://www.linkedin.com/in/${slug}`;
            if (seen.has(cleanUrl)) continue;
            seen.add(cleanUrl);
            leads.push({ linkedin_url: cleanUrl, first_name: '', last_name: '', title: '', company: '' });
          }
        });

        return {
          leads,
          debug: {
            engine,
            url: location.href,
            title: document.title,
            totalAnchors: anchors.length,
            bodyLength: bodyHtml.length,
            sampleHrefs: Array.from(anchors).slice(0, 10).map(a => (a.href || '').substring(0, 100)),
            bodyContainsLinkedIn: bodyHtml.includes('linkedin.com'),
            bodyContainsInPath: bodyHtml.includes('linkedin.com/in/'),
          },
        };
      },
      args: [engine],
    });
    return injection?.result || { leads: [], debug: { error: 'no result' } };
  } catch (e) {
    console.error(`[LI Outreach Web] ${engine} scrape failed:`, e);
    return { leads: [], debug: { error: e.message } };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH WEB SEARCH — keyword × location combinations for thousands of leads
// ═══════════════════════════════════════════════════════════════════════════

let _batchStopRequested = false;

async function runBatchWebSearch(keywords, locations, campaignId, accountId, apiUrl, apiToken) {
  _batchStopRequested = false;

  const allLeads = new Map(); // dedupe across all queries
  const queries = [];
  for (const kw of keywords) {
    for (const loc of locations) {
      queries.push({ kw, loc });
    }
  }

  const sendProgress = (text, done = false) => {
    chrome.runtime.sendMessage({ type: 'LI_OUTREACH_BATCH_PROGRESS', text, done }).catch(() => {});
  };

  sendProgress(`🚀 Starting batch: ${queries.length} queries…`);

  let perQueryMax = 50; // Per-query cap — Google rarely gives more

  for (let i = 0; i < queries.length; i++) {
    if (_batchStopRequested) {
      sendProgress(`⏹ Stopped at ${i}/${queries.length}. ${allLeads.size} unique leads collected.`, false);
      break;
    }

    const { kw, loc } = queries[i];
    const fullQuery = `"${kw}" "${loc}"`;

    sendProgress(`🔎 [${i + 1}/${queries.length}] "${kw}" "${loc}" | ${allLeads.size} leads so far…`);
    console.log(`[Batch] Query ${i + 1}/${queries.length}: ${fullQuery}`);

    try {
      const leads = await searchWebForLinkedInProfiles(fullQuery, perQueryMax);
      let newCount = 0;
      for (const lead of leads) {
        if (!allLeads.has(lead.linkedin_url)) {
          allLeads.set(lead.linkedin_url, lead);
          newCount++;
        }
      }
      console.log(`[Batch] Query ${i + 1} → ${leads.length} found, +${newCount} new, total ${allLeads.size}`);

      // Push to backend every 50 new leads to avoid losing progress
      if (allLeads.size > 0 && (i % 3 === 0 || i === queries.length - 1)) {
        await pushBatchToBackend(Array.from(allLeads.values()), campaignId, accountId, apiUrl, apiToken);
      }
    } catch (e) {
      console.error(`[Batch] Query ${i + 1} failed:`, e);
    }

    // Delay between queries to avoid rate-limiting search engines
    if (i < queries.length - 1 && !_batchStopRequested) {
      await sleep(2000 + Math.random() * 1500);
    }
  }

  // Final push
  if (allLeads.size > 0) {
    const result = await pushBatchToBackend(Array.from(allLeads.values()), campaignId, accountId, apiUrl, apiToken);
    sendProgress(`✅ Done! ${queries.length} queries → ${allLeads.size} unique leads → added ${result.totalAdded} new (${result.totalSkipped} dups)`, true);
    chrome.action.setBadgeText({ text: `+${result.totalAdded}` });
    chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 60000);
  } else {
    sendProgress(`⚠️ Done — no leads found across ${queries.length} queries`, true);
  }
}

let _batchPushedSet = new Set(); // tracks which URLs already sent to backend

async function pushBatchToBackend(allLeadsArray, campaignId, accountId, apiUrl, apiToken) {
  // Only push leads that haven't been pushed yet
  const fresh = allLeadsArray.filter(l => !_batchPushedSet.has(l.linkedin_url));
  if (fresh.length === 0) return { totalAdded: 0, totalSkipped: 0 };

  let totalAdded = 0, totalSkipped = 0;
  for (let i = 0; i < fresh.length; i += 50) {
    const chunk = fresh.slice(i, i + 50);
    try {
      const res = await fetch(`${apiUrl}/api/extension/import-leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify({ campaign_id: campaignId, account_id: accountId, leads: chunk }),
      });
      if (res.ok) {
        const data = await res.json();
        totalAdded += data.added || 0;
        totalSkipped += data.skipped || 0;
        for (const l of chunk) _batchPushedSet.add(l.linkedin_url);
      }
    } catch (e) {
      console.error('[Batch] Backend push failed:', e);
    }
  }
  return { totalAdded, totalSkipped };
}

// Batch message handlers
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'LI_OUTREACH_BATCH_START') {
    // Validate apiUrl to prevent SSRF — only allow http(s)://localhost or configured backend
    const urlOk = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(message.apiUrl || '');
    if (!urlOk) {
      console.error('[Batch] Rejected unsafe apiUrl:', message.apiUrl);
      chrome.runtime.sendMessage({ type: 'LI_OUTREACH_BATCH_PROGRESS', text: '❌ Invalid backend URL', done: true }).catch(() => {});
      return;
    }
    _batchPushedSet = new Set(); // reset dedup tracking for new batch
    runBatchWebSearch(
      message.keywords,
      message.locations,
      message.campaignId,
      message.accountId,
      message.apiUrl,
      message.apiToken,
    ).catch(e => {
      console.error('[Batch] Crashed:', e);
      chrome.runtime.sendMessage({ type: 'LI_OUTREACH_BATCH_PROGRESS', text: `❌ Crashed: ${e.message}`, done: true }).catch(() => {});
    });
    return;
  }
  if (message.type === 'LI_OUTREACH_BATCH_STOP') {
    _batchStopRequested = true;
    return;
  }
});

// ── Message handler for popup-triggered web search ────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'LI_OUTREACH_WEB_SEARCH') return;

  function showResultNotification(title, msg, color) {
    // chrome.notifications requires a real PNG file URL — data: URIs don't work in MV3.
    // Skip notification entirely, rely on badge + popup progress instead.
    const badgeText = color === 'green' ? '✓' : '!';
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: color === 'green' ? '#28a745' : '#dc3545' });
    chrome.action.setTitle({ title: `${title}\n${msg}` });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'LI Outreach' });
    }, 30000);
    console.log(`[LI Outreach] ${title}: ${msg}`);
  }

  searchWebForLinkedInProfiles(message.keywords, message.maxResults || 50)
    .then(async (leads) => {
      if (leads.length === 0) {
        const err = 'Web search returned no LinkedIn profiles. Try different keywords or check service worker console.';
        showResultNotification('LI Outreach — Web Search', '❌ 0 profiles found', 'red');
        sendResponse({ ok: false, error: err, leads: [] });
        return;
      }

      // Send leads to backend
      try {
        const res = await fetch(`${message.apiUrl}/api/extension/import-leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${message.apiToken}` },
          body: JSON.stringify({
            campaign_id: message.campaignId,
            account_id: message.accountId,
            leads,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          const err = `Backend HTTP ${res.status}: ${errBody.substring(0, 100)}`;
          showResultNotification('LI Outreach — Backend Error', err, 'red');
          sendResponse({ ok: false, error: err, leads });
          return;
        }

        const data = await res.json();
        const summary = `Found ${leads.length}, added ${data.added || 0} (${data.skipped || 0} duplicates)`;
        showResultNotification('LI Outreach — Web Search Done ✅', summary, 'green');
        sendResponse({ ok: true, leads, added: data.added || 0, skipped: data.skipped || 0 });
      } catch (e) {
        showResultNotification('LI Outreach — Error', e.message, 'red');
        sendResponse({ ok: false, error: `Backend error: ${e.message}`, leads });
      }
    })
    .catch(e => {
      showResultNotification('LI Outreach — Error', e.message, 'red');
      sendResponse({ ok: false, error: e.message, leads: [] });
    });

  return true; // keep channel open for async response
});

// ── Main polling loop ─────────────────────────────────────────────────────────

async function tick() {
  const { apiUrl, apiToken, accountId } = await getConfig();

  if (!apiUrl || !apiToken || !accountId) {
    console.log('[LI Outreach] Not configured — skipping tick');
    return;
  }

  await sendHeartbeat(apiUrl, apiToken, accountId);

  if (isProcessing) {
    console.log('[LI Outreach] Still processing — skipping poll');
    return;
  }

  try {
    const data = await pollForTask(apiUrl, apiToken, accountId);
    if (data && data.task) {
      isProcessing = true;
      try {
        await processTask(data.task, apiUrl, apiToken);
      } finally {
        isProcessing = false;
      }
    }
  } catch (e) {
    console.error('[LI Outreach] Poll error:', e.message);
    isProcessing = false;
  }
}

// ── Alarms ────────────────────────────────────────────────────────────────────

chrome.alarms.create('li-outreach-tick', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'li-outreach-tick') tick();
});

tick();

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  // Voyager leads captured passively by content.js (auto-capture mode — legacy)
  if (message.type === 'LI_OUTREACH_VOYAGER_LEADS') {
    const leads = message.leads;
    if (!leads || leads.length === 0) return;

    chrome.storage.local.get(['autoCaptureCampaign', 'apiUrl', 'apiToken', 'accountId'], (cfg) => {
      if (!cfg.autoCaptureCampaign || !cfg.apiUrl || !cfg.apiToken) return;

      fetch(`${cfg.apiUrl}/api/extension/import-leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiToken}`,
        },
        body: JSON.stringify({
          campaign_id: cfg.autoCaptureCampaign,
          account_id: cfg.accountId,
          leads,
        }),
      }).then(r => r.json()).then(data => {
        if (data.added > 0) {
          console.log(`[LI Outreach] Auto-imported ${data.added} leads`);
          chrome.action.setBadgeText({ text: `+${data.added}` });
          chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
          setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
        }
      }).catch(e => console.warn('[LI Outreach] Auto-import failed:', e.message));
    });
    return;
  }

  // Active bulk import triggered from popup
  if (message.type === 'LI_OUTREACH_START_IMPORT') {
    const { searchUrl, campaignId, accountId, apiUrl, apiToken, maxLeads } = message;
    importLeadsFromSearch(searchUrl, campaignId, accountId, apiUrl, apiToken, maxLeads)
      .catch(e => {
        console.error('[LI Outreach] Import crashed:', e.message);
        reportProgress(`❌ Import error: ${e.message}`, true);
      });
    return;
  }
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
