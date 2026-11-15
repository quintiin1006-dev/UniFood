"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { cashApi } from "../api";
import { formatPesos } from "../presentation";
import { parsePesos } from "../state";
import type { CashProblem } from "../types";
import styles from "./Cash.module.css";

/** ADMIN: difference tolerance of the cafeteria, audited on every change. */
export function CashSettingsForm({
  toleranceCop,
  version,
  onSaved,
}: {
  toleranceCop: number;
  version: number;
  onSaved: (toleranceCop: number, version: number) => void;
}) {
  const ids = useId();
  const [value, setValue] = useState(String(toleranceCop));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem | null>(null);
  const [saved, setSaved] = useState(false);
  const amount = parsePesos(value);
  const invalid = amount === null || amount > 1_000_000;

  const submit = async () => {
    if (invalid) return;
    setBusy(true);
    setProblem(null);
    setSaved(false);
    const result = await cashApi.tolerance(amount, version);
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      onSaved(result.data.toleranceCop, result.data.settingsVersion);
    } else setProblem(result.problem);
  };

  return (
    <form
      className={`${styles.card} ${styles.filters}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className={styles.field}>
        <label htmlFor={`${ids}-tolerance`}>
          Tolerancia de diferencia (COP)
        </label>
        <input
          id={`${ids}-tolerance`}
          className={styles.dateInput}
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(event) => {
            setSaved(false);
            setValue(event.target.value.replace(/[^\d.]/g, ""));
          }}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={`${ids}-tolerance-help`}
        />
        <p id={`${ids}-tolerance-help`} className={styles.help}>
          Actual: {formatPesos(toleranceCop)}. Las diferencias mayores se marcan
          para revisión.
        </p>
      </div>
      <Button
        type="submit"
        disabled={busy || invalid || amount === toleranceCop}
      >
        {busy ? "Guardando…" : "Guardar tolerancia"}
      </Button>
      {invalid && (
        <p className={styles.fieldError} role="alert">
          Escribe un monto entero entre $0 y $1.000.000.
        </p>
      )}
      {problem && <Notice tone="error">{problem.message}</Notice>}
      <p className={styles.srOnly} aria-live="polite">
        {saved ? "Tolerancia guardada." : ""}
      </p>
      {saved && <Notice tone="success">Tolerancia guardada.</Notice>}
    </form>
  );
}
