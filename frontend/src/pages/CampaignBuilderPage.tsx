import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, GripVertical, Trash2, ArrowLeft } from 'lucide-react';
import { campaignsApi } from '../lib/api';
import { v4 as uuidv4 } from 'uuid';

type ActionType = 'visit' | 'follow' | 'connect' | 'message' | 'send_inmail' | 'check_connection' | 'wait' | 'send_email';
type Condition = 'always' | 'if_connected' | 'if_not_replied';

interface Step {
  _id: string;
  step_order: number;
  action: ActionType;
  wait_days: number;
  condition: Condition;
  message_text: string;
  email_subject: string;
}

const ACTION_LABELS: Record<ActionType, string> = {
  visit: 'Visit Profile',
  follow: 'Follow Profile',
  connect: 'Send Connection',
  message: 'Send Message',
  send_inmail: 'Send InMail',
  check_connection: 'Check Connection',
  wait: 'Wait',
  send_email: 'Send Email',
};

const ACTION_COLORS: Record<ActionType, string> = {
  visit: 'bg-blue-50 border-blue-200',
  follow: 'bg-sky-50 border-sky-200',
  connect: 'bg-green-50 border-green-200',
  message: 'bg-purple-50 border-purple-200',
  send_inmail: 'bg-indigo-50 border-indigo-200',
  check_connection: 'bg-yellow-50 border-yellow-200',
  wait: 'bg-gray-50 border-gray-200',
  send_email: 'bg-orange-50 border-orange-200',
};

const TEMPLATE_VARS = [
  // Basic
  '{firstName}', '{lastName}', '{company}', '{title}', '{myName}',
  // Enrichment — auto-filled after visitProfile step runs
  '{headline}', '{location}', '{yearsAtCompany}', '{school}',
  '{skills}', '{recentPost}', '{mutualConnections}', '{summary}',
];

function SortableStep({ step, onChange, onDelete }: {
  step: Step;
  onChange: (updated: Step) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: step._id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const hasText = step.action === 'connect' || step.action === 'message' || step.action === 'send_email' || step.action === 'send_inmail';
  const maxLen = step.action === 'connect' ? 300 : 1900;

  return (
    <div ref={setNodeRef} style={style} className={`rounded-xl border p-4 ${ACTION_COLORS[step.action]} space-y-3`}>
      <div className="flex items-center gap-3">
        <button {...attributes} {...listeners} className="text-gray-400 hover:text-gray-600 cursor-grab">
          <GripVertical size={16} />
        </button>

        <select
          value={step.action}
          onChange={e => onChange({ ...step, action: e.target.value as ActionType, message_text: '', email_subject: '' })}
          className="text-sm font-medium bg-white border border-gray-200 rounded-lg px-2 py-1"
        >
          {Object.entries(ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <select
          value={step.condition}
          onChange={e => onChange({ ...step, condition: e.target.value as Condition })}
          className="text-sm bg-white border border-gray-200 rounded-lg px-2 py-1 ml-auto"
        >
          <option value="always">Always</option>
          <option value="if_connected">If Connected</option>
          <option value="if_not_replied">If Not Replied</option>
        </select>

        <button onClick={onDelete} className="text-gray-400 hover:text-red-500">
          <Trash2 size={15} />
        </button>
      </div>

      {step.action === 'wait' && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Wait</span>
          <input
            type="number" min={1} max={90}
            value={step.wait_days}
            onChange={e => onChange({ ...step, wait_days: parseInt(e.target.value) || 1 })}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-center bg-white"
          />
          <span className="text-gray-600">days</span>
        </div>
      )}

      {(step.action === 'send_email' || step.action === 'send_inmail') && (
        <div className="space-y-2">
          <input
            value={step.email_subject}
            onChange={e => onChange({ ...step, email_subject: e.target.value })}
            placeholder="Email subject (supports {firstName} etc.)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
      )}

      {hasText && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {TEMPLATE_VARS.map(v => (
              <button key={v} onClick={() => onChange({ ...step, message_text: step.message_text + v })}
                className="text-xs px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-600 hover:border-blue-300 hover:text-blue-600">
                {v}
              </button>
            ))}
          </div>
          <textarea
            value={step.message_text}
            onChange={e => onChange({ ...step, message_text: e.target.value })}
            maxLength={maxLen}
            rows={step.action === 'send_email' ? 6 : 3}
            placeholder={
              step.action === 'connect' ? 'Connection note (optional)…' :
              step.action === 'send_email' ? 'Email body (plain text, supports {firstName} etc.)…' :
              'Message text…'
            }
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <p className="text-xs text-gray-400 text-right">{step.message_text.length}/{maxLen}</p>
        </div>
      )}
    </div>
  );
}

export function CampaignBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data: existing } = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => campaignsApi.get(id!),
    enabled: isEdit,
  });

  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setTimezone(existing.timezone);
      setSteps((existing.steps ?? []).map((s: Omit<Step, '_id'>) => ({
        ...s,
        _id: uuidv4(),
        message_text: s.message_text ?? '',
        email_subject: (s as Step & { email_subject?: string }).email_subject ?? '',
      })));
    }
  }, [existing]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSteps(prev => {
        const oldIndex = prev.findIndex(s => s._id === active.id);
        const newIndex = prev.findIndex(s => s._id === over.id);
        return arrayMove(prev, oldIndex, newIndex).map((s, i) => ({ ...s, step_order: i + 1 }));
      });
    }
  }

  function addStep() {
    setSteps(prev => [...prev, {
      _id: uuidv4(), step_order: prev.length + 1, action: 'visit', wait_days: 1, condition: 'always', message_text: '', email_subject: '',
    }]);
  }

  const createMutation = useMutation({
    mutationFn: (data: unknown) => isEdit ? campaignsApi.update(id!, data) : campaignsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); navigate('/campaigns'); },
  });

  const startMutation = useMutation({
    mutationFn: async (data: unknown) => {
      const res = isEdit ? await campaignsApi.update(id!, data) : await campaignsApi.create(data);
      const cid = isEdit ? id! : res.id;
      await campaignsApi.start(cid);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); navigate('/campaigns'); },
  });

  function buildPayload() {
    return {
      name,
      timezone,
      steps: steps.map((s, i) => ({
        step_order: i + 1, action: s.action, wait_days: s.wait_days,
        condition: s.condition, message_text: s.message_text || null,
        email_subject: s.email_subject || null,
      })),
    };
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/campaigns')} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">{isEdit ? 'Edit Campaign' : 'New Campaign'}</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. CTOs in SaaS"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
          <input
            value={timezone} onChange={e => setTimezone(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Steps</h2>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map(s => s._id)} strategy={verticalListSortingStrategy}>
            {steps.map(step => (
              <SortableStep
                key={step._id}
                step={step}
                onChange={updated => setSteps(prev => prev.map(s => s._id === updated._id ? updated : s))}
                onDelete={() => setSteps(prev => prev.filter(s => s._id !== step._id).map((s, i) => ({ ...s, step_order: i + 1 })))}
              />
            ))}
          </SortableContext>
        </DndContext>

        <button onClick={addStep} className="w-full py-2 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2">
          <Plus size={15} /> Add Step
        </button>
      </div>

      <div className="flex gap-3 pb-6">
        <button
          onClick={() => createMutation.mutate(buildPayload())}
          disabled={!name}
          className="flex-1 py-2.5 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          Save
        </button>
        <button
          onClick={() => startMutation.mutate(buildPayload())}
          disabled={!name || steps.length === 0}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          Save & Start
        </button>
      </div>
    </div>
  );
}
