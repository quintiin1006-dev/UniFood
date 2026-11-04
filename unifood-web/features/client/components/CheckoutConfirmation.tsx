"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import type { PlacedOrder } from "../api/placeOrder";
import { currency } from "../domain/catalog";
import { pickupLabel, type CheckoutSummary } from "../domain/checkout";
import CheckoutLines from "./CheckoutLines";
import shared from "./ClientShopping.module.css";
import styles from "./ClientCheckout.module.css";

/** Short reference shown to people; the full identifier stays in the order record. */
export const orderReference = (id: string) => id.slice(0, 8).toUpperCase();

export default function CheckoutConfirmation({
  order,
  summary,
}: {
  order: PlacedOrder;
  summary: CheckoutSummary;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className={shared.shopping} aria-labelledby="confirmation-title">
      <div className={styles.confirmationHeading}>
        <CircleCheck size={44} strokeWidth={1.5} aria-hidden="true" />
        <h1 id="confirmation-title" tabIndex={-1} ref={heading}>
          Pedido enviado
        </h1>
        <p className={shared.description}>
          Pedido #{orderReference(order.id)} pendiente de preparación en la
          cafetería.
        </p>
      </div>
      <dl className={styles.details}>
        <div>
          <dt>Recoger en</dt>
          <dd>
            {summary.cafeteria}
            <span>{summary.siteName}</span>
          </dd>
        </div>
        <div>
          <dt>Hora elegida · Colombia</dt>
          <dd>{pickupLabel(summary.pickupAt)}</dd>
        </div>
        <div>
          <dt>Pago</dt>
          <dd>Efectivo en caja al recoger</dd>
        </div>
      </dl>
      <CheckoutLines lines={summary.lines} />
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
