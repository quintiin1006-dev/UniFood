"use client";

import { useCallback, useEffect, useState } from "react";
import { PUSH_MESSAGES, type PushMessageKey } from "@/lib/messages";
import {
  fetchPublicKey,
  PushRequestError,
  removeSubscription,
  saveSubscription,
} from "./api";
import {
  applicationServerKey,
  PUSH_ENABLED_KEY,
  pushAvailability,
  readCapabilities,
  type PushAvailability,
  type PushRole,
} from "./state";

export type PushView = {
  /** null until the browser was inspected (first render is the same on server and client). */
  availability: PushAvailability | "disabled-on-server" | null;
  subscribed: boolean;
  busy: boolean;
  message: PushMessageKey | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

function remembered() {
  try {
    return window.localStorage.getItem(PUSH_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(enabled: boolean) {
  try {
    if (enabled) window.localStorage.setItem(PUSH_ENABLED_KEY, "1");
    else window.localStorage.removeItem(PUSH_ENABLED_KEY);
  } catch {
    // Storage may be unavailable; re-subscription on return is then skipped.
  }
}

async function registration() {
  // updateViaCache "none": the worker script is always checked against the server.
  await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  return navigator.serviceWorker.ready;
}

function errorKey(cause: unknown): PushMessageKey {
  if (cause instanceof PushRequestError) {
    if (cause.code === "PUSH_RATE_LIMITED") return "rateLimited";
    if (cause.code === "PUSH_DISABLED") return "disabledOnServer";
  }
  return "failed";
}

/**
 * Push state of this device for the signed-in user. Permission is requested only from
 * enable(), which the UI calls from a tap; nothing is asked on page load.
 */
export function usePush(role: PushRole): PushView {
  const [availability, setAvailability] =
    useState<PushView["availability"]>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<PushMessageKey | null>(null);

  // Inspect the device, and renew the subscription if this account had push on: a browser can
  // expire or rotate it, and registering again also refreshes it on the server.
  const sync = useCallback(async () => {
    const found = pushAvailability(readCapabilities());
    setAvailability(found);
    if (found !== "available") {
      setSubscribed(false);
      return;
    }
    try {
      const ready = await registration();
      let current = await ready.pushManager.getSubscription();
      if (remembered() && Notification.permission === "granted") {
        if (!current) {
          const key = await fetchPublicKey(role);
          current = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey(key),
          });
        }
        await saveSubscription(role, current);
      }
      setSubscribed(Boolean(current) && remembered());
    } catch (cause) {
      if (cause instanceof PushRequestError && cause.code === "PUSH_DISABLED")
        setAvailability("disabled-on-server");
      setSubscribed(false);
    }
  }, [role]);

  useEffect(() => {
    // Inspecting the browser is an external system: done after mount, never during render.
    void Promise.resolve().then(sync);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sync]);

  const enable = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Called from a tap: the only place where the permission prompt may appear.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setAvailability(permission === "denied" ? "denied" : "available");
        return;
      }
      const key = await fetchPublicKey(role);
      const ready = await registration();
      const subscription =
        (await ready.pushManager.getSubscription()) ??
        (await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(key),
        }));
      await saveSubscription(role, subscription);
      remember(true);
      setSubscribed(true);
      setMessage("enabled");
    } catch (cause) {
      const key = errorKey(cause);
      if (key === "disabledOnServer") setAvailability("disabled-on-server");
      setMessage(key);
    } finally {
      setBusy(false);
    }
  }, [role]);

  const disable = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const ready = await registration();
      const subscription = await ready.pushManager.getSubscription();
      if (subscription) {
        await removeSubscription(role, subscription.endpoint);
        await subscription.unsubscribe();
      }
      remember(false);
      setSubscribed(false);
      setMessage("disabled");
    } catch (cause) {
      setMessage(errorKey(cause));
    } finally {
      setBusy(false);
    }
  }, [role]);

  return { availability, subscribed, busy, message, enable, disable };
}

export { PUSH_MESSAGES };
