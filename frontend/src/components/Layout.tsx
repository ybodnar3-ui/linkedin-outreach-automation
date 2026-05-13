import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Megaphone, Users, BarChart2, Settings, UserCircle, Inbox } from 'lucide-react';

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { to: '/leads', icon: Users, label: 'Leads' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
  { to: '/analytics', icon: BarChart2, label: 'Analytics' },
  { to: '/accounts', icon: UserCircle, label: 'Accounts' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-gray-200">
          <span className="font-bold text-blue-600 text-lg">LI Outreach</span>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-3">
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

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
