import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import Meals from './pages/Meals';
import Settings from './pages/Settings';

const tabs = [
  { to: '/', label: 'Log', icon: MicIcon, end: true },
  { to: '/meals', label: 'Meals', icon: ListIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
];

function App() {
  return (
    // On phones this wrapper has no visible effect (the frame below is position:fixed
    // and covers the whole viewport regardless). From tablet width up, it centers the
    // app inside a phone-shaped frame instead of letting it stretch full-bleed.
    <div className="min-h-screen bg-neutral-200 md:flex md:items-center md:justify-center md:p-10">
      <div className="fixed inset-0 overflow-hidden bg-[#f6f4ef] text-neutral-950 md:static md:relative md:h-[852px] md:w-[393px] md:overflow-hidden md:rounded-[3rem] md:border-[10px] md:border-neutral-950 md:shadow-2xl">
        {/* Decorative notch, tablet/desktop only */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-50 hidden justify-center md:flex">
          <div className="mt-2 h-6 w-28 rounded-full bg-neutral-950" />
        </div>

        <main className="h-full overflow-y-auto pt-[env(safe-area-inset-top)]" style={{ WebkitOverflowScrolling: 'touch' }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/meals" element={<Meals />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        <nav className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:absolute">
          <div className="mx-auto flex max-w-md">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
                    isActive ? 'text-green-600' : 'text-neutral-400'
                  }`
                }
              >
                <tab.icon className="h-5 w-5" />
                {tab.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

export default App;

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
