"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { NOTICES_MESSAGES, PUSH_MESSAGES } from "@/features/shared/messages";
import { writeMuted } from "@/features/client-orders/sound";
import { usePush } from "@/features/push/usePush";
import { PushUnavailable } from "@/features/push/components/PushControls";
import { badgeText, unreadLabel } from "../presentation";
import { useNotices } from "../useNotices";
import NoticesList from "./NoticesList";
import styles from "./InboxBell.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The bell with the inbox (AVISOS_BANDEJA_ENABLED on). It is still the one switch for every
 * client notification: the panel's first row is «Recibir avisos». Below it, the recent notices.
 * A bottom sheet on phones, a popover on wider screens. Opening it marks the notices as read;
 * focus moves into the panel, stays there with Tab, and returns to the bell on close.
 */
export default function InboxBell() {
  const view = usePush("client");
  const inbox = useNotices();
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const listTitleId = useId();
  const switchId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) bellRef.current?.focus();
  }, []);

  const openPanel = () => {
    setFresh(new Set(inbox.notices.filter((n) => !n.read).map((n) => n.id)));
    setNow(Date.now());
    setOpen(true);
  };

  // While open, everything listed is read: also a notice that arrives with the panel open.
  const { unread, markAllRead } = inbox;
  useEffect(() => {
    if (open && unread > 0) markAllRead();
  }, [open, unread, markAllRead]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = [
        ...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

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
  const count = inbox.status === "disabled" ? 0 : unread;
  const switchLabel = on
    ? PUSH_MESSAGES.bellLabelOn
    : PUSH_MESSAGES.bellLabelOff;
  const label =
    count > 0 ? `${unreadLabel(count)}. ${switchLabel}` : switchLabel;

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        ref={bellRef}
        type="button"
        className={styles.bell}
        data-on={on}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        onClick={() => (open ? close() : openPanel())}
      >
        <Icon
          name={on ? "avisos" : "avisos-apagados"}
          size={20}
          tone={on ? "active" : "inactive"}
        />
        {count > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {badgeText(count)}
          </span>
        )}
      </button>
      <span className={styles.srOnly} role="status">
        {unreadLabel(count)}
      </span>
      {open && (
        <>
          <div
            className={styles.backdrop}
            aria-hidden="true"
            onClick={() => close()}
          />
          <div
            ref={panelRef}
            id={panelId}
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <div className={styles.header}>
              <h2 id={titleId} className={styles.title}>
                {NOTICES_MESSAGES.panelTitle}
              </h2>
              <button
                type="button"
                className={styles.close}
                aria-label={NOTICES_MESSAGES.close}
                onClick={() => close()}
              >
                <X size={20} aria-hidden="true" focusable="false" />
              </button>
            </div>

            <div className={styles.switchRow}>
              <span className={styles.switchText}>
                <span id={switchId} className={styles.switchLabel}>
                  {NOTICES_MESSAGES.switchLabel}
                </span>
                <span className={styles.switchStatus} role="status">
                  {on
                    ? PUSH_MESSAGES.bellStatusOn
                    : PUSH_MESSAGES.bellStatusOff}
                </span>
              </span>
              {view.availability === "available" && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby={switchId}
                  className={styles.switch}
                  data-on={on}
                  disabled={view.busy}
                  aria-busy={view.busy}
                  onClick={() => void toggle()}
                >
                  <span className={styles.thumb} aria-hidden="true" />
                </button>
              )}
            </div>
            {view.availability === "denied" ? (
              <p className={styles.hint}>{PUSH_MESSAGES.bellBlocked}</p>
            ) : view.availability !== "available" ? (
              <PushUnavailable availability={view.availability} />
            ) : null}
            {view.busy && (
              <p className={styles.hint} role="status">
                {PUSH_MESSAGES.enabling}
              </p>
            )}
            {view.message && (
              <p className={styles.hint} role="status">
                {PUSH_MESSAGES[view.message]}
              </p>
            )}

            {inbox.status !== "disabled" && (
              <NoticesList
                view={inbox}
                now={Math.max(now, inbox.readAt)}
                fresh={fresh}
                titleId={listTitleId}
                onNavigate={() => close(false)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
