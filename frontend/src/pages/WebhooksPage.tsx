import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Zap, ToggleLeft, ToggleRight, Send } from 'lucide-react';
import { webhooksApi } from '../lib/api';

const ALL_EVENTS = [
  { id: 'connection_accepted', label: 'Connection Accepted', desc: 'Lead accepted your connection request' },
  { id: 'replied',             label: 'Lead Replied',        desc: 'Lead sent an inbound message' },
  { id: 'lead_completed',      label: 'Lead Completed',      desc: 'Lead finished all campaign steps' },
  { id: 'lead_skipped',        label: 'Lead Skipped',        desc: 'Lead was skipped (blacklist / manual)' },
  { id: 'campaign_started',    label: 'Campaign Started',    desc: 'Campaign status changed to active' },
  { id: 'campaign_paused',     label: 'Campaign Paused',     desc: 'Campaign status changed to paused' },
];

interface Webhook {
  id: string;
  url: string;
  events: string; // JSON string
  secret: string | null;
  active: number;
  created_at: number;
}

export function WebhooksPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['connection_accepted', 'replied']);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, boolean>>({});

  const { data: webhooks = [] } = useQuery({
    queryKey: ['webhooks'],
    queryFn: webhooksApi.list,
  });

  const createMutation = useMutation({
    mutationFn: () => webhooksApi.create({ url, events: selectedEvents, secret: secret || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      setShowForm(false);
      setUrl('');
      setSecret('');
      setSelectedEvents(['connection_accepted', 'replied']);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => webhooksApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => webhooksApi.toggle(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  function toggleEvent(eventId: string) {
    setSelectedEvents(prev =>
      prev.includes(eventId) ? prev.filter(e => e !== eventId) : [...prev, eventId]
    );
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      await webhooksApi.test(id);
      setTestResult(r => ({ ...r, [id]: true }));
    } catch {
      setTestResult(r => ({ ...r, [id]: false }));
    } finally {
      setTestingId(null);
      setTimeout(() => setTestResult(r => { const n = { ...r }; delete n[id]; return n; }), 3000);
    }
  }

  const whs = webhooks as Webhook[];

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Send real-time events to Zapier, Make, or your own endpoint.
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} /> Add Webhook
        </button>
      </div>

      {/* Zapier helper banner */}
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex gap-3 items-start">
        <Zap size={18} className="text-orange-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-orange-800">How to connect Zapier</p>
          <p className="text-xs text-orange-700 mt-1">
            1. Create a new Zap → Trigger: <strong>Webhooks by Zapier → Catch Hook</strong><br />
            2. Copy the Zapier webhook URL and paste it below<br />
            3. Choose which events to send → Save → Test it
          </p>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">New Webhook</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Secret <span className="text-gray-400 font-normal">(optional — adds X-Webhook-Signature header)</span>
            </label>
            <input
              type="password"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="my-secret-key"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Events to send</label>
            <div className="space-y-2">
              {ALL_EVENTS.map(ev => (
                <label key={ev.id} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(ev.id)}
                    onChange={() => toggleEvent(ev.id)}
                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <span className="text-sm font-medium text-gray-800 group-hover:text-blue-600">{ev.label}</span>
                    <span className="text-xs text-gray-400 ml-2">{ev.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!url || selectedEvents.length === 0 || createMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {createMutation.isPending ? 'Saving…' : 'Save Webhook'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {whs.length === 0 && !showForm ? (
        <div className="text-center py-16 text-gray-400">
          <Zap size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No webhooks yet. Add one to start sending events to Zapier or Make.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {whs.map(wh => {
            const events: string[] = (() => { try { return JSON.parse(wh.events); } catch { return []; } })();
            return (
              <div key={wh.id} className={`bg-white rounded-xl border p-4 space-y-3 ${wh.active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{wh.url}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Created {new Date(wh.created_at * 1000).toLocaleDateString()}
                      {wh.secret && ' · HMAC signed'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {testResult[wh.id] !== undefined && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${testResult[wh.id] ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {testResult[wh.id] ? '✓ Sent' : '✗ Failed'}
                      </span>
                    )}
                    <button
                      onClick={() => handleTest(wh.id)}
                      disabled={testingId === wh.id}
                      className="text-gray-400 hover:text-blue-600 disabled:opacity-40"
                      title="Send test event"
                    >
                      <Send size={14} />
                    </button>
                    <button
                      onClick={() => toggleMutation.mutate({ id: wh.id, active: !wh.active })}
                      className="text-gray-400 hover:text-blue-600"
                      title={wh.active ? 'Disable' : 'Enable'}
                    >
                      {wh.active ? <ToggleRight size={18} className="text-blue-500" /> : <ToggleLeft size={18} />}
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(wh.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {events.map(ev => {
                    const meta = ALL_EVENTS.find(e => e.id === ev);
                    return (
                      <span key={ev} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
                        {meta?.label ?? ev}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payload example */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-500 mb-2">Example payload (connection_accepted)</p>
        <pre className="text-xs text-gray-600 overflow-x-auto">{JSON.stringify({
          event: 'connection_accepted',
          ts: 1715000000,
          data: {
            leadId: 'abc-123',
            linkedinUrl: 'https://www.linkedin.com/in/johndoe',
            firstName: 'John',
            lastName: 'Doe',
            company: 'Acme Corp',
            title: 'CTO',
          }
        }, null, 2)}</pre>
      </div>
    </div>
  );
}
