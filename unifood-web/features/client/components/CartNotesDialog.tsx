"use client";

import { useId, useState } from "react";
import type { CartLine } from "../types";
import { NOTES_LIMIT } from "../domain/catalog";
import { useClientCart } from "./ClientCartProvider";
import ClientDialog from "./ClientDialog";
import styles from "./ClientShopping.module.css";

export default function CartNotesDialog({
  line,
  name,
  onClose,
}: {
  line: CartLine;
  name: string;
  onClose: () => void;
}) {
  const { update } = useClientCart();
  const [notes, setNotes] = useState(line.notes);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  return (
    <ClientDialog title="Editar observaciones" onClose={onClose}>
      <p>{name}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const message = update(line.id, { notes });
          setError(message);
          if (!message) onClose();
        }}
      >
        <div className={styles.notes}>
          <label htmlFor={inputId}>
            Observaciones <span>(opcional)</span>
          </label>
          <textarea
            id={inputId}
            autoFocus
            value={notes}
            maxLength={NOTES_LIMIT}
            rows={3}
            onChange={(event) => setNotes(event.target.value)}
            aria-describedby={`${inputId}-count`}
          />
          <small id={`${inputId}-count`}>
            {notes.length}/{NOTES_LIMIT} caracteres
          </small>
        </div>
        {error && <p role="alert">{error}</p>}
        <div className={styles.dialogActions}>
          <button type="submit" className={styles.primaryButton}>
            Guardar observaciones
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
          >
            Cancelar
          </button>
        </div>
      </form>
    </ClientDialog>
  );
}
