"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNotices, markNoticesRead } from "./api";
import { createNoticesRefresher } from "./state";
import type { Notice } from "./types";

export type NoticesView = {
  status: "loading" | "ready" | "error" | "disabled";
  notices: Notice[];
  unread: number;
  /** When the list on screen was read, for the relative times. */
  readAt: number;
  message: string | null;
  /** Read again now (the retry button). */
  retry: () => void;
  /** The panel opened: every listed notice becomes read, on the server and here. */
  markAllRead: () => void;
};

const visible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";

/**
 * The inbox of the signed-in client: read on mount, every 60 s while the app is visible, at once
 * when it is focused or visible again, paused while hidden. A 404 means the inbox is off on the
 * server: the loop stops and the bell keeps working as a plain switch.
 */
export function useNotices(): NoticesView {
  const [status, setStatus] = useState<NoticesView["status"]>("loading");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [readAt, setReadAt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const refresher = useRef<ReturnType<typeof createNoticesRefresher> | null>(
    null,
  );
  const unreadNow = useRef(0);
  useEffect(() => {
    unreadNow.current = unread;
  }, [unread]);

  useEffect(() => {
    let alive = true;
    const loop = createNoticesRefresher({
      isVisible: visible,
      load: async () => {
        const read = await fetchNotices();
        if (!alive) return "fatal";
        if (read.kind === "disabled") {
          setStatus("disabled");
          return "fatal";
        }
        if (read.kind === "error") {
          // Keep the last good list on screen; only an empty first read shows the error.
          setMessage(read.message);
          setStatus((current) => (current === "ready" ? current : "error"));
          return "error";
        }
        setNotices(read.payload.notices);
        setUnread(read.payload.unread);
        setReadAt(Date.now());
        setMessage(null);
        setStatus("ready");
        return "ok";
      },
    });
    refresher.current = loop;
    const onVisibility = () => loop.visibilityChanged();
    const onFocus = () => loop.focused();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    loop.start();
    return () => {
      alive = false;
      loop.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const retry = useCallback(() => {
    setStatus((current) => (current === "error" ? "loading" : current));
    refresher.current?.refresh();
  }, []);

  const markAllRead = useCallback(() => {
    if (unreadNow.current <= 0) return;
    unreadNow.current = 0;
    void markNoticesRead();
    setUnread(0);
    setNotices((list) => list.map((notice) => ({ ...notice, read: true })));
  }, []);

  return { status, notices, unread, readAt, message, retry, markAllRead };
}
