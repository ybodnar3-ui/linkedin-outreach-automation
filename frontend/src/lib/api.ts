import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Campaigns
export const campaignsApi = {
  list: () => api.get('/campaigns').then(r => r.data),
  get: (id: string) => api.get(`/campaigns/${id}`).then(r => r.data),
  create: (data: unknown) => api.post('/campaigns', data).then(r => r.data),
  update: (id: string, data: unknown) => api.put(`/campaigns/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/campaigns/${id}`).then(r => r.data),
  start: (id: string) => api.post(`/campaigns/${id}/start`).then(r => r.data),
  pause: (id: string) => api.post(`/campaigns/${id}/pause`).then(r => r.data),
  resume: (id: string) => api.post(`/campaigns/${id}/resume`).then(r => r.data),
  stats: (id: string) => api.get(`/campaigns/${id}/stats`).then(r => r.data),
  pauseAll: () => api.post('/pause-all').then(r => r.data),
};

// Leads
export const leadsApi = {
  list: (params?: Record<string, unknown>) => api.get('/leads', { params }).then(r => r.data),
  get: (id: string) => api.get(`/leads/${id}`).then(r => r.data),
  create: (data: unknown) => api.post('/leads', data).then(r => r.data),
  update: (id: string, data: unknown) => api.put(`/leads/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/leads/${id}`).then(r => r.data),
  skip: (id: string, reason?: string) => api.post(`/leads/${id}/skip`, { reason }).then(r => r.data),
  discoverEmail: (id: string) => api.post(`/leads/${id}/discover-email`).then(r => r.data),
  importCsv: (campaignId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('campaign_id', campaignId);
    return api.post('/leads/import/csv', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
  importSalesNav: (campaignId: string, searchUrl: string, maxLeads?: number) =>
    api.post('/leads/import-sales-nav', { campaign_id: campaignId, search_url: searchUrl, max_leads: maxLeads }).then(r => r.data),
};

// Analytics
export const analyticsApi = {
  overview: () => api.get('/analytics/overview').then(r => r.data),
  daily: (days?: number) => api.get('/analytics/daily', { params: { days } }).then(r => r.data),
  campaign: (id: string) => api.get(`/analytics/campaign/${id}`).then(r => r.data),
  campaignsSummary: () => api.get('/analytics/campaigns-summary').then(r => r.data),
};

// Settings
export const settingsApi = {
  get: () => api.get('/settings').then(r => r.data),
  update: (data: Record<string, string>) => api.put('/settings', data).then(r => r.data),
  login: () => api.post('/settings/login').then(r => r.data),
  session: () => api.get('/settings/session').then(r => r.data),
  testProxycurl: () => api.post('/settings/proxycurl/test').then(r => r.data),
};

// Accounts (multi-account)
export const accountsApi = {
  list: () => api.get('/accounts').then(r => r.data),
  create: (data: { name: string; email?: string }) => api.post('/accounts', data).then(r => r.data),
  delete: (id: string) => api.delete(`/accounts/${id}`).then(r => r.data),
  login: (id: string) => api.post(`/accounts/${id}/login`).then(r => r.data),
  setProxy: (id: string, proxy: { host: string; port: string; user: string; password: string }) =>
    api.put(`/accounts/${id}/proxy`, proxy).then(r => r.data),
  clearProxy: (id: string) =>
    api.put(`/accounts/${id}/proxy`, { host: '', port: '', user: '', password: '' }).then(r => r.data),
};

// Inbox (Smart Inbox)
export const inboxApi = {
  threads: () => api.get('/inbox').then(r => r.data),
  messages: (threadId: string) => api.get(`/inbox/${threadId}`).then(r => r.data),
  reply: (threadId: string, text: string, accountId?: string) =>
    api.post(`/inbox/${threadId}/reply`, { text, account_id: accountId }).then(r => r.data),
};

// Webhooks
export const webhooksApi = {
  list: () => api.get('/webhooks').then(r => r.data),
  create: (data: { url: string; events: string[]; secret?: string }) =>
    api.post('/webhooks', data).then(r => r.data),
  delete: (id: string) => api.delete(`/webhooks/${id}`).then(r => r.data),
  toggle: (id: string, active: boolean) => api.patch(`/webhooks/${id}`, { active }).then(r => r.data),
  test: (id: string) => api.post(`/webhooks/${id}/test`).then(r => r.data),
};

// CRM integrations
export const crmApi = {
  test: () => api.post('/crm/test').then(r => r.data),
  syncLead: (leadId: string) => api.post(`/crm/sync/${leadId}`).then(r => r.data),
  syncAll: () => api.post('/crm/sync-all').then(r => r.data),
};

// A/B Tests
export const abTestsApi = {
  list: () => api.get('/ab-tests').then(r => r.data),
  get: (id: string) => api.get(`/ab-tests/${id}`).then(r => r.data),
  results: (id: string) => api.get(`/ab-tests/${id}/results`).then(r => r.data),
  create: (data: { name: string; step_id?: string; variant_a_text: string; variant_b_text: string }) =>
    api.post('/ab-tests', data).then(r => r.data),
  delete: (id: string) => api.delete(`/ab-tests/${id}`).then(r => r.data),
};
