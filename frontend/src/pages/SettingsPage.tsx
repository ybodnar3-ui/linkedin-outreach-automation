import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wifi, WifiOff, LogIn, Sparkles, Key, Mail, Link2, Puzzle, Copy, Check } from 'lucide-react';
import { settingsApi, crmApi, api } from '../lib/api';

interface SettingsData {
  my_name: string | null;
  timezone: string | null;
  hunter_api_key: string | null;
  apollo_api_key: string | null;
  openai_api_key: string | null;
  anthropic_api_key: string | null;
  auto_email_discovery: string | null;
  icebreaker_enabled: string | null;
  smtp_host: string | null;
  smtp_port: string | null;
  smtp_user: string | null;
  smtp_from: string | null;
  smtp_secure: string | null;
  smtp_password: string | null;
  hubspot_api_key: string | null;
  pipedrive_api_token: string | null;
  pipedrive_domain: string | null;
  proxycurl_api_key: string | null;
}

type CrmTestResult = { ok: boolean; error?: string };
interface CrmTestResults {
  hubspot: CrmTestResult;
  pipedrive: CrmTestResult;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data: session, refetch: refetchSession } = useQuery({
    queryKey: ['settings', 'session'],
    queryFn: settingsApi.session,
    refetchInterval: 30_000,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });

  const [form, setForm] = useState({
    my_name: '',
    timezone: 'America/New_York',
    hunter_api_key: '',
    apollo_api_key: '',
    openai_api_key: '',
    anthropic_api_key: '',
    auto_email_discovery: 'false',
    icebreaker_enabled: '0',
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_from: '',
    smtp_secure: '0',
    smtp_password: '',
    hubspot_api_key: '',
    pipedrive_api_token: '',
    pipedrive_domain: '',
    proxycurl_api_key: '',
  });
  const [proxycurlTestResult, setProxycurlTestResult] = useState<{ ok: boolean; credits?: number; error?: string } | null>(null);
  const [proxycurlTesting, setProxycurlTesting] = useState(false);
  const [loginMsg, setLoginMsg] = useState('');
  const [crmTestResult, setCrmTestResult] = useState<CrmTestResults | null>(null);
  const [crmTesting, setCrmTesting] = useState(false);
  const [extensionToken, setExtensionToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    if (settings) {
      const s = settings as SettingsData;
      setForm(f => ({
        ...f,
        my_name: s.my_name ?? '',
        timezone: s.timezone ?? 'America/New_York',
        hunter_api_key: s.hunter_api_key ?? '',
        apollo_api_key: s.apollo_api_key ?? '',
        openai_api_key: s.openai_api_key ?? '',
        anthropic_api_key: s.anthropic_api_key ?? '',
        auto_email_discovery: s.auto_email_discovery ?? 'false',
        icebreaker_enabled: s.icebreaker_enabled ?? '0',
        smtp_host: s.smtp_host ?? '',
        smtp_port: s.smtp_port ?? '587',
        smtp_user: s.smtp_user ?? '',
        smtp_from: s.smtp_from ?? '',
        smtp_secure: s.smtp_secure ?? '0',
        smtp_password: s.smtp_password ?? '',
        hubspot_api_key: s.hubspot_api_key ?? '',
        pipedrive_api_token: s.pipedrive_api_token ?? '',
        pipedrive_domain: s.pipedrive_domain ?? '',
        proxycurl_api_key: s.proxycurl_api_key ?? '',
      }));
    }
  }, [settings]);

  // Load extension token on mount
  useEffect(() => {
    api.get('/extension/token').then(r => setExtensionToken(r.data.extension_token)).catch(() => {});
  }, []);

  const saveMutation = useMutation({
    mutationFn: () => settingsApi.update(form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const loginMutation = useMutation({
    mutationFn: settingsApi.login,
    onSuccess: () => {
      setLoginMsg('A browser window will open. Complete the LinkedIn login, then the session will be saved automatically.');
      setTimeout(() => refetchSession(), 15_000);
    },
  });

  const sessionActive = session?.active;

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Settings</h1>

      {/* Session */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">LinkedIn Session</h2>
        <div className={`flex items-center gap-3 p-3 rounded-lg ${sessionActive ? 'bg-green-50' : 'bg-red-50'}`}>
          {sessionActive ? <Wifi size={18} className="text-green-600" /> : <WifiOff size={18} className="text-red-500" />}
          <div>
            <p className={`text-sm font-medium ${sessionActive ? 'text-green-700' : 'text-red-600'}`}>
              {sessionActive ? 'Session active' : 'Not connected'}
            </p>
            <p className="text-xs text-gray-500">
              {sessionActive ? 'LinkedIn cookies are valid' : 'Login required to run campaigns'}
            </p>
          </div>
        </div>
        {loginMsg && <p className="text-sm text-blue-600 bg-blue-50 rounded-lg p-3">{loginMsg}</p>}
        <button
          onClick={() => loginMutation.mutate()}
          disabled={loginMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          <LogIn size={15} />
          {loginMutation.isPending ? 'Opening browser…' : 'Connect LinkedIn Account'}
        </button>
      </div>

      {/* General settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">General</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Your Name <span className="text-gray-400 font-normal">(used in {'{myName}'} template var)</span>
          </label>
          <input
            value={form.my_name}
            onChange={e => setForm(f => ({ ...f, my_name: e.target.value }))}
            placeholder="e.g. Alex"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Default Timezone</label>
          <input
            value={form.timezone}
            onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
            placeholder="America/New_York"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      {/* AI Icebreaker */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-500" />
          <h2 className="font-semibold text-gray-900">AI Icebreaker</h2>
        </div>
        <p className="text-sm text-gray-500">
          Automatically generates a personalized opening line when your message template contains{' '}
          <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{'{icebreaker}'}</code>.
          Requires a visitProfile step before the message step to enrich lead data.
        </p>

        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={form.icebreaker_enabled === '1'}
              onChange={e => setForm(f => ({ ...f, icebreaker_enabled: e.target.checked ? '1' : '0' }))}
            />
            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-purple-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
          </label>
          <span className="text-sm text-gray-700">
            {form.icebreaker_enabled === '1' ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Key size={12} className="inline mr-1" />OpenAI API Key <span className="text-gray-400 font-normal">(primary)</span>
          </label>
          <input
            type="password"
            value={form.openai_api_key}
            onChange={e => setForm(f => ({ ...f, openai_api_key: e.target.value }))}
            placeholder={form.openai_api_key === '***' ? '••••••• (saved)' : 'sk-...'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Key size={12} className="inline mr-1" />Anthropic API Key <span className="text-gray-400 font-normal">(fallback)</span>
          </label>
          <input
            type="password"
            value={form.anthropic_api_key}
            onChange={e => setForm(f => ({ ...f, anthropic_api_key: e.target.value }))}
            placeholder={form.anthropic_api_key === '***' ? '••••••• (saved)' : 'sk-ant-...'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-40 transition-colors"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save AI Settings'}
        </button>
      </div>

      {/* Email Discovery */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Email Discovery</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Key size={12} className="inline mr-1" />Hunter.io API Key
          </label>
          <input
            type="password"
            value={form.hunter_api_key}
            onChange={e => setForm(f => ({ ...f, hunter_api_key: e.target.value }))}
            placeholder={form.hunter_api_key === '***' ? '••••••• (saved)' : 'Enter key…'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Key size={12} className="inline mr-1" />Apollo.io API Key <span className="text-gray-400 font-normal">(fallback)</span>
          </label>
          <input
            type="password"
            value={form.apollo_api_key}
            onChange={e => setForm(f => ({ ...f, apollo_api_key: e.target.value }))}
            placeholder={form.apollo_api_key === '***' ? '••••••• (saved)' : 'Enter key…'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={form.auto_email_discovery === 'true'}
              onChange={e => setForm(f => ({ ...f, auto_email_discovery: e.target.checked ? 'true' : 'false' }))}
            />
            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
          </label>
          <span className="text-sm text-gray-700">Auto-discover emails after connection accepted</span>
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Keys'}
        </button>
      </div>

      {/* SMTP Email Sending */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail size={16} className="text-blue-500" />
          <h2 className="font-semibold text-gray-900">Email Sending (SMTP)</h2>
        </div>
        <p className="text-sm text-gray-500">
          Configure SMTP to enable the <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">send_email</code> campaign step.
          Uses the lead's discovered email address.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">SMTP Host</label>
            <input value={form.smtp_host} onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))}
              placeholder="smtp.gmail.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Port</label>
            <input value={form.smtp_port} onChange={e => setForm(f => ({ ...f, smtp_port: e.target.value }))}
              placeholder="587"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">SMTP Username / Email</label>
          <input value={form.smtp_user} onChange={e => setForm(f => ({ ...f, smtp_user: e.target.value }))}
            placeholder="you@gmail.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">SMTP Password / App Password</label>
          <input type="password" value={form.smtp_password} onChange={e => setForm(f => ({ ...f, smtp_password: e.target.value }))}
            placeholder={form.smtp_password === '***' ? '••••••• (saved)' : 'Enter password…'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From Name &amp; Email</label>
          <input value={form.smtp_from} onChange={e => setForm(f => ({ ...f, smtp_from: e.target.value }))}
            placeholder='John Smith <john@example.com>'
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer"
              checked={form.smtp_secure === '1'}
              onChange={e => setForm(f => ({ ...f, smtp_secure: e.target.checked ? '1' : '0' }))} />
            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
          </label>
          <span className="text-sm text-gray-700">Use TLS (port 465)</span>
        </div>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
          {saveMutation.isPending ? 'Saving…' : 'Save SMTP Settings'}
        </button>
      </div>

      {/* Proxycurl */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-indigo-500" />
          <h2 className="font-semibold text-gray-900">Proxycurl <span className="text-xs font-normal text-gray-400 ml-1">Profile Enrichment API</span></h2>
        </div>
        <p className="text-sm text-gray-500">
          When configured, replaces Playwright DOM scraping with the Proxycurl API — more reliable, more data, includes email discovery.
          <br />
          <a href="https://nubela.co/proxycurl" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-xs">
            Sign up at nubela.co/proxycurl
          </a>
          {' '}· ~$0.01 per profile · pay-as-you-go
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Key size={12} className="inline mr-1" />API Key
          </label>
          <input
            type="password"
            value={form.proxycurl_api_key}
            onChange={e => setForm(f => ({ ...f, proxycurl_api_key: e.target.value }))}
            placeholder={form.proxycurl_api_key === '***' ? '••••••• (saved)' : 'Enter key…'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>

        {proxycurlTestResult && (
          <div className={`text-xs px-3 py-2 rounded-lg ${proxycurlTestResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {proxycurlTestResult.ok
              ? `✓ Connected — ${proxycurlTestResult.credits?.toLocaleString()} credits remaining`
              : `✗ ${proxycurlTestResult.error}`}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            {saveMutation.isPending ? 'Saving…' : 'Save Key'}
          </button>
          <button
            onClick={async () => {
              setProxycurlTesting(true);
              setProxycurlTestResult(null);
              try {
                const r = await settingsApi.testProxycurl();
                setProxycurlTestResult(r as { ok: boolean; credits?: number; error?: string });
              } catch {
                setProxycurlTestResult({ ok: false, error: 'Request failed' });
              } finally {
                setProxycurlTesting(false);
              }
            }}
            disabled={proxycurlTesting}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {proxycurlTesting ? 'Testing…' : 'Test & Check Credits'}
          </button>
        </div>
      </div>

      {/* CRM Integrations */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-teal-500" />
          <h2 className="font-semibold text-gray-900">CRM Integrations</h2>
        </div>
        <p className="text-sm text-gray-500">
          Automatically sync leads to your CRM when a connection is accepted or they reply.
          Supports HubSpot and Pipedrive.
        </p>

        {/* HubSpot */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-gray-800">HubSpot</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              <Key size={11} className="inline mr-1" />Private App Token
            </label>
            <input
              type="password"
              value={form.hubspot_api_key}
              onChange={e => setForm(f => ({ ...f, hubspot_api_key: e.target.value }))}
              placeholder={form.hubspot_api_key === '***' ? '••••••• (saved)' : 'pat-na1-...'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <p className="text-xs text-gray-400 mt-1">
              Create in HubSpot → Settings → Integrations → Private Apps. Grant <em>CRM: contacts</em> scope.
            </p>
          </div>
        </div>

        {/* Pipedrive */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-gray-800">Pipedrive</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              <Key size={11} className="inline mr-1" />API Token
            </label>
            <input
              type="password"
              value={form.pipedrive_api_token}
              onChange={e => setForm(f => ({ ...f, pipedrive_api_token: e.target.value }))}
              placeholder={form.pipedrive_api_token === '***' ? '••••••• (saved)' : 'Enter token…'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Company Domain</label>
            <div className="flex items-center gap-1">
              <input
                value={form.pipedrive_domain}
                onChange={e => setForm(f => ({ ...f, pipedrive_domain: e.target.value }))}
                placeholder="yourcompany"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
              <span className="text-sm text-gray-400">.pipedrive.com</span>
            </div>
          </div>
        </div>

        {/* Test result */}
        {crmTestResult && (
          <div className="space-y-1.5">
            {(['hubspot', 'pipedrive'] as const).map(crm => (
              <div key={crm} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                crmTestResult[crm].ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
              }`}>
                <span className="font-medium capitalize">{crm}:</span>
                {crmTestResult[crm].ok ? '✓ Connected' : crmTestResult[crm].error || 'Failed'}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save CRM Settings'}
          </button>
          <button
            onClick={async () => {
              setCrmTesting(true);
              setCrmTestResult(null);
              try {
                const result = await crmApi.test();
                setCrmTestResult(result as CrmTestResults);
              } catch {
                /* error handled by result state */
              } finally {
                setCrmTesting(false);
              }
            }}
            disabled={crmTesting}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {crmTesting ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
      </div>

      {/* Safe Limits info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Daily Safety Limits</h2>
        <div className="space-y-2 text-sm">
          {[
            ['Connection requests / day', '20 (adjusted by health score)'],
            ['Messages / day', '15 (adjusted by health score)'],
            ['Profile visits / day', '80 (adjusted by health score)'],
            ['Warmup — days 1-7', '5 connections max'],
            ['Warmup — days 8-14', '10 connections max'],
            ['Warmup — days 15-21', '15 connections max'],
            ['Delay between actions', '15 – 45 sec'],
            ['Delay between leads', '1 – 3 min'],
            ['Working hours', '09:00 – 18:00'],
            ['Working days', 'Mon – Fri'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-gray-600">{k}</span>
              <span className="font-medium text-gray-900">{v}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Limits are dynamically adjusted by account health score (0-100). CAPTCHA −30, warning −20, restriction −50. +5/day when healthy.
        </p>
      </div>

      {/* Chrome Extension */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Puzzle className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">Chrome Extension</h2>
          <span className="ml-auto text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">Recommended</span>
        </div>
        <p className="text-sm text-gray-600">
          The Chrome Extension runs automation directly in your browser — just like Dripify.
          LinkedIn can't detect it because it uses your real session. No session drops.
        </p>

        {/* Setup steps */}
        <ol className="text-sm text-gray-700 space-y-2 list-none">
          {[
            '1. Download the extension folder and load it in Chrome (chrome://extensions → Load unpacked)',
            '2. Copy the token below and paste it into the extension popup',
            '3. Copy the Account ID from the Accounts page and paste it into the extension popup',
            '4. Click Save & Connect — the extension will show ✅ Connected',
          ].map((step) => (
            <li key={step} className="flex gap-2">
              <span className="text-blue-500 font-bold">→</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        {/* Token display */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Extension Token</label>
          <div className="flex gap-2">
            <input
              readOnly
              value={extensionToken ?? 'Loading…'}
              className="flex-1 px-3 py-2 text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg text-gray-700 select-all"
              onFocus={e => e.target.select()}
            />
            <button
              onClick={async () => {
                if (extensionToken) {
                  await navigator.clipboard.writeText(extensionToken);
                  setTokenCopied(true);
                  setTimeout(() => setTokenCopied(false), 2000);
                }
              }}
              className="px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
              title="Copy token"
            >
              {tokenCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          onClick={async () => {
            if (confirm('This will invalidate the current token. The extension will need to be reconfigured. Continue?')) {
              const r = await api.post('/extension/token/regenerate');
              setExtensionToken(r.data.extension_token);
            }
          }}
          className="text-xs text-red-500 hover:text-red-700 transition-colors"
        >
          Regenerate token
        </button>
      </div>
    </div>
  );
}
