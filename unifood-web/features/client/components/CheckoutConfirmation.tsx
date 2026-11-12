"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { currency } from "../domain/catalog";
import { pickupLabel, type PlacedOrder } from "../domain/checkout";
import CheckoutLines from "./CheckoutLines";
import shared from "./ClientShopping.module.css";
import styles from "./ClientCheckout.module.css";

/** Shown after the backend accepted the order (201 or an idempotent 200). */
export default function CheckoutConfirmation({
  order,
}: {
  order: PlacedOrder;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const reference = order.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return (
    <section className={shared.shopping} aria-labelledby="confirmation-title">
      <div className={styles.confirmationHeading}>
        <CircleCheck size={44} strokeWidth={1.5} aria-hidden="true" />
        <h1 id="confirmation-title" tabIndex={-1} ref={heading}>
          Pedido enviado
        </h1>
        <p className={shared.description}>
          La cafetería ya recibió tu pedido. Paga en efectivo al recogerlo.
        </p>
      </div>
      <dl className={styles.details}>
        <div>
          <dt>Referencia</dt>
          <dd>{reference}</dd>
        </div>
        {order.cafeteria && (
          <div>
            <dt>Recoger en</dt>
            <dd>{order.cafeteria}</dd>
          </div>
        )}
        <div>
          <dt>Recogida</dt>
          <dd>
            {order.requestedPickupAt
              ? `A las ${pickupLabel(order.requestedPickupAt)} · Colombia`
              : "Lo antes posible"}
          </dd>
        </div>
        {order.note && (
          <div>
            <dt>Nota</dt>
            <dd>{order.note}</dd>
          </div>
        )}
        <div>
          <dt>Pago</dt>
          <dd>Efectivo en caja al recoger</dd>
        </div>
      </dl>
      <CheckoutLines lines={order.items} />
      <div className={shared.cartTotal}>
        <span>Total</span>
        <strong>{currency.format(order.total)}</strong>
      </div>
      <Link href="/cuenta" className={shared.primaryButton}>
        Volver al inicio
      </Link>
    </section>
  );
}
