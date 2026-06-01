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
  console.log('[LI Outreach] Executing action:', action, payload);

  // Safety check: detect LinkedIn security/CAPTCHA screens before doing anything
  const warning = detectPageWarning();
  if (warning) {
    console.warn('[LI Outreach] Page warning detected — aborting action:', warning);
    return { success: false, error: `LinkedIn warning: ${warning}`, warning: true };
  }

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

/**
 * Detects LinkedIn security/CAPTCHA/restriction warnings.
 * Returns a warning string if found, null if page is clean.
 */
function detectPageWarning() {
  const url = window.location.href;
  if (url.includes('/checkpoint/')) return 'checkpoint_page';
  if (url.includes('/authwall'))    return 'authwall';

  const bodyText = document.body.innerText || '';
  if (bodyText.includes("Let's do a quick security check")) return 'captcha';
  if (bodyText.includes("Your account has been restricted"))  return 'account_restricted';
  if (bodyText.includes("You've reached the weekly invitation limit")) return 'weekly_invite_limit';
  if (bodyText.includes("you might be experiencing an issue")) return 'possible_issue';
  return null;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Find a button whose trimmed text content starts with (or equals) the given text.
 * LinkedIn sometimes adds icons inside buttons so we check startsWith.
 */
/**
 * Find any clickable element whose visible text or aria-label matches.
 * Uses querySelectorAll('*') to handle LinkedIn's non-standard HTML structures.
 */
function findButton(text) {
  const lowerText = text.toLowerCase();
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    const isClickable = tag === 'button' || tag === 'a' ||
      el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'link';
    if (!isClickable) continue;

    // Check aria-label first (most reliable)
    const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (label === lowerText || label.startsWith(lowerText + ' ')) return el;

    // Check visible text via innerText (skips SVG, hidden nodes)
    const inner = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (inner === lowerText) return el;

    // Check artdeco span inside (LinkedIn's button text wrapper)
    const span = el.querySelector('.artdeco-button__text');
    if (span) {
      const spanText = (span.innerText || span.textContent || '').trim().toLowerCase();
      if (spanText === lowerText || spanText.startsWith(lowerText)) return el;
    }
  }
  return null;
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
  // Collect all Connect-like buttons/links on the page
  const allConnectBtns = [];
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'button' && tag !== 'a' && el.getAttribute('role') !== 'button') continue;
    const label = (el.getAttribute('aria-label') || '').trim();
    const inner = (el.innerText || '').replace(/\s+/g, ' ').trim();
    const isConnect = label === 'Connect' || /^Connect with /i.test(label) ||
                      /^Invite .+ to connect/i.test(label) || inner === 'Connect';
    if (isConnect) allConnectBtns.push(el);
  }

  if (allConnectBtns.length === 0) return null;
  if (allConnectBtns.length === 1) return allConnectBtns[0];

  // Multiple Connect buttons — pick the one highest on the page (profile header)
  // Use getBoundingClientRect to find the topmost visible one
  let topBtn = null;
  let topY = Infinity;
  for (const btn of allConnectBtns) {
    const rect = btn.getBoundingClientRect();
    // Must be visible (not hidden) and in the upper portion of the page
    if (rect.width > 0 && rect.height > 0 && rect.top < topY) {
      topY = rect.top;
      topBtn = btn;
    }
  }
  return topBtn;
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

  const bodyText = document.body.innerText || '';

  // Check pending first (Invitation sent / Withdraw = already sent)
  const isPending = bodyText.includes('Invitation sent') ||
    !!document.querySelector('[aria-label*="Pending"i]') ||
    !!findButton('Pending') ||
    !!findButton('Withdraw');
  if (isPending) {
    return { success: true, sent: false, reason: 'already_pending' };
  }

  // Try to find Connect button directly first
  let connectBtn = findConnectButton();

  // If not found, try "More" dropdown
  if (!connectBtn) {
    const moreBtn = findButton('More');
    if (moreBtn) {
      moreBtn.click();
      await sleep(1200);
      connectBtn = findConnectButton();
    }
  }

  // If not found, try data-control-name fallback
  if (!connectBtn) {
    connectBtn = document.querySelector('[data-control-name="connect"]');
  }

  // No Connect button found — determine why
  if (!connectBtn) {
    const is2ndOr3rd = /·\s*(2nd|3rd)\b/i.test(bodyText);
    const hasMessage = /\bMessage\b/.test(bodyText);
    // 1st-degree: no degree badge + Message shown = already connected
    if (hasMessage && !is2ndOr3rd) {
      return { success: true, sent: false, reason: 'already_connected' };
    }
    // Return button labels only — avoid logging raw page body (contains PII)
    const btnsFound = Array.from(document.querySelectorAll('button, [role="button"], a.artdeco-button'))
      .map(b => (b.getAttribute('aria-label') || b.innerText || '').trim())
      .filter(t => t.length > 0 && t.length < 40)
      .slice(0, 20)
      .join(' | ');
    return { success: false, error: `Connect button not found. Buttons: ${btnsFound}` };
  }

  // Click the Connect button
  connectBtn.click();

  // Wait for modal to appear — poll up to 5s
  let modal = null;
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    modal = document.querySelector('[role="dialog"]') ||
            document.querySelector('.artdeco-modal') ||
            document.querySelector('.send-invite') ||
            document.querySelector('[class*="send-invite"]') ||
            document.querySelector('[data-test-modal-id]') ||
            // Find by Dismiss button's ancestor
            (() => { const d = findButtonLoose('Dismiss'); return d ? (d.closest('[class*="modal"], [class*="overlay"], [class*="dialog"]') || d.parentElement) : null; })();
    if (modal) break;
    // Also check if already sent (no modal needed)
    if (/Invitation sent|Pending/i.test(document.body.innerText)) {
      return { success: true, sent: true };
    }
  }

  // SAFETY: if no modal appeared, do NOT search the whole document for "Connect"
  // — the page has background "People you may know" Connect buttons and we'd
  // send a request to the wrong person. Abort instead.
  if (!modal) {
    // Maybe the request was already sent silently
    if (/Invitation sent|Pending/i.test(document.body.innerText)) {
      return { success: true, sent: true };
    }
    return { success: false, error: 'Connect modal did not appear after clicking Connect' };
  }

  // Helper: find button STRICTLY inside the modal (never falls back to document)
  function findInModal(text) {
    const lower = text.toLowerCase();
    for (const el of modal.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (tag !== 'button' && tag !== 'a' && el.getAttribute('role') !== 'button') continue;
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      if (label === lower || label.startsWith(lower)) return el;
      const inner = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (inner === lower || inner.startsWith(lower)) return el;
    }
    return null;
  }

  // Step 1: Handle "How do you know X?" modal if present
  const connectInModal = findInModal('Connect');
  if (connectInModal && connectInModal !== connectBtn) {
    connectInModal.click();
    await sleep(1200);
    // Re-find modal after click
    modal = document.querySelector('[role="dialog"]') || document.querySelector('.artdeco-modal') || modal;
  }

  // Step 2: Try "Send without a note" first (simplest, most reliable)
  const sendWithout = findInModal('Send without a note');
  if (sendWithout && !sendWithout.disabled) {
    sendWithout.click();
    await sleep(1500);
    return { success: true, sent: true };
  }

  // Step 3: If note provided, click "Add a note" and fill textarea
  if (note) {
    const addNoteBtn = findInModal('Add a note');
    if (addNoteBtn) {
      addNoteBtn.click();
      await sleep(1200);
      // Scope textarea lookup to the modal — avoid picking a stray textarea elsewhere
      const textarea = modal.querySelector('textarea') ||
                       modal.querySelector('#custom-message') ||
                       modal.querySelector('[contenteditable="true"]') ||
                       document.querySelector('[role="dialog"] textarea');
      if (textarea) {
        textarea.focus();
        if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
          // Real textarea — set value directly
          textarea.value = note;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // contenteditable div — use clipboard-style insertion (works in Chrome extensions)
          textarea.focus();
          textarea.textContent = '';
          // Try modern approach first, fall back to deprecated execCommand
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', note);
            textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
          } catch {
            // eslint-disable-next-line no-restricted-globals
            document.execCommand('insertText', false, note);
          }
        }
        await sleep(600);
      }
    }
  }

  // Step 4: Try any Send variant — strictly inside the modal
  await sleep(500);
  const sendBtn = findInModal('Send invitation') ||
                  findInModal('Send') ||
                  modal.querySelector('button[aria-label*="Send"i]') ||
                  modal.querySelector('button[type="submit"]');
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
    await sleep(1500);
    return { success: true, sent: true };
  }

  // Final fallback: log modal button labels only (no raw body text — avoid PII)
  const visibleBtns = Array.from(modal.querySelectorAll('button, [role="button"]'))
    .map(b => (b.getAttribute('aria-label') || b.innerText || '').trim())
    .filter(t => t.length > 0 && t.length < 40)
    .slice(0, 20)
    .join(' | ');
  return { success: false, error: `Send button not found. Modal buttons: ${visibleBtns}` };
}

// Like findButton but allows startsWith match (for multi-word Send labels)
function findButtonLoose(text) {
  const lower = text.toLowerCase();
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'button' && tag !== 'a' && el.getAttribute('role') !== 'button') continue;
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    if (label === lower || label.startsWith(lower)) return el;
    const inner = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (inner === lower || inner.startsWith(lower)) return el;
  }
  return null;
}

async function sendMessage(messageText) {
  if (!messageText) return { success: false, error: 'No message text provided' };

  // Find Message button using the same broad search as findConnectButton
  const messageBtn = findButton('Message') ||
    Array.from(document.querySelectorAll('*')).find(el => {
      const tag = el.tagName.toLowerCase();
      if (tag !== 'button' && tag !== 'a' && el.getAttribute('role') !== 'button') return false;
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      return label.startsWith('message') || (el.innerText || '').trim().toLowerCase() === 'message';
    });

  if (!messageBtn) {
    return { success: false, error: 'Message button not found — lead may not be connected' };
  }
  messageBtn.click();

  // Wait for the compose box to appear — LinkedIn 2024/2025 opens a chat overlay
  // at the bottom of the page with various possible selectors
  let msgBox = null;
  for (let i = 0; i < 15; i++) {
    await sleep(600);
    msgBox = document.querySelector('.msg-form__contenteditable') ||
             document.querySelector('[data-placeholder="Write a message…"]') ||
             document.querySelector('[data-placeholder*="message" i]') ||
             document.querySelector('.msg-form [contenteditable="true"]') ||
             document.querySelector('[role="textbox"][aria-label*="message" i]') ||
             document.querySelector('[role="textbox"][aria-label*="Message" i]') ||
             document.querySelector('.msg-form__contenteditable[contenteditable]') ||
             document.querySelector('[contenteditable="true"][aria-placeholder]') ||
             document.querySelector('.msg-overlay-conversation-bubble [contenteditable="true"]') ||
             document.querySelector('.msg-overlay-list-bubble [contenteditable="true"]') ||
             document.querySelector('[contenteditable="true"][role="textbox"]');
    if (msgBox) break;
  }

  if (!msgBox) {
    // LinkedIn navigated to /messaging/thread/new/ — React renders async.
    // Use MutationObserver to catch the compose box as soon as it appears.
    msgBox = await new Promise((resolve) => {
      // Already in DOM?
      const find = () =>
        document.querySelector('[contenteditable="true"][role="textbox"]') ||
        document.querySelector('.msg-form__contenteditable') ||
        document.querySelector('[data-placeholder*="message" i]') ||
        document.querySelector('[aria-label*="message" i][contenteditable]') ||
        document.querySelector('[contenteditable="true"]');
      const existing = find();
      if (existing) { resolve(existing); return; }

      const obs = new MutationObserver(() => {
        const el = find();
        if (el) { obs.disconnect(); clearTimeout(timer); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => { obs.disconnect(); resolve(null); }, 15000);
    });
  }

  if (!msgBox) {
    const editables = Array.from(document.querySelectorAll('[contenteditable], [role="textbox"]'))
      .map(el => el.tagName + '.' + (el.className || '').split(' ').slice(0,2).join('.'))
      .slice(0, 5).join(' | ');
    const url = window.location.href.replace(/^https:\/\/www\.linkedin\.com/, '');
    return { success: false, error: `Compose box not found. URL: ${url} | editables: ${editables}` };
  }

  // Type the message — use clipboard paste approach (most reliable for contenteditable)
  msgBox.focus();
  msgBox.click();
  await sleep(300);

  // Clear existing content
  msgBox.innerHTML = '';
  msgBox.textContent = '';

  // Insert text via DataTransfer (same approach as note in sendConnection)
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', messageText);
    msgBox.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } catch {
    // Fallback: execCommand
    msgBox.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, messageText);
  }
  msgBox.dispatchEvent(new Event('input', { bubbles: true }));
  msgBox.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(800);

  // Find and click Send — scoped to the message overlay/form
  const msgContainer = msgBox.closest('[class*="msg-form"], [class*="overlay"], [class*="compose"]') || document;
  const sendBtn = msgContainer.querySelector('[class*="send-button"]') ||
                  msgContainer.querySelector('button[type="submit"]') ||
                  msgContainer.querySelector('[aria-label*="Send" i]') ||
                  (() => {
                    // Walk all buttons in container, find one with text Send
                    for (const el of msgContainer.querySelectorAll('button, [role="button"]')) {
                      const t = (el.getAttribute('aria-label') || el.innerText || '').trim().toLowerCase();
                      if (t === 'send' || t.startsWith('send message')) return el;
                    }
                    return null;
                  })();

  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
    await sleep(1500);
    return { success: true, sent: true };
  }

  // Debug: list buttons in the overlay
  const visibleBtns = Array.from(msgContainer.querySelectorAll('button, [role="button"]'))
    .map(b => (b.getAttribute('aria-label') || b.innerText || '').trim())
    .filter(t => t.length > 0 && t.length < 40).slice(0, 10).join(' | ');
  return { success: false, error: `Send button not found. Composer buttons: ${visibleBtns}` };
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
