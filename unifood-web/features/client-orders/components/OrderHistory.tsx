"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { StatusChip } from "@/components/ui/StatusChip";
import ClientDialog from "@/features/client/components/ClientDialog";
import { fetchOrder } from "../api";
import type { OrderFailure } from "../errors";
import { formatOrderDate, formatTotal, statusLine } from "../presentation";
import type { ClientOrder, OrderHistoryItem } from "../types";
import { useOrderHistory } from "../useOrderHistory";
import OrderSummary from "./OrderSummary";
import styles from "./ClientOrders.module.css";

export default function OrderHistory() {
  const history = useOrderHistory();
  const [open, setOpen] = useState<OrderHistoryItem | null>(null);

  return (
    <section className={styles.page} aria-labelledby="history-title">
      <div className={styles.heading}>
        <h1 id="history-title">Historial</h1>
      </div>

      {history.phase === "loading" && (
        <div
          className={styles.skeletonGroup}
          aria-busy="true"
          aria-label="Cargando tu historial"
        >
          {[0, 1, 2].map((n) => (
            <div key={n} className={styles.skeleton} style={{ height: 96 }} />
          ))}
        </div>
      )}

      {history.phase === "error" && history.failure && (
        <div className={styles.failure} role="alert">
          <h2>{history.failure.message}</h2>
          {history.failure.login ? (
            <Link href="/login" className={buttonClass("primary")}>
              Iniciar sesión
            </Link>
          ) : (
            <Button onClick={history.retry}>Reintentar</Button>
          )}
        </div>
      )}

      {history.phase === "ready" && history.orders.length === 0 && (
        <EmptyState
          icon={<Icon name="historial" size={28} />}
          title="Aún no tienes pedidos"
          action={
            <Link href="/cuenta" className={buttonClass("primary")}>
              Ver el menú
            </Link>
          }
        >
          Tus pedidos aparecerán aquí cuando hagas el primero.
        </EmptyState>
      )}

      {history.phase === "ready" && history.orders.length > 0 && (
        <>
          <ul className={styles.historyList}>
            {history.orders.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  className={styles.historyRow}
                  onClick={() => setOpen(order)}
                  aria-haspopup="dialog"
                >
                  <span className={styles.rowTop}>
                    <span className={styles.rowDate}>
                      {formatOrderDate(order.createdAt)}
                    </span>
                    <StatusChip status={order.status} />
                  </span>
                  <span className={styles.rowPlace}>{order.cafeteriaName}</span>
                  <span className={styles.rowSummary}>{order.summary}</span>
                  <span className={styles.rowTotal}>
                    {order.itemCount}{" "}
                    {order.itemCount === 1 ? "unidad" : "unidades"} ·{" "}
                    <strong>{formatTotal(order.total)}</strong>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {history.failure && (
            <Notice tone="error">{history.failure.message}</Notice>
          )}
          {history.hasMore && (
            <Button
              variant="secondary"
              className={styles.more}
              loading={history.loadingMore}
              onClick={history.failure ? history.retry : history.loadMore}
            >
              {history.loadingMore
                ? "Cargando…"
                : history.failure
                  ? "Reintentar"
                  : "Cargar más"}
            </Button>
          )}
        </>
      )}

      {open && <DetailDialog item={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function DetailDialog({
  item,
  onClose,
}: {
  item: OrderHistoryItem;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<ClientOrder | null>(null);
  const [failure, setFailure] = useState<OrderFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetchOrder(item.id).then((outcome) => {
      if (!alive) return;
      if (outcome.ok) setOrder(outcome.value);
      else setFailure(outcome.failure);
    });
    return () => {
      alive = false;
    };
  }, [item.id, attempt]);

  const line = order ? statusLine(order) : null;
  return (
    <ClientDialog
      title={`Pedido del ${formatOrderDate(item.createdAt)}`}
      onClose={onClose}
    >
      <div className={styles.detail} aria-busy={!order && !failure}>
        {!order && !failure && (
          <div className={styles.skeleton} style={{ height: 160 }} />
        )}
        {failure && <Notice tone="error">{failure.message}</Notice>}
        {order && line && (
          <>
            <StatusChip
              status={order.status}
              cancellationSource={order.cancellationSource}
            />
            <p className={styles.statusDetail}>
              <strong>{line.title}.</strong> {line.detail}
            </p>
            <OrderSummary order={order} />
          </>
        )}
      </div>
      <div className={styles.dialogActions}>
        {failure && !failure.login && (
          <Button
            onClick={() => {
              setFailure(null);
              setAttempt((n) => n + 1);
            }}
          >
            Reintentar
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} autoFocus>
          Cerrar
        </Button>
      </div>
    </ClientDialog>
  );
}
