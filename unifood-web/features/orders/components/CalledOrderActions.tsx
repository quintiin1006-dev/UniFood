"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, UserX } from "lucide-react";
import {
  MAX_REMINDERS,
  canMarkNotCollected,
  reminderAvailability,
  reminderCount,
} from "@/features/orders/calledOrderActions";
import type { Order } from "@/types/order";
import styles from "./CalledOrderActions.module.css";

/** How long the "Confirmar no recogido" step waits for the second click. */
export const NOT_COLLECTED_CONFIRM_MS = 5000;

function remindTitle(order: Order, now: number): string {
  const availability = reminderAvailability(order, now);
  if (availability.kind === "limit")
    return `Ya enviaste los ${MAX_REMINDERS} avisos`;
  if (availability.kind === "wait")
    return `Podrás volver a avisar en ${availability.minutes} min`;
  return `Avisar nuevamente (${reminderCount(order)} de ${MAX_REMINDERS})`;
}

/**
 * Bell of a CALLED row. Disabled while any action of the order is in flight, after the third
 * reminder and, as a hint, before the 5 minutes; Spring decides in any case.
 */
export function RemindButton({
  order,
  busy = false,
  sending = false,
  now,
  className,
  onRemind,
}: {
  order: Order;
  busy?: boolean;
  sending?: boolean;
  now: number;
  className?: string;
  onRemind: (order: Order) => void;
}) {
  if (order.status !== "called") return null;
  const availability = reminderAvailability(order, now);
  const blocked = busy || availability.kind !== "available";
  return (
    <button
      type="button"
      className={`${className ?? ""} ${styles.remind}`}
      disabled={blocked}
      aria-busy={sending}
      title={sending ? "Enviando aviso…" : remindTitle(order, now)}
      aria-label={
        sending
          ? `Enviando aviso a ${order.student}`
          : `Avisar nuevamente a ${order.student}, ${reminderCount(order)} de ${MAX_REMINDERS} avisos enviados`
      }
      onClick={() => {
        if (!blocked) onRemind(order);
      }}
    >
      <Bell size={18} strokeWidth={2} aria-hidden="true" />
      <span className={styles.count} aria-hidden="true">
        {sending ? "…" : `${reminderCount(order)}/${MAX_REMINDERS}`}
      </span>
    </button>
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
      title={
        ready
          ? undefined
          : `Disponible después de enviar los ${MAX_REMINDERS} avisos`
      }
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
      <UserX size={18} strokeWidth={2.2} aria-hidden="true" />
      <span aria-live="polite">{label}</span>
    </button>
  );
}

/** "Avisos enviados: N de 3" for the delivery detail. */
export function ReminderSummary({ order }: { order: Order }) {
  if (order.status !== "called") return null;
  return (
    <p className={styles.summary}>
      Avisos enviados: {reminderCount(order)} de {MAX_REMINDERS}
    </p>
  );
}
