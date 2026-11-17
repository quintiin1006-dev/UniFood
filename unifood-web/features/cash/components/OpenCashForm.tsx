"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { cashApi } from "../api";
import { SHIFT_LABELS, formatPesos, suggestedShift } from "../presentation";
import { countTotal, emptyCount } from "../state";
import type { CashCurrent, CashProblem, CashShift } from "../types";
import { DenominationCounter } from "./DenominationCounter";
import { CASH_TEXTS } from "@/features/shared/messages";
import styles from "./Cash.module.css";

/** «Abrir caja»: the shift and the opening float, counted by denomination. */
export function OpenCashForm({
  online,
  onOpened,
}: {
  online: boolean;
  onOpened: (current: CashCurrent) => void;
}) {
  const [shift, setShift] = useState<CashShift>(() => suggestedShift());
  const [draft, setDraft] = useState(emptyCount);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem | null>(null);
  const total = countTotal(draft);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await cashApi.open(shift, total);
    setBusy(false);
    if (result.ok) onOpened(result.data);
    else setProblem(result.problem);
  };

  return (
    <section className={styles.card} aria-labelledby="cash-open-title">
      <h3 id="cash-open-title" className={styles.cardTitle}>
        Abrir caja
      </h3>
      <p className={styles.help}>
        Elige el turno y cuenta el fondo inicial que queda en la caja.
      </p>
      <fieldset className={styles.shifts}>
        <legend>Turno</legend>
        {(["BREAKFAST", "LUNCH"] as const).map((value) => (
          <label
            key={value}
            className={`${styles.shift} ${shift === value ? styles.shiftActive : ""}`}
          >
            <input
              type="radio"
              name="cash-shift"
              value={value}
              checked={shift === value}
              onChange={() => setShift(value)}
            />
            {SHIFT_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <DenominationCounter
        draft={draft}
        onChange={setDraft}
        idPrefix="cash-open"
        disabled={busy}
        totalLabel="Fondo inicial"
      />
      {problem && <Notice tone="error">{problem.message}</Notice>}
      {!online && <Notice tone="error">{CASH_TEXTS.offlineOpen}</Notice>}
      <Button
        touch
        className={styles.primaryAction}
        disabled={busy || !online}
        onClick={() => void submit()}
      >
        {busy ? "Abriendo…" : `Abrir caja con ${formatPesos(total)}`}
      </Button>
    </section>
  );
}
