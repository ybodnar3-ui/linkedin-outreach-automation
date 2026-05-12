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
  importCsv: (campaignId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('campaign_id', campaignId);
    return api.post('/leads/import/csv', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
};

// Analytics
export const analyticsApi = {
  overview: () => api.get('/analytics/overview').then(r => r.data),
  daily: (days?: number) => api.get('/analytics/daily', { params: { days } }).then(r => r.data),
  campaign: (id: string) => api.get(`/analytics/campaign/${id}`).then(r => r.data),
};

// Settings
export const settingsApi = {
  get: () => api.get('/settings').then(r => r.data),
  update: (data: Record<string, string>) => api.put('/settings', data).then(r => r.data),
  login: () => api.post('/settings/login').then(r => r.data),
  session: () => api.get('/settings/session').then(r => r.data),
};
