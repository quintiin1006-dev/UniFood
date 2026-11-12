/**
 * The Idempotency-Key of one order attempt. It is created when the client starts confirming,
 * reused for every retry of the same content (lost response, double click, reload) and
 * replaced only after a success or when the content changes (docs/decisiones.md §6/§11).
 */
export type Attempt = { signature: string; key: string };

export const ATTEMPT_STORAGE_KEY = "unifood.client.order-attempt.v1";
// chk_orders_idempotency_key_format (020).
const KEY_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * A random UUID v4. `crypto.randomUUID` only exists in secure contexts (HTTPS or localhost),
 * so over plain HTTP on a LAN address it is missing: `getRandomValues` is the fallback.
 */
export function randomKey(
  cryptoApi: Partial<Crypto> | undefined = globalThis.crypto,
) {
  if (typeof cryptoApi?.randomUUID === "function")
    return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function")
    cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}
const newKey = () => randomKey();

/** The attempt for this content: the previous one when nothing changed, else a fresh key. */
export function nextAttempt(
  previous: Attempt | null,
  signature: string,
  generate: () => string = newKey,
): Attempt {
  return previous && previous.signature === signature
    ? previous
    : { signature, key: generate() };
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const browserStore = (): Store | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

/** Survives a reload of the tab, so a lost response can still be retried with its key. */
export function readAttempt(
  ownerId: string,
  store: Store | null = browserStore(),
): Attempt | null {
  try {
    const saved = JSON.parse(store?.getItem(ATTEMPT_STORAGE_KEY) ?? "null");
    return saved?.ownerId === ownerId &&
      typeof saved.signature === "string" &&
      typeof saved.key === "string" &&
      KEY_FORMAT.test(saved.key)
      ? { signature: saved.signature, key: saved.key }
      : null;
  } catch {
    return null;
  }
}

export function saveAttempt(
  ownerId: string,
  attempt: Attempt,
  store: Store | null = browserStore(),
) {
  try {
    store?.setItem(
      ATTEMPT_STORAGE_KEY,
      JSON.stringify({ ownerId, ...attempt }),
    );
  } catch {
    // The key still lives in memory for this page.
  }
}

export function clearAttempt(store: Store | null = browserStore()) {
  try {
    store?.removeItem(ATTEMPT_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
