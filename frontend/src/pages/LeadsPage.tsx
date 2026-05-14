import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Plus, X, SkipForward, Mail, Sparkles, Search, Download, Link2, Users } from 'lucide-react';
import { leadsApi, campaignsApi, crmApi, accountsApi } from '../lib/api';

interface Lead {
  id: string;
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  status: string;
  campaign_id: string;
  updated_at: number;
  email: string | null;
  email_status: 'pending' | 'found' | 'not_found' | null;
  // enrichment
  headline: string | null;
  location: string | null;
  years_at_company: string | null;
  school: string | null;
  skills: string | null;
  recent_post: string | null;
  mutual_connections: string | null;
  enriched_at: number | null;
  replied_at: number | null;
  crm_contact_id: string | null;
  crm_synced_at: number | null;
}

interface Campaign { id: string; name: string }

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-gray-500',
  in_progress: 'text-blue-600',
  completed: 'text-green-600',
  skipped: 'text-yellow-600',
  replied: 'text-purple-600',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  skipped: 'Skipped',
  replied: 'Replied ✉',
};

export function LeadsPage() {
  const qc = useQueryClient();
  const [campaignFilter, setCampaignFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSalesNavModal, setShowSalesNavModal] = useState(false);
  const [showLinkedInSearchModal, setShowLinkedInSearchModal] = useState(false);
  const [liSearchUrl, setLiSearchUrl] = useState('');
  const [liSearchCampaign, setLiSearchCampaign] = useState('');
  const [liSearchAccount, setLiSearchAccount] = useState('');
  const [liSearchMax, setLiSearchMax] = useState(50);
  const [liSearchResult, setLiSearchResult] = useState<{ added: number; skipped: number; total_found: number; pages_scraped: number } | null>(null);
  const [salesNavUrl, setSalesNavUrl] = useState('');
  const [salesNavCampaign, setSalesNavCampaign] = useState('');
  const [salesNavMax, setSalesNavMax] = useState(25);
  const [salesNavResult, setSalesNavResult] = useState<{ added: number; skipped: number; total_found: number } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvCampaign, setCsvCampaign] = useState('');
  const [csvResult, setCsvResult] = useState<{ added: number; skipped: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', campaignFilter, statusFilter, page],
    queryFn: () => leadsApi.list({ campaign_id: campaignFilter || undefined, status: statusFilter || undefined, page, limit: 25 }),
  });

  const { data: campaigns = [] } = useQuery({ queryKey: ['campaigns'], queryFn: campaignsApi.list });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });

  const skipMutation = useMutation({
    mutationFn: (id: string) => leadsApi.skip(id, 'manual'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  const discoverEmailMutation = useMutation({
    mutationFn: (id: string) => leadsApi.discoverEmail(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  const importMutation = useMutation({
    mutationFn: () => leadsApi.importCsv(csvCampaign, csvFile!),
    onSuccess: (res) => { setCsvResult(res); qc.invalidateQueries({ queryKey: ['leads'] }); },
  });

  const salesNavMutation = useMutation({
    mutationFn: () => leadsApi.importSalesNav(salesNavCampaign, salesNavUrl, salesNavMax),
    onSuccess: (res) => { setSalesNavResult(res); qc.invalidateQueries({ queryKey: ['leads'] }); },
  });

  const liSearchMutation = useMutation({
    mutationFn: () => leadsApi.importLinkedInSearch(liSearchCampaign, liSearchAccount, liSearchUrl, liSearchMax),
    onSuccess: (res) => { setLiSearchResult(res); qc.invalidateQueries({ queryKey: ['leads'] }); },
  });

  // Add lead form state
  const [addForm, setAddForm] = useState({ campaign_id: '', linkedin_url: '', first_name: '', last_name: '', company: '', title: '' });
  const addMutation = useMutation({
    mutationFn: () => leadsApi.create(addForm),
    onSuccess: () => { setShowAddModal(false); setAddForm({ campaign_id: '', linkedin_url: '', first_name: '', last_name: '', company: '', title: '' }); qc.invalidateQueries({ queryKey: ['leads'] }); },
  });

  const crmSyncMutation = useMutation({
    mutationFn: (id: string) => crmApi.syncLead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  const leads: Lead[] = data?.leads ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 25) || 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Leads <span className="text-gray-400 text-base font-normal">({total})</span></h1>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowLinkedInSearchModal(true)} className="flex items-center gap-2 px-3 py-2 border border-blue-600 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            <Users size={15} /> <span>LinkedIn Search</span>
          </button>
          <button onClick={() => setShowSalesNavModal(true)} className="flex items-center gap-2 px-3 py-2 border border-blue-300 text-blue-600 text-sm rounded-lg hover:bg-blue-50 transition-colors">
            <Search size={15} /> <span className="hidden sm:inline">Sales Navigator</span><span className="sm:hidden">SalesNav</span>
          </button>
          <button
            onClick={() => {
              const params = campaignFilter ? `?campaign_id=${campaignFilter}` : '';
              window.open(`/api/leads/export/csv${params}`, '_blank');
            }}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download size={15} /> <span className="hidden sm:inline">Export CSV</span>
          </button>
          <button onClick={() => setShowCsvModal(true)} className="flex items-center gap-2 px-3 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors">
            <Upload size={15} /> <span className="hidden sm:inline">Import CSV</span>
          </button>
          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={15} /> Add Lead
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select value={campaignFilter} onChange={e => { setCampaignFilter(e.target.value); setPage(1); }} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="">All Campaigns</option>
          {(campaigns as Campaign[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="">All Statuses</option>
          {['pending', 'in_progress', 'completed', 'skipped'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              {['Name', 'Company', 'Title', 'Email', 'Status', 'Last Action', ''].map(h => (
                <th key={h} className="text-left text-xs font-medium text-gray-500 px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading…</td></tr>}
            {!isLoading && leads.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">No leads found</td></tr>}
            {leads.map(l => (
              <tr key={l.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <a href={l.linkedin_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">
                      {[l.first_name, l.last_name].filter(Boolean).join(' ') || '—'}
                    </a>
                    {l.enriched_at && (
                      <span title={[
                        l.headline && `Headline: ${l.headline}`,
                        l.location && `Location: ${l.location}`,
                        l.years_at_company && `Tenure: ${l.years_at_company}`,
                        l.school && `School: ${l.school}`,
                        l.skills && `Skills: ${l.skills}`,
                        l.mutual_connections && `Mutual: ${l.mutual_connections}`,
                      ].filter(Boolean).join('\n')}>
                        <Sparkles size={11} className="text-purple-400 cursor-help" />
                      </span>
                    )}
                  </div>
                  {l.headline && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[180px]">{l.headline}</p>}
                </td>
                <td className="px-4 py-3 text-gray-600">{l.company || '—'}</td>
                <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">{l.title || '—'}</td>
                <td className="px-4 py-3">
                  {l.email ? (
                    <a href={`mailto:${l.email}`} className="text-blue-600 text-xs hover:underline">{l.email}</a>
                  ) : l.email_status === 'pending' ? (
                    <span className="text-gray-400 text-xs">Searching…</span>
                  ) : l.email_status === 'not_found' ? (
                    <span className="text-gray-400 text-xs">Not found</span>
                  ) : (
                    <button
                      onClick={() => discoverEmailMutation.mutate(l.id)}
                      disabled={discoverEmailMutation.isPending}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
                    >
                      <Mail size={10} /> Find
                    </button>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`font-medium ${STATUS_COLOR[l.status] ?? 'text-gray-500'}`}>
                    {STATUS_LABEL[l.status] ?? l.status}
                  </span>
                  {l.crm_synced_at && (
                    <span title={`Synced to CRM: ${l.crm_contact_id}`} className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-teal-600">
                      <Link2 size={10} />CRM
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(l.updated_at * 1000).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {l.status !== 'skipped' && l.status !== 'completed' && (
                      <button onClick={() => skipMutation.mutate(l.id)} className="text-gray-400 hover:text-yellow-600" title="Skip">
                        <SkipForward size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => crmSyncMutation.mutate(l.id)}
                      disabled={crmSyncMutation.isPending}
                      className="text-gray-400 hover:text-teal-600 disabled:opacity-40"
                      title={l.crm_synced_at ? 'Re-sync to CRM' : 'Sync to CRM'}
                    >
                      <Link2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
        </div>
      </div>

      {/* LinkedIn Search Import Modal */}
      {showLinkedInSearchModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Users size={16} className="text-blue-600" /> Import from LinkedIn Search
              </h2>
              <button onClick={() => { setShowLinkedInSearchModal(false); setLiSearchResult(null); setLiSearchUrl(''); }}><X size={18} /></button>
            </div>

            {liSearchResult ? (
              <div className="space-y-3">
                <p className="text-green-600 font-semibold">Import complete!</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Added', value: liSearchResult.added },
                    { label: 'Skipped (duplicates)', value: liSearchResult.skipped },
                    { label: 'Total found on LinkedIn', value: liSearchResult.total_found },
                    { label: 'Pages scraped', value: liSearchResult.pages_scraped },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="text-lg font-bold text-gray-900">{value}</p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setShowLinkedInSearchModal(false); setLiSearchResult(null); setLiSearchUrl(''); }}
                  className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800 space-y-2">
                  <p className="font-semibold">Як отримати URL пошуку:</p>
                  <ol className="list-decimal list-inside space-y-1 text-blue-700">
                    <li>Зайди на <strong>linkedin.com/search/results/people/</strong></li>
                    <li>Встав фільтри: посада, країна, галузь, компанія</li>
                    <li>Скопіюй URL з адресного рядка і встав нижче</li>
                  </ol>
                </div>

                <div className="space-y-3">
                  <select
                    value={liSearchCampaign}
                    onChange={e => setLiSearchCampaign(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Оберіть кампанію…</option>
                    {(campaigns as Campaign[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>

                  <select
                    value={liSearchAccount}
                    onChange={e => setLiSearchAccount(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Оберіть акаунт LinkedIn…</option>
                    {(accounts as Array<{ id: string; name: string; status: string }>)
                      .filter(a => a.status === 'active')
                      .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>

                  <input
                    value={liSearchUrl}
                    onChange={e => setLiSearchUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/search/results/people/?keywords=..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />

                  <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 shrink-0">Максимум лідів:</label>
                    <input
                      type="number" min={5} max={200} value={liSearchMax}
                      onChange={e => setLiSearchMax(Number(e.target.value))}
                      className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
                    />
                    <span className="text-xs text-gray-400">(10 лідів = ~1 сторінка)</span>
                  </div>
                </div>

                {liSearchMutation.isError && (
                  <p className="text-red-500 text-sm">
                    {String((liSearchMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Помилка імпорту')}
                  </p>
                )}

                <button
                  onClick={() => liSearchMutation.mutate()}
                  disabled={!liSearchCampaign || !liSearchAccount || !liSearchUrl || liSearchMutation.isPending}
                  className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {liSearchMutation.isPending ? 'Скрапінг… (може зайняти 1-2 хв)' : 'Імпортувати лідів'}
                </button>
                <p className="text-xs text-gray-400 text-center">
                  Бот відкриє LinkedIn через акаунт Alyona Scaleo і збере профілі з результатів пошуку
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sales Navigator Import Modal */}
      {showSalesNavModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Search size={16} className="text-blue-600" /> Import from Sales Navigator
              </h2>
              <button onClick={() => { setShowSalesNavModal(false); setSalesNavResult(null); setSalesNavUrl(''); }}><X size={18} /></button>
            </div>

            {salesNavResult ? (
              <div className="space-y-3">
                <p className="text-green-600 font-medium">Import complete!</p>
                <p className="text-sm text-gray-600">
                  Found: <strong>{salesNavResult.total_found}</strong> total ·
                  Added: <strong>{salesNavResult.added}</strong> ·
                  Skipped: <strong>{salesNavResult.skipped}</strong>
                </p>
                <button onClick={() => { setShowSalesNavModal(false); setSalesNavResult(null); setSalesNavUrl(''); }}
                  className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Done</button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  Paste a LinkedIn Sales Navigator search URL. Your active LinkedIn session must have a Sales Navigator subscription.
                </p>
                <select value={salesNavCampaign} onChange={e => setSalesNavCampaign(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select campaign…</option>
                  {(campaigns as Campaign[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input
                  value={salesNavUrl}
                  onChange={e => setSalesNavUrl(e.target.value)}
                  placeholder="https://www.linkedin.com/sales/search/people?..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-700 shrink-0">Max leads:</label>
                  <input type="number" min={1} max={100} value={salesNavMax}
                    onChange={e => setSalesNavMax(Number(e.target.value))}
                    className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                {salesNavMutation.isError && (
                  <p className="text-red-500 text-xs">{String((salesNavMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Import failed')}</p>
                )}
                <button
                  onClick={() => salesNavMutation.mutate()}
                  disabled={!salesNavCampaign || !salesNavUrl || salesNavMutation.isPending}
                  className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40"
                >
                  {salesNavMutation.isPending ? 'Scraping… (may take 30s)' : 'Import Leads'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCsvModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Import CSV</h2>
              <button onClick={() => { setShowCsvModal(false); setCsvFile(null); setCsvResult(null); }}><X size={18} /></button>
            </div>

            {csvResult ? (
              <div className="space-y-2">
                <p className="text-green-600 font-medium">Import complete!</p>
                <p className="text-sm text-gray-600">Added: <strong>{csvResult.added}</strong> · Skipped: <strong>{csvResult.skipped}</strong> · Errors: <strong>{csvResult.errors}</strong></p>
                <button onClick={() => { setShowCsvModal(false); setCsvFile(null); setCsvResult(null); }} className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Done</button>
              </div>
            ) : (
              <>
                <select value={csvCampaign} onChange={e => setCsvCampaign(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select campaign…</option>
                  {(campaigns as Campaign[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl py-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
                >
                  <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600">{csvFile ? csvFile.name : 'Click to upload CSV'}</p>
                  <p className="text-xs text-gray-400 mt-1">Columns: linkedin_url, first_name, last_name, company, title</p>
                </div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => setCsvFile(e.target.files?.[0] ?? null)} />
                <button
                  onClick={() => importMutation.mutate()}
                  disabled={!csvCampaign || !csvFile || importMutation.isPending}
                  className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {importMutation.isPending ? 'Importing…' : 'Import'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Add Lead</h2>
              <button onClick={() => setShowAddModal(false)}><X size={18} /></button>
            </div>
            {(['campaign_id', 'linkedin_url', 'first_name', 'last_name', 'company', 'title'] as const).map(field => (
              <div key={field}>
                {field === 'campaign_id' ? (
                  <select value={addForm.campaign_id} onChange={e => setAddForm(f => ({ ...f, campaign_id: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select campaign…</option>
                    {(campaigns as Campaign[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <input
                    placeholder={field.replace(/_/g, ' ')}
                    value={addForm[field]}
                    onChange={e => setAddForm(f => ({ ...f, [field]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                )}
              </div>
            ))}
            <button
              onClick={() => addMutation.mutate()}
              disabled={!addForm.campaign_id || !addForm.linkedin_url || addMutation.isPending}
              className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40"
            >
              Add Lead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
