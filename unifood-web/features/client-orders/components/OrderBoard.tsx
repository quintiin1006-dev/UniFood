"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import ClientDialog from "@/features/client/components/ClientDialog";
import {
  CANCEL_CONFIRM,
  CANCEL_CONFIRMING,
  CANCEL_DIALOG_BODY,
  CANCEL_DIALOG_TITLE,
  CANCEL_KEEP,
  CLIENT_ORDER_CANCEL,
  CLIENT_ORDER_CASH_NOTE,
  CLIENT_ORDER_NAME_LABEL,
  CLIENT_ORDER_NOTE_LABEL,
  CLIENT_ORDER_PICKUP_LABEL,
  CLIENT_ORDER_READY_TITLE,
  ORDER_STAGE_LABELS,
  ORDER_STAGES_LABEL,
  STAGE_CURRENT,
  STAGE_DONE,
  stageCounter,
} from "../../shared/messages";
import { cancelOrder } from "../api";
import type { OrderFailure } from "../errors";
import {
  formatOrderDate,
  formatTotal,
  pickupLabel,
  statusLine,
} from "../presentation";
import {
  isPickupReady,
  ORDER_STAGE_COUNT,
  ORDER_STAGE_ICONS,
  stageIndexOf,
} from "../stages";
import type { ClientOrder } from "../types";
import styles from "./ClientOrders.module.css";

/** The active order: the stage board, the pickup notice, the summary and the cancel action. */
export default function OrderBoard({
  order,
  studentName,
  onCancelled,
  onChanged,
  focusTitle = false,
}: {
  order: ClientOrder;
  /** The name on the student profile: the counter matches the order with it. */
  studentName: string | null;
  onCancelled: () => void;
  onChanged: () => void;
  /** A delivered order just ended: its last stage takes the focus once, for screen readers. */
  focusTitle?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle]);
  const pickup = pickupLabel(order);
  const line = statusLine(order);
  const current = stageIndexOf(order.status);
  const ready = isPickupReady(order.status);

  return (
    <>
      <section className={styles.card} aria-labelledby="order-board-title">
        <ol className={styles.stages} aria-label={ORDER_STAGES_LABEL}>
          {ORDER_STAGE_LABELS.map((label, index) => {
            const isCurrent = index === current;
            const done = current !== null && index < current;
            const counter = stageCounter(index + 1, ORDER_STAGE_COUNT);
            return (
              <li
                key={label}
                className={styles.stage}
                data-state={isCurrent ? "current" : done ? "done" : "upcoming"}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span className={styles.stageIcon} aria-hidden="true">
                  <Icon name={ORDER_STAGE_ICONS[index]} size={20} />
                </span>
                <span className={styles.stageLabel} aria-hidden="true">
                  {label}
                </span>
                <span className={styles.srOnly}>
                  {counter}
                  {isCurrent ? `, ${STAGE_CURRENT}` : ""}
                  {done ? `, ${STAGE_DONE}` : ""}: {label}
                </span>
              </li>
            );
          })}
        </ol>

        <h2
          id="order-board-title"
          ref={titleRef}
          tabIndex={focusTitle ? -1 : undefined}
          className={styles.statusTitle}
        >
          {line.title}
        </h2>
        <p className={styles.statusDetail}>{line.detail}</p>

        {ready && (
          <div className={styles.readyNotice}>
            <p className={styles.readyTitle}>{CLIENT_ORDER_READY_TITLE}</p>
            {studentName && (
              <p className={styles.readyCode}>
                <span>{CLIENT_ORDER_NAME_LABEL}</span>
                <strong className={styles.readyName}>{studentName}</strong>
              </p>
            )}
          </div>
        )}
      </section>

      <article className={styles.card} aria-label="Resumen de tu pedido">
        <h3 className={styles.orderName}>
          Pedido del {formatOrderDate(order.createdAt)}
        </h3>
        {studentName && (
          <p className={styles.studentLine}>
            <span>{CLIENT_ORDER_NAME_LABEL}</span>{" "}
            <strong>{studentName}</strong>
          </p>
        )}
        <p className={styles.place}>{order.cafeteria.name}</p>
        <p className={styles.productsLine}>
          {order.items
            .map((item) => `${item.quantity}× ${item.name}`)
            .join(" · ")}
        </p>
        {pickup && (
          <p className={styles.note}>
            <span>{CLIENT_ORDER_PICKUP_LABEL}</span>{" "}
            <strong>{pickup.replace("Recoger a las ", "")}</strong>
          </p>
        )}
        {order.note && (
          <p className={styles.note}>
            <span>{CLIENT_ORDER_NOTE_LABEL}</span> {order.note}
          </p>
        )}
        <p className={styles.total}>
          <span>Total</span>
          <strong>{formatTotal(order.total)}</strong>
        </p>
        <p className={styles.cash}>{CLIENT_ORDER_CASH_NOTE}</p>
        {order.status === "PENDING" && (
          <Button
            variant="danger"
            className={styles.cancelButton}
            onClick={() => setConfirming(true)}
          >
            {CLIENT_ORDER_CANCEL}
          </Button>
        )}
      </article>

      {confirming && (
        <CancelDialog
          orderId={order.id}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            onCancelled();
          }}
          onStale={onChanged}
        />
      )}
    </>
  );
}

function CancelDialog({
  orderId,
  onClose,
  onDone,
  onStale,
}: {
  orderId: string;
  onClose: () => void;
  onDone: () => void;
  onStale: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<OrderFailure | null>(null);
  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    const outcome = await cancelOrder(orderId);
    if (outcome.ok) {
      onDone();
      return;
    }
    setBusy(false);
    setFailure(outcome.failure);
    // The order moved under the client (preparing, rejected…): show its real state behind.
    onStale();
  };
  return (
    <ClientDialog
      title={CANCEL_DIALOG_TITLE}
      onClose={busy ? () => undefined : onClose}
    >
      <p>{CANCEL_DIALOG_BODY}</p>
      {failure && (
        <Notice tone="error" className={styles.dialogError}>
          {failure.message}
        </Notice>
      )}
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy} autoFocus>
          {failure ? "Cerrar" : CANCEL_KEEP}
        </Button>
        {!failure?.login && (
          <Button variant="danger" loading={busy} onClick={confirm}>
            {busy ? CANCEL_CONFIRMING : CANCEL_CONFIRM}
          </Button>
        )}
      </div>
    </ClientDialog>
  );
}
