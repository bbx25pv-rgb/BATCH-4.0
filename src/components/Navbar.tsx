import { User } from 'firebase/auth';
import { ActiveTab } from '@/src/types';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  user: User | null;
  isAdmin: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function Navbar({
  activeTab,
  onSelectTab,
  user,
  isAdmin,
  onSignIn,
  onSignOut,
}: NavbarProps) {
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'batches', label: 'Lecture Batches' },
    { id: 'logs', label: 'Session Logs' },
  ];

  if (isAdmin) {
    navItems.push({ id: 'admin', label: 'Admin Console' });
  }

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('batches')}
          className="text-base sm:text-lg font-extrabold tracking-tight text-[#0B1120] font-display whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
        >
          Cadence Study
        </button>

        {/* Zone 2: 3–4 single-line text navigation links */}
        <nav aria-label="Primary" className="hidden md:flex items-center gap-7">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600 ${
                  isActive
                    ? 'text-indigo-700 border-indigo-700'
                    : 'text-slate-600 border-transparent hover:text-[#0B1120] hover:border-slate-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          {user ? (
            <button
              type="button"
              onClick={onSignOut}
              className="px-3.5 sm:px-4 min-h-[38px] sm:min-h-[36px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Sign out
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="px-4 sm:px-4.5 min-h-[38px] sm:min-h-[36px] text-xs font-semibold text-white bg-[#0B1120] hover:bg-indigo-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Responsive mobile nav bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden border-t border-slate-100 px-4 flex items-center gap-5 overflow-x-auto bg-white"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`min-h-[42px] flex items-center text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                isActive
                  ? 'text-indigo-700 border-indigo-700'
                  : 'text-slate-600 border-transparent hover:text-[#0B1120]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
