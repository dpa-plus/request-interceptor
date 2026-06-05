export function apiFetch(path: string, init?: RequestInit) {
  const url = new URL(path, window.location.origin);
  const currentUrl = new URL(window.location.href);
  const headers = new Headers(init?.headers);

  if (currentUrl.username && !headers.has('Authorization')) {
    const user = decodeURIComponent(currentUrl.username);
    const password = decodeURIComponent(currentUrl.password);
    headers.set('Authorization', `Basic ${btoa(`${user}:${password}`)}`);
  }

  return fetch(url.toString(), { credentials: 'same-origin', ...init, headers });
}
