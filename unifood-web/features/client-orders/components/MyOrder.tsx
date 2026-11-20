"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  CLIENT_ORDER_CANCELLED_NOTICE,
  CLIENT_ORDER_EMPTY_BODY,
  CLIENT_ORDER_EMPTY_TITLE,
  CLIENT_ORDER_GO_MENU,
  CLIENT_ORDER_TITLE,
  CONNECTION_OFFLINE,
} from "../../shared/messages";
import { ConnectionNotice } from "@/features/shared/components/ConnectionNotice";
import type { OrderFailure } from "../errors";
import { statusLine } from "../presentation";
import { isDeliveredToday } from "../stages";
import { ALERT_TEXT, tabTitle, type OrderAlert } from "../polling";
import { armChime, playChime, readMuted } from "../sound";
import type { ClientOrder } from "../types";
import { useCurrentOrder } from "../useCurrentOrder";
import OrderBoard from "./OrderBoard";
import OrderHistory from "./OrderHistory";
import styles from "./ClientOrders.module.css";

/** «Mi pedido»: the active order on a stage board, and the ended orders below it. */
export default function MyOrder({
  studentName,
}: {
  studentName: string | null;
}) {
  // The clock is read in an effect and refreshed each minute: a delivery belongs to its day.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  // C4: the header bell is the only switch; it also mutes this chime (readMuted).
  const mutedRef = useRef(false);
  const [alert, setAlert] = useState<OrderAlert | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    // The saved choice only exists in the browser, so it is read after hydration.
    mutedRef.current = readMuted();
    return armChime();
  }, []);

  const onAlert = useCallback((next: OrderAlert) => {
    setAlert(next);
    // Read on every alert: the bell may have changed it since the page opened.
    mutedRef.current = readMuted();
    if (!mutedRef.current) playChime();
  }, []);
  const { loaded, order, finished, failure, offline, refresh } =
    useCurrentOrder(onAlert);
  // A delivery of today leaves «active» but stays on the board at its last stage. Any other
  // ended order is in the history; cancelled and not collected ones are not stages at all.
  const boardOrder =
    order ?? (finished && isDeliveredToday(finished, now) ? finished : null);
  // Rejected, cancelled or not collected: one status line until the next order.
  const endedOrder =
    finished && finished.status !== "DELIVERED" ? finished : null;

  // The tab says the order is ready even when the page is in the background.
  const status = order?.status ?? null;
  useEffect(() => {
    const title = tabTitle(status);
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      // Only if nobody else (the next page) has already set its own title.
      if (document.title === title) document.title = previous;
    };
  }, [status]);

  // A banner belongs to the order that caused it.
  const orderId = order?.id ?? null;
  useEffect(() => {
    if (!orderId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAlert(null);
    }
  }, [orderId]);

  return (
    <section className={styles.page} aria-labelledby="my-order-title">
      <div className={styles.heading}>
        <h1 id="my-order-title">{CLIENT_ORDER_TITLE}</h1>
      </div>

      <div aria-live="polite" aria-atomic="true" className={styles.liveRegion}>
        {alert && (
          <Notice
            tone="info"
            action={
              <button
                type="button"
                className={styles.dismiss}
                onClick={() => setAlert(null)}
              >
                Entendido
              </button>
            }
          >
            {ALERT_TEXT[alert]}
          </Notice>
        )}
        {cancelled && !alert && (
          <Notice tone="success">{CLIENT_ORDER_CANCELLED_NOTICE}</Notice>
        )}
      </div>

      {offline && (
        <ConnectionNotice className={styles.offline} onRetry={refresh}>
          {CONNECTION_OFFLINE}
        </ConnectionNotice>
      )}

      {!loaded && !failure && <Skeleton />}
      {failure && <FailurePanel failure={failure} onRetry={refresh} />}
      {loaded && !failure && boardOrder && (
        <OrderBoard
          order={boardOrder}
          studentName={studentName}
          focusTitle={!order}
          onCancelled={() => {
            setCancelled(true);
            refresh();
          }}
          onChanged={refresh}
        />
      )}
      {loaded && !failure && !boardOrder && endedOrder && (
        <EndedOrder order={endedOrder} />
      )}
      {loaded && !failure && !boardOrder && !endedOrder && (
        <section className={styles.card} aria-label="Tablero de tu pedido">
          <EmptyState
            icon={<Icon name="mi-pedido" size={28} />}
            title={CLIENT_ORDER_EMPTY_TITLE}
            action={
              <Link href="/cuenta" className={buttonClass("primary")}>
                {CLIENT_ORDER_GO_MENU}
              </Link>
            }
          >
            {CLIENT_ORDER_EMPTY_BODY}
          </EmptyState>
        </section>
      )}

      <OrderHistory refreshKey={finished?.id ?? null} />
    </section>
  );
}

/**
 * How an order that ended without being delivered (rejected, cancelled, not collected) finished.
 * It is not a stage of the board: one status line, with its reason, until the next order.
 */
function EndedOrder({ order }: { order: ClientOrder }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const line = statusLine(order);
  return (
    <section className={styles.card} aria-labelledby="ended-order-title">
      <StatusChip
        status={order.status}
        cancellationSource={order.cancellationSource}
        className={styles.chipStart}
      />
      <h2
        id="ended-order-title"
        ref={heading}
        tabIndex={-1}
        className={styles.statusTitle}
      >
        {line.title}
      </h2>
      <p className={styles.statusDetail}>{line.detail}</p>
      <div className={styles.actions}>
        <Link href="/cuenta" className={buttonClass("primary")}>
          {CLIENT_ORDER_GO_MENU}
        </Link>
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div
      className={styles.skeletonGroup}
      aria-busy="true"
      aria-label="Cargando tu pedido"
    >
      <div className={styles.skeleton} style={{ height: 132 }} />
      <div className={styles.skeleton} style={{ height: 188 }} />
    </div>
  );
}

function FailurePanel({
  failure,
  onRetry,
}: {
  failure: OrderFailure;
  onRetry: () => void;
}) {
  return (
    <div className={styles.failure} role="alert">
      <h2>{failure.message}</h2>
      {failure.login ? (
        <Link href="/login" className={buttonClass("primary")}>
          Iniciar sesión
        </Link>
      ) : (
        <Button onClick={onRetry}>Reintentar</Button>
      )}
    </div>
  );
}
