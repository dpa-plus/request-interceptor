import { useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

interface LoginScreenProps {
  mode: 'basic' | 'google';
  loginUrl: string;
  onLoggedIn?: () => void;
  error?: string | null;
}

export function LoginScreen({ mode, loginUrl, onLoggedIn, error }: LoginScreenProps) {
  return (
    <div className="h-full w-full bg-[#0d1117] flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-[#161b22] border border-[#30363d] rounded-lg p-6 shadow-xl">
        <div className="flex flex-col items-center gap-2 mb-6">
          <span className="text-2xl font-bold" style={{ color: '#FF6100' }}>DPA+</span>
          <h1 className="text-lg font-medium text-gray-200">Request Interceptor</h1>
          <p className="text-sm text-gray-500 text-center">
            Sign in to access the dashboard.
          </p>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded border border-red-800/50 bg-red-900/20 text-red-300 text-sm">
            {error}
          </div>
        )}

        {mode === 'basic'
          ? <BasicLoginForm onLoggedIn={onLoggedIn} />
          : <GoogleLoginButton loginUrl={loginUrl} />}
      </div>
    </div>
  );
}

function BasicLoginForm({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        if (onLoggedIn) onLoggedIn();
        else window.location.reload();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setFormError(data?.error || 'Sign-in failed. Please try again.');
    } catch {
      setFormError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // method/action are set so password managers reliably detect this as a
    // login form and offer to fill / save credentials; submission is handled
    // in JS via onSubmit (preventDefault).
    <form method="post" action="/api/auth/login" onSubmit={handleSubmit} className="flex flex-col gap-3">
      {formError && (
        <div className="px-3 py-2 rounded border border-red-800/50 bg-red-900/20 text-red-300 text-sm">
          {formError}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-400">Username</span>
        <input
          type="text"
          name="username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-gray-200 focus:outline-none focus:border-[#58a6ff]"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-400">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-gray-200 focus:outline-none focus:border-[#58a6ff]"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full px-4 py-2.5 rounded-md bg-[#1f6feb] hover:bg-[#1a5fd4] disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function GoogleLoginButton({ loginUrl }: { loginUrl: string }) {
  const returnTo = window.location.pathname + window.location.search;
  const href = `${loginUrl}?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <>
      <a
        href={href}
        className="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-md bg-white text-gray-800 hover:bg-gray-100 transition-colors font-medium text-sm shadow-sm"
      >
        <GoogleIcon />
        <span>Sign in with Google</span>
      </a>
      <p className="mt-4 text-xs text-gray-600 text-center">
        Access is restricted to allow-listed accounts.
      </p>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
