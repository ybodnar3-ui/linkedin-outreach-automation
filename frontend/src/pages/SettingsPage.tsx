import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wifi, WifiOff, LogIn, Sparkles, Key } from 'lucide-react';
import { settingsApi } from '../lib/api';

interface SettingsData {
  my_name: string | null;
  timezone: string | null;
  hunter_api_key: string | null;
  apollo_api_key: string | null;
  openai_api_key: string | null;
  anthropic_api_key: string | null;
  auto_email_discovery: string | null;
  icebreaker_enabled: string | null;
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
  });
  const [loginMsg, setLoginMsg] = useState('');

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
      }));
    }
  }, [settings]);

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
    </div>
  );
}
