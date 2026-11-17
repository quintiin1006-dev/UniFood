"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { StatusChip } from "@/components/ui/StatusChip";
import ClientDialog from "@/features/client/components/ClientDialog";
import { OFFLINE_RETRYING } from "../../shared/messages";
import { cancelOrder } from "../api";
import type { OrderFailure } from "../errors";
import { ALERT_TEXT, tabTitle, type OrderAlert } from "../polling";
import { STEPS, statusLine, stepOf } from "../presentation";
import { armChime, playChime, readMuted, writeMuted } from "../sound";
import type { ClientOrder } from "../types";
import { useCurrentOrder } from "../useCurrentOrder";
import OrderSummary from "./OrderSummary";
import styles from "./ClientOrders.module.css";

export default function MyOrder() {
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [alert, setAlert] = useState<OrderAlert | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    const saved = readMuted();
    mutedRef.current = saved;
    // The saved choice only exists in the browser, so it is read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(saved);
    return armChime();
  }, []);

  const onAlert = useCallback((next: OrderAlert) => {
    setAlert(next);
    if (!mutedRef.current) playChime();
  }, []);
  const { loaded, order, finished, failure, offline, refresh } =
    useCurrentOrder(onAlert);

  const toggleSound = () => {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    writeMuted(next);
  };

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
        <h1 id="my-order-title">Mi pedido</h1>
        <button
          type="button"
          role="switch"
          aria-checked={!muted}
          className={styles.soundSwitch}
          onClick={toggleSound}
        >
          <span aria-hidden="true" className={styles.switchTrack}>
            <span className={styles.switchThumb} />
          </span>
          <span>Sonido de avisos</span>
        </button>
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
          <Notice tone="success">Pedido cancelado.</Notice>
        )}
      </div>

      {offline && (
        <Notice tone="info" className={styles.offline}>
          {OFFLINE_RETRYING} Mostramos lo último que vimos.
        </Notice>
      )}

      {!loaded && !failure && <Skeleton />}
      {failure && !order && (
        <FailurePanel failure={failure} onRetry={refresh} />
      )}
      {loaded && !failure && order && (
        <ActiveOrder
          order={order}
          onCancelled={() => {
            setCancelled(true);
            refresh();
          }}
          onChanged={refresh}
        />
      )}
      {loaded && !failure && !order && finished && (
        <FinishedOrder order={finished} />
      )}
      {loaded && !failure && !order && !finished && (
        <EmptyState
          icon={<Icon name="mi-pedido" size={28} />}
          title="No tienes un pedido activo"
          action={
            <Link href="/cuenta" className={buttonClass("primary")}>
              Ver el menú
            </Link>
          }
        >
          Cuando envíes un pedido podrás seguirlo aquí.
        </EmptyState>
      )}
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

function Progress({ order }: { order: ClientOrder }) {
  const current = stepOf(order.status);
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <ol className={styles.steps} aria-label="Progreso del pedido">
      {STEPS.map((step, position) => (
        <li
          key={step.id}
          data-done={position < index || undefined}
          aria-current={position === index ? "step" : undefined}
        >
          <span className={styles.stepDot} aria-hidden="true" />
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function ActiveOrder({
  order,
  onCancelled,
  onChanged,
}: {
  order: ClientOrder;
  onCancelled: () => void;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const line = statusLine(order);
  return (
    <>
      <article className={styles.card} aria-labelledby="order-status-title">
        <StatusChip status={order.status} />
        <h2 id="order-status-title" className={styles.statusTitle}>
          {line.title}
        </h2>
        <p className={styles.statusDetail}>{line.detail}</p>
        <Progress order={order} />
      </article>
      <article className={styles.card}>
        <OrderSummary order={order} />
        {order.status === "PENDING" && (
          <Button
            variant="danger"
            className={styles.cancelButton}
            onClick={() => setConfirming(true)}
          >
            Cancelar pedido
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
      title="¿Cancelar tu pedido?"
      onClose={busy ? () => undefined : onClose}
    >
      <p>
        Solo puedes cancelarlo mientras esté pendiente. Esta acción no se puede
        deshacer.
      </p>
      {failure && (
        <Notice tone="error" className={styles.dialogError}>
          {failure.message}
        </Notice>
      )}
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy} autoFocus>
          {failure ? "Cerrar" : "Mantener pedido"}
        </Button>
        {!failure?.login && (
          <Button variant="danger" loading={busy} onClick={confirm}>
            {busy ? "Cancelando…" : "Sí, cancelar pedido"}
          </Button>
        )}
      </div>
    </ClientDialog>
  );
}

function FinishedOrder({ order }: { order: ClientOrder }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const line = statusLine(order);
  return (
    <>
      <article className={styles.card} aria-labelledby="finished-title">
        <StatusChip
          status={order.status}
          cancellationSource={order.cancellationSource}
        />
        <h2
          id="finished-title"
          ref={heading}
          tabIndex={-1}
          className={styles.statusTitle}
        >
          {line.title}
        </h2>
        <p className={styles.statusDetail}>{line.detail}</p>
        <div className={styles.actions}>
          <Link href="/cuenta" className={buttonClass("primary")}>
            Hacer otro pedido
          </Link>
          <Link href="/cuenta/historial" className={buttonClass("secondary")}>
            Ver historial
          </Link>
        </div>
      </article>
      <article className={styles.card}>
        <OrderSummary order={order} />
      </article>
    </>
  );
}
