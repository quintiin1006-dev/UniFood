// What the push switch can offer on this device, decided from browser capabilities only.
// Pure: tested without a browser (tests/push-state.test.mjs).

export type PushRole = "client" | "worker";

export type PushCapabilities = {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  /** matchMedia('(display-mode: standalone)') or navigator.standalone (iOS). */
  standalone: boolean;
  userAgent: string;
  /** Notification.permission, or "default" when there is no Notification API. */
  permission: NotificationPermission;
};

export type PushAvailability =
  /** Push works here; the switch can be offered. */
  | "available"
  /** Permission was refused: show how to allow it again, never ask. */
  | "denied"
  /** iPhone/iPad in a Safari tab: only an installed app can receive push. */
  | "ios-install"
  /** iOS before 16.4 has no Web Push at all. */
  | "ios-too-old"
  /** No Service Worker or Push API: the in-app notice is the only channel. */
  | "unsupported";

const IOS = /\b(iPhone|iPad|iPod)\b/;
const IOS_VERSION = /\bOS (\d+)[_.](\d+)/;

/** iOS major and minor from the user agent, or null outside iOS. */
export function iosVersion(userAgent: string): [number, number] | null {
  if (!IOS.test(userAgent)) return null;
  const match = IOS_VERSION.exec(userAgent);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

export function pushAvailability(
  capabilities: PushCapabilities,
): PushAvailability {
  const ios = iosVersion(capabilities.userAgent);
  if (ios) {
    const [major, minor] = ios;
    if (major < 16 || (major === 16 && minor < 4)) return "ios-too-old";
    if (!capabilities.standalone) return "ios-install";
  }
  if (
    !capabilities.serviceWorker ||
    !capabilities.pushManager ||
    !capabilities.notification
  )
    return "unsupported";
  if (capabilities.permission === "denied") return "denied";
  return "available";
}

/** Reads the capabilities of the current browser; only call it on the client. */
export function readCapabilities(): PushCapabilities {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    nav.standalone === true;
  const notification = "Notification" in window;
  return {
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification,
    standalone,
    userAgent: navigator.userAgent,
    permission: notification ? Notification.permission : "default",
  };
}

/** The VAPID public key as the bytes pushManager.subscribe expects. */
export function applicationServerKey(
  base64url: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Per-device memory that this account turned push on; cleared on sign-out. */
export const PUSH_ENABLED_KEY = "unifood.push.enabled";
