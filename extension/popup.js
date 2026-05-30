'use strict';

const apiUrlInput    = document.getElementById('apiUrl');
const apiTokenInput  = document.getElementById('apiToken');
const accountIdInput = document.getElementById('accountId');
const saveBtn        = document.getElementById('saveBtn');
const statusBox      = document.getElementById('statusBox');
const campaignSelect = document.getElementById('campaignSelect');
const searchUrlInput = document.getElementById('searchUrl');
const maxLeadsInput  = document.getElementById('maxLeads');
const importBtn      = document.getElementById('importBtn');
const importProgress = document.getElementById('importProgress');
const manualUrls     = document.getElementById('manualUrls');
const manualImportBtn= document.getElementById('manualImportBtn');
const manualProgress = document.getElementById('manualProgress');
const webKeywords    = document.getElementById('webKeywords');
const webMaxResults  = document.getElementById('webMaxResults');
const webSearchBtn   = document.getElementById('webSearchBtn');
const webProgress    = document.getElementById('webProgress');
const batchKeywords  = document.getElementById('batchKeywords');
const batchLocations = document.getElementById('batchLocations');
const batchSearchBtn = document.getElementById('batchSearchBtn');
const batchStopBtn   = document.getElementById('batchStopBtn');
const batchProgress  = document.getElementById('batchProgress');
const batchEstQueries= document.getElementById('batchEstQueries');
const batchEstLeads  = document.getElementById('batchEstLeads');
const batchEstTime   = document.getElementById('batchEstTime');

// Load saved config + last search URL
chrome.storage.local.get(['apiUrl', 'apiToken', 'accountId', 'lastSearchUrl', 'lastCampaignId'], (data) => {
  if (data.apiUrl)    apiUrlInput.value    = data.apiUrl;
  if (data.apiToken)  apiTokenInput.value  = data.apiToken;
  if (data.accountId) accountIdInput.value = data.accountId;
  if (data.lastSearchUrl) searchUrlInput.value = data.lastSearchUrl;

  if (data.apiUrl && data.apiToken && data.accountId) {
    testConnection(data.apiUrl, data.apiToken, data.accountId);
    loadCampaigns(data.apiUrl, data.apiToken, data.lastCampaignId);
  }
});

// Save search URL as user types
searchUrlInput.addEventListener('input', () => {
  chrome.storage.local.set({ lastSearchUrl: searchUrlInput.value });
});

// Save & Connect
saveBtn.addEventListener('click', async () => {
  const apiUrl    = apiUrlInput.value.trim().replace(/\/$/, '');
  const apiToken  = apiTokenInput.value.trim();
  const accountId = accountIdInput.value.trim();

  if (!apiUrl || !apiToken || !accountId) {
    setStatus('disconnected', '⚠️ All fields are required');
    return;
  }

  saveBtn.disabled = true;
  setStatus('loading', 'Connecting…');

  await chrome.storage.local.set({ apiUrl, apiToken, accountId });
  await testConnection(apiUrl, apiToken, accountId);
  const { lastCampaignId } = await chrome.storage.local.get('lastCampaignId');
  await loadCampaigns(apiUrl, apiToken, lastCampaignId);

  saveBtn.disabled = false;
});

// Import All Leads button
importBtn.addEventListener('click', async () => {
  const campaignId = campaignSelect.value;
  const searchUrl  = searchUrlInput.value.trim();
  const maxLeads   = parseInt(maxLeadsInput.value, 10) || 50;

  if (!campaignId) {
    setProgress('⚠️ Select a campaign first');
    return;
  }
  if (!searchUrl || !searchUrl.includes('linkedin.com')) {
    setProgress('⚠️ Paste a LinkedIn search URL');
    return;
  }

  const { apiUrl, apiToken, accountId } = await chrome.storage.local.get(['apiUrl', 'apiToken', 'accountId']);
  if (!apiUrl || !apiToken) {
    setProgress('⚠️ Connect to backend first');
    return;
  }

  importBtn.disabled = true;
  setProgress('🔄 Starting import…');

  // Listen for progress updates from background
  const listener = (message) => {
    if (message.type === 'LI_OUTREACH_IMPORT_PROGRESS') {
      setProgress(message.text);
      if (message.done) {
        importBtn.disabled = false;
        chrome.runtime.onMessage.removeListener(listener);
      }
    }
  };
  chrome.runtime.onMessage.addListener(listener);

  // Send import request to background script
  chrome.runtime.sendMessage({
    type: 'LI_OUTREACH_START_IMPORT',
    searchUrl,
    campaignId,
    accountId,
    apiUrl,
    apiToken,
    maxLeads,
  });
});

// ── Web Search Import — finds profiles via Bing, bypasses LinkedIn limits ───
webSearchBtn.addEventListener('click', async () => {
  const campaignId = campaignSelect.value;
  const keywords = webKeywords.value.trim();
  const maxResults = parseInt(webMaxResults.value, 10) || 50;

  if (!campaignId) {
    setWebProgress('⚠️ Спочатку вибери кампанію');
    return;
  }
  if (!keywords) {
    setWebProgress('⚠️ Введи keywords для пошуку');
    return;
  }

  const { apiUrl, apiToken, accountId } = await chrome.storage.local.get(['apiUrl', 'apiToken', 'accountId']);
  if (!apiUrl || !apiToken || !accountId) {
    setWebProgress('⚠️ Спочатку Connect до backend');
    return;
  }

  webSearchBtn.disabled = true;
  setWebProgress(`🔎 Шукаю в інтернеті: "${keywords}"…`);

  // Save last keywords
  chrome.storage.local.set({ lastWebKeywords: keywords });

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'LI_OUTREACH_WEB_SEARCH',
      keywords,
      maxResults,
      campaignId,
      accountId,
      apiUrl,
      apiToken,
    });

    if (!response) {
      setWebProgress('❌ Немає відповіді від background script');
      return;
    }

    if (!response.ok) {
      const foundCount = response.leads?.length || 0;
      setWebProgress(`❌ ${response.error}${foundCount ? ` (знайдено ${foundCount} лідів але не вдалося зберегти)` : ''}`);
      return;
    }

    setWebProgress(`✅ Знайдено ${response.leads.length}, додано ${response.added} (${response.skipped} дублікатів)`);
  } catch (e) {
    setWebProgress(`❌ Помилка: ${e.message}`);
  } finally {
    webSearchBtn.disabled = false;
  }
});

function setWebProgress(text) {
  webProgress.textContent = text;
}

// Restore last keywords on popup open
chrome.storage.local.get('lastWebKeywords', (data) => {
  if (data.lastWebKeywords) webKeywords.value = data.lastWebKeywords;
});

// ── BATCH WEB SEARCH ────────────────────────────────────────────────────────
function parseLines(text) {
  return text.split(/[\n]+/).map(s => s.trim()).filter(Boolean);
}

function updateBatchEstimate() {
  const kws = parseLines(batchKeywords.value);
  const locs = parseLines(batchLocations.value);
  const queries = kws.length * locs.length;
  const leads = queries * 15; // ~15 unique per query after dedup
  const minutes = Math.ceil(queries * 8 / 60); // ~8 sec per query
  batchEstQueries.textContent = queries;
  batchEstLeads.textContent = leads;
  batchEstTime.textContent = minutes;
}
batchKeywords.addEventListener('input', updateBatchEstimate);
batchLocations.addEventListener('input', updateBatchEstimate);

// Restore last batch inputs
chrome.storage.local.get(['lastBatchKeywords', 'lastBatchLocations'], (data) => {
  if (data.lastBatchKeywords) batchKeywords.value = data.lastBatchKeywords;
  if (data.lastBatchLocations) batchLocations.value = data.lastBatchLocations;
  updateBatchEstimate();
});

batchSearchBtn.addEventListener('click', async () => {
  const campaignId = campaignSelect.value;
  if (!campaignId) {
    batchProgress.textContent = '⚠️ Вибери кампанію';
    return;
  }

  const kws = parseLines(batchKeywords.value);
  const locs = parseLines(batchLocations.value);

  if (kws.length === 0 || locs.length === 0) {
    batchProgress.textContent = '⚠️ Заповни keywords і locations';
    return;
  }

  // Save inputs
  chrome.storage.local.set({
    lastBatchKeywords: batchKeywords.value,
    lastBatchLocations: batchLocations.value,
  });

  const { apiUrl, apiToken, accountId } = await chrome.storage.local.get(['apiUrl', 'apiToken', 'accountId']);
  if (!apiUrl || !apiToken || !accountId) {
    batchProgress.textContent = '⚠️ Спочатку Connect до backend';
    return;
  }

  batchSearchBtn.disabled = true;
  batchStopBtn.style.display = 'block';

  // Listen for progress updates from background
  const progressListener = (msg) => {
    if (msg.type === 'LI_OUTREACH_BATCH_PROGRESS') {
      batchProgress.textContent = msg.text;
      if (msg.done) {
        batchSearchBtn.disabled = false;
        batchStopBtn.style.display = 'none';
        chrome.runtime.onMessage.removeListener(progressListener);
      }
    }
  };
  chrome.runtime.onMessage.addListener(progressListener);

  // Tell background to start the batch
  chrome.runtime.sendMessage({
    type: 'LI_OUTREACH_BATCH_START',
    keywords: kws,
    locations: locs,
    campaignId, accountId, apiUrl, apiToken,
  });
});

batchStopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'LI_OUTREACH_BATCH_STOP' });
  batchProgress.textContent = '⏹ Зупиняю після поточного запиту…';
});

// ── Manual paste import — guaranteed to work (no LinkedIn scraping) ─────────
manualImportBtn.addEventListener('click', async () => {
  const campaignId = campaignSelect.value;
  const raw = manualUrls.value.trim();

  if (!campaignId) {
    setManualProgress('⚠️ Спочатку вибери кампанію вище');
    return;
  }
  if (!raw) {
    setManualProgress('⚠️ Встав хоча б один URL');
    return;
  }

  // Parse URLs from textarea (one per line, also accept comma/space separated)
  const lines = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const leads = [];
  const seen = new Set();
  const errors = [];

  for (const line of lines) {
    // Extract slug from various URL formats
    const match = line.match(/(?:linkedin\.com\/in\/|^\/in\/|^)([a-zA-Z0-9-]{3,100})\/?(?:[?#].*)?$/i);
    if (!match) {
      errors.push(line.substring(0, 40));
      continue;
    }
    const slug = match[1];
    if (slug === 'in' || slug === 'me' || slug === 'UNAVAILABLE') {
      errors.push(line.substring(0, 40));
      continue;
    }
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

  if (leads.length === 0) {
    setManualProgress(`❌ Не знайдено валідних URL. Перевір формат: linkedin.com/in/SLUG`);
    return;
  }

  setManualProgress(`🔄 Відправляю ${leads.length} лідів${errors.length ? ` (${errors.length} пропущено)` : ''}…`);
  manualImportBtn.disabled = true;

  try {
    const { apiUrl, apiToken, accountId } = await chrome.storage.local.get(['apiUrl', 'apiToken', 'accountId']);
    if (!apiUrl || !apiToken || !accountId) {
      setManualProgress('❌ Спочатку Connect до backend');
      manualImportBtn.disabled = false;
      return;
    }

    const res = await fetch(`${apiUrl}/api/extension/import-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
      body: JSON.stringify({ campaign_id: campaignId, account_id: accountId, leads }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      setManualProgress(`❌ Backend HTTP ${res.status}: ${errBody.substring(0, 100)}`);
      manualImportBtn.disabled = false;
      return;
    }

    const data = await res.json();
    setManualProgress(`✅ Додано ${data.added} лідів (${data.skipped} дублікатів пропущено)`);
    manualUrls.value = ''; // clear textarea on success
  } catch (e) {
    setManualProgress(`❌ Помилка: ${e.message}`);
  } finally {
    manualImportBtn.disabled = false;
  }
});

function setManualProgress(text) {
  manualProgress.textContent = text;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function testConnection(apiUrl, apiToken, accountId) {
  try {
    const res = await fetch(`${apiUrl}/api/extension/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ account_id: accountId }),
    });
    const data = await res.json();
    if (data.ok) {
      const pending = data.pending_count || 0;
      setStatus('connected', `✅ Connected — ${pending} task${pending !== 1 ? 's' : ''} pending`);
    } else {
      setStatus('disconnected', '❌ Backend rejected the token');
    }
  } catch (e) {
    setStatus('disconnected', `❌ ${e.message}`);
  }
}

async function loadCampaigns(apiUrl, apiToken, lastCampaignId) {
  try {
    const res = await fetch(`${apiUrl}/api/extension/campaigns`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });
    if (!res.ok) return;
    const campaigns = await res.json();
    // Build options via DOM API (textContent) to avoid HTML injection from
    // a campaign name like "</option><script>..."
    campaignSelect.replaceChildren();
    if (campaigns.length) {
      for (const c of campaigns) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        campaignSelect.appendChild(opt);
      }
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No campaigns found';
      campaignSelect.appendChild(opt);
    }
    // Restore previously selected campaign
    if (lastCampaignId) {
      campaignSelect.value = lastCampaignId;
    }
  } catch {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Could not load campaigns';
    campaignSelect.replaceChildren(opt);
  }
}

// Save selected campaign when user changes it
campaignSelect.addEventListener('change', () => {
  chrome.storage.local.set({ lastCampaignId: campaignSelect.value });
});

function setStatus(type, text) {
  statusBox.className = `status ${type}`;
  statusBox.textContent = text;
}

function setProgress(text) {
  importProgress.textContent = text;
}
