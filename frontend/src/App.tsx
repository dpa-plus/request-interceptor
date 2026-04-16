import { Routes, Route, NavLink } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Dashboard from './pages/Dashboard';
import AiDashboard from './pages/AiDashboard';
import RequestDetail from './pages/RequestDetail';
import RoutingRules from './pages/RoutingRules';
import Settings from './pages/Settings';

function App() {
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
        <div className="flex items-center justify-center h-11 gap-6 px-4">
          <a href="https://dpa.plus" target="_blank" rel="noopener noreferrer" className="text-sm font-bold hover:opacity-80 transition-opacity flex-shrink-0" style={{ color: '#FF6100' }}>
            DPA+
          </a>
          <div className="flex items-center gap-1">
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

export default App;
