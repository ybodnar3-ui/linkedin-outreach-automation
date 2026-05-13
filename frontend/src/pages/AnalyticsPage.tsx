import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { analyticsApi, abTestsApi } from '../lib/api';

interface CampaignSummary {
  id: string;
  name: string;
  total_leads: number;
  connections_sent: number;
  connected: number;
  messaged: number;
  acceptance_rate: number;
}

function ABTestCard({ testId, testName }: { testId: string; testName: string }) {
  const { data } = useQuery({
    queryKey: ['ab-test-results', testId],
    queryFn: () => abTestsApi.results(testId),
  });

  if (!data) return null;

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900">{testName}</h3>
        {data.winner && (
          <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
            Winner: Variant {data.winner.toUpperCase()}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(['a', 'b'] as const).map(v => (
          <div key={v} className={`p-3 rounded-lg border ${data.winner === v ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
            <p className="text-xs font-medium text-gray-600 mb-1">Variant {v.toUpperCase()}</p>
            <p className="text-xs text-gray-500 mb-2 line-clamp-2">{data[`variant_${v}_text`]}</p>
            <p className="text-lg font-semibold text-gray-900">{data[`reply_rate_${v}`]}%</p>
            <p className="text-xs text-gray-500">{data.test[`sent_${v}`]} sent</p>
          </div>
        ))}
      </div>
      {!data.winner_determined && (
        <p className="text-xs text-gray-400 mt-2">Winner declared after 20+ sends per variant with ≥5% reply rate difference</p>
      )}
    </div>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data: overview } = useQuery({ queryKey: ['analytics', 'overview'], queryFn: analyticsApi.overview });
  const { data: daily = [] } = useQuery({ queryKey: ['analytics', 'daily', days], queryFn: () => analyticsApi.daily(days) });
  const { data: campaignsSummary = [] } = useQuery({ queryKey: ['analytics', 'campaigns-summary'], queryFn: analyticsApi.campaignsSummary });
  const { data: abTests = [] } = useQuery({ queryKey: ['ab-tests'], queryFn: abTestsApi.list });

  const chartData = [...(daily as Record<string, unknown>[])].reverse().map(d => ({
    date: String(d.date).slice(5),
    connections: d.connections_sent,
    messages: d.messages_sent,
    visits: d.profiles_visited,
  }));

  const acceptance = overview?.leads
    ? Math.round(((overview.leads.connected ?? 0) / Math.max(1, overview.leads.total)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1 text-sm rounded-md transition-colors ${days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total Leads', value: overview?.leads?.total ?? 0 },
          { label: 'Connected', value: overview?.leads?.connected ?? 0 },
          { label: 'Messaged', value: overview?.leads?.messaged ?? 0 },
          { label: 'Acceptance Rate', value: `${acceptance}%` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Line chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Activity over time</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="connections" stroke="#3b82f6" strokeWidth={2} dot={false} name="Connections" />
            <Line type="monotone" dataKey="messages" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Messages" />
            <Line type="monotone" dataKey="visits" stroke="#10b981" strokeWidth={2} dot={false} name="Visits" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Bar chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Daily breakdown</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="connections" fill="#3b82f6" name="Connections" />
            <Bar dataKey="messages" fill="#8b5cf6" name="Messages" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Campaign comparison table */}
      {(campaignsSummary as CampaignSummary[]).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Campaign Performance</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Campaign', 'Leads', 'Sent', 'Connected', 'Messaged', 'Acceptance'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-gray-500 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(campaignsSummary as CampaignSummary[]).map(c => (
                <tr key={c.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-[160px]">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.total_leads}</td>
                  <td className="px-4 py-3 text-gray-600">{c.connections_sent}</td>
                  <td className="px-4 py-3 text-gray-600">{c.connected}</td>
                  <td className="px-4 py-3 text-gray-600">{c.messaged}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[80px]">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, c.acceptance_rate)}%` }} />
                      </div>
                      <span className="text-gray-700 font-medium">{c.acceptance_rate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* A/B Tests section */}
      {(abTests as Array<{ id: string; name: string }>).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">A/B Tests</h2>
          <div className="space-y-4">
            {(abTests as Array<{ id: string; name: string }>).map(test => (
              <ABTestCard key={test.id} testId={test.id} testName={test.name} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
