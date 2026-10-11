"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Banknote, Clock3, ShoppingBag } from "lucide-react";
import type { ClientCart } from "../types";
import { findDemoSite, getSiteMeals } from "../mocks/catalog";
import { currency, serviceHours } from "../domain/catalog";
import { cartMealKind, validateCart } from "../domain/cart";
import {
  pickupSlots,
  reviewCheckout,
  type CheckoutSummary,
} from "../domain/checkout";
import { useColombiaClock } from "../hooks/useColombiaClock";
import { useClientCart } from "./ClientCartProvider";
import CheckoutLines from "./CheckoutLines";
import CheckoutConfirmation from "./CheckoutConfirmation";
import shared from "./ClientShopping.module.css";
import styles from "./ClientCheckout.module.css";

export default function ClientCheckout({
  initialTime,
}: {
  initialTime: string;
}) {
  const { cart, ready, ignoreServiceHours } = useClientCart();
  const now = useColombiaClock(initialTime);
  if (!ready) return <p role="status">Cargando el resumen…</p>;
  if (!cart.lines.length || !findDemoSite(cart.siteId ?? undefined))
    return (
      <section className={shared.empty}>
        <ShoppingBag size={46} aria-hidden="true" />
        <h1>Tu carrito está vacío</h1>
        <p>Agrega tus platos antes de confirmar el pedido.</p>
        <Link href="/cuenta" className={shared.primaryButton}>
          Explorar el menú
        </Link>
      </section>
    );
  // Any cart or preview change requires reviewing the new contents and accepting again.
  return (
    <CheckoutForm
      key={JSON.stringify([cart, ignoreServiceHours])}
      cart={cart}
      now={now}
    />
  );
}

function CheckoutForm({ cart, now }: { cart: ClientCart; now: Date }) {
  const { ignoreServiceHours, confirmCheckout } = useClientCart();
  const [pickupAt, setPickupAt] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<CheckoutSummary | null>(null);
  const site = findDemoSite(cart.siteId!)!;
  const meals = getSiteMeals(site);
  const lines = cart.lines.map((line) => {
    const meal = meals.find((item) => item.id === line.mealId)!;
    return {
      id: line.id,
      name: meal.name,
      quantity: line.quantity,
      notes: line.notes,
      unitPrice: meal.price,
    };
  });
  const total = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  );
  const slots = pickupSlots(cart, now, ignoreServiceHours);
  const next = slots.find((slot) => slot.available);
  const cartIssue = validateCart(cart, now, ignoreServiceHours);
  const kind = cartMealKind(cart);
  const selected = slots.find((slot) => slot.value === pickupAt);
  const expiredSelection = pickupAt && (!selected || !selected.available);
  const canConfirm = reviewCheckout(
    cart,
    pickupAt,
    accepted,
    now,
    ignoreServiceHours,
  ).ok;
  if (confirmed)
    return (
      <CheckoutConfirmation
        summary={confirmed}
        onReview={() => {
          setConfirmed(null);
          setAccepted(false);
        }}
      />
    );

  return (
    <section className={shared.shopping} aria-labelledby="checkout-title">
      <Link className={shared.back} href="/cuenta/carrito">
        <ArrowLeft size={21} aria-hidden="true" /> Volver al carrito
      </Link>
      <div>
        <h1 id="checkout-title">Resumen del pedido</h1>
        <p className={shared.description}>
          Revisa tus platos y elige cuándo recogerlos.
        </p>
      </div>
      <div className={styles.location}>
        <span>Recoger en</span>
        <strong>{site.cafeteria}</strong>
        <p>{site.name}</p>
      </div>
      <CheckoutLines lines={lines} />
      <Link href="/cuenta/carrito" className={styles.editCart}>
        Editar platos y observaciones
      </Link>
      {cartIssue && (
        <p role="alert" className={shared.notice}>
          {cartIssue}
        </p>
      )}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const result = confirmCheckout(cart, pickupAt, accepted);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setError("");
          setConfirmed(result.summary);
        }}
      >
        <fieldset className={styles.pickup}>
          <legend>
            <Clock3 size={20} aria-hidden="true" /> Hora de recogida
          </legend>
          <p id="pickup-help">
            Preparación estimada: mínimo 20 minutos. Podría estar listo antes
            según los pedidos de la cafetería.
          </p>
          {kind && (
            <p>
              {kind === "breakfast" ? "Desayunos" : "Almuerzos"}:{" "}
              {serviceHours(kind)} · Colombia.
            </p>
          )}
          <label htmlFor="pickup-time">Elige tu hora · Colombia</label>
          <select
            id="pickup-time"
            value={pickupAt}
            required
            disabled={!next || !!cartIssue}
            aria-describedby="pickup-help pickup-feedback"
            onChange={(event) => {
              setPickupAt(event.target.value);
              setError("");
            }}
          >
            <option value="" disabled>
              Selecciona una hora
            </option>
            {expiredSelection && !selected && (
              <option value={pickupAt} disabled>
                El horario elegido ya venció
              </option>
            )}
            {slots.map((slot) => (
              <option
                key={slot.value}
                value={slot.value}
                disabled={!slot.available}
              >
                {slot.label}
                {!slot.available ? " · No disponible" : ""}
              </option>
            ))}
          </select>
          <p id="pickup-feedback" aria-live="polite">
            {!next
              ? "Ya no quedan horarios de recogida para este servicio hoy. Puedes volver al carrito para revisarlo."
              : expiredSelection
                ? `La hora elegida ya no permite 20 minutos de preparación. Próxima opción: ${next.label}`
                : `Primera hora disponible: ${next.label} · Turnos cada 30 minutos.`}
          </p>
        </fieldset>
        <div className={styles.payment}>
          <Banknote size={24} aria-hidden="true" />
          <div>
            <strong>Efectivo al recoger</strong>
            <p>Paga el total en la caja de la cafetería.</p>
          </div>
        </div>
        <div className={shared.cartTotal}>
          <span>Total a pagar</span>
          <strong>{currency.format(total)}</strong>
        </div>
        <div className={styles.terms}>
          <h2>Condiciones de recogida</h2>
          <p id="pickup-terms">
            Texto provisional: revisa los platos, las cantidades y la sede.
            Recoge en la hora seleccionada y paga en efectivo en caja. La
            preparación puede variar según la demanda.
          </p>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              required
              onChange={(event) => {
                setAccepted(event.target.checked);
                setError("");
              }}
              aria-describedby="pickup-terms"
            />
            <span>
              He revisado mi pedido y acepto las condiciones de recogida.
            </span>
          </label>
        </div>
        <p className={styles.previewNote}>
          Esta confirmación es de prueba y todavía no envía pedidos a la
          cafetería.
        </p>
        {error && (
          <p role="alert" className={shared.notice}>
            {error}
          </p>
        )}
        <button
          type="submit"
          className={shared.primaryButton}
          disabled={!canConfirm}
        >
          Confirmar pedido
        </button>
      </form>
    </section>
  );
}
