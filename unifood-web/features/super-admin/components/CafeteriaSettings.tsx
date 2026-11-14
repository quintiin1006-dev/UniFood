"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  BILLING_NOTE,
  HIDE_CONFIRMATION,
  MODEL_LABELS,
  REQUIRES_ADMIN,
  adminLabel,
  auditChange,
  auditWhen,
  auditWho,
  billingDraft,
  draftBilling,
  type BillingDraft,
} from "../presentation";
import type { SettingsControl, SuperAdminState } from "../state";
import type { BillingModel, BillingValue, SuperAdminCafeteria } from "../types";
import styles from "./SuperAdmin.module.css";

type Props = {
  cafeteria: SuperAdminCafeteria;
  saving: SettingsControl | null;
  controlError: SuperAdminState["controlError"];
  notice: string | null;
  audit: SuperAdminState["audit"];
  onClose: () => void;
  onVisibility: (visible: boolean) => Promise<boolean>;
  onBilling: (billing: BillingValue) => Promise<boolean>;
  onRefuse: (control: SettingsControl, message: string) => void;
  onReloadAudit: () => void;
};

const MODELS: BillingModel[] = ["NONE", "SUBSCRIPTION", "PER_ORDER_FEE"];

function BillingForm({
  cafeteria,
  saving,
  error,
  onBilling,
  onRefuse,
}: {
  cafeteria: SuperAdminCafeteria;
  saving: boolean;
  error: string | null;
  onBilling: Props["onBilling"];
  onRefuse: Props["onRefuse"];
}) {
  const ids = useId();
  const [draft, setDraft] = useState<BillingDraft>(() =>
    billingDraft(cafeteria.billing),
  );
  const change = (patch: Partial<BillingDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = draftBilling(draft);
    if ("error" in result) onRefuse("billing", result.error);
    else void onBilling(result.billing);
  };
  const errorId = `${ids}-error`;
  return (
    <form className={styles.billing} onSubmit={submit} noValidate>
      <label htmlFor={`${ids}-model`}>Modelo de cobro</label>
      <select
        id={`${ids}-model`}
        value={draft.model}
        disabled={saving}
        onChange={(event) =>
          change({ model: event.target.value as BillingModel })
        }
        aria-describedby={error ? errorId : undefined}
      >
        {MODELS.map((model) => (
          <option key={model} value={model}>
            {MODEL_LABELS[model]}
          </option>
        ))}
      </select>
      {draft.model === "PER_ORDER_FEE" && (
        <>
          <label htmlFor={`${ids}-fee`}>Comisión por pedido (COP)</label>
          <input
            id={`${ids}-fee`}
            inputMode="numeric"
            autoComplete="off"
            value={draft.perOrderFee}
            disabled={saving}
            onChange={(event) => change({ perOrderFee: event.target.value })}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids}-fee-hint${error ? ` ${errorId}` : ""}`}
          />
          <small id={`${ids}-fee-hint`}>
            Pesos enteros, de $1 a $1.000.000.
          </small>
        </>
      )}
      {draft.model === "SUBSCRIPTION" && (
        <>
          <label htmlFor={`${ids}-monthly`}>Monto mensual (COP)</label>
          <input
            id={`${ids}-monthly`}
            inputMode="numeric"
            autoComplete="off"
            value={draft.subscriptionFee}
            disabled={saving}
            onChange={(event) =>
              change({ subscriptionFee: event.target.value })
            }
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids}-monthly-hint${error ? ` ${errorId}` : ""}`}
          />
          <small id={`${ids}-monthly-hint`}>
            Opcional. Pesos enteros, de $1 a $100.000.000.
          </small>
        </>
      )}
      {error && (
        <p id={errorId} className={styles.controlError} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={styles.primary} disabled={saving}>
        {saving ? "Guardando…" : "Guardar"}
      </button>
      <p className={styles.note}>{BILLING_NOTE}</p>
    </form>
  );
}

export function CafeteriaSettings({
  cafeteria,
  saving,
  controlError,
  notice,
  audit,
  onClose,
  onVisibility,
  onBilling,
  onRefuse,
  onReloadAudit,
}: Props) {
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const visibilityError =
    controlError?.control === "visibility" ? controlError.message : null;
  const billingError =
    controlError?.control === "billing" ? controlError.message : null;

  const toggle = () => {
    if (saving) return;
    if (cafeteria.visible) {
      dialog.current?.showModal();
      return;
    }
    if (!cafeteria.hasActiveAdmin) {
      onRefuse("visibility", REQUIRES_ADMIN);
      return;
    }
    void onVisibility(true);
  };
  const hide = () => {
    dialog.current?.close();
    void onVisibility(false);
  };

  return (
    <section
      className={styles.settings}
      aria-labelledby={`${ids}-title`}
      id="cafeteria-settings"
    >
      <div className={styles.settingsHeader}>
        <div>
          <h2 id={`${ids}-title`}>{cafeteria.name}</h2>
          <p>Administrador: {adminLabel(cafeteria.hasActiveAdmin)}</p>
        </div>
        <button
          type="button"
          className={styles.secondary}
          onClick={onClose}
          disabled={saving !== null}
        >
          Cerrar
        </button>
      </div>

      <p className={styles.notice} role="status" aria-live="polite">
        {notice}
      </p>

      <div className={styles.group}>
        <h3>Visibilidad</h3>
        <div className={styles.switchRow}>
          <span id={`${ids}-switch-label`}>Visible para los clientes</span>
          <button
            type="button"
            role="switch"
            className={styles.switch}
            aria-checked={cafeteria.visible}
            aria-labelledby={`${ids}-switch-label`}
            aria-describedby={
              visibilityError ? `${ids}-visibility-error` : undefined
            }
            disabled={saving !== null}
            onClick={toggle}
          >
            <span aria-hidden="true" />
          </button>
          <span className={styles.switchState} aria-hidden="true">
            {saving === "visibility"
              ? "Guardando…"
              : cafeteria.visible
                ? "Sí"
                : "No"}
          </span>
        </div>
        {visibilityError && (
          <p
            id={`${ids}-visibility-error`}
            className={styles.controlError}
            role="alert"
          >
            {visibilityError}
          </p>
        )}
      </div>

      <div className={styles.group}>
        <h3>Cobro</h3>
        <BillingForm
          // A saved or reloaded agreement restarts the form from the server's value.
          key={`${cafeteria.id}-${cafeteria.billing.version}-${cafeteria.billing.model}`}
          cafeteria={cafeteria}
          saving={saving === "billing"}
          error={billingError}
          onBilling={onBilling}
          onRefuse={onRefuse}
        />
      </div>

      <div className={styles.group}>
        <h3>Últimos cambios</h3>
        {audit?.loading && <p className={styles.muted}>Cargando cambios…</p>}
        {audit?.error && (
          <p className={styles.controlError}>
            {audit.error}{" "}
            <button
              type="button"
              className={styles.link}
              onClick={onReloadAudit}
            >
              Reintentar
            </button>
          </p>
        )}
        {audit?.entries && audit.entries.length === 0 && (
          <p className={styles.muted}>Aún no hay cambios registrados.</p>
        )}
        {audit?.entries && audit.entries.length > 0 && (
          <ol className={styles.history}>
            {audit.entries.map((entry, index) => (
              <li key={`${entry.changedAt}-${index}`}>
                <strong>{auditChange(entry)}</strong>
                <small>
                  {auditWho(entry)} · {auditWhen(entry)}
                </small>
              </li>
            ))}
          </ol>
        )}
      </div>

      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={`${ids}-dialog-title`}
        aria-describedby={`${ids}-dialog-text`}
      >
        <h2 id={`${ids}-dialog-title`}>¿Ocultar {cafeteria.name}?</h2>
        <p id={`${ids}-dialog-text`}>{HIDE_CONFIRMATION}</p>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            Cancelar
          </button>
          <button type="button" className={styles.danger} onClick={hide}>
            Ocultar cafetería
          </button>
        </div>
      </dialog>
    </section>
  );
}
