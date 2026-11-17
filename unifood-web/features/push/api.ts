// Browser calls to the push BFF. Same-origin, no-store; the session cookie identifies the user.
import { parsePublicKey } from "./contracts";
import type { PushRole } from "./state";

const BASE: Record<PushRole, string> = {
  client: "/api/me/push",
  worker: "/api/worker/push",
};
const TIMEOUT_MS = 15000;

export class PushRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function failure(response: Response) {
  const body: { code?: unknown } | null = await response
    .json()
    .catch(() => null);
  return new PushRequestError(
    response.status,
    typeof body?.code === "string" ? body.code : "PUSH_UNAVAILABLE",
  );
}

export async function fetchPublicKey(role: PushRole): Promise<string> {
  const response = await fetch(`${BASE[role]}/public-key`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response);
  const key = parsePublicKey(await response.json().catch(() => null));
  if (!key) throw new PushRequestError(502, "PUSH_UNAVAILABLE");
  return key.publicKey;
}

export async function saveSubscription(
  role: PushRole,
  subscription: PushSubscription,
) {
  const json = subscription.toJSON();
  const response = await fetch(`${BASE[role]}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response);
}

export async function removeSubscription(
  role: PushRole,
  endpoint: string,
  timeout = TIMEOUT_MS,
) {
  const response = await fetch(`${BASE[role]}/subscribe`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok && response.status !== 401) throw await failure(response);
}
