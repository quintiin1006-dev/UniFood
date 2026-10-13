"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { currency } from "../domain/catalog";
import { pickupLabel, type CheckoutSummary } from "../domain/checkout";
import CheckoutLines from "./CheckoutLines";
import shared from "./ClientShopping.module.css";
import styles from "./ClientCheckout.module.css";

export default function CheckoutConfirmation({
  summary,
  onReview,
}: {
  summary: CheckoutSummary;
  onReview: () => void;
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
          Resumen confirmado
        </h1>
        <p className={shared.description}>
          Confirmación de prueba. Tu carrito se conserva; todavía no se ha
          enviado un pedido a la cafetería.
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
        <strong>{currency.format(summary.total)}</strong>
      </div>
      <Link href="/cuenta/carrito" className={shared.primaryButton}>
        Volver al carrito
      </Link>
      <button
        type="button"
        className={shared.secondaryButton}
        onClick={onReview}
      >
        Revisar horario y condiciones
      </button>
    </section>
  );
}
