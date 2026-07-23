import { NavLink, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import Meals from './pages/Meals';
import Settings from './pages/Settings';

const tabs = [
  { to: '/', label: 'Log', icon: '🎤', end: true },
  { to: '/meals', label: 'Meals', icon: '📋', end: false },
  { to: '/settings', label: 'Settings', icon: '⚙️', end: false },
];

function App() {
  return (
    <div className="min-h-screen bg-white pt-[env(safe-area-inset-top)]">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/meals" element={<Meals />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>

      <nav className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)]">
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
              <span className="text-lg">{tab.icon}</span>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export default App;
