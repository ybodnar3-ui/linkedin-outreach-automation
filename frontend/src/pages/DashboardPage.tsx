import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Activity, Link, Users, Wifi, WifiOff, OctagonX } from 'lucide-react';
import { analyticsApi, campaignsApi, settingsApi, accountsApi } from '../lib/api';
import { wsClient, WsEvent } from '../lib/ws';
import { OnboardingWizard } from '../components/OnboardingWizard';

interface LogEntry { ts: number; event: string; message: string }

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: overview } = useQuery({ queryKey: ['analytics', 'overview'], queryFn: analyticsApi.overview, refetchInterval: 30_000 });
  const { data: daily } = useQuery({ queryKey: ['analytics', 'daily', 7], queryFn: () => analyticsApi.daily(7) });
  const { data: session } = useQuery({ queryKey: ['settings', 'session'], queryFn: settingsApi.session, refetchInterval: 60_000 });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Show onboarding wizard on first run (no accounts + no session)
  const isFirstRun = (accounts as unknown[]).length === 0 && !session?.active;
  const [wizardDismissed, setWizardDismissed] = useState(() => localStorage.getItem('onboarding_done') === '1');
  const showWizard = isFirstRun && !wizardDismissed;

  function handleDismiss() {
    localStorage.setItem('onboarding_done', '1');
    setWizardDismissed(true);
  }

  useEffect(() => {
    const unsub = wsClient.subscribe((evt: WsEvent) => {
      const msg = typeof evt.data === 'object' && evt.data !== null
        ? ((evt.data as Record<string, unknown>).message as string) || JSON.stringify(evt.data)
        : String(evt.data);
      setLogs(prev => [...prev.slice(-199), { ts: evt.ts, event: evt.event, message: msg }]);
    });
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const chartData = [...(daily ?? [])].reverse().map((d: Record<string, unknown>) => ({
    date: String(d.date).slice(5),
    connections: d.connections_sent,
    messages: d.messages_sent,
  }));

  const sessionActive = session?.active;

  return (
    <div className="space-y-6">
      {showWizard && <OnboardingWizard onDismiss={handleDismiss} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full ${sessionActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {sessionActive ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span className="hidden sm:inline">LinkedIn </span>{sessionActive ? 'Connected' : 'Disconnected'}
          </span>
          <button
            onClick={() => campaignsApi.pauseAll()}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <OctagonX size={14} />
            Pause All
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Active Campaigns" value={overview?.campaigns?.active ?? 0} icon={Activity} color="bg-blue-500" />
        <StatCard label="Connections Today" value={overview?.today?.connections_sent ?? 0} icon={Link} color="bg-green-500" />
        <StatCard label="Messages Today" value={overview?.today?.messages_sent ?? 0} icon={Users} color="bg-purple-500" />
        <StatCard label="Total Leads" value={overview?.leads?.total ?? 0} icon={Users} color="bg-orange-500" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Last 7 Days</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Line type="monotone" dataKey="connections" stroke="#3b82f6" strokeWidth={2} dot={false} name="Connections" />
              <Line type="monotone" dataKey="messages" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Messages" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Live log */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Live Activity</h2>
          <div className="flex-1 overflow-y-auto max-h-52 space-y-1 font-mono text-xs">
            {logs.length === 0 && <p className="text-gray-400 italic">Waiting for events…</p>}
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2 text-gray-600">
                <span className="text-gray-400 shrink-0">{new Date(l.ts).toLocaleTimeString()}</span>
                <span className={`shrink-0 font-medium ${l.event.includes('warning') || l.event.includes('error') ? 'text-red-500' : 'text-blue-500'}`}>[{l.event}]</span>
                <span className="truncate">{l.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
