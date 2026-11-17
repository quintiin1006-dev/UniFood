"use client";

import { Icon, ICON_MIN_20 } from "@/components/ui/Icon";
import { CASH_TEXTS } from "@/features/shared/messages";
import { Button } from "@/components/ui/Button";
import {
  OUTCOME_LABELS,
  SHIFT_LABELS,
  STATUS_LABELS,
  denominationLabel,
  formatCashDate,
  formatCashDateTime,
  formatDifference,
  formatPesos,
  formatSequence,
} from "../presentation";
import type { CashDetail } from "../types";
import styles from "./Cash.module.css";

/**
 * Receipt of a closed drawer, on screen and printable («Imprimir o guardar PDF» uses the
 * browser's print dialog). Internal control only: it is not an invoice.
 */
export function CashReceipt({
  detail,
  onDone,
}: {
  detail: CashDetail;
  onDone?: () => void;
}) {
  const s = detail.session;
  const rows: [string, number | null][] = [
    ["Fondo inicial", s.openingFloat],
    ["Ventas en efectivo", s.sales],
    ["Otros ingresos", s.income],
    ["Egresos y retiros", s.expense],
    ["Efectivo esperado", s.expected],
    ["Efectivo contado", s.counted],
  ];
  return (
    <section
      className={`${styles.card} ${styles.receipt}`}
      aria-labelledby="cash-receipt-title"
    >
      <header className={styles.receiptHeader}>
        <p className={styles.stepLabel}>Comprobante de cierre de caja</p>
        <h3 id="cash-receipt-title" className={styles.cardTitle}>
          {s.cafeteria.name} · Consecutivo {formatSequence(s.sequenceNumber)}
        </h3>
        <p className={styles.help}>
          {SHIFT_LABELS[s.shift]} · {formatCashDate(s.businessDate)} ·{" "}
          {STATUS_LABELS[s.status]}
        </p>
      </header>
      <dl className={styles.receiptRows}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value === null ? "—" : formatPesos(value)}</dd>
          </div>
        ))}
        {s.difference !== null && s.outcome && (
          <div className={styles.receiptDifference}>
            <dt>Diferencia</dt>
            <dd>
              {formatDifference(s.difference)} · {OUTCOME_LABELS[s.outcome]}
              {s.outsideTolerance ? " · Fuera de tolerancia" : ""}
            </dd>
          </div>
        )}
      </dl>
      {s.note && (
        <p className={styles.receiptNote}>
          <strong>Nota:</strong> {s.note}
        </p>
      )}
      {s.forcedClose && (
        <p className={styles.receiptNote}>
          Cerrada por el administrador con {s.pendingOrdersAtClose} pedido(s)
          sin resolver.
        </p>
      )}
      {detail.countLines.length > 0 && (
        <table className={styles.receiptTable}>
          <caption>Conteo por denominación</caption>
          <thead>
            <tr>
              <th scope="col">Denominación</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {detail.countLines.map((line) => (
              <tr key={line.denomination}>
                <td>{denominationLabel(line.denomination)}</td>
                <td>{line.quantity}</td>
                <td>{formatPesos(line.denomination * line.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail.movements.length > 0 && (
        <table className={styles.receiptTable}>
          <caption>Movimientos</caption>
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Motivo</th>
              <th scope="col">Monto</th>
            </tr>
          </thead>
          <tbody>
            {detail.movements.map((m) => (
              <tr key={m.id}>
                <td>{m.kind === "INCOME" ? "Ingreso" : "Egreso"}</td>
                <td>{m.reason}</td>
                <td>
                  {formatPesos(m.kind === "INCOME" ? m.amount : -m.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.receiptMeta}>
        Abrió {s.openedByName}, {formatCashDateTime(s.openedAt)}
        {s.closedAt && s.closedByName
          ? ` · Cerró ${s.closedByName}, ${formatCashDateTime(s.closedAt)}`
          : ""}
      </p>
      <p className={styles.receiptMeta}>{CASH_TEXTS.notInvoice}</p>
      <div className={`${styles.actions} ${styles.noPrint}`}>
        <Button variant="secondary" touch onClick={() => window.print()}>
          <Icon name="imprimir" size={20} style={ICON_MIN_20} /> Imprimir o
          guardar PDF
        </Button>
        {onDone && (
          <Button touch onClick={onDone}>
            Listo
          </Button>
        )}
      </div>
    </section>
  );
}
