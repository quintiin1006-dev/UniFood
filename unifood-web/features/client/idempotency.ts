/**
 * The Idempotency-Key of one order attempt. It is created when the client starts confirming,
 * reused for every retry of the same content (lost response, double click, reload) and
 * replaced only after a success or when the content changes (docs/decisiones.md §6/§11).
 */
export type Attempt = { signature: string; key: string };

export const ATTEMPT_STORAGE_KEY = "unifood.client.order-attempt.v1";
// chk_orders_idempotency_key_format (020).
const KEY_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;

const newKey = () => globalThis.crypto.randomUUID();

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
