import { useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Dashboard from './pages/Dashboard';
import AiDashboard from './pages/AiDashboard';
import RequestDetail from './pages/RequestDetail';
import RoutingRules from './pages/RoutingRules';
import Settings from './pages/Settings';
import { LoginScreen } from './components/LoginScreen';

type AuthState =
  | { status: 'loading' }
  | { status: 'authed'; mode: 'basic' | 'google'; user: { name?: string; email?: string; picture?: string } }
  | { status: 'unauthed'; loginUrl: string };

function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setAuth({ status: 'authed', mode: data.mode, user: data.user || {} });
        } else if (res.status === 401) {
          const data = await res.json().catch(() => ({}));
          if (data?.requiresLogin && data?.loginUrl) {
            setAuth({ status: 'unauthed', loginUrl: data.loginUrl });
          } else {
            // Basic-auth mode: the browser will handle the WWW-Authenticate prompt,
            // so just reload to trigger it. Once the user types creds the next
            // /api/auth/me call will succeed.
            setAuth({ status: 'authed', mode: 'basic', user: {} });
          }
        } else {
          setAuth({ status: 'authed', mode: 'basic', user: {} });
        }
      } catch {
        if (!cancelled) setAuth({ status: 'authed', mode: 'basic', user: {} });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (auth.status === 'loading') {
    return (
      <div className="h-full w-full bg-[#0d1117] flex items-center justify-center text-gray-500 text-sm">
        Loading…
      </div>
    );
  }

  if (auth.status === 'unauthed') {
    return <LoginScreen loginUrl={auth.loginUrl} />;
  }

  return (
    <div className="h-full bg-[#0d1117] text-gray-200 flex flex-col overflow-hidden">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#1c2333',
            color: '#e6edf3',
            fontSize: '14px',
            border: '1px solid #30363d',
          },
          success: { iconTheme: { primary: '#3fb950', secondary: '#0d1117' } },
          error: { iconTheme: { primary: '#f85149', secondary: '#0d1117' } },
        }}
      />
      {/* Compact navbar - full width, no wasted space */}
      <nav className="bg-[#161b22] border-b border-[#30363d]">
        <div className="flex items-center h-11 gap-6 px-4">
          <a href="https://dpa.plus" target="_blank" rel="noopener noreferrer" className="text-sm font-bold hover:opacity-80 transition-opacity flex-shrink-0" style={{ color: '#FF6100' }}>
            DPA+
          </a>
          <div className="flex items-center gap-1 flex-1 justify-center">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-[#1f6feb33] text-[#58a6ff]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                }`
              }
            >
              Requests
            </NavLink>
            <NavLink
              to="/ai"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-[#8b5cf633] text-[#a78bfa]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                }`
              }
            >
              AI
            </NavLink>
            <NavLink
              to="/routing"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-[#1f6feb33] text-[#58a6ff]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                }`
              }
            >
              Routing
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-[#1f6feb33] text-[#58a6ff]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                }`
              }
            >
              Settings
            </NavLink>
          </div>
          <UserMenu auth={auth} />
        </div>
      </nav>

      {/* Full width, no padding — pages control their own layout */}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ai" element={<AiDashboard />} />
          <Route path="/request/:id" element={<RequestDetail />} />
          <Route path="/routing" element={<RoutingRules />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

function UserMenu({ auth }: { auth: Extract<AuthState, { status: 'authed' }> }) {
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {}
    window.location.href = '/';
  };

  if (auth.mode === 'basic' || !auth.user.email) {
    return null;
  }
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {auth.user.picture ? (
        <img src={auth.user.picture} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-[#1f6feb33] text-[#58a6ff] flex items-center justify-center text-xs font-bold">
          {(auth.user.email || '?').charAt(0).toUpperCase()}
        </div>
      )}
      <span className="text-xs text-gray-400 hidden sm:inline truncate max-w-[10rem]">{auth.user.email}</span>
      <button
        onClick={handleLogout}
        className="px-2 py-1 text-xs rounded text-gray-400 hover:text-gray-200 hover:bg-[#1c2333] transition-colors"
        title="Sign out"
      >
        Sign out
      </button>
    </div>
  );
}

export default App;
