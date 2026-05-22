/**
 * background.js — LI Outreach Chrome Extension Service Worker
 *
 * Flow:
 *   1. Every 30 s: POST /api/extension/ping (heartbeat)
 *   2. Every 30 s: GET  /api/extension/poll?account_id=xxx
 *   3. If a task arrives: open/reuse a LinkedIn tab, navigate to profile, send
 *      message to content.js, await result
 *   4. POST /api/extension/result with outcome
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let isProcessing = false;
let linkedInTabId = null; // the reused LinkedIn tab

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
    // Update badge with pending count
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
  // Check our cached tab
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

  // Find existing LinkedIn tab
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (tabs.length > 0) {
    linkedInTabId = tabs[0].id;
    return linkedInTabId;
  }

  // Create new tab (not active — works in background)
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
  // Extra wait for LinkedIn's SPA to hydrate after navigation
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

    // Navigate to the LinkedIn profile
    await navigateTab(tabId, profileUrl);

    // Execute action via content script
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

// ── Main polling loop ─────────────────────────────────────────────────────────

async function tick() {
  const { apiUrl, apiToken, accountId } = await getConfig();

  if (!apiUrl || !apiToken || !accountId) {
    console.log('[LI Outreach] Not configured — skipping tick');
    return;
  }

  // Heartbeat
  await sendHeartbeat(apiUrl, apiToken, accountId);

  // Skip if already working on a task
  if (isProcessing) {
    console.log('[LI Outreach] Still processing previous task — skipping poll');
    return;
  }

  // Poll for task
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

// Set up recurring alarm — every 0.5 minutes = 30 seconds
chrome.alarms.create('li-outreach-tick', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'li-outreach-tick') {
    tick();
  }
});

// Also run immediately on service worker startup
tick();

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
