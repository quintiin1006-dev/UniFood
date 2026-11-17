"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PUSH_MESSAGES } from "@/features/shared/messages";
import { usePush } from "../usePush";
import { PushUnavailable } from "./PushControls";
import styles from "./PushBell.module.css";

/**
 * Bell in the client header (ola 4). It shows whether this device gets push and opens a small
 * menu to change it. The logic is the Perfil switch's (usePush + PushUnavailable); nothing is
 * duplicated here.
 */
export default function PushBell() {
  const view = usePush("client");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Same size as the profile link beside it, from the first paint, so the header does not jump.
  if (view.availability === null)
    return <span className={styles.placeholder} aria-hidden="true" />;

  const on = view.subscribed;
  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.bell}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={on ? PUSH_MESSAGES.bellLabelOn : PUSH_MESSAGES.bellLabelOff}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon
          name={on ? "avisos" : "avisos-apagados"}
          size={20}
          tone={on ? "active" : "inactive"}
        />
      </button>
      {open && (
        <div id={panelId} className={styles.panel}>
          <p className={styles.title}>{PUSH_MESSAGES.toggleLabel}</p>
          <p className={styles.status} role="status" aria-live="polite">
            {on ? PUSH_MESSAGES.bellStatusOn : PUSH_MESSAGES.bellStatusOff}
          </p>
          {view.availability === "available" ? (
            <button
              type="button"
              className={styles.action}
              disabled={view.busy}
              aria-busy={view.busy}
              onClick={() => void (on ? view.disable() : view.enable())}
            >
              {view.busy
                ? PUSH_MESSAGES.enabling
                : on
                  ? PUSH_MESSAGES.bellDisable
                  : PUSH_MESSAGES.enable}
            </button>
          ) : (
            <PushUnavailable availability={view.availability} />
          )}
          {view.message && (
            <p className={styles.status} role="status">
              {PUSH_MESSAGES[view.message]}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
