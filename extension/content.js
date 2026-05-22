/**
 * content.js — LI Outreach Content Script
 * Runs on linkedin.com pages.
 * Receives action commands from background.js and executes DOM operations.
 */

'use strict';

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
  const btns = Array.from(document.querySelectorAll('button'));
  return btns.find(b => {
    const t = (b.ariaLabel || b.textContent || '').trim();
    return t === text || t.startsWith(text);
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

async function sendConnection(note) {
  // Check if already connected / pending
  if (findButton('Message')) {
    return { success: true, sent: false, reason: 'already_connected' };
  }
  if (findButton('Pending')) {
    return { success: true, sent: false, reason: 'already_pending' };
  }

  // Click the Connect button
  const connectBtn = findButton('Connect');
  if (!connectBtn) {
    // Some profiles have it behind a "More" dropdown
    const moreBtn = findButton('More');
    if (moreBtn) {
      moreBtn.click();
      await sleep(1000);
    }
    // Try again
    const connectBtn2 = findButton('Connect');
    if (!connectBtn2) {
      return { success: false, error: 'Connect button not found' };
    }
    connectBtn2.click();
  } else {
    connectBtn.click();
  }

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

async function followProfile() {
  const followBtn = findButton('Follow');
  if (!followBtn) {
    return { success: false, error: 'Follow button not found' };
  }
  followBtn.click();
  await sleep(1000);
  return { success: true };
}
