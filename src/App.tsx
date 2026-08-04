import { NavLink, Route, Routes } from 'react-router-dom';
import Ask from './pages/Ask';
import Home from './pages/Home';
import Meals from './pages/Meals';
import Settings from './pages/Settings';

const tabs = [
  { to: '/', label: 'Log', icon: NotebookPenIcon, end: true, className: 'nav-tab-log' },
  { to: '/ask', label: 'Ask', icon: AudioLinesIcon, end: false, className: 'nav-tab-ask' },
  { to: '/meals', label: 'Meals', icon: UtensilsCrossedIcon, end: false, className: 'nav-tab-meals' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
];

function App() {
  return (
    <div className="app-stage">
      <div className="phone-shell">
        <div className="phone-button phone-button-left-top" />
        <div className="phone-button phone-button-left-mid" />
        <div className="phone-button phone-button-right" />

        <div className="app-screen">
          <div className="dynamic-island" aria-hidden="true" />

          <main className="app-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="/meals" element={<Meals />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
          </main>

          <nav className="absolute inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto flex max-w-md">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `nav-tab ${tab.className ?? ''} flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
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
    </div>
  );
}

export default App;

function NotebookPenIcon({ className }: { className?: string }) {
  return (
    <svg className={`notebook-pen-icon ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="nav-icon-fill notebook-fill" d="M6 2h7.4l6.6 10.6V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path className="notebook-page" d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
      <path className="notebook-ring notebook-ring-1" d="M2 6h4" />
      <path className="notebook-ring notebook-ring-2" d="M2 10h4" />
      <path className="notebook-ring notebook-ring-3" d="M2 14h4" />
      <path className="notebook-ring notebook-ring-4" d="M2 18h4" />
      <path className="notebook-pen" d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
    </svg>
  );
}

function UtensilsCrossedIcon({ className }: { className?: string }) {
  return (
    <svg className={`utensils-crossed ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle className="nav-icon-fill meals-fill" cx="12" cy="12" r="8.2" />
      <path className="utensil-fork" d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" />
      <path className="utensil-main" d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" />
      <path className="utensil-handle" d="m2.1 21.8 6.4-6.3" />
      <path className="utensil-knife" d="m19 5-7 7" />
    </svg>
  );
}

function AudioLinesIcon({ className }: { className?: string }) {
  return (
    <svg className={`audio-lines-icon ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect className="nav-icon-fill ask-fill" x="3.5" y="3.5" width="17" height="17" rx="8.5" />
      <path className="audio-line audio-line-1" d="M2 10v3" />
      <path className="audio-line audio-line-2" d="M6 6v11" />
      <path className="audio-line audio-line-3" d="M10 3v18" />
      <path className="audio-line audio-line-4" d="M14 8v7" />
      <path className="audio-line audio-line-5" d="M18 5v13" />
      <path className="audio-line audio-line-6" d="M22 10v3" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={`settings-icon ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle className="nav-icon-fill settings-fill" cx="12" cy="12" r="7.4" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
