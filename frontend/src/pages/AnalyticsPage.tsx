import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { analyticsApi } from '../lib/api';

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data: overview } = useQuery({ queryKey: ['analytics', 'overview'], queryFn: analyticsApi.overview });
  const { data: daily = [] } = useQuery({ queryKey: ['analytics', 'daily', days], queryFn: () => analyticsApi.daily(days) });

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
    </div>
  );
}
