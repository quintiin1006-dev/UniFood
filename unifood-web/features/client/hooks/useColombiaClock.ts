"use client";
import { useEffect, useState } from "react";

/** Server and browser render the same initial instant; refreshes at minute boundaries. */
export function useColombiaClock(initialTime: string) {
  const [now, setNow] = useState(() => new Date(initialTime));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      setNow(new Date());
      timer = setTimeout(update, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(update, 0);
    const refresh = () => {
      clearTimeout(timer);
      update();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return now;
}
