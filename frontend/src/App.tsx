import { Routes, Route, NavLink } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Dashboard from './pages/Dashboard';
import AiDashboard from './pages/AiDashboard';
import RequestDetail from './pages/RequestDetail';
import RoutingRules from './pages/RoutingRules';
import Settings from './pages/Settings';

function App() {
  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
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
      <nav className="bg-[#161b22] border-b border-[#30363d] px-3">
        <div className="flex items-center h-10 gap-4">
          <span className="text-sm font-bold text-gray-300 mr-2">RI</span>
          <div className="flex items-center gap-0.5">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#1f6feb33] text-[#58a6ff]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                }`
              }
            >
              Requests
            </NavLink>
            <NavLink
              to="/ai"
              className={({ isActive }) =>
                `px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#8b5cf633] text-[#a78bfa]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                }`
              }
            >
              AI
            </NavLink>
            <NavLink
              to="/routing"
              className={({ isActive }) =>
                `px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#1f6feb33] text-[#58a6ff]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                }`
              }
            >
              Routing
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  isActive ? 'bg-[#1f6feb33] text-[#58a6ff]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                }`
              }
            >
              Settings
            </NavLink>
          </div>
        </div>
      </nav>

      {/* Full width, no padding — pages control their own layout */}
      <main>
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

export default App;
