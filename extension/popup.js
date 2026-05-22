'use strict';

const apiUrlInput  = document.getElementById('apiUrl');
const apiTokenInput= document.getElementById('apiToken');
const accountIdInput=document.getElementById('accountId');
const saveBtn      = document.getElementById('saveBtn');
const statusBox    = document.getElementById('statusBox');

// Load saved config
chrome.storage.local.get(['apiUrl', 'apiToken', 'accountId'], (data) => {
  if (data.apiUrl)    apiUrlInput.value   = data.apiUrl;
  if (data.apiToken)  apiTokenInput.value = data.apiToken;
  if (data.accountId) accountIdInput.value= data.accountId;

  // Auto-test connection if already configured
  if (data.apiUrl && data.apiToken && data.accountId) {
    testConnection(data.apiUrl, data.apiToken, data.accountId);
  }
});

saveBtn.addEventListener('click', async () => {
  const apiUrl   = apiUrlInput.value.trim().replace(/\/$/, '');
  const apiToken = apiTokenInput.value.trim();
  const accountId= accountIdInput.value.trim();

  if (!apiUrl || !apiToken || !accountId) {
    setStatus('disconnected', '⚠️ All fields are required');
    return;
  }

  saveBtn.disabled = true;
  setStatus('loading', 'Connecting…');

  await chrome.storage.local.set({ apiUrl, apiToken, accountId });
  await testConnection(apiUrl, apiToken, accountId);

  saveBtn.disabled = false;
});

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
      setStatus('connected',
        `✅ Connected — ${pending} task${pending !== 1 ? 's' : ''} pending`
      );
    } else {
      setStatus('disconnected', '❌ Backend rejected the token');
    }
  } catch (e) {
    setStatus('disconnected', `❌ ${e.message}`);
  }
}

function setStatus(type, text) {
  statusBox.className = `status ${type}`;
  statusBox.textContent = text;
}
