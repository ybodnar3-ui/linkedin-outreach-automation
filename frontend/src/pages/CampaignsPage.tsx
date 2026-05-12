import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Play, Pause, Pencil, Trash2, Plus } from 'lucide-react';
import { campaignsApi } from '../lib/api';

interface Campaign {
  id: string;
  name: string;
  status: string;
  timezone: string;
  created_at: number;
}

const statusColor: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  draft: 'bg-gray-100 text-gray-600',
  completed: 'bg-blue-100 text-blue-700',
};

export function CampaignsPage() {
  const qc = useQueryClient();
  const { data: campaigns = [], isLoading } = useQuery({ queryKey: ['campaigns'], queryFn: campaignsApi.list });

  const startMutation = useMutation({ mutationFn: campaignsApi.start, onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }) });
  const pauseMutation = useMutation({ mutationFn: campaignsApi.pause, onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }) });
  const deleteMutation = useMutation({ mutationFn: campaignsApi.delete, onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }) });

  if (isLoading) return <div className="text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
        <Link to="/campaigns/new" className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus size={16} /> New Campaign
        </Link>
      </div>

      {(campaigns as Campaign[]).length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No campaigns yet</p>
          <Link to="/campaigns/new" className="mt-3 inline-block text-blue-600 text-sm hover:underline">Create your first campaign →</Link>
        </div>
      )}

      <div className="space-y-3">
        {(campaigns as Campaign[]).map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-gray-900 truncate">{c.name}</h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor[c.status] ?? statusColor.draft}`}>
                  {c.status}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{c.timezone} · Created {new Date(c.created_at * 1000).toLocaleDateString()}</p>
            </div>

            <div className="flex items-center gap-2">
              {c.status === 'active' ? (
                <button onClick={() => pauseMutation.mutate(c.id)} className="p-2 text-gray-500 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors" title="Pause">
                  <Pause size={16} />
                </button>
              ) : (
                <button onClick={() => startMutation.mutate(c.id)} className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Start">
                  <Play size={16} />
                </button>
              )}
              <Link to={`/campaigns/${c.id}/edit`} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                <Pencil size={16} />
              </Link>
              <button
                onClick={() => { if (confirm('Delete this campaign?')) deleteMutation.mutate(c.id); }}
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
