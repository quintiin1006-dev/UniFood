"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { cashApi } from "../api";
import { reasonValid } from "../state";
import type { CashDetail, CashProblem, CashSession } from "../types";
import styles from "./Cash.module.css";

/**
 * ADMIN only: reopen the latest closed drawer with a reason. The closed version stays in the
 * audit; the sales window extends until the next close.
 */
export function ReopenForm({
  session,
  onReopened,
}: {
  session: CashSession;
  onReopened: (detail: CashDetail) => void;
}) {
  const ids = useId();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem | null>(null);
  const valid = reasonValid(reason, 10, 300);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await cashApi.reopen(
      session.id,
      reason.trim(),
      session.version,
    );
    setBusy(false);
    setConfirming(false);
    if (result.ok) onReopened(result.data);
    else setProblem(result.problem);
  };

  return (
    <section className={styles.card} aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className={styles.cardTitle}>
        Reabrir caja
      </h3>
      <p className={styles.help}>
        Solo se reabre la última caja cerrada y si no hay otra abierta. Las
        ventas entregadas hasta el nuevo cierre entrarán en esta caja.
      </p>
      <div className={styles.field}>
        <label htmlFor={`${ids}-reason`}>Motivo de la reapertura</label>
        <textarea
          id={`${ids}-reason`}
          className={styles.textarea}
          rows={3}
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !valid ? true : undefined}
        />
        {touched && !valid && (
          <p className={styles.fieldError} role="alert">
            Escribe el motivo (de 10 a 300 caracteres).
          </p>
        )}
      </div>
      {problem && <Notice tone="error">{problem.message}</Notice>}
      {confirming ? (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "Reabriendo…" : "Sí, reabrir la caja"}
          </Button>
        </div>
      ) : (
        <Button
          variant="danger"
          onClick={() => {
            setTouched(true);
            if (valid) setConfirming(true);
          }}
        >
          Reabrir caja
        </Button>
      )}
    </section>
  );
}
