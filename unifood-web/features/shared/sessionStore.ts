/**
 * Data that survives a change of module or route inside one browser session (jj/cliente-ajustes-2
 * · A): a module paints its last known data at once and refreshes in the background, and its
 * loading skeleton only shows the first time.
 *
 * Every key carries the account (and, where it applies, the cafeteria), so nothing of one
 * account can show in another. `clearSessionStores()` runs before signing out; signing out and
 * signing in are full page loads, which also drop this memory.
 */
const stores = new Map<string, unknown>();

export function sessionStore<T>(key: string, create: () => T): T {
  if (!stores.has(key)) stores.set(key, create());
  return stores.get(key) as T;
}

/** Drops every key that starts with `prefix` (for example a worker who changed cafeteria). */
export function dropSessionStores(prefix: string) {
  for (const key of [...stores.keys()])
    if (key.startsWith(prefix)) stores.delete(key);
}

export function clearSessionStores() {
  stores.clear();
}
