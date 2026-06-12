import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { queryClient } from './lib/queryClient';
import { wsClient } from './lib/ws';
import { useEffect, ReactNode } from 'react';
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
import { CRMPage } from './pages/CRMPage';
import { LoginPage } from './pages/LoginPage';

function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const token = localStorage.getItem('auth_token');
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function LogoutButton() {
  const navigate = useNavigate();
  const username = localStorage.getItem('auth_username') || 'admin';

  function handleLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
    navigate('/login', { replace: true });
  }

  return (
    <div className="hidden md:flex items-center gap-2 px-3 py-2 mt-auto border-t border-gray-200">
      <span className="text-xs text-gray-500 truncate flex-1">{username}</span>
      <button
        onClick={handleLogout}
        title="Sign out"
        className="text-xs text-gray-400 hover:text-red-500 transition-colors whitespace-nowrap"
      >
        Sign out
      </button>
    </div>
  );
}

function AppRoutes() {
  useEffect(() => {
    wsClient.connect();
    return () => wsClient.disconnect();
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        element={
          <AuthGuard>
            <Layout logoutSlot={<LogoutButton />} />
          </AuthGuard>
        }
      >
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
        <Route path="/crm" element={<CRMPage />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
