import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wifi, WifiOff, Trash2, ShieldCheck, ShieldAlert, Flame, Globe, Cookie, X, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { accountsApi } from '../lib/api';

interface ProxyInfo {
  host: string;
  port: string;
  user: string;
  password: string;
}

interface HealthInfo {
  healthScore: number;
  accountAgeDays: number;
  isWarmingUp: boolean;
  warmupCap: number;
  effectiveConnectionLimit: number;
  effectiveMessageLimit: number;
  effectiveVisitLimit: number;
  connectionsUsedToday: number;
  messagesUsedToday: number;
  visitsUsedToday: number;
}

interface Account {
  id: string;
  name: string;
  email: string | null;
  status: 'disconnected' | 'active' | 'error';
  created_at: number;
  health: HealthInfo;
  proxy_host: string | null;
  proxy_port: string | null;
  proxy_user: string | null;
}

const STATUS_CONFIG = {
  active:       { label: 'Active',        cls: 'bg-green-100 text-green-700', Icon: Wifi },
  disconnected: { label: 'Disconnected',  cls: 'bg-gray-100 text-gray-600',   Icon: WifiOff },
  error:        { label: 'Error',         cls: 'bg-red-100 text-red-700',     Icon: WifiOff },
} as const;

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-700">{score}</span>
    </div>
  );
}

function HealthIcon({ score }: { score: number }) {
  if (score >= 70) return <ShieldCheck size={14} className="text-green-500" />;
  if (score >= 40) return <ShieldAlert size={14} className="text-yellow-500" />;
  return <ShieldAlert size={14} className="text-red-500" />;
}

// ── Cookie Import Modal ────────────────────────────────────────────────────────

interface ImportResult {
  ok: boolean;
  verified: boolean;
  message: string;
}

function CookieImportModal({
  account,
  onClose,
  onSuccess,
}: {
  account: Account;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [cookieText, setCookieText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (cookies: unknown[]) => accountsApi.importCookies(account.id, cookies),
    onSuccess: (data: ImportResult) => {
      setResult(data);
      if (data.verified) onSuccess();
    },
    onError: (err: { response?: { data?: { error?: string } }; message?: string }) => {
      setError(err.response?.data?.error ?? err.message ?? 'Unknown error');
    },
  });

  function handleImport() {
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cookieText.trim());
    } catch {
      setError('Invalid JSON — make sure you copied the full array from the extension.');
      return;
    }
    if (!Array.isArray(parsed)) {
      setError('Expected an array of cookie objects. Check the extension export format.');
      return;
    }
    importMutation.mutate(parsed as unknown[]);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Cookie size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">Connect LinkedIn Account</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3 text-sm text-blue-900">
            <p className="font-semibold">How to export LinkedIn cookies:</p>
            <ol className="space-y-2 list-decimal list-inside text-blue-800">
              <li>
                Install the{' '}
                <a
                  href="https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
                  target="_blank"
                  rel="noreferrer"
                  className="underline inline-flex items-center gap-1 font-medium"
                >
                  Cookie-Editor <ExternalLink size={11} />
                </a>{' '}
                extension in Chrome
              </li>
              <li>
                Open{' '}
                <a href="https://www.linkedin.com" target="_blank" rel="noreferrer" className="underline font-medium">
                  linkedin.com
                </a>{' '}
                and make sure you are <strong>logged in</strong>
              </li>
              <li>Click the Cookie-Editor icon in your toolbar</li>
              <li>
                Click <strong>Export</strong> → <strong>Export as JSON</strong>
              </li>
              <li>Paste the copied JSON below</li>
            </ol>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Paste LinkedIn cookies JSON
            </label>
            <textarea
              value={cookieText}
              onChange={e => setCookieText(e.target.value)}
              rows={8}
              placeholder={'[\n  { "name": "li_at", "value": "AQE...", "domain": ".linkedin.com", ... },\n  ...\n]'}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div
              className={`flex items-start gap-2 p-3 border rounded-lg text-sm ${
                result.verified
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-yellow-50 border-yellow-200 text-yellow-800'
              }`}
            >
              {result.verified ? (
                <CheckCircle size={15} className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
              )}
              <span>{result.message}</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleImport}
              disabled={!cookieText.trim() || importMutation.isPending}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {importMutation.isPending ? 'Importing & verifying…' : 'Import Cookies'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>

          <p className="text-xs text-gray-400 text-center">
            Cookies are stored securely on the server and used only to operate your LinkedIn account.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AccountsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '' });
  const [proxyForms, setProxyForms] = useState<Record<string, ProxyInfo>>({});
  const [importTarget, setImportTarget] = useState<Account | null>(null);

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

  const proxyMutation = useMutation({
    mutationFn: ({ id, proxy }: { id: string; proxy: ProxyInfo }) => accountsApi.setProxy(id, proxy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const clearProxyMutation = useMutation({
    mutationFn: (id: string) => accountsApi.clearProxy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => accountsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {importTarget && (
        <CookieImportModal
          account={importTarget}
          onClose={() => setImportTarget(null)}
          onSuccess={() => {
            setImportTarget(null);
            qc.invalidateQueries({ queryKey: ['accounts'] });
          }}
        />
      )}

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
            placeholder="LinkedIn email (optional, for reference)"
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
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
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
            const h = account.health;
            const isOpen = expanded === account.id;
            return (
              <div key={account.id} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                {/* Main row */}
                <div className="flex items-center justify-between p-4">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : account.id)}
                  >
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{account.name}</p>
                      {h?.isWarmingUp && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-orange-50 text-orange-600 rounded-full border border-orange-200">
                          <Flame size={10} /> Warmup day {h.accountAgeDays}
                        </span>
                      )}
                    </div>
                    {account.email && <p className="text-xs text-gray-500 mt-0.5">{account.email}</p>}
                    {h && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <HealthIcon score={h.healthScore} />
                        <HealthBar score={h.healthScore} />
                        <span className="text-xs text-gray-400">
                          {h.connectionsUsedToday}/{h.effectiveConnectionLimit} connections today
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${cfg.cls}`}>
                      <cfg.Icon size={12} /> {cfg.label}
                    </span>
                    <button
                      onClick={() => setImportTarget(account)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50"
                    >
                      <Cookie size={13} />
                      {account.status === 'active' ? 'Reconnect' : 'Connect'}
                    </button>
                    <button
                      onClick={() => { if (confirm('Delete this account?')) deleteMutation.mutate(account.id); }}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Expanded health panel */}
                {isOpen && h && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Account Health Details</p>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Health Score', value: `${h.healthScore}/100` },
                        { label: 'Account Age', value: `${h.accountAgeDays} days` },
                        { label: 'Warmup Cap', value: h.isWarmingUp ? `${h.warmupCap} conn/day` : 'Full limit' },
                        { label: 'Connections', value: `${h.connectionsUsedToday}/${h.effectiveConnectionLimit}` },
                        { label: 'Messages', value: `${h.messagesUsedToday}/${h.effectiveMessageLimit}` },
                        { label: 'Profile Visits', value: `${h.visitsUsedToday}/${h.effectiveVisitLimit}` },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white rounded-lg border border-gray-200 p-2.5">
                          <p className="text-xs text-gray-500">{label}</p>
                          <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      Health recovers +5/day when no warnings detected. Penalties: CAPTCHA −30, Warning −20, Restriction −50.
                    </p>

                    {/* Proxy config */}
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                        <Globe size={11} /> Proxy Configuration
                      </p>
                      {account.proxy_host ? (
                        <div className="flex items-center justify-between bg-blue-50 rounded-lg p-2">
                          <div>
                            <p className="text-xs font-medium text-blue-800">{account.proxy_host}:{account.proxy_port || '8080'}</p>
                            {account.proxy_user && <p className="text-xs text-blue-600">{account.proxy_user}</p>}
                          </div>
                          <button
                            onClick={() => clearProxyMutation.mutate(account.id)}
                            disabled={clearProxyMutation.isPending}
                            className="text-xs px-2 py-1 text-red-600 hover:text-red-800 border border-red-200 rounded"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(() => {
                            const pf = proxyForms[account.id] ?? { host: '', port: '8080', user: '', password: '' };
                            const setPf = (upd: Partial<ProxyInfo>) => setProxyForms(prev => ({ ...prev, [account.id]: { ...pf, ...upd } }));
                            return (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <input value={pf.host} onChange={e => setPf({ host: e.target.value })}
                                    placeholder="proxy host" className="border border-gray-200 rounded px-2 py-1 text-xs" />
                                  <input value={pf.port} onChange={e => setPf({ port: e.target.value })}
                                    placeholder="port" className="border border-gray-200 rounded px-2 py-1 text-xs" />
                                  <input value={pf.user} onChange={e => setPf({ user: e.target.value })}
                                    placeholder="username (opt)" className="border border-gray-200 rounded px-2 py-1 text-xs" />
                                  <input type="password" value={pf.password} onChange={e => setPf({ password: e.target.value })}
                                    placeholder="password (opt)" className="border border-gray-200 rounded px-2 py-1 text-xs" />
                                </div>
                                <button
                                  disabled={!pf.host || proxyMutation.isPending}
                                  onClick={() => proxyMutation.mutate({ id: account.id, proxy: pf })}
                                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
                                >
                                  Save Proxy
                                </button>
                                <p className="text-xs text-gray-400">e.g. Brightdata / Smartproxy residential IP for this account</p>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
