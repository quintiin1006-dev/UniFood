"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Banknote, Clock3, ShoppingBag } from "lucide-react";
import type { ClientCart } from "../types";
import { placeOrder, type PlacedOrder } from "../api/placeOrder";
import { currency, serviceHours } from "../domain/catalog";
import { cartMealKind, validateCart } from "../domain/cart";
import {
  pickupSlots,
  reviewCheckout,
  type CheckoutSummary,
} from "../domain/checkout";
import { findSite } from "../domain/menu";
import { useColombiaClock } from "../hooks/useColombiaClock";
import { useClientCart } from "./ClientCartProvider";
import CheckoutLines from "./CheckoutLines";
import CheckoutConfirmation from "./CheckoutConfirmation";
import MenuUnavailable from "./MenuUnavailable";
import shared from "./ClientShopping.module.css";
import styles from "./ClientCheckout.module.css";

export default function ClientCheckout({
  initialTime,
}: {
  initialTime: string;
}) {
  const { cart, ready, ignoreServiceHours, menu, finishOrder } =
    useClientCart();
  const now = useColombiaClock(initialTime);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [placedSummary, setPlacedSummary] = useState<CheckoutSummary | null>(
    null,
  );
  const [rejection, setRejection] = useState("");
  // The confirmation outlives the cart: the cart is emptied once the backend accepts the order.
  if (placed && placedSummary)
    return <CheckoutConfirmation order={placed} summary={placedSummary} />;
  if (menu.unavailable) return <MenuUnavailable />;
  if (!ready) return <p role="status">Cargando el resumen…</p>;
  if (!cart.lines.length || !findSite(menu, cart.siteId ?? undefined))
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
      initialError={rejection}
      onRejected={setRejection}
      onPlaced={(order, summary) => {
        setPlaced(order);
        setPlacedSummary(summary);
        finishOrder();
      }}
    />
  );
}

function CheckoutForm({
  cart,
  now,
  initialError,
  onRejected,
  onPlaced,
}: {
  cart: ClientCart;
  now: Date;
  initialError: string;
  onRejected: (error: string) => void;
  onPlaced: (order: PlacedOrder, summary: CheckoutSummary) => void;
}) {
  const { menu, ignoreServiceHours, confirmCheckout } = useClientCart();
  const router = useRouter();
  const [pickupAt, setPickupAt] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const site = findSite(menu, cart.siteId!)!;
  const lines = cart.lines.map((line) => {
    const meal = site.meals.find((item) => item.id === line.mealId)!;
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
  const slots = pickupSlots(menu, cart, now, ignoreServiceHours);
  const next = slots.find((slot) => slot.available);
  const cartIssue = validateCart(menu, cart, now, ignoreServiceHours);
  const kind = cartMealKind(menu, cart);
  const selected = slots.find((slot) => slot.value === pickupAt);
  const expiredSelection = pickupAt && (!selected || !selected.available);
  const canConfirm =
    !ignoreServiceHours &&
    !submitting &&
    reviewCheckout(menu, cart, pickupAt, accepted, now, ignoreServiceHours).ok;

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
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting) return;
          const review = confirmCheckout(cart, pickupAt, accepted);
          if (!review.ok) {
            setError(review.error);
            return;
          }
          setError("");
          setSubmitting(true);
          const result = await placeOrder(cart, review.summary.pickupAt);
          setSubmitting(false);
          if (!result.ok) {
            setError(result.error);
            // Stock or availability moved: reload the menu so the summary shows the current state.
            // The form may remount with a changed cart, so the reason is kept by the parent.
            if (result.stale) {
              onRejected(result.error);
              router.refresh();
            }
            return;
          }
          onPlaced(result.order, review.summary);
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
        {ignoreServiceHours ? (
          <p role="alert" className={shared.notice}>
            El modo de prueba fuera de horario no envía pedidos. Desactívalo
            para confirmar tu pedido.
          </p>
        ) : null}
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
          {submitting ? "Enviando pedido…" : "Confirmar pedido"}
        </button>
      </form>
    </section>
  );
}
