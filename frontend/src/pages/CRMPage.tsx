import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmPipelineApi } from '../lib/api';
import { ExternalLink, StickyNote } from 'lucide-react';

const STAGES = [
  { id: 'new',         label: 'New',          color: 'bg-gray-100 border-gray-300 text-gray-700' },
  { id: 'contacted',   label: 'Contacted',    color: 'bg-blue-50 border-blue-300 text-blue-700' },
  { id: 'replied',     label: 'Replied',      color: 'bg-purple-50 border-purple-300 text-purple-700' },
  { id: 'call_booked', label: 'Call Booked',  color: 'bg-yellow-50 border-yellow-300 text-yellow-700' },
  { id: 'won',         label: 'Won',          color: 'bg-green-50 border-green-300 text-green-700' },
  { id: 'lost',        label: 'Lost',         color: 'bg-red-50 border-red-300 text-red-700' },
] as const;

interface CRMLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  linkedin_url: string;
  email: string | null;
  crm_stage: string;
  crm_notes: string | null;
  crm_next_follow_up: number | null;
  campaign_name: string | null;
  replied_at: number | null;
  connected_at: number | null;
}

function LeadCard({ lead, onUpdate }: {
  lead: CRMLead;
  onUpdate: (id: string, data: { stage?: string; notes?: string }) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(lead.crm_notes ?? '');
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={lead.linkedin_url} target="_blank" rel="noreferrer"
            className="font-semibold text-gray-900 hover:text-blue-600 flex items-center gap-1 truncate">
            {name} <ExternalLink size={10} className="shrink-0" />
          </a>
          {lead.title && <p className="text-xs text-gray-500 truncate">{lead.title}</p>}
          {lead.company && <p className="text-xs text-gray-400 truncate">{lead.company}</p>}
        </div>
      </div>

      {lead.email && (
        <p className="text-xs text-blue-600 truncate">{lead.email}</p>
      )}

      {lead.campaign_name && (
        <p className="text-xs text-gray-400 truncate">{lead.campaign_name}</p>
      )}

      {/* Stage selector */}
      <select
        value={lead.crm_stage}
        onChange={e => onUpdate(lead.id, { stage: e.target.value })}
        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
      >
        {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>

      {/* Notes */}
      <button
        onClick={() => setEditingNotes(!editingNotes)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
      >
        <StickyNote size={11} />
        {lead.crm_notes ? 'Edit note' : 'Add note'}
      </button>
      {editingNotes && (
        <div className="space-y-1">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Notes..."
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={() => { onUpdate(lead.id, { notes }); setEditingNotes(false); }}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      )}
      {lead.crm_notes && !editingNotes && (
        <p className="text-xs text-gray-500 italic truncate">"{lead.crm_notes}"</p>
      )}
    </div>
  );
}

export function CRMPage() {
  const qc = useQueryClient();

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: crmPipelineApi.list,
    refetchInterval: 30000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof crmPipelineApi.update>[1] }) =>
      crmPipelineApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-pipeline'] }),
  });

  function handleUpdate(id: string, data: Parameters<typeof crmPipelineApi.update>[1]) {
    updateMutation.mutate({ id, data });
  }

  const leadsByStage = (stageId: string) =>
    (leads as CRMLead[]).filter(l => (l.crm_stage ?? 'contacted') === stageId);

  if (isLoading) return <div className="p-6 text-gray-400">Loading...</div>;

  const total = (leads as CRMLead[]).length;
  const won = leadsByStage('won').length;
  const replied = leadsByStage('replied').length + leadsByStage('call_booked').length + won;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">CRM Pipeline</h1>
        <div className="flex gap-4 text-sm text-gray-500">
          <span><strong className="text-gray-900">{total}</strong> total</span>
          <span><strong className="text-purple-600">{replied}</strong> replied</span>
          <span><strong className="text-green-600">{won}</strong> won</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto">
        {STAGES.map(stage => {
          const stageLeads = leadsByStage(stage.id);
          return (
            <div key={stage.id} className="min-w-[180px] space-y-2">
              <div className={`rounded-lg px-3 py-1.5 border text-xs font-semibold flex items-center justify-between ${stage.color}`}>
                <span>{stage.label}</span>
                <span className="opacity-70">{stageLeads.length}</span>
              </div>
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-0.5">
                {stageLeads.length === 0 && (
                  <p className="text-xs text-gray-300 text-center py-4">Empty</p>
                )}
                {stageLeads.map(lead => (
                  <LeadCard key={lead.id} lead={lead} onUpdate={handleUpdate} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
