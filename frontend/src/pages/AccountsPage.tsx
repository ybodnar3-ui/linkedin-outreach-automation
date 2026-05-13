import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wifi, WifiOff, Trash2 } from 'lucide-react';
import { accountsApi } from '../lib/api';

interface Account {
  id: string;
  name: string;
  email: string | null;
  status: 'disconnected' | 'active' | 'error';
  created_at: number;
}

const STATUS_CONFIG = {
  active: { label: 'Active', cls: 'bg-green-100 text-green-700', Icon: Wifi },
  disconnected: { label: 'Disconnected', cls: 'bg-gray-100 text-gray-600', Icon: WifiOff },
  error: { label: 'Error', cls: 'bg-red-100 text-red-700', Icon: WifiOff },
} as const;

export function AccountsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '' });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: () => accountsApi.create({ name: form.name, email: form.email || undefined }),
    onSuccess: () => {
      setShowAdd(false);
      setForm({ name: '', email: '' });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const loginMutation = useMutation({
    mutationFn: (id: string) => accountsApi.login(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => accountsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">LinkedIn Accounts</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"
        >
          <Plus size={16} /> Add Account
        </button>
      </div>

      {showAdd && (
        <div className="mb-6 p-4 border border-gray-200 rounded-xl bg-gray-50 space-y-3">
          <h3 className="text-sm font-medium text-gray-700">New Account</h3>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Account name (e.g. Work Account)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <input
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="LinkedIn email (optional)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!form.name || createMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (accounts as Account[]).length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No accounts yet. Add your first LinkedIn account.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(accounts as Account[]).map(account => {
            const cfg = STATUS_CONFIG[account.status] ?? STATUS_CONFIG.disconnected;
            return (
              <div key={account.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-xl bg-white">
                <div>
                  <p className="font-medium text-gray-900">{account.name}</p>
                  {account.email && <p className="text-xs text-gray-500 mt-0.5">{account.email}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${cfg.cls}`}>
                    <cfg.Icon size={12} /> {cfg.label}
                  </span>
                  <button
                    onClick={() => loginMutation.mutate(account.id)}
                    disabled={loginMutation.isPending}
                    className="px-3 py-1.5 text-sm border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                  >
                    Connect
                  </button>
                  <button
                    onClick={() => { if (confirm('Delete this account?')) deleteMutation.mutate(account.id); }}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
