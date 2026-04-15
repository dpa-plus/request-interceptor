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
          success: {
            iconTheme: {
              primary: '#3fb950',
              secondary: '#0d1117',
            },
          },
          error: {
            iconTheme: {
              primary: '#f85149',
              secondary: '#0d1117',
            },
          },
        }}
      />
      <nav className="bg-[#161b22] border-b border-[#30363d]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <span className="text-lg font-bold text-gray-100">
                  Request Interceptor
                </span>
              </div>
              <div className="ml-10 flex items-center space-x-1">
                <NavLink
                  to="/"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[#1f6feb33] text-[#58a6ff]'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                    }`
                  }
                >
                  Requests
                </NavLink>
                <NavLink
                  to="/ai"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[#8b5cf633] text-[#a78bfa]'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                    }`
                  }
                >
                  AI Requests
                </NavLink>
                <NavLink
                  to="/routing"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[#1f6feb33] text-[#58a6ff]'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                    }`
                  }
                >
                  Routing Rules
                </NavLink>
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[#1f6feb33] text-[#58a6ff]'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c2333]'
                    }`
                  }
                >
                  Settings
                </NavLink>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ai" element={<AiDashboard />} />
          <Route path="/request/:id" element={<RequestDetail />} />
          <Route path="/routing" element={<RoutingRules />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      <footer className="fixed bottom-2 right-3">
        <a
          href="https://dpa.plus"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs opacity-40 hover:opacity-100 transition-opacity"
          style={{ color: '#FF6100' }}
        >
          DPA+
        </a>
      </footer>
    </div>
  );
}

export default App;
