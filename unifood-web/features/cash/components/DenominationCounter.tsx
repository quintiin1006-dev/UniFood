"use client";

import { Minus, Plus } from "lucide-react";
import { BILLS, COINS, MAX_QUANTITY } from "../types";
import { denominationLabel, formatPesos } from "../presentation";
import {
  countTotal,
  lineSubtotal,
  sanitizeQuantity,
  type CountDraft,
} from "../state";
import styles from "./Cash.module.css";

/**
 * Count by denomination with a live total. Numeric keypad on tablets (inputMode), 48 px
 * steppers and tabular figures. The total is a preview; the server recomputes it.
 */
export function DenominationCounter({
  draft,
  onChange,
  idPrefix,
  disabled = false,
  totalLabel = "Total contado",
}: {
  draft: CountDraft;
  onChange: (draft: CountDraft) => void;
  idPrefix: string;
  disabled?: boolean;
  totalLabel?: string;
}) {
  const set = (denomination: number, value: string) =>
    onChange({ ...draft, [denomination]: sanitizeQuantity(value) });
  const step = (denomination: number, delta: number) => {
    const next = Math.max(
      0,
      Math.min(MAX_QUANTITY, Number(draft[denomination] || 0) + delta),
    );
    onChange({ ...draft, [denomination]: next === 0 ? "" : String(next) });
  };
  const group = (title: string, values: readonly number[]) => (
    <fieldset className={styles.denominations} disabled={disabled}>
      <legend>{title}</legend>
      {values.map((denomination) => {
        const inputId = `${idPrefix}-${denomination}`;
        const label = denominationLabel(denomination);
        return (
          <div key={denomination} className={styles.denominationRow}>
            <label htmlFor={inputId} className={styles.denominationLabel}>
              {label}
            </label>
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepButton}
                onClick={() => step(denomination, -1)}
                aria-label={`Quitar uno de ${label}`}
                disabled={disabled || !draft[denomination]}
              >
                <Minus size={20} aria-hidden="true" />
              </button>
              <input
                id={inputId}
                className={styles.quantity}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="0"
                value={draft[denomination] ?? ""}
                onChange={(event) => set(denomination, event.target.value)}
                aria-describedby={`${inputId}-subtotal`}
              />
              <button
                type="button"
                className={styles.stepButton}
                onClick={() => step(denomination, 1)}
                aria-label={`Agregar uno de ${label}`}
                disabled={disabled}
              >
                <Plus size={20} aria-hidden="true" />
              </button>
            </div>
            <output
              id={`${inputId}-subtotal`}
              className={styles.subtotal}
              htmlFor={inputId}
            >
              {formatPesos(lineSubtotal(draft, denomination))}
            </output>
          </div>
        );
      })}
    </fieldset>
  );
  return (
    <div className={styles.counter}>
      {group("Billetes", BILLS)}
      {group("Monedas", COINS)}
      <p className={styles.countTotal} aria-live="polite">
        <span>{totalLabel}</span>
        <strong>{formatPesos(countTotal(draft))}</strong>
      </p>
    </div>
  );
}
