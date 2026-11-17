import "server-only";
import { cookies } from "next/headers";
import { serverApiUrl } from "@/config/server";
import { validSubscriptionId } from "../contracts";

/**
 * httpOnly id of this browser's subscription, so sign-out can revoke it on the server even if
 * the page's own DELETE never ran (closed tab, network error, shared device).
 */
export const PUSH_SUBSCRIPTION_COOKIE = "unifood-push-subscription";
const SIGN_OUT_TIMEOUT_MS = 3000;

/**
 * Sign-out reinforcement: revokes the subscription this browser registered, with the session
 * that is about to end. Bounded and best effort: sign-out never fails because of it. The
 * cookie is always removed.
 */
export async function revokePushOnSignOut(
  accessToken: string | null | undefined,
) {
  let id: string | undefined;
  try {
    const jar = await cookies();
    id = jar.get(PUSH_SUBSCRIPTION_COOKIE)?.value;
    if (id === undefined) return;
    jar.delete(PUSH_SUBSCRIPTION_COOKIE);
  } catch {
    // Cookies unavailable: nothing to revoke, and sign-out must go on.
    return;
  }
  if (!accessToken || !validSubscriptionId(id)) return;
  try {
    // Any signed-in account may remove its own rows; Spring scopes it to the token's user.
    await fetch(`${serverApiUrl()}/api/me/push/subscribe`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ subscriptionId: id }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
    });
  } catch {
    // The page also unsubscribes the browser itself before signing out.
  }
}
