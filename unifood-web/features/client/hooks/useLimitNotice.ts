"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long a limit notice stays before it hides by itself. */
export const LIMIT_NOTICE_MS = 3000;

/**
 * A short notice for when the student tries to go past a limit: never fixed text on the page,
 * only after the attempt, and gone after LIMIT_NOTICE_MS. Repeating the attempt restarts it.
 */
export function useLimitNotice() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), LIMIT_NOTICE_MS);
  }, []);
  return { message, show };
}
