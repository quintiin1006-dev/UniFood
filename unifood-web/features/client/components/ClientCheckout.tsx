"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Banknote, Clock3, ShoppingBag } from "lucide-react";
import type { CafeteriaMenu, ClientCart } from "../types";
import { placeOrder } from "../api/placeOrder";
import { currency } from "../domain/catalog";
import { validateCart } from "../domain/cart";
import {
  checkoutLines,
  earliestPickup,
  noteLength,
  NOTE_LIMIT,
  orderSignature,
  reviewOrder,
  type PlacedOrder,
} from "../domain/checkout";
import { cafeteriaHref, CHANGE_CAFETERIA_HREF } from "../domain/context";
import type { CheckoutError } from "../errors";
import { useCafeteriaMenu } from "../hooks/useCafeteriaMenu";
import { useColombiaClock } from "../hooks/useColombiaClock";
import {
  clearAttempt,
  nextAttempt,
  readAttempt,
  saveAttempt,
  type Attempt,
} from "../idempotency";
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
  const { cart, ready } = useClientCart();
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const { state, retry } = useCafeteriaMenu(
    ready && cart.lines.length && !placed ? cart.cafeteriaId : null,
  );
  // Once the order is accepted the cart is empty, but the confirmation stays on screen.
  if (placed) return <CheckoutConfirmation order={placed} />;
  if (!ready) return <p role="status">Cargando el resumen…</p>;
  if (!cart.lines.length || !cart.cafeteriaId)
    return (
      <section className={shared.empty}>
        <ShoppingBag size={46} aria-hidden="true" />
        <h1>Tu carrito está vacío</h1>
        <p>Agrega tus productos antes de confirmar el pedido.</p>
        <Link href="/cuenta" className={shared.primaryButton}>
          Explorar el menú
        </Link>
      </section>
    );
  if (state.status === "idle" || state.status === "loading")
    return <p role="status">Cargando el resumen…</p>;
  if (state.status !== "ok")
    return (
      <section className={shared.empty} role="alert">
        <h1>No pudimos cargar el resumen</h1>
        <p>Intenta de nuevo en un momento. Tu carrito se conserva.</p>
        <button type="button" className={shared.primaryButton} onClick={retry}>
          Volver a intentar
        </button>
      </section>
    );
  // Any cart change requires reviewing the new contents and accepting again.
  return (
    <CheckoutForm
      key={JSON.stringify(cart)}
      cart={cart}
      menu={state.menu}
      initialTime={initialTime}
      onPlaced={setPlaced}
    />
  );
}

type Problem = { message: string; action?: CheckoutError["action"] };

function CheckoutForm({
  cart,
  menu,
  initialTime,
  onPlaced,
}: {
  cart: ClientCart;
  menu: CafeteriaMenu;
  initialTime: string;
  onPlaced: (order: PlacedOrder) => void;
}) {
  const { ownerId, latestCart, completeOrder } = useClientCart();
  const now = useColombiaClock(initialTime);
  const [note, setNote] = useState("");
  const [choosePickup, setChoosePickup] = useState(false);
  const [pickupTime, setPickupTime] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const lines = checkoutLines(cart, menu);
  const total = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  );
  const cartIssue = validateCart(cart, menu);
  const earliest = earliestPickup(now);
  const pickupHelp = earliest
    ? `Solo horas de hoy posteriores a la actual (hora de Colombia). Es informativa: no cambia el orden de atención.`
    : "Ya no quedan horas disponibles hoy. Envía el pedido lo antes posible.";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // A double click or Enter while sending never starts a second request.
    if (sending.current) return;
    // Another tab may have changed the cart: review what is stored, not what is on screen.
    const latest = latestCart();
    // The provider already announced the change and the summary is rebuilding.
    if (JSON.stringify(latest) !== JSON.stringify(cart)) return;
    const review = reviewOrder(
      latest,
      menu,
      { note, pickupTime: choosePickup ? pickupTime : "", accepted },
      new Date(),
    );
    if (!review.ok) {
      setProblem({
        message: review.error,
        action:
          review.field === "pickup"
            ? "time"
            : review.field === "note"
              ? "note"
              : undefined,
      });
      if (review.field === "pickup") timeInput.current?.focus();
      if (review.field === "note") noteInput.current?.focus();
      return;
    }
    const current = nextAttempt(
      attempt.current ?? readAttempt(ownerId),
      orderSignature(review.request),
    );
    attempt.current = current;
    saveAttempt(ownerId, current);
    sending.current = true;
    setPending(true);
    setProblem(null);
    const result = await placeOrder(review.request, current.key);
    sending.current = false;
    setPending(false);
    if (result.ok) {
      attempt.current = null;
      onPlaced(result.order);
      completeOrder();
      return;
    }
    if (result.error.newKey) {
      attempt.current = null;
      clearAttempt();
    }
    setProblem({ message: result.error.message, action: result.error.action });
    if (result.error.action === "time")
      setTimeout(() => timeInput.current?.focus(), 0);
    if (result.error.action === "note")
      setTimeout(() => noteInput.current?.focus(), 0);
  }

  return (
    <section className={shared.shopping} aria-labelledby="checkout-title">
      <Link className={shared.back} href="/cuenta/carrito">
        <ArrowLeft size={21} aria-hidden="true" /> Volver al carrito
      </Link>
      <div>
        <h1 id="checkout-title">Resumen del pedido</h1>
        <p className={shared.description}>
          Revisa tus productos y confirma tu pedido.
        </p>
      </div>
      <div className={styles.location}>
        <span>Recoger en</span>
        <strong>{menu.cafeteria.name}</strong>
      </div>
      <CheckoutLines lines={lines} />
      <Link href="/cuenta/carrito" className={styles.editCart}>
        Editar productos
      </Link>
      {cartIssue && (
        <p role="alert" className={shared.notice}>
          {cartIssue}
        </p>
      )}
      <form
        className={styles.form}
        onSubmit={submit}
        aria-busy={pending}
        noValidate
      >
        <fieldset className={styles.pickup} disabled={pending}>
          <legend>
            <Clock3 size={20} aria-hidden="true" /> Hora de recogida
          </legend>
          <div className={styles.choices}>
            <label>
              <input
                type="radio"
                name="pickup-mode"
                checked={!choosePickup}
                onChange={() => {
                  setChoosePickup(false);
                  setProblem(null);
                }}
              />
              <span>Lo antes posible</span>
            </label>
            <label>
              <input
                type="radio"
                name="pickup-mode"
                checked={choosePickup}
                disabled={!earliest}
                onChange={() => {
                  setChoosePickup(true);
                  setProblem(null);
                }}
              />
              <span>Elegir hora</span>
            </label>
          </div>
          {choosePickup && earliest && (
            <>
              <label htmlFor="pickup-time">Hora de recogida · Colombia</label>
              <input
                id="pickup-time"
                ref={timeInput}
                type="time"
                value={pickupTime}
                min={earliest}
                max="23:59"
                required
                aria-describedby="pickup-help"
                onChange={(event) => {
                  setPickupTime(event.target.value);
                  setProblem(null);
                }}
              />
            </>
          )}
          <p id="pickup-help">{pickupHelp}</p>
        </fieldset>
        <div className={styles.noteField}>
          <label htmlFor="order-note">
            Nota para el pedido <span>(opcional)</span>
          </label>
          <textarea
            id="order-note"
            ref={noteInput}
            rows={3}
            maxLength={NOTE_LIMIT + 50}
            value={note}
            disabled={pending}
            placeholder="Cuéntanos algo que debamos tener en cuenta"
            aria-describedby="note-count"
            onChange={(event) => {
              setNote(event.target.value);
              setProblem(null);
            }}
          />
          <small id="note-count">
            {noteLength(note)}/{NOTE_LIMIT} caracteres. Una sola nota para todo
            el pedido.
          </small>
        </div>
        <div className={styles.payment}>
          <Banknote size={24} aria-hidden="true" />
          <div>
            <strong>Efectivo al recoger</strong>
            <p>Paga el total en la caja de la cafetería.</p>
          </div>
        </div>
        <div className={shared.cartTotal}>
          <span>Total estimado</span>
          <strong>{currency.format(total)}</strong>
        </div>
        <div className={styles.terms}>
          <h2>Condiciones de recogida</h2>
          <p id="pickup-terms">
            Revisa los productos, las cantidades y la cafetería. Recoge tu
            pedido y paga en efectivo en caja. El total final lo calcula la
            cafetería al recibirlo.
          </p>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              required
              disabled={pending}
              onChange={(event) => {
                setAccepted(event.target.checked);
                setProblem(null);
              }}
              aria-describedby="pickup-terms"
            />
            <span>
              He revisado mi pedido y acepto las condiciones de recogida.
            </span>
          </label>
        </div>
        {problem && (
          <div role="alert" className={shared.notice}>
            <p>{problem.message}</p>
            <ProblemAction
              action={problem.action}
              cafeteriaId={menu.cafeteria.id}
            />
          </div>
        )}
        <button
          type="submit"
          className={shared.primaryButton}
          disabled={!accepted || pending || !!cartIssue}
        >
          {pending
            ? "Enviando pedido…"
            : problem?.action === "retry"
              ? "Reintentar envío"
              : "Confirmar pedido"}
        </button>
      </form>
    </section>
  );
}

/** The suggested next step for an error; retrying and editing happen in the form itself. */
function ProblemAction({
  action,
  cafeteriaId,
}: {
  action?: CheckoutError["action"];
  cafeteriaId: string;
}) {
  const links: Partial<
    Record<CheckoutError["action"], { href: string; label: string }>
  > = {
    cart: { href: "/cuenta/carrito", label: "Revisar carrito" },
    menu: { href: cafeteriaHref(cafeteriaId), label: "Ir al menú" },
    choose: { href: CHANGE_CAFETERIA_HREF, label: "Elegir cafetería" },
    home: { href: "/cuenta", label: "Ir al inicio" },
    login: { href: "/login", label: "Iniciar sesión" },
  };
  const link = action ? links[action] : undefined;
  return link ? (
    <Link className={shared.secondaryButton} href={link.href}>
      {link.label}
    </Link>
  ) : null;
}
