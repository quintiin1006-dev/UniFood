"use client";

import { useId, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { cashApi } from "../api";
import {
  OUTCOME_LABELS,
  SHIFT_LABELS,
  STATUS_LABELS,
  formatCashDate,
  formatDifference,
  formatPesos,
  formatSequence,
} from "../presentation";
import { useCashListing } from "../useCashListing";
import type { CashDetail, CashProblem } from "../types";
import { CashReceipt } from "./CashReceipt";
import { CashSettingsForm } from "./CashSettingsForm";
import { ReopenForm } from "./ReopenForm";
import styles from "./Cash.module.css";

/**
 * Cash closures for the ADMIN of a cafeteria (operates and reopens its own) or SUPER_ADMIN
 * (reads every cafeteria). Differences outside the tolerance are highlighted.
 */
export function CashClosuresPanel({
  superAdmin = false,
}: {
  superAdmin?: boolean;
}) {
  const ids = useId();
  const state = useCashListing({ superAdmin });
  const { listing, range } = state;
  const [detail, setDetail] = useState<CashDetail | null>(null);
  const [detailProblem, setDetailProblem] = useState<CashProblem | null>(null);
  const [draftRange, setDraftRange] = useState(range);
  const invalidRange =
    !draftRange.from || !draftRange.to || draftRange.from > draftRange.to;

  const open = async (id: string) => {
    setDetailProblem(null);
    const result = await cashApi.detail(id, superAdmin);
    if (result.ok) setDetail(result.data);
    else setDetailProblem(result.problem);
  };

  return (
    <section className={styles.panel} aria-labelledby={`${ids}-title`}>
      <div className={styles.heading}>
        <div>
          <h2 id={`${ids}-title`}>Cierres de caja</h2>
          <p className={styles.help}>
            Control interno del efectivo por turno. No reemplaza la facturación.
          </p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void state.reload()}
          disabled={state.loading}
        >
          <RefreshCw size={17} aria-hidden="true" />
          <span>{state.loading ? "Actualizando…" : "Actualizar"}</span>
        </button>
      </div>

      <form
        className={`${styles.card} ${styles.filters}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalidRange) state.setRange(draftRange);
        }}
      >
        <div className={styles.field}>
          <label htmlFor={`${ids}-from`}>Desde</label>
          <input
            id={`${ids}-from`}
            type="date"
            className={styles.dateInput}
            value={draftRange.from}
            max={listing?.businessDate}
            onChange={(event) =>
              setDraftRange({ ...draftRange, from: event.target.value })
            }
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${ids}-to`}>Hasta</label>
          <input
            id={`${ids}-to`}
            type="date"
            className={styles.dateInput}
            value={draftRange.to}
            max={listing?.businessDate}
            onChange={(event) =>
              setDraftRange({ ...draftRange, to: event.target.value })
            }
          />
        </div>
        <Button type="submit" disabled={invalidRange || state.loading}>
          Ver cierres
        </Button>
        <a
          className={buttonClass("secondary")}
          href={state.exportUrl}
          download
          aria-label="Exportar los cierres del rango a CSV para Excel"
        >
          <Download size={18} aria-hidden="true" /> Exportar CSV
        </a>
        {invalidRange && (
          <p className={styles.fieldError} role="alert">
            La fecha inicial debe ser anterior o igual a la final.
          </p>
        )}
      </form>

      {state.problem && <Notice tone="error">{state.problem.message}</Notice>}

      {listing && listing.staleSessions.length > 0 && (
        <Notice tone="error" title="Caja abierta de un día anterior">
          <ul className={styles.pendingList}>
            {listing.staleSessions.map((s) => (
              <li key={s.id}>
                {s.cafeteria.name} · {SHIFT_LABELS[s.shift]} del{" "}
                {formatCashDate(s.businessDate)}. Pide que la cierren antes de
                abrir otra.
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {listing?.unsessionedToday && listing.unsessionedToday.orders > 0 && (
        <Notice tone="info" title="Ventas sin caja hoy">
          {listing.unsessionedToday.orders} pedido(s) entregado(s) por{" "}
          {formatPesos(listing.unsessionedToday.amount)} fuera de una caja
          abierta. No entran en ningún cierre.
        </Notice>
      )}

      {!superAdmin &&
        listing &&
        listing.toleranceCop !== null &&
        listing.settingsVersion !== null && (
          <CashSettingsForm
            toleranceCop={listing.toleranceCop}
            version={listing.settingsVersion}
            onSaved={(toleranceCop, settingsVersion) =>
              state.setListing({ ...listing, toleranceCop, settingsVersion })
            }
          />
        )}

      {listing && (
        <div className={styles.card}>
          {listing.sessions.length === 0 ? (
            <p className={styles.help}>No hay cierres en este rango.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.closures}>
                <caption className={styles.srOnly}>
                  Cierres del {range.from} al {range.to}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">N.º</th>
                    {superAdmin && <th scope="col">Cafetería</th>}
                    <th scope="col">Fecha</th>
                    <th scope="col">Turno</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Esperado</th>
                    <th scope="col">Contado</th>
                    <th scope="col">Diferencia</th>
                    <th scope="col">
                      <span className={styles.srOnly}>Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {listing.sessions.map((s) => (
                    <tr
                      key={s.id}
                      className={
                        s.outsideTolerance ? styles.rowOutside : undefined
                      }
                    >
                      <td>{formatSequence(s.sequenceNumber)}</td>
                      {superAdmin && <td>{s.cafeteria.name}</td>}
                      <td>{s.businessDate}</td>
                      <td>{SHIFT_LABELS[s.shift]}</td>
                      <td>
                        {STATUS_LABELS[s.status]}
                        {s.forcedClose ? " · con pendientes" : ""}
                      </td>
                      <td>
                        {s.expected === null ? "—" : formatPesos(s.expected)}
                      </td>
                      <td>
                        {s.counted === null ? "—" : formatPesos(s.counted)}
                      </td>
                      <td>
                        {s.difference === null || !s.outcome ? (
                          "—"
                        ) : (
                          <>
                            {formatDifference(s.difference)}{" "}
                            <small>
                              {OUTCOME_LABELS[s.outcome]}
                              {s.outsideTolerance
                                ? " · fuera de tolerancia"
                                : ""}
                            </small>
                          </>
                        )}
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => void open(s.id)}
                        >
                          Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {detailProblem && <Notice tone="error">{detailProblem.message}</Notice>}
      {detail && (
        <>
          <CashReceipt detail={detail} onDone={() => setDetail(null)} />
          {!superAdmin && detail.session.status === "CLOSED" && (
            <ReopenForm
              session={detail.session}
              onReopened={(next) => {
                setDetail(next);
                void state.reload();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
