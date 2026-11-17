// Before signing out, this browser stops receiving the account's notices: the server row is
// revoked and the browser subscription is dropped. The BFF repeats the revocation on the
// server with its httpOnly cookie, so a failure here never leaves a shared device subscribed.
import { removeSubscription } from "./api";
import { PUSH_ENABLED_KEY, type PushRole } from "./state";

const SIGN_OUT_BUDGET_MS = 3000;

export async function dropPushBeforeSignOut(role: PushRole) {
  try {
    window.localStorage.removeItem(PUSH_ENABLED_KEY);
  } catch {
    // Storage may be unavailable (private mode); nothing else depends on it.
  }
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await Promise.allSettled([
      removeSubscription(role, subscription.endpoint, SIGN_OUT_BUDGET_MS),
      subscription.unsubscribe(),
    ]);
  } catch {
    // Sign-out must never be blocked by push.
  }
}
