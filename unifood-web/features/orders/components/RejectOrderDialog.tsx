"use client";

import { useEffect, useId, useRef, useState } from "react";
import { XCircle } from "lucide-react";
import {
  MAX_REJECTION_REASON,
  checkRejectionReason,
  reasonLength,
} from "@/features/orders/rejectionReason";
import type { Order } from "@/types/order";
import styles from "./RejectOrderDialog.module.css";

export function RejectOrderButton({
  order,
  busy = false,
  onReject,
}: {
  order: Order;
  busy?: boolean;
  onReject: (order: Order) => void;
}) {
  if (order.status !== "pending" && order.status !== "preparing") return null;
  return (
    <button
      type="button"
      className={styles.rejectButton}
      disabled={busy}
      onClick={() => onReject(order)}
      aria-label={`Rechazar pedido de ${order.student}`}
    >
      <XCircle size={16} strokeWidth={2.2} aria-hidden="true" />
      <span>Rechazar</span>
    </button>
  );
}

interface RejectOrderDialogProps {
  order: Order;
  onClose: () => void;
  onConfirm: (
    order: Order,
    reason: string,
  ) => Promise<{ order: Order } | { error: string }>;
  /** Only for tests that render a given state; the dialog keeps its own otherwise. */
  initialReason?: string;
}

/**
 * B18: the reason is mandatory and the client will read it. One request at a time: the
 * submit is locked while it is in flight, so a double click sends it once.
 */
export function RejectOrderDialog({
  order,
  onClose,
  onConfirm,
  initialReason = "",
}: RejectOrderDialogProps) {
  const [reason, setReason] = useState(initialReason);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const hintId = useId();
  const errorId = useId();
  const length = reasonLength(reason);
  const check = checkRejectionReason(reason);

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !inFlight.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!check.ok) {
      setError(check.message);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm(order, check.reason);
      if ("error" in result) setError(result.error);
      else onClose();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.backdrop}>
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onSubmit={submit}
        noValidate
      >
        <h2 id={titleId} className={styles.title}>
          ¿Rechazar pedido?
        </h2>
        <p className={styles.text}>
          Vas a rechazar el pedido de <strong>{order.student}</strong>. Esta
          acción es definitiva.
        </p>
        <label className={styles.label} htmlFor={`${titleId}-reason`}>
          Motivo del rechazo
        </label>
        <textarea
          ref={field}
          id={`${titleId}-reason`}
          className={styles.field}
          value={reason}
          rows={3}
          disabled={submitting}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
          onChange={(event) => {
            setReason(event.target.value);
            if (error) setError(null);
          }}
          placeholder="Por ejemplo: se acabó el pollo"
        />
        <div className={styles.meta}>
          <p id={hintId} className={styles.hint}>
            El cliente verá este motivo.
          </p>
          <span
            className={
              length > MAX_REJECTION_REASON
                ? styles.counterOver
                : styles.counter
            }
            aria-live="polite"
          >
            {length}/{MAX_REJECTION_REASON}
          </span>
        </div>
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={onClose}
            disabled={submitting}
          >
            Volver
          </button>
          <button
            type="submit"
            className={styles.primary}
            disabled={submitting || !check.ok}
            aria-busy={submitting || undefined}
          >
            {submitting ? "Rechazando…" : "Rechazar pedido"}
          </button>
        </div>
      </form>
    </div>
  );
}
