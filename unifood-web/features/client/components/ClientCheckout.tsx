"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, ShoppingBag } from "lucide-react";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import type { CafeteriaMenu, ClientCart } from "../types";
import { placeOrder } from "../api/placeOrder";
import { currency } from "../domain/catalog";
import { cartItems, validateCart } from "../domain/cart";
import {
  checkoutLines,
  earliestPickup,
  limitNote,
  NOTE_LIMIT,
  pickupInstant,
  PICKUP_TIME_MESSAGE,
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
import CartLineItem from "./CartLineItem";
import {
  CART_ADD_NOTE,
  CART_CONFIRM,
  CART_EMPTY_ACTION,
  CART_PICKUP_AT,
  CART_TITLE,
  CART_TOTAL,
} from "../../shared/messages";
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
  const router = useRouter();
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
  // One screen: the lines are edited here, so the form keeps its time and note across changes.
  return (
    <CheckoutForm
      cart={cart}
      menu={state.menu}
      initialTime={initialTime}
      onPlaced={(order) => {
        setPlaced(order);
        // The pages cached for 30 s (Inicio, Mi pedido) must not show the cart before the order.
        router.refresh();
      }}
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
  const { ownerId, latestCart, completeOrder, clear } = useClientCart();
  const now = useColombiaClock(initialTime);
  const [note, setNote] = useState("");
  const [choosePickup, setChoosePickup] = useState(false);
  const [pickupTime, setPickupTime] = useState("");
  const [noteLimitReached, setNoteLimitReached] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
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
  // Checked against the live clock, so a time that expires while the summary is open is caught.
  const typedPickup =
    choosePickup && pickupTime ? pickupInstant(pickupTime, now) : null;
  const pickupError =
    typedPickup && !typedPickup.ok ? PICKUP_TIME_MESSAGE : null;

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
      { note, pickupTime: choosePickup ? pickupTime : "" },
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
      if (review.field === "note") {
        setNoteOpen(true);
        setTimeout(() => noteInput.current?.focus(), 0);
      }
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
    if (result.error.action === "note") {
      setNoteOpen(true);
      setTimeout(() => noteInput.current?.focus(), 0);
    }
  }

  return (
    <section className={shared.shopping} aria-labelledby="checkout-title">
      <div>
        <h1 id="checkout-title">{CART_TITLE}</h1>
        <p className={shared.description}>
          {CART_PICKUP_AT} <strong>{menu.cafeteria.name}</strong>
        </p>
      </div>
      <ul className={shared.cartList}>
        {cartItems(cart, menu).map(({ line, product }) => (
          <CartLineItem
            key={line.productId}
            line={line}
            product={product}
            menu={menu}
          />
        ))}
      </ul>
      {/* Asks for confirmation in the provider before emptying. */}
      <button type="button" className={shared.secondaryButton} onClick={clear}>
        {CART_EMPTY_ACTION}
      </button>
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
                aria-invalid={pickupError ? true : undefined}
                aria-describedby={pickupError ? "pickup-error" : undefined}
                onChange={(event) => {
                  setPickupTime(event.target.value);
                  setProblem(null);
                }}
              />
            </>
          )}
          {pickupError && (
            <Notice id="pickup-error" tone="error">
              {pickupError}
            </Notice>
          )}
          {!earliest && (
            <p id="pickup-help">
              Ya no quedan horas disponibles hoy. Envía el pedido lo antes
              posible.
            </p>
          )}
        </fieldset>
        <details
          className={styles.noteField}
          open={noteOpen}
          onToggle={(event) => setNoteOpen(event.currentTarget.open)}
        >
          <summary>{CART_ADD_NOTE}</summary>
          <label htmlFor="order-note">
            Nota para el pedido <span>(opcional)</span>
          </label>
          <textarea
            id="order-note"
            ref={noteInput}
            rows={3}
            value={note}
            disabled={pending}
            placeholder="Cuéntanos algo que debamos tener en cuenta"
            onChange={(event) => {
              // Typing or pasting past the limit keeps the first NOTE_LIMIT characters.
              const limited = limitNote(event.target.value);
              setNote(limited.note);
              setNoteLimitReached(limited.truncated);
              setProblem(null);
            }}
          />
          {noteLimitReached && (
            <Notice tone="info">
              El límite es de {NOTE_LIMIT} caracteres.
            </Notice>
          )}
        </details>
        {problem && (
          <div role="alert" className={shared.notice}>
            <p>{problem.message}</p>
            <ProblemAction
              action={problem.action}
              cafeteriaId={menu.cafeteria.id}
            />
          </div>
        )}
        {/* Fixed at the bottom of the screen: the total and the one action. */}
        <div className={styles.bar}>
          <div className={styles.barTotal}>
            <span>{CART_TOTAL}</span>
            <strong>{currency.format(total)}</strong>
          </div>
          <button
            type="submit"
            className={shared.primaryButton}
            disabled={pending || !!cartIssue || !!pickupError}
            aria-busy={pending || undefined}
          >
            {pending && <Spinner />}
            {pending
              ? "Enviando pedido…"
              : problem?.action === "retry"
                ? "Reintentar envío"
                : CART_CONFIRM}
          </button>
        </div>
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
