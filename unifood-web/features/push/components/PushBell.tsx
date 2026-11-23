"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PUSH_MESSAGES } from "@/features/shared/messages";
import { writeMuted } from "@/features/client-orders/sound";
import { usePush } from "../usePush";
import { PushUnavailable } from "./PushControls";
import InboxBell from "@/features/notices/components/InboxBell";
import styles from "./PushBell.module.css";

/**
 * C4 (jj/cliente-ajustes): the header bell is the ONE switch for every client notification
 * (status changes, call, reminders, not collected, cancelled and any later one). Mi perfil and
 * Mi pedido have no control of their own. Turning it off also mutes the in-app chime of Mi
 * pedido. A dot on the bell says they are off.
 *
 * The panel is ready for a «recent notifications» list: it would go in the `recent` slot below
 * the switch (not implemented yet).
 */
export default function PushBell({ inbox = false }: { inbox?: boolean }) {
  // AVISOS_BANDEJA_ENABLED (read on the server): off, the bell is exactly the switch below.
  return inbox ? <InboxBell /> : <SwitchBell />;
}

function SwitchBell() {
  const view = usePush("client");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      bellRef.current?.focus();
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
  const toggle = async () => {
    if (on) {
      await view.disable();
      writeMuted(true);
    } else {
      await view.enable();
      writeMuted(false);
    }
  };
  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        ref={bellRef}
        type="button"
        className={styles.bell}
        data-on={on}
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
        <div
          id={panelId}
          className={styles.panel}
          role="region"
          aria-labelledby={titleId}
        >
          <p id={titleId} className={styles.title} role="status">
            {on ? PUSH_MESSAGES.bellStatusOn : PUSH_MESSAGES.bellStatusOff}
          </p>
          {view.availability === "available" ? (
            <button
              type="button"
              className={styles.action}
              data-on={on}
              disabled={view.busy}
              aria-busy={view.busy}
              onClick={() => void toggle()}
            >
              {view.busy
                ? PUSH_MESSAGES.enabling
                : on
                  ? PUSH_MESSAGES.bellDisable
                  : PUSH_MESSAGES.bellEnable}
            </button>
          ) : view.availability === "denied" ? (
            <p className={styles.hint}>{PUSH_MESSAGES.bellBlocked}</p>
          ) : (
            <PushUnavailable availability={view.availability} />
          )}
          {view.message && (
            <p className={styles.hint} role="status">
              {PUSH_MESSAGES[view.message]}
            </p>
          )}
          {/* Slot for the recent notifications list (pending). */}
          <div className={styles.recent} data-slot="recent" hidden />
        </div>
      )}
    </div>
  );
}
