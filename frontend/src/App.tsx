import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { wsClient } from './lib/ws';
import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { CampaignBuilderPage } from './pages/CampaignBuilderPage';
import { LeadsPage } from './pages/LeadsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AccountsPage } from './pages/AccountsPage';
import { InboxPage } from './pages/InboxPage';
import { BlacklistPage } from './pages/BlacklistPage';
import { WebhooksPage } from './pages/WebhooksPage';
import { ABTestsPage } from './pages/ABTestsPage';

function App() {
  useEffect(() => {
    wsClient.connect();
    return () => wsClient.disconnect();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/new" element={<CampaignBuilderPage />} />
            <Route path="/campaigns/:id/edit" element={<CampaignBuilderPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/blacklist" element={<BlacklistPage />} />
            <Route path="/webhooks" element={<WebhooksPage />} />
            <Route path="/ab-tests" element={<ABTestsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
