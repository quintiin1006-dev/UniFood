// UniFood service worker: push notifications only (docs/notificaciones-push.md).
// It has no fetch handler and uses no Cache Storage: API responses and private data are never
// cached here, and every request goes to the network exactly as without a service worker.

const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";
const FALLBACK_URL = "/";
const ALLOWED_PATHS = ["/cuenta", "/worker"];
const DEFAULT_TITLE = "UniFood";

/** Only same-origin pages of the app; anything else opens the home page. */
function safeUrl(value) {
  if (typeof value !== "string") return FALLBACK_URL;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return FALLBACK_URL;
    const allowed = ALLOWED_PATHS.some(
      (path) => url.pathname === path || url.pathname.startsWith(path + "/"),
    );
    return allowed ? url.pathname : FALLBACK_URL;
  } catch {
    return FALLBACK_URL;
  }
}

function text(value, max) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : "";
}

/** The payload is {title, body, tag, url}; anything missing or malformed gets a safe default. */
function notificationFrom(data) {
  let payload = {};
  try {
    payload = data ? data.json() : {};
  } catch {
    payload = {};
  }
  if (!payload || typeof payload !== "object") payload = {};
  const tag = text(payload.tag, 64) || "unifood";
  return {
    title: text(payload.title, 80) || DEFAULT_TITLE,
    options: {
      body: text(payload.body, 160),
      icon: ICON,
      badge: BADGE,
      tag,
      // A newer notice of the same order replaces the previous one and alerts again.
      renotify: true,
      vibrate: [120, 60, 120],
      data: { url: safeUrl(payload.url) },
    },
  };
}

async function openOrFocus(target) {
  const absolute = new URL(target, self.location.origin).href;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    if (client.url === absolute && "focus" in client) return client.focus();
  }
  for (const client of windows) {
    if (
      new URL(client.url).origin === self.location.origin &&
      "navigate" in client
    ) {
      await client.focus();
      return client.navigate(absolute);
    }
  }
  return self.clients.openWindow(absolute);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const { title, options } = notificationFrom(event.data);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeUrl(
    event.notification.data && event.notification.data.url,
  );
  event.waitUntil(openOrFocus(target));
});

// Exposed for tests (tests/push-sw.test.mjs); harmless in the browser.
self.__unifoodPush = { safeUrl, notificationFrom, openOrFocus };
