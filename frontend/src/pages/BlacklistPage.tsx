import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus, ShieldOff } from 'lucide-react';
import { api } from '../lib/api';

interface BlacklistEntry { id: string; value: string; type: string; created_at: number }

export function BlacklistPage() {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [type, setType] = useState<'domain' | 'company'>('domain');

  const { data: items = [] } = useQuery<BlacklistEntry[]>({
    queryKey: ['blacklist'],
    queryFn: () => api.get('/blacklist').then(r => r.data),
  });

  const addMutation = useMutation({
    mutationFn: () => api.post('/blacklist', { value: value.trim(), type }).then(r => r.data),
    onSuccess: () => { setValue(''); qc.invalidateQueries({ queryKey: ['blacklist'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/blacklist/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blacklist'] }),
  });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ShieldOff size={22} className="text-red-500" />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Blacklist</h1>
          <p className="text-sm text-gray-500 mt-0.5">Leads matching these domains or companies will be automatically skipped</p>
        </div>
      </div>

      {/* Add form */}
      <div className="mb-6 p-4 border border-gray-200 rounded-xl bg-gray-50 space-y-3">
        <div className="flex gap-2">
          <select
            value={type}
            onChange={e => setType(e.target.value as 'domain' | 'company')}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="domain">Domain</option>
            <option value="company">Company name</option>
          </select>
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && value.trim()) addMutation.mutate(); }}
            placeholder={type === 'domain' ? 'e.g. google.com' : 'e.g. Google'}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={() => addMutation.mutate()}
            disabled={!value.trim() || addMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            <Plus size={15} /> Add
          </button>
        </div>
        <p className="text-xs text-gray-400">
          <b>Domain</b>: matches email domain and LinkedIn URL (e.g. <code>google.com</code> blocks all @google.com leads).<br />
          <b>Company</b>: partial match on company field (e.g. <code>Google</code> blocks "Google LLC", "Google UK" etc.)
        </p>
      </div>

      {/* List */}
      {items.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-10">No entries yet. Add domains or companies to protect.</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-xl bg-white">
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.type === 'domain' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                  {item.type}
                </span>
                <span className="text-sm font-mono text-gray-800">{item.value}</span>
              </div>
              <button
                onClick={() => deleteMutation.mutate(item.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
