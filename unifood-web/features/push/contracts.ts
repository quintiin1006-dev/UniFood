// Strict shapes exchanged with the browser and with Spring. Shared by the BFF and the client.

export const MAX_ENDPOINT_LENGTH = 2048;
const MAX_USER_AGENT_LENGTH = 256;
const P256DH = /^[A-Za-z0-9_-]{80,100}={0,2}$/;
const AUTH = /^[A-Za-z0-9_-]{16,32}={0,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAPID_PUBLIC_KEY = /^[A-Za-z0-9_-]{80,100}$/;

export type PushSubscriptionBody = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpsEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > MAX_ENDPOINT_LENGTH)
    return false;
  if (value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * The browser's PushSubscription.toJSON(), plus an optional user agent. Only these fields are
 * forwarded; any user id, role or cafeteria in the body is dropped. Spring checks the push
 * service host again.
 */
export function parseSubscriptionBody(
  value: unknown,
): PushSubscriptionBody | null {
  if (!plainObject(value) || !httpsEndpoint(value.endpoint)) return null;
  const keys = value.keys;
  if (!plainObject(keys)) return null;
  if (typeof keys.p256dh !== "string" || !P256DH.test(keys.p256dh)) return null;
  if (typeof keys.auth !== "string" || !AUTH.test(keys.auth)) return null;
  const body: PushSubscriptionBody = {
    endpoint: value.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
  if (typeof value.userAgent === "string" && value.userAgent.trim())
    body.userAgent = value.userAgent.trim().slice(0, MAX_USER_AGENT_LENGTH);
  return body;
}

/** DELETE from the browser: its own endpoint only. */
export function parseUnsubscribeBody(
  value: unknown,
): { endpoint: string } | null {
  if (!plainObject(value) || !httpsEndpoint(value.endpoint)) return null;
  return { endpoint: value.endpoint };
}

export function parseSubscribed(
  value: unknown,
): { subscriptionId: string } | null {
  if (!plainObject(value) || typeof value.subscriptionId !== "string")
    return null;
  return UUID.test(value.subscriptionId)
    ? { subscriptionId: value.subscriptionId }
    : null;
}

export function validSubscriptionId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parsePublicKey(value: unknown): { publicKey: string } | null {
  if (!plainObject(value) || typeof value.publicKey !== "string") return null;
  return VAPID_PUBLIC_KEY.test(value.publicKey)
    ? { publicKey: value.publicKey }
    : null;
}
