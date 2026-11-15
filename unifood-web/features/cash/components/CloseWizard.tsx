"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { cashApi } from "../api";
import {
  OUTCOME_LABELS,
  formatCashTime,
  formatDifference,
  formatPesos,
} from "../presentation";
import {
  NOTE_MAX,
  countLines,
  emptyCount,
  nextStep,
  noteError,
  previousStep,
  stepNumber,
  type CloseStep,
} from "../state";
import type {
  CashDetail,
  CashPreview,
  CashProblem,
  CashSession,
} from "../types";
import { DenominationCounter } from "./DenominationCounter";
import styles from "./Cash.module.css";

/**
 * Close in four steps: 1) count by denomination, 2) compare with the expected cash the
 * server computed, 3) a note when it does not balance, 4) a destructive confirmation.
 * Offline it never sends the close.
 */
export function CloseWizard({
  session,
  online,
  onClosed,
  onCancel,
}: {
  session: CashSession;
  online: boolean;
  onClosed: (detail: CashDetail) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const [step, setStep] = useState<CloseStep>("count");
  const [draft, setDraft] = useState(emptyCount);
  const [preview, setPreview] = useState<CashPreview | null>(null);
  const [note, setNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem | null>(null);
  const difference = preview?.difference ?? 0;
  const pending = problem?.pendingOrders ?? preview?.pendingOrders ?? [];

  const compare = async () => {
    setBusy(true);
    setProblem(null);
    const result = await cashApi.preview(session.id, countLines(draft));
    setBusy(false);
    if (!result.ok) return setProblem(result.problem);
    setPreview(result.data);
    setStep("compare");
  };

  const close = async () => {
    if (!preview) return;
    setBusy(true);
    setProblem(null);
    const result = await cashApi.close(session.id, {
      lines: countLines(draft),
      note: note.trim() || null,
      expectedCash: preview.expected,
      expectedVersion: preview.version,
    });
    setBusy(false);
    if (result.ok) return onClosed(result.data);
    setProblem(result.problem);
    // New sales while counting: show the updated figures and compare again.
    if (
      result.problem.code === "CASH_EXPECTED_CHANGED" &&
      result.problem.preview
    ) {
      setPreview(result.problem.preview);
      setStep("compare");
    }
    if (result.problem.code === "CASH_PENDING_ORDERS") setStep("compare");
  };

  const forward = () => {
    if (step === "count") return void compare();
    if (step === "note") {
      setNoteTouched(true);
      if (noteError(note, difference)) return;
    }
    setProblem(null);
    setStep(nextStep(step, difference));
  };

  const back = () => {
    setProblem(null);
    if (step === "count") return onCancel();
    setStep(previousStep(step, difference));
  };

  const totalSteps = difference === 0 && step !== "note" ? 3 : 4;
  const shownStep =
    difference === 0 && step === "confirm" ? 3 : stepNumber(step);
  const error = noteTouched ? noteError(note, difference) : null;
  const titles: Record<CloseStep, string> = {
    count: "Cuenta el efectivo",
    compare: "Compara con el esperado",
    note: "Explica la diferencia",
    confirm: "Confirma el cierre",
  };

  return (
    <section className={styles.card} aria-labelledby={`${ids}-title`}>
      <p className={styles.stepLabel}>
        Paso {shownStep} de {totalSteps}
      </p>
      <h3 id={`${ids}-title`} className={styles.cardTitle}>
        {titles[step]}
      </h3>

      {step === "count" && (
        <DenominationCounter
          draft={draft}
          onChange={setDraft}
          idPrefix={`${ids}-count`}
          disabled={busy}
        />
      )}

      {step !== "count" && preview && (
        <dl className={styles.compare}>
          <div>
            <dt>Efectivo esperado</dt>
            <dd>{formatPesos(preview.expected)}</dd>
          </div>
          <div>
            <dt>Efectivo contado</dt>
            <dd>{formatPesos(preview.counted)}</dd>
          </div>
          <div
            className={`${styles.differenceRow} ${
              preview.outcome === "BALANCED"
                ? styles.balanced
                : preview.withinTolerance
                  ? styles.tolerated
                  : styles.outside
            }`}
          >
            <dt>Diferencia</dt>
            <dd>
              {formatDifference(preview.difference)}
              <span className={styles.outcome}>
                {OUTCOME_LABELS[preview.outcome]}
              </span>
            </dd>
          </div>
        </dl>
      )}

      {step === "compare" && preview && preview.outcome !== "BALANCED" && (
        <p className={styles.help}>
          {preview.withinTolerance
            ? `Dentro de la tolerancia de ${formatPesos(preview.toleranceCop)}.`
            : `Fuera de la tolerancia de ${formatPesos(preview.toleranceCop)}: el administrador la revisará.`}{" "}
          Si contaste mal, vuelve al conteo.
        </p>
      )}

      {step !== "count" && pending.length > 0 && (
        <Notice tone="error" title="Pedidos sin resolver">
          <p>
            Entrégalos o márcalos como no recogidos en Pedidos o Llamadas antes
            de cerrar.
          </p>
          <ul className={styles.pendingList}>
            {pending.map((order) => (
              <li key={order.id}>
                {order.clientName} ·{" "}
                {order.status === "READY" ? "Listo" : "Llamado"} · desde las{" "}
                {formatCashTime(order.createdAt)}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {step === "note" && (
        <div className={styles.field}>
          <label htmlFor={`${ids}-note`}>Nota del cierre (obligatoria)</label>
          <textarea
            id={`${ids}-note`}
            className={styles.textarea}
            rows={4}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => setNoteTouched(true)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids}-note-help${error ? ` ${ids}-note-error` : ""}`}
          />
          <p id={`${ids}-note-help`} className={styles.help}>
            {[...note.trim()].length}/{NOTE_MAX} · Mínimo 10 caracteres.
          </p>
          {error && (
            <p
              id={`${ids}-note-error`}
              className={styles.fieldError}
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      )}

      {step === "confirm" && (
        <Notice tone="info" title="Esta acción no se puede deshacer">
          Al cerrar, la caja ya no admite cambios. Solo el administrador puede
          reabrirla.
        </Notice>
      )}

      {problem && problem.code !== "CASH_PENDING_ORDERS" && (
        <Notice tone="error">{problem.message}</Notice>
      )}
      {!online && (
        <Notice tone="error">
          Sin conexión a internet. No se puede cerrar la caja sin conexión; tu
          conteo se conserva en esta pantalla.
        </Notice>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" touch onClick={back} disabled={busy}>
          {step === "count" ? "Cancelar" : "Atrás"}
        </Button>
        {step === "confirm" ? (
          <Button
            variant="danger"
            touch
            onClick={() => void close()}
            disabled={busy || !online || pending.length > 0}
          >
            {busy ? "Cerrando…" : "Cerrar caja"}
          </Button>
        ) : (
          <Button
            touch
            onClick={forward}
            disabled={
              busy ||
              (step === "count" && !online) ||
              (step === "compare" && pending.length > 0)
            }
          >
            {busy ? "Calculando…" : "Continuar"}
          </Button>
        )}
      </div>
    </section>
  );
}
