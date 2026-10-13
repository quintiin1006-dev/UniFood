"use client";
import Link from "next/link";
import { ArrowRight, ShoppingBag, Trash2 } from "lucide-react";
import { findDemoSite, getSiteMeals } from "../mocks/catalog";
import { currency } from "../domain/catalog";
import {
  cartMealKind,
  MIXED_MEALS_MESSAGE,
  validateCart,
} from "../domain/cart";
import { useColombiaClock } from "../hooks/useColombiaClock";
import { useClientCart } from "./ClientCartProvider";
import CartLineItem from "./CartLineItem";
import styles from "./ClientShopping.module.css";

export default function ClientCart({ initialTime }: { initialTime: string }) {
  const { cart, ready, count, clear, ignoreServiceHours } = useClientCart();
  const now = useColombiaClock(initialTime);
  const site = findDemoSite(cart.siteId ?? undefined);
  if (!ready) return <p role="status">Cargando tu carrito…</p>;
  if (!site || !cart.lines.length)
    return (
      <section className={styles.empty}>
        <ShoppingBag size={48} strokeWidth={1.4} aria-hidden="true" />
        <h1>Tu carrito está vacío</h1>
        <p>Encuentra algo rico para tu próxima pausa.</p>
        <Link className={styles.primaryButton} href="/cuenta">
          Explorar el menú
        </Link>
      </section>
    );
  const meals = getSiteMeals(site);
  const issue = validateCart(cart, now, ignoreServiceHours);
  const total = cart.lines.reduce(
    (sum, line) =>
      sum +
      (meals.find((meal) => meal.id === line.mealId)?.price ?? 0) *
        line.quantity,
    0,
  );
  return (
    <section className={styles.shopping} aria-labelledby="cart-title">
      <div>
        <h1 id="cart-title">Tu carrito</h1>
        <p className={styles.description}>
          {site.cafeteria} · {site.name}
        </p>
        <p className={styles.description}>{count} de 3 platos completos</p>
      </div>
      <ul className={styles.cartList}>
        {cart.lines.map((line) => {
          const meal = meals.find((item) => item.id === line.mealId)!;
          return (
            <CartLineItem
              key={line.id}
              line={line}
              meal={meal}
              siteId={site.id}
              now={now}
            />
          );
        })}
      </ul>
      <div className={styles.cartTotal}>
        <span>Subtotal</span>
        <strong>{currency.format(total)}</strong>
      </div>
      <p className={styles.description}>
        Pago en efectivo en caja al recoger. Revisa tus platos y elige la hora
        de recogida en el siguiente paso.
      </p>
      {issue && (
        <p className={styles.notice} aria-live="polite">
          {!cartMealKind(cart)
            ? MIXED_MEALS_MESSAGE
            : "Revisa la disponibilidad de tus platos antes de continuar."}
        </p>
      )}
      {issue ? (
        <button type="button" className={styles.primaryButton} disabled>
          Continuar con el pedido
        </button>
      ) : (
        <Link className={styles.primaryButton} href="/cuenta/carrito/resumen">
          Continuar con el pedido <ArrowRight size={19} aria-hidden="true" />
        </Link>
      )}
      <Link className={styles.secondaryButton} href={`/cuenta?sede=${site.id}`}>
        Seguir eligiendo
      </Link>
      <button type="button" className={styles.secondaryButton} onClick={clear}>
        <Trash2 size={18} aria-hidden="true" />
        Vaciar carrito
      </button>
    </section>
  );
}
