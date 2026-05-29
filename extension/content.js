/**
 * content.js — LI Outreach Content Script
 * Runs on linkedin.com pages.
 * Receives action commands from background.js and executes DOM operations.
 */

'use strict';

// ── Message listener ──────────────────────────────────────────────────────────

// ── Receive data from interceptor.js (MAIN world) via window.postMessage ─────
// postMessage is the only reliable cross-world communication in Chrome extensions.

let _lastVoyagerUrl = null;
let _lastVoyagerCsrf = null;

window.addEventListener('message', (e) => {
  // Only accept messages from our interceptor (same origin, has __liOutreach flag)
  if (!e.data?.__liOutreach) return;

  if (e.data.type === 'LEADS' && Array.isArray(e.data.leads) && e.data.leads.length > 0) {
    if (e.data.url) {
      _lastVoyagerUrl = e.data.url;
      try { sessionStorage.setItem('_liVoyagerUrl', e.data.url); } catch {}
    }
    chrome.runtime.sendMessage({
      type: 'LI_OUTREACH_VOYAGER_LEADS',
      leads: e.data.leads,
    }).catch(() => {});
  }
});

function extractLeadsFromVoyager(data) {
  const leads = [];
  const seen = new Set();
  const str = JSON.stringify(data);

  // Extract publicIdentifier + firstName + lastName from the JSON blob
  // LinkedIn's voyager response nests profiles in various places
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }

    if (obj.publicIdentifier && typeof obj.publicIdentifier === 'string') {
      const slug = obj.publicIdentifier;
      if (!seen.has(slug) && slug.length > 2) {
        seen.add(slug);
        const firstName = obj.firstName || '';
        const lastName = obj.lastName || '';
        const title = obj.headline || '';
        leads.push({
          linkedin_url: `https://www.linkedin.com/in/${slug}`,
          first_name: firstName,
          last_name: lastName,
          title,
          company: '',
        });
      }
    }
    Object.values(obj).forEach(walk);
  }

  walk(data);
  return leads;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Return the captured Voyager URL so background.js can paginate it
  if (message.type === 'LI_OUTREACH_GET_VOYAGER_URL') {
    let url  = _lastVoyagerUrl  || sessionStorage.getItem('_liVoyagerUrl')  || null;
    let csrf = _lastVoyagerCsrf || sessionStorage.getItem('_liVoyagerCsrf') || null;

    if (!url) {
      // Fallback: scan ALL browser network requests (even ones before content.js loaded)
      // performance.getEntriesByType('resource') includes fetch/XHR calls with full URLs
      try {
        const entries = performance.getEntriesByType('resource');
        const entry = entries
          .filter(e => e.name.includes('/voyager/api/search/blended'))
          .pop(); // most recent
        if (entry) {
          url = entry.name;
          _lastVoyagerUrl = url;
          try { sessionStorage.setItem('_liVoyagerUrl', url); } catch {}
        }
      } catch {}
    }

    sendResponse({ url, csrf });
    return true;
  }

  if (message.type === 'LI_OUTREACH_SCRAPE_SEARCH') {
    const leads = scrapeSearchResults();
    sendResponse({ leads });
    return true;
  }

  if (message.type !== 'LI_OUTREACH_EXECUTE') return;

  executeAction(message.action, message.payload)
    .then(result => sendResponse(result))
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true; // Keep message channel open for async response
});

// ── Action dispatcher ─────────────────────────────────────────────────────────

async function executeAction(action, payload) {
  console.log('[LI Outreach] Executing action:', action);
  try {
    switch (action) {
      case 'visit_profile':    return await visitProfile();
      case 'send_connection':  return await sendConnection(payload.note);
      case 'send_message':     return await sendMessage(payload.messageText);
      case 'check_connection': return await checkConnection();
      case 'follow_profile':   return await followProfile();
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    console.error('[LI Outreach] Action error:', err);
    return { success: false, error: err.message };
  }
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Find a button whose trimmed text content starts with (or equals) the given text.
 * LinkedIn sometimes adds icons inside buttons so we check startsWith.
 */
function findButton(text) {
  const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
  return btns.find(b => {
    const label = (b.getAttribute('aria-label') || b.ariaLabel || '').trim();
    const textContent = (b.textContent || '').trim();
    return label === text || label.startsWith(text) ||
           textContent === text || textContent.startsWith(text);
  }) || null;
}

/**
 * Wait for an element matching selector to appear, up to timeoutMs.
 */
function waitForElement(selector, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { obs.disconnect(); clearTimeout(timer); resolve(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`Element not found: ${selector}`));
    }, timeoutMs);
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function visitProfile() {
  // Just landing on the page counts as a visit
  await sleep(2000);
  return { success: true };
}

async function checkConnection() {
  await sleep(1500);

  // "Message" button = connected
  if (findButton('Message')) {
    return { success: true, connection_status: 'connected' };
  }

  // Pending state — various LinkedIn labels
  const bodyText = document.body.innerText;
  if (
    findButton('Pending') ||
    document.querySelector('[aria-label*="Pending"]') ||
    bodyText.includes('Invitation sent') ||
    bodyText.includes('pending')
  ) {
    return { success: true, connection_status: 'pending' };
  }

  // Connect button = not yet connected
  if (findButton('Connect')) {
    return { success: true, connection_status: 'not_connected' };
  }

  return { success: true, connection_status: 'unknown' };
}

/**
 * Find a button by aria-label or text, with broader matching for LinkedIn's varied button structures.
 */
function findConnectButton() {
  const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
  // First: exact aria-label match for "Connect" or "Invite ... to connect"
  for (const b of btns) {
    const label = (b.getAttribute('aria-label') || '').trim();
    if (label === 'Connect' || /^Connect with /i.test(label) || /^Invite .+ to connect/i.test(label)) {
      return b;
    }
  }
  // Second: button text starts with "Connect"
  for (const b of btns) {
    const text = (b.textContent || '').trim();
    if (text === 'Connect' || text.startsWith('Connect')) {
      return b;
    }
  }
  return null;
}

async function waitForProfileActions(timeoutMs = 10000) {
  // Wait until at least one action button (Connect / Message / Follow / More) appears
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hasActions = findConnectButton() ||
      findButton('Message') ||
      findButton('Follow') ||
      findButton('More') ||
      document.querySelector('[data-control-name="connect"]') ||
      document.querySelector('.pvs-profile-actions button') ||
      document.querySelector('.pv-top-card-v2-ctas button');
    if (hasActions) return true;
    await sleep(800);
  }
  return false;
}

async function sendConnection(note) {
  // Wait for LinkedIn profile action buttons to render
  await waitForProfileActions();
  await sleep(1000); // extra settle time

  // Check if already connected / pending
  if (findButton('Message')) {
    return { success: true, sent: false, reason: 'already_connected' };
  }
  if (findButton('Pending') || document.querySelector('[aria-label*="Pending"]') || document.body.innerText.includes('Invitation sent')) {
    return { success: true, sent: false, reason: 'already_pending' };
  }

  // Click the Connect button (direct or via "More" dropdown)
  let connectBtn = findConnectButton();
  if (!connectBtn) {
    // Try behind "More" dropdown
    const moreBtn = findButton('More');
    if (moreBtn) {
      moreBtn.click();
      await sleep(1200);
      connectBtn = findConnectButton();
    }
    if (!connectBtn) {
      // Last resort: try data-control-name
      connectBtn = document.querySelector('[data-control-name="connect"]');
    }
    if (!connectBtn) {
      const pageSnippet = document.body.innerText.substring(0, 300);
      return { success: false, error: `Connect button not found. Page snippet: ${pageSnippet}` };
    }
  }
  connectBtn.click();

  await sleep(1500);

  // Handle the "How do you know X?" modal — click Connect directly
  const connectDirectly = findButton('Connect');
  if (connectDirectly) {
    connectDirectly.click();
    await sleep(1000);
  }

  // If a note is provided, try to add it
  if (note) {
    const addNoteBtn = findButton('Add a note');
    if (addNoteBtn) {
      addNoteBtn.click();
      await sleep(800);

      // Find note textarea
      const textarea = document.querySelector('#custom-message') ||
                       document.querySelector('textarea[name="message"]') ||
                       document.querySelector('textarea[placeholder]');
      if (textarea) {
        textarea.focus();
        textarea.value = note;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(400);
      }
    }
  }

  // Click Send / Send invitation
  const sendBtn = findButton('Send invitation') || findButton('Send');
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
    await sleep(1500);
    return { success: true, sent: true };
  }

  // If we ended up on "Send without a note"
  const sendWithoutNote = findButton('Send without a note');
  if (sendWithoutNote) {
    sendWithoutNote.click();
    await sleep(1500);
    return { success: true, sent: true };
  }

  return { success: false, error: 'Send button not found after clicking Connect' };
}

async function sendMessage(messageText) {
  if (!messageText) return { success: false, error: 'No message text provided' };

  // Find the Message button on the profile
  const messageBtn = findButton('Message');
  if (!messageBtn) {
    return { success: false, error: 'Message button not found — lead may not be connected' };
  }
  messageBtn.click();
  await sleep(2000);

  // LinkedIn message compose box (contenteditable div)
  let msgBox = null;
  try {
    msgBox = await waitForElement('.msg-form__contenteditable', 5000);
  } catch {
    // fallback selectors
    msgBox = document.querySelector('[data-placeholder="Write a message…"]') ||
             document.querySelector('[role="textbox"][aria-label]');
  }

  if (!msgBox) {
    return { success: false, error: 'Message compose box not found' };
  }

  // Clear and type the message
  msgBox.focus();
  // For contenteditable divs we set innerHTML; dispatch input event so React/Vue picks it up
  msgBox.innerHTML = '';
  document.execCommand('insertText', false, messageText);
  msgBox.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(600);

  // Click Send
  const sendBtn = document.querySelector('.msg-form__send-button') ||
                  document.querySelector('button[type="submit"]') ||
                  findButton('Send');

  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
    await sleep(1500);
    return { success: true, sent: true };
  }

  return { success: false, error: 'Send button not found in message composer' };
}

// ── LinkedIn Search Scraper ───────────────────────────────────────────────────

function scrapeSearchResults() {
  const leads = [];
  const seen = new Set();

  function addLead(url, firstName, lastName, title, company, location) {
    const clean = url.split('?')[0].replace(/\/$/, '');
    if (!clean.match(/linkedin\.com\/in\/[^/]+$/) || seen.has(clean)) return;
    seen.add(clean);
    const atIdx = (title || '').indexOf(' at ');
    const t = atIdx > 0 ? title.slice(0, atIdx).trim() : (title || '');
    const c = atIdx > 0 ? title.slice(atIdx + 4).trim() : (company || '');
    leads.push({ linkedin_url: clean, first_name: firstName || '', last_name: lastName || '', title: t, company: c, location: location || '' });
  }

  // ── Strategy 1: visible <a href="/in/..."> links ───────────────────────────
  document.querySelectorAll('a[href*="/in/"]').forEach(link => {
    if (!link.href.match(/linkedin\.com\/in\/[^/]+/)) return;
    const container = link.closest('li.reusable-search__result-container, li[class*="result"], [data-view-name]');
    let name = '', rawTitle = '', location = '';
    if (container) {
      const nameEl = container.querySelector('.entity-result__title-text a span[aria-hidden="true"]') ||
                     container.querySelector('.app-aware-link span[aria-hidden="true"]');
      name = (nameEl?.textContent || link.textContent || '').trim().replace('LinkedIn Member', '').trim();
      rawTitle = (container.querySelector('.entity-result__primary-subtitle')?.textContent || '').trim();
      location = (container.querySelector('.entity-result__secondary-subtitle')?.textContent || '').trim();
    }
    const parts = name.split(' ').filter(Boolean);
    addLead(link.href, parts[0], parts.slice(1).join(' '), rawTitle, '', location);
  });

  // ── Strategy 2: extract from embedded JSON (voyager data in <code> tags) ──
  document.querySelectorAll('code[id^="bpr-guid"]').forEach(el => {
    try {
      const json = JSON.parse(el.textContent || '{}');
      const str = JSON.stringify(json);
      // Find all publicIdentifier values (LinkedIn usernames)
      const matches = str.matchAll(/"publicIdentifier"\s*:\s*"([^"]+)"/g);
      for (const m of matches) {
        const slug = m[1];
        if (!slug || slug.length < 3) continue;
        addLead(`https://www.linkedin.com/in/${slug}`, '', '', '', '', '');
      }
      // Also find firstName/lastName near publicIdentifier
      const entities = str.matchAll(/"firstName"\s*:\s*"([^"]*)","lastName"\s*:\s*"([^"]*)"/g);
      for (const m of entities) {
        // These might not be paired with a URL easily, skip for now
      }
    } catch {}
  });

  // ── Strategy 3: extract from window.__SSR_DATA__ or similar globals ────────
  try {
    const pageText = document.documentElement.innerHTML;
    const slugs = pageText.matchAll(/\/in\/([\w-]{3,100})(?:\/|"|'|\?)/g);
    for (const m of slugs) {
      const slug = m[1];
      if (/^(search|jobs|company|school|groups|learning)$/.test(slug)) continue;
      addLead(`https://www.linkedin.com/in/${slug}`, '', '', '', '', '');
    }
  } catch {}

  return leads;
}

async function followProfile() {
  const followBtn = findButton('Follow');
  if (!followBtn) {
    return { success: false, error: 'Follow button not found' };
  }
  followBtn.click();
  await sleep(1000);
  return { success: true };
}
