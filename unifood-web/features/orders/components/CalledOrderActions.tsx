"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, RefreshCw, UserX } from "lucide-react";
import {
  canMarkNotCollected,
  reminderAvailability,
} from "@/features/orders/calledOrderActions";
import {
  NOT_COLLECTED_NEEDS_REMINDERS,
  REMINDER_LIMIT_NOTICE,
  REMIND_LABEL,
  REMIND_SENDING,
  remindWaitTitle,
} from "@/features/shared/messages";
import type { Order } from "@/types/order";
import styles from "./CalledOrderActions.module.css";
import { ICON_MIN_20 } from "@/components/ui/Icon";

/** How long the "Confirmar no recogido" step waits for the second click. */
export const NOT_COLLECTED_CONFIRM_MS = 5000;

/** True when the server's limit (maxReminders, or its 409) says no reminder is left. */
export function reminderLimitReached(order: Order, now: number): boolean {
  return reminderAvailability(order, now).kind === "limit";
}

/**
 * D5 (jj/cliente-ajustes): the reminder of a CALLED row is an icon-only bell, «Recordar al
 * estudiante», with a 44 px touch area and no visible text. While the 5 minutes run, a reload
 * icon spins in its place (it stays still with reduced motion). At the limit the button gives
 * way to <ReminderLimitNotice>; the web never writes the maximum, it comes from the API.
 */
export function RemindButton({
  order,
  busy = false,
  sending = false,
  now,
  className,
  describedBy,
  onRemind,
}: {
  order: Order;
  busy?: boolean;
  sending?: boolean;
  now: number;
  className?: string;
  /** The id of the student's name in the row, so each bell says whose order it is. */
  describedBy?: string;
  onRemind: (order: Order) => void;
}) {
  if (order.status !== "called") return null;
  const availability = reminderAvailability(order, now);
  if (availability.kind === "limit") return null;
  const waiting = availability.kind === "wait";
  const blocked = busy || availability.kind !== "available";
  return (
    <button
      type="button"
      className={`${className ?? ""} ${styles.remind}`}
      disabled={blocked}
      aria-busy={sending}
      aria-label={sending ? REMIND_SENDING : REMIND_LABEL}
      aria-describedby={describedBy}
      title={
        waiting && availability.kind === "wait"
          ? remindWaitTitle(availability.minutes)
          : REMIND_LABEL
      }
      data-waiting={waiting || undefined}
      onClick={() => {
        if (!blocked) onRemind(order);
      }}
    >
      {waiting ? (
        <RefreshCw
          size={20}
          style={ICON_MIN_20}
          strokeWidth={1.8}
          aria-hidden="true"
          className={styles.waitIcon}
        />
      ) : (
        <Bell
          size={20}
          style={ICON_MIN_20}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/** «Ya enviaste el máximo de recordatorios para este pedido», only once the limit is reached. */
export function ReminderLimitNotice({
  order,
  now,
  className,
}: {
  order: Order;
  now: number;
  className?: string;
}) {
  if (!reminderLimitReached(order, now)) return null;
  return (
    <p className={`${styles.limit} ${className ?? ""}`} role="status">
      {REMINDER_LIMIT_NOTICE}
    </p>
  );
}

/**
 * Terminal and irreversible: the first click asks for confirmation and the second sends it. If
 * no second click arrives within 5 seconds the button goes back to normal.
 */
export function NotCollectedButton({
  order,
  busy = false,
  sending = false,
  onConfirm,
  initialConfirming = false,
}: {
  order: Order;
  busy?: boolean;
  sending?: boolean;
  onConfirm: (order: Order) => void;
  /** Only for tests that render a given state; the button keeps its own otherwise. */
  initialConfirming?: boolean;
}) {
  const [confirming, setConfirming] = useState(initialConfirming);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = canMarkNotCollected(order);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  if (order.status !== "called") return null;

  const disabled = busy || !ready;
  // While disabled the confirmation never shows; the parent keys this button by order id.
  const asking = confirming && !disabled;
  const label = sending
    ? "Registrando…"
    : asking
      ? "Confirmar no recogido"
      : "No recogido";

  return (
    <button
      type="button"
      className={`${styles.notCollected} ${asking ? styles.confirming : ""}`}
      disabled={disabled}
      aria-busy={sending}
      title={ready ? undefined : NOT_COLLECTED_NEEDS_REMINDERS}
      onClick={() => {
        if (disabled) return;
        if (timer.current !== undefined) clearTimeout(timer.current);
        if (!asking) {
          setConfirming(true);
          timer.current = setTimeout(() => {
            timer.current = undefined;
            setConfirming(false);
          }, NOT_COLLECTED_CONFIRM_MS);
          return;
        }
        timer.current = undefined;
        setConfirming(false);
        onConfirm(order);
      }}
    >
      <UserX
        size={20}
        style={ICON_MIN_20}
        strokeWidth={2.2}
        aria-hidden="true"
      />
      <span aria-live="polite">{label}</span>
    </button>
  );
}
