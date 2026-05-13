/**
 * OnboardingWizard — shown on first launch when no accounts exist.
 * 3 steps: Welcome → Connect LinkedIn → First Campaign
 * Disappears once dismissed (stored in localStorage).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Rocket, Linkedin, CheckCircle2, ArrowRight, X } from 'lucide-react';
import { settingsApi, accountsApi } from '../lib/api';

const STEPS = [
  {
    icon: Rocket,
    title: 'Welcome to LI Outreach',
    desc: 'Your self-hosted LinkedIn automation platform. Let\'s get you set up in 2 minutes.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    icon: Linkedin,
    title: 'Connect your LinkedIn account',
    desc: 'We\'ll open a browser window where you log in. Your session is saved locally — we never see your password.',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
  },
  {
    icon: CheckCircle2,
    title: 'You\'re all set!',
    desc: 'Create your first campaign and start reaching out to leads automatically.',
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
];

interface Props {
  onDismiss: () => void;
}

export function OnboardingWizard({ onDismiss }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [accountName, setAccountName] = useState('');
  const [loginStarted, setLoginStarted] = useState(false);

  const createAndLogin = useMutation({
    mutationFn: async () => {
      const acc = await accountsApi.create({ name: accountName || 'My LinkedIn Account' });
      await accountsApi.login(acc.id);
      return acc;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setLoginStarted(true);
      setStep(2);
    },
  });

  const quickLogin = useMutation({
    mutationFn: settingsApi.login,
    onSuccess: () => {
      setLoginStarted(true);
      setStep(2);
    },
  });

  const S = STEPS[step];
  const Icon = S.icon;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative">
        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 text-gray-300 hover:text-gray-500"
          title="Dismiss setup wizard"
        >
          <X size={18} />
        </button>

        {/* Progress dots */}
        <div className="flex gap-1.5 justify-center pt-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-blue-600' : i < step ? 'w-3 bg-blue-300' : 'w-3 bg-gray-200'
              }`}
            />
          ))}
        </div>

        <div className="p-8 space-y-5">
          {/* Icon */}
          <div className={`w-14 h-14 rounded-2xl ${S.bg} flex items-center justify-center`}>
            <Icon size={28} className={S.color} />
          </div>

          {/* Title + desc */}
          <div>
            <h2 className="text-xl font-bold text-gray-900">{S.title}</h2>
            <p className="text-sm text-gray-500 mt-1.5">{S.desc}</p>
          </div>

          {/* Step-specific content */}
          {step === 0 && (
            <div className="space-y-2 text-sm text-gray-600">
              {['No monthly subscription — self-hosted', 'Full REST API access', 'A/B testing with winner detection', 'Dynamic limits with account health'].map(f => (
                <div key={f} className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <input
                value={accountName}
                onChange={e => setAccountName(e.target.value)}
                placeholder="Account name (e.g. Work Account)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <p className="text-xs text-gray-400">
                A browser window will open — log in with your LinkedIn credentials. The session is saved locally.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-2 text-sm text-gray-600">
              {loginStarted && (
                <div className="p-3 bg-blue-50 rounded-lg text-blue-700 text-sm">
                  Complete the LinkedIn login in the browser window that opened. Your session will be saved automatically.
                </div>
              )}
              <p>Next steps:</p>
              {['Go to Campaigns → create your first campaign', 'Import leads from CSV or add manually', 'Press Play — automation starts!'].map((s, i) => (
                <div key={s} className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">{i + 1}</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="flex gap-3 pt-1">
            {step === 0 && (
              <button
                onClick={() => setStep(1)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"
              >
                Get Started <ArrowRight size={15} />
              </button>
            )}

            {step === 1 && (
              <>
                <button
                  onClick={() => createAndLogin.mutate()}
                  disabled={createAndLogin.isPending}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50"
                >
                  <Linkedin size={15} />
                  {createAndLogin.isPending ? 'Opening browser…' : 'Connect LinkedIn'}
                </button>
                <button
                  onClick={() => quickLogin.mutate()}
                  disabled={quickLogin.isPending}
                  className="px-4 py-2.5 border border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50 disabled:opacity-50"
                >
                  Legacy login
                </button>
              </>
            )}

            {step === 2 && (
              <button
                onClick={() => { onDismiss(); navigate('/campaigns/new'); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700"
              >
                <Rocket size={15} /> Create First Campaign
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
