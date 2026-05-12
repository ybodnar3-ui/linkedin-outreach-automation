import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wifi, WifiOff, LogIn } from 'lucide-react';
import { settingsApi } from '../lib/api';

export function SettingsPage() {
  const qc = useQueryClient();
  const { data: session, refetch: refetchSession } = useQuery({ queryKey: ['settings', 'session'], queryFn: settingsApi.session, refetchInterval: 30_000 });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });

  const [form, setForm] = useState({ my_name: '', timezone: 'America/New_York' });
  const [loginMsg, setLoginMsg] = useState('');

  useEffect(() => {
    if (settings) {
      setForm({ my_name: settings.my_name ?? '', timezone: settings.timezone ?? 'America/New_York' });
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
            <p className="text-xs text-gray-500">{sessionActive ? 'LinkedIn cookies are valid' : 'Login required to run campaigns'}</p>
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Your Name <span className="text-gray-400 font-normal">(used in {'{myName}'} template var)</span></label>
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

      {/* Safe Limits info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Daily Safety Limits</h2>
        <div className="space-y-2 text-sm">
          {[
            ['Connection requests / day', '20'],
            ['Messages / day', '15'],
            ['Profile visits / day', '80'],
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
        <p className="text-xs text-gray-400 mt-3">Limits are hardcoded for safety. Contact developer to adjust.</p>
      </div>
    </div>
  );
}
