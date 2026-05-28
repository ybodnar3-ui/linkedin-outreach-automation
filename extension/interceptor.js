/**
 * interceptor.js — MAIN world (same JS context as LinkedIn's code)
 * Intercepts window.fetch and XHR, extracts leads, sends via window.postMessage.
 * postMessage is the ONLY reliable way to communicate from MAIN world to isolated content script.
 */
(function () {
  'use strict';

  console.log('[LI Outreach] interceptor.js loaded in MAIN world ✓');

  // ── Lead extractor — handles BOTH old Voyager and new GraphQL response formats ────
  function extractLeads(data) {
    const leads = [];
    const seen = new Set();

    function isValidSlug(slug) {
      return slug &&
        typeof slug === 'string' &&
        slug.length > 2 &&
        slug !== 'UNAVAILABLE' &&
        slug !== 'headless' &&
        !slug.startsWith('ACoA'); // skip raw entity URN ids
    }

    function addLead(slug, firstName, lastName, title) {
      if (!isValidSlug(slug)) return;
      if (seen.has(slug)) return;
      seen.add(slug);
      let fn = firstName || '';
      let ln = lastName || '';
      if (!ln && fn.includes(' ')) {
        const parts = fn.split(/\s+/).filter(Boolean);
        fn = parts[0] || '';
        ln = parts.slice(1).join(' ');
      }
      leads.push({
        linkedin_url: `https://www.linkedin.com/in/${slug}`,
        first_name: fn,
        last_name: ln,
        title: title || '',
        company: '',
      });
    }

    function parseSlugFromUrl(url) {
      if (!url || typeof url !== 'string') return null;
      const m = url.match(/\/in\/([^/?#&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }

    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach(walk); return; }

      // Format 1: Classic Voyager — publicIdentifier
      if (obj.publicIdentifier && typeof obj.publicIdentifier === 'string') {
        addLead(obj.publicIdentifier, obj.firstName, obj.lastName, obj.headline);
      }

      // Format 2: Modern GraphQL — navigationUrl + title.text
      if (obj.navigationUrl && typeof obj.navigationUrl === 'string') {
        const slug = parseSlugFromUrl(obj.navigationUrl);
        if (slug) {
          const fullName = (obj.title && obj.title.text) || '';
          const titleText =
            (obj.primarySubtitle && obj.primarySubtitle.text) ||
            (obj.headline && obj.headline.text) || '';
          addLead(slug, fullName, '', titleText);
        }
      }

      // Format 3: vanityName field (some endpoints use this)
      if (obj.vanityName && typeof obj.vanityName === 'string') {
        addLead(obj.vanityName, obj.firstName, obj.lastName, obj.headline);
      }

      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') walk(v);
      }
    }

    walk(data);
    return leads;
  }

  function isVoyagerSearch(url) {
    if (!url) return false;
    return url.includes('/voyager/api/search/blended') ||
           url.includes('/voyager/api/search/hits') ||
           url.includes('/voyager/api/search/dash/clusters') ||
           (url.includes('/voyager/api/graphql') &&
            (url.includes('Cluster') || url.includes('searchDash') || url.includes('SearchCluster')));
  }

  function sendLeads(url, leads) {
    if (!leads.length) {
      console.log('[LI Outreach interceptor] 0 leads from', url.substring(0, 100));
      return;
    }
    console.log(`[LI Outreach interceptor] Extracted ${leads.length} leads from`, url.substring(0, 100));
    window.postMessage({ __liOutreach: true, type: 'LEADS', leads, url }, '*');
    try { sessionStorage.setItem('_liVoyagerUrl', url); } catch {}
  }

  // ── Intercept fetch ───────────────────────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await _origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (isVoyagerSearch(url)) {
        response.clone().json().then(data => {
          sendLeads(url, extractLeads(data));
        }).catch(err => {
          console.warn('[LI Outreach interceptor] JSON parse error:', err.message);
        });
      }
    } catch (e) {
      console.warn('[LI Outreach interceptor] fetch hook error:', e.message);
    }
    return response;
  };

  // ── Intercept XHR ────────────────────────────────────────────────────────
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__liUrl = url;
    return _origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      if (isVoyagerSearch(this.__liUrl)) {
        try {
          const data = JSON.parse(this.responseText);
          sendLeads(this.__liUrl, extractLeads(data));
        } catch (e) {
          console.warn('[LI Outreach interceptor] XHR parse error:', e.message);
        }
      }
    });
    return _origSend.apply(this, arguments);
  };
})();
