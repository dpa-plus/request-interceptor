/**
 * Minimal in-memory TTL cache keyed by stringified params. Used to take the
 * heat off the DB when the dashboard polls /api/stats every 30s — multiple
 * users / browser tabs hit the same cached value instead of triggering 9
 * aggregations each time.
 *
 * Memory-bounded by `MAX_ENTRIES`; oldest entries get evicted on overflow.
 * Safe to use across concurrent requests since Node is single-threaded for JS.
 */

const MAX_ENTRIES = 64;

interface Entry<V> {
  value: V;
  expiresAt: number;
}

const stores = new Map<string, Map<string, Entry<unknown>>>();

function getStore<V>(namespace: string): Map<string, Entry<V>> {
  let store = stores.get(namespace) as Map<string, Entry<V>> | undefined;
  if (!store) {
    store = new Map<string, Entry<V>>();
    stores.set(namespace, store as Map<string, Entry<unknown>>);
  }
  return store;
}

export async function cached<V>(
  namespace: string,
  key: string,
  ttlMs: number,
  produce: () => Promise<V>
): Promise<V> {
  const store = getStore<V>(namespace);
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await produce();
  store.set(key, { value, expiresAt: now + ttlMs });

  // Bound memory: evict the oldest entry once we exceed the cap.
  if (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }

  return value;
}

export function invalidateNamespace(namespace: string): void {
  stores.delete(namespace);
}
