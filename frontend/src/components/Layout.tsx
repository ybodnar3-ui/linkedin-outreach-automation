import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Megaphone, Users, BarChart2, Settings,
  UserCircle, Inbox, ShieldOff, Zap, FlaskConical, Menu, X,
} from 'lucide-react';
import { useState } from 'react';

const nav = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/campaigns',  icon: Megaphone,        label: 'Campaigns' },
  { to: '/leads',      icon: Users,            label: 'Leads' },
  { to: '/inbox',      icon: Inbox,            label: 'Inbox' },
  { to: '/analytics',  icon: BarChart2,        label: 'Analytics' },
  { to: '/ab-tests',   icon: FlaskConical,     label: 'A/B Tests' },
  { to: '/webhooks',   icon: Zap,              label: 'Webhooks' },
  { to: '/accounts',   icon: UserCircle,       label: 'Accounts' },
  { to: '/blacklist',  icon: ShieldOff,        label: 'Blacklist' },
  { to: '/settings',   icon: Settings,         label: 'Settings' },
];

// Bottom nav shows only the 5 most-used items on mobile
const mobileNav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/campaigns', icon: Megaphone,       label: 'Campaigns' },
  { to: '/leads',     icon: Users,           label: 'Leads' },
  { to: '/inbox',     icon: Inbox,           label: 'Inbox' },
  { to: '/settings',  icon: Settings,        label: 'Settings' },
];

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0">
        <div className="h-14 flex items-center px-5 border-b border-gray-200">
          <span className="font-bold text-blue-600 text-lg">LI Outreach</span>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-3 overflow-y-auto">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* ── Mobile slide-over menu ───────────────────────────────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          {/* Panel */}
          <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl flex flex-col">
            <div className="h-14 flex items-center justify-between px-5 border-b border-gray-200">
              <span className="font-bold text-blue-600 text-lg">LI Outreach</span>
              <button onClick={() => setMenuOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 py-4 space-y-0.5 px-3 overflow-y-auto">
              {nav.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* ── Main content area ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
          <button onClick={() => setMenuOpen(true)} className="text-gray-600 hover:text-gray-900">
            <Menu size={22} />
          </button>
          <span className="font-bold text-blue-600 text-base">LI Outreach</span>
          <div className="w-6" /> {/* spacer */}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex z-30">
        {mobileNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`
            }
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
