"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { cashApi } from "../api";
import { formatPesos } from "../presentation";
import { parsePesos, reasonValid } from "../state";
import type { CashCurrent, CashMovementKind, CashProblem } from "../types";
import styles from "./Cash.module.css";

/**
 * «Registrar movimiento»: other income or an expense (expenses, deposits), always with a
 * reason. The request id survives a failed attempt, so a retry never records it twice.
 */
export function MovementForm({
  sessionId,
  online,
  onRecorded,
  onCancel,
}: {
  sessionId: string;
  online: boolean;
  onRecorded: (current: CashCurrent) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const [kind, setKind] = useState<CashMovementKind>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem | null>(null);
  const requestId = useRef<string | null>(null);
  const pesos = parsePesos(amount);
  const amountError =
    touched && (pesos === null || pesos < 1)
      ? "Escribe un monto en pesos enteros mayor que cero."
      : null;
  const reasonError =
    touched && !reasonValid(reason)
      ? "Escribe el motivo (de 3 a 200 caracteres)."
      : null;

  const submit = async () => {
    setTouched(true);
    if (pesos === null || pesos < 1 || !reasonValid(reason)) return;
    requestId.current ??= crypto.randomUUID();
    setBusy(true);
    setProblem(null);
    const result = await cashApi.movement(sessionId, {
      requestId: requestId.current,
      kind,
      amount: pesos,
      reason: reason.trim(),
    });
    setBusy(false);
    if (result.ok) {
      requestId.current = null;
      onRecorded(result.data);
    } else setProblem(result.problem);
  };

  // Any edit is a new movement, with a new request id.
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      requestId.current = null;
      setter(value);
    };

  return (
    <form
      className={styles.card}
      aria-labelledby={`${ids}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
    >
      <h3 id={`${ids}-title`} className={styles.cardTitle}>
        Registrar movimiento
      </h3>
      <fieldset className={styles.shifts}>
        <legend>Tipo</legend>
        {(
          [
            ["EXPENSE", "Egreso o retiro"],
            ["INCOME", "Otro ingreso"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={`${styles.shift} ${kind === value ? styles.shiftActive : ""}`}
          >
            <input
              type="radio"
              name={`${ids}-kind`}
              value={value}
              checked={kind === value}
              onChange={() => edit(setKind)(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className={styles.field}>
        <label htmlFor={`${ids}-amount`}>Monto (COP)</label>
        <input
          id={`${ids}-amount`}
          className={styles.amountInput}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="0"
          value={amount}
          onChange={(event) =>
            edit(setAmount)(event.target.value.replace(/[^\d.]/g, ""))
          }
          aria-invalid={amountError ? true : undefined}
          aria-describedby={amountError ? `${ids}-amount-error` : undefined}
        />
        {amountError && (
          <p
            id={`${ids}-amount-error`}
            className={styles.fieldError}
            role="alert"
          >
            {amountError}
          </p>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${ids}-reason`}>Motivo</label>
        <textarea
          id={`${ids}-reason`}
          className={styles.textarea}
          rows={2}
          maxLength={200}
          placeholder="Ej.: compra de hielo, consignación al banco, vuelto cobrado de más"
          value={reason}
          onChange={(event) => edit(setReason)(event.target.value)}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? `${ids}-reason-error` : undefined}
        />
        {reasonError && (
          <p
            id={`${ids}-reason-error`}
            className={styles.fieldError}
            role="alert"
          >
            {reasonError}
          </p>
        )}
      </div>
      <p className={styles.help}>
        Si cobraste distinto al total de un pedido, regístralo aquí con su
        motivo; el pedido no cambia.
      </p>
      {problem && <Notice tone="error">{problem.message}</Notice>}
      <div className={styles.actions}>
        <Button variant="secondary" touch onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" touch disabled={busy || !online}>
          {busy
            ? "Guardando…"
            : `Registrar ${pesos ? formatPesos(pesos) : "movimiento"}`}
        </Button>
      </div>
    </form>
  );
}
