export function apiFetch(path: string, init?: RequestInit) {
  const url = new URL(path, window.location.origin);
  const headers = new Headers(init?.headers);

  // Mark every request as coming from the dashboard SPA. The server uses this
  // to authenticate dashboard traffic by session cookie ONLY — it deliberately
  // ignores any `Authorization: Basic` header here (browsers keep auto-sending
  // cached Basic credentials even after "clear site data", which would
  // otherwise keep the user logged in and hide the login screen). Plain API
  // clients (curl -u …) omit this header and keep working via Basic auth.
  headers.set('X-Dashboard', '1');

  return fetch(url.toString(), { credentials: 'same-origin', ...init, headers });
}
