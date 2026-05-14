import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FlaskConical, Trophy, TrendingUp } from 'lucide-react';
import { abTestsApi } from '../lib/api';

interface ABTest {
  id: string;
  name: string;
  step_id: string | null;
  sent_a: number;
  sent_b: number;
  replies_a: number;
  replies_b: number;
  winner: 'a' | 'b' | null;
  created_at: number;
  updated_at: number;
}

interface ABTestResults {
  test: ABTest;
  variant_a_text: string;
  variant_b_text: string;
  reply_rate_a: number;
  reply_rate_b: number;
  winner: 'a' | 'b' | null;
  winner_determined: boolean;
}

function StatBar({ rate, max, variant, isWinner }: { rate: number; max: number; variant: 'A' | 'B'; isWinner: boolean }) {
  const pct = max > 0 ? (rate / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className={`w-5 text-xs font-bold ${isWinner ? 'text-green-600' : 'text-gray-500'}`}>{variant}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isWinner ? 'bg-green-500' : 'bg-blue-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold w-12 text-right ${isWinner ? 'text-green-600' : 'text-gray-600'}`}>
        {rate}%
      </span>
      {isWinner && <Trophy size={13} className="text-green-500" />}
    </div>
  );
}

function TestCard({ test }: { test: ABTest }) {
  const qc = useQueryClient();
  const { data: results } = useQuery({
    queryKey: ['ab-test-results', test.id],
    queryFn: () => abTestsApi.results(test.id),
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: () => abTestsApi.delete(test.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ab-tests'] }),
  });

  const r = results as ABTestResults | undefined;
  const maxRate = Math.max(r?.reply_rate_a ?? 0, r?.reply_rate_b ?? 0, 1);
  const totalSent = test.sent_a + test.sent_b;
  const MIN_FOR_STATS = 20;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-purple-500" />
            <h3 className="font-semibold text-gray-900">{test.name}</h3>
            {test.winner && (
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                Winner: {test.winner.toUpperCase()}
              </span>
            )}
            {!test.winner && totalSent < MIN_FOR_STATS && totalSent > 0 && (
              <span className="text-xs px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-full">
                Need {MIN_FOR_STATS - Math.min(test.sent_a, test.sent_b)} more sends
              </span>
            )}
            {totalSent === 0 && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">No data yet</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Created {new Date(test.created_at * 1000).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={() => deleteMutation.mutate()}
          className="text-gray-300 hover:text-red-500 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: 'Sent A', value: test.sent_a },
          { label: 'Sent B', value: test.sent_b },
          { label: 'Total Sends', value: totalSent },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-50 rounded-lg py-2">
            <p className="text-lg font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Reply rate bars */}
      {r && totalSent > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={13} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-500">Reply Rate</span>
          </div>
          <StatBar rate={r.reply_rate_a} max={maxRate} variant="A" isWinner={test.winner === 'a'} />
          <StatBar rate={r.reply_rate_b} max={maxRate} variant="B" isWinner={test.winner === 'b'} />
        </div>
      )}

      {/* Variant texts */}
      {r && (
        <div className="grid grid-cols-2 gap-3">
          {(['a', 'b'] as const).map(v => (
            <div key={v} className={`rounded-lg p-3 border text-xs ${
              test.winner === v
                ? 'bg-green-50 border-green-200'
                : 'bg-gray-50 border-gray-100'
            }`}>
              <p className="font-semibold text-gray-700 mb-1">Variant {v.toUpperCase()}</p>
              <p className="text-gray-600 line-clamp-3 whitespace-pre-wrap">
                {v === 'a' ? r.variant_a_text : r.variant_b_text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ABTestsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [variantA, setVariantA] = useState('');
  const [variantB, setVariantB] = useState('');

  const { data: tests = [], isLoading } = useQuery({
    queryKey: ['ab-tests'],
    queryFn: abTestsApi.list,
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: () => abTestsApi.create({ name, variant_a_text: variantA, variant_b_text: variantB }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ab-tests'] });
      setShowForm(false);
      setName('');
      setVariantA('');
      setVariantB('');
    },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">A/B Tests</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Compare two message variants. Winner auto-detected after 20+ sends per variant.
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Plus size={15} /> New Test
        </button>
      </div>

      {/* How-to banner */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-sm text-purple-800">
        <p className="font-medium mb-1">How to use A/B tests</p>
        <ol className="text-xs text-purple-700 space-y-0.5 list-decimal list-inside">
          <li>Create a test with two message variants below</li>
          <li>In Campaign Builder → connect step → select this A/B test</li>
          <li>Each lead is randomly assigned to Variant A or B</li>
          <li>Winner is declared when reply rate difference ≥ 5% with 20+ sends each</li>
        </ol>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">New A/B Test</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Test Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Short vs Long connection note"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Variant A</label>
              <textarea
                value={variantA}
                onChange={e => setVariantA(e.target.value)}
                rows={4}
                placeholder="Hi {firstName}, I'd love to connect…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-purple-400"
              />
              <p className="text-xs text-gray-400 text-right mt-0.5">{variantA.length}/300</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Variant B</label>
              <textarea
                value={variantB}
                onChange={e => setVariantB(e.target.value)}
                rows={4}
                placeholder="Hey {firstName}! Saw your work at {company}…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-purple-400"
              />
              <p className="text-xs text-gray-400 text-right mt-0.5">{variantB.length}/300</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!name || !variantA || !variantB || createMutation.isPending}
              className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Test'}
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

      {/* Test list */}
      {isLoading && <p className="text-sm text-gray-400 py-4">Loading…</p>}

      {!isLoading && (tests as ABTest[]).length === 0 && !showForm && (
        <div className="text-center py-16 text-gray-400">
          <FlaskConical size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No A/B tests yet. Create one to start optimizing your messages.</p>
        </div>
      )}

      <div className="space-y-4">
        {(tests as ABTest[]).map(test => (
          <TestCard key={test.id} test={test} />
        ))}
      </div>
    </div>
  );
}
