"use client";

import { useState } from "react";
import { Icon, ICON_MIN_20 } from "@/components/ui/Icon";
import { CASH_TEXTS } from "@/features/shared/messages";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useCash } from "../useCash";
import {
  SHIFT_LABELS,
  formatCashDate,
  formatCashTime,
  formatPesos,
  formatSequence,
} from "../presentation";
import type { CashDetail } from "../types";
import { CashReceipt } from "./CashReceipt";
import { CloseWizard } from "./CloseWizard";
import { MovementForm } from "./MovementForm";
import { OpenCashForm } from "./OpenCashForm";
import styles from "./Cash.module.css";

type View = "summary" | "movement" | "close";

/** «Caja» tab of the worker panel (docs/decisiones.md §14). */
export function CashPanel() {
  const cash = useCash();
  const [view, setView] = useState<View>("summary");
  const [receipt, setReceipt] = useState<CashDetail | null>(null);
  const { current, problem, loading, online } = cash;
  const session = current?.session ?? null;
  const live = current?.live ?? null;
  const denied = problem?.status === 401 || problem?.status === 403;

  return (
    <section
      className={styles.panel}
      aria-labelledby="cash-title"
      aria-busy={loading || cash.refreshing}
    >
      <div className={styles.heading}>
        <div>
          <h2 id="cash-title">Caja</h2>
          {current && (
            <p className={styles.help}>
              {formatCashDate(current.businessDate)}
            </p>
          )}
        </div>
        {current && !receipt && (
          <button
            type="button"
            className={styles.refresh}
            onClick={() => void cash.refresh()}
            disabled={cash.refreshing}
            aria-label="Actualizar caja"
          >
            <Icon name="recargar" size={20} style={ICON_MIN_20} />
            <span>{cash.refreshing ? "Actualizando…" : "Actualizar"}</span>
          </button>
        )}
      </div>

      {!online && (
        <Notice tone="error" title="Sin conexión">
          {CASH_TEXTS.offlineBanner}
        </Notice>
      )}

      {loading && !current && (
        <p className={styles.loading} role="status">
          {CASH_TEXTS.loading}
        </p>
      )}

      {problem && !current && (
        <Notice
          tone="error"
          action={
            denied ? undefined : (
              <Button variant="secondary" onClick={() => void cash.retry()}>
                Reintentar
              </Button>
            )
          }
        >
          {problem.message}
        </Notice>
      )}

      {receipt && (
        <CashReceipt
          detail={receipt}
          onDone={() => {
            setReceipt(null);
            setView("summary");
            void cash.refresh();
          }}
        />
      )}

      {current && !receipt && (
        <>
          {current.unsessionedToday.orders > 0 && (
            <Notice tone="info" title="Ventas sin caja">
              Hoy hay {current.unsessionedToday.orders} pedido(s) entregado(s)
              por {formatPesos(current.unsessionedToday.amount)} fuera de una
              caja abierta. No entran en ningún cierre; avisa al administrador.
            </Notice>
          )}
          {current.stale && session && (
            <Notice tone="error" title="Caja de un día anterior">
              Esta caja es del {formatCashDate(session.businessDate)}. Ciérrala
              para poder abrir la de hoy; el administrador ya fue avisado.
            </Notice>
          )}

          {!session && (
            <OpenCashForm online={online} onOpened={cash.setCurrent} />
          )}

          {session && live && view === "summary" && (
            <section
              className={styles.card}
              aria-labelledby="cash-summary-title"
            >
              <p className={styles.stepLabel}>
                {SHIFT_LABELS[session.shift]} · Consecutivo{" "}
                {formatSequence(session.sequenceNumber)} · abierta a las{" "}
                {formatCashTime(session.openedAt)}
                {session.status === "REOPENED" ? " · Reabierta" : ""}
              </p>
              <h3 id="cash-summary-title" className={styles.cardTitle}>
                Caja abierta
              </h3>
              <dl className={styles.summary}>
                <div>
                  <dt>Fondo inicial</dt>
                  <dd>{formatPesos(live.openingFloat)}</dd>
                </div>
                <div>
                  <dt>Ventas en efectivo</dt>
                  <dd>
                    {formatPesos(live.sales)}
                    <small>{live.deliveredOrders} entregado(s)</small>
                  </dd>
                </div>
                <div>
                  <dt>Otros ingresos</dt>
                  <dd>{formatPesos(live.income)}</dd>
                </div>
                <div>
                  <dt>Egresos y retiros</dt>
                  <dd>{formatPesos(-live.expense)}</dd>
                </div>
                <div className={styles.expected}>
                  <dt>Efectivo esperado</dt>
                  <dd>{formatPesos(live.expected)}</dd>
                </div>
              </dl>
              {session.status === "REOPENED" && session.reopenReason && (
                <p className={styles.help}>
                  Reabierta por {session.reopenedByName}: {session.reopenReason}
                </p>
              )}
              {current.pendingOrders.length > 0 && (
                <p className={styles.help}>
                  {current.pendingOrders.length} pedido(s) listo(s) o llamado(s)
                  por resolver antes de cerrar.
                </p>
              )}
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  touch
                  onClick={() => setView("movement")}
                  disabled={!online}
                >
                  Registrar movimiento
                </Button>
                <Button
                  touch
                  onClick={() => setView("close")}
                  disabled={!online}
                >
                  Cerrar caja
                </Button>
              </div>
              {current.movements.length > 0 && (
                <ul
                  className={styles.movements}
                  aria-label="Movimientos de la caja"
                >
                  {current.movements.map((m) => (
                    <li key={m.id}>
                      <span>
                        {formatCashTime(m.createdAt)} · {m.reason}
                      </span>
                      <strong>
                        {formatPesos(
                          m.kind === "INCOME" ? m.amount : -m.amount,
                        )}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {session && view === "movement" && (
            <MovementForm
              sessionId={session.id}
              online={online}
              onCancel={() => setView("summary")}
              onRecorded={(next) => {
                cash.setCurrent(next);
                setView("summary");
              }}
            />
          )}

          {session && view === "close" && (
            <CloseWizard
              session={session}
              online={online}
              onCancel={() => setView("summary")}
              onClosed={(detail) => {
                setReceipt(detail);
                setView("summary");
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
