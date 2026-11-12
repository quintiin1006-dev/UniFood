"use client";
import Link from "next/link";
import { ArrowRight, ShoppingBag, Trash2 } from "lucide-react";
import { currency } from "../domain/catalog";
import { cafeteriaHref } from "../domain/context";
import { cartItems, MAX_CART_UNITS, validateCart } from "../domain/cart";
import { useCafeteriaMenu } from "../hooks/useCafeteriaMenu";
import { useClientCart } from "./ClientCartProvider";
import CartLineItem from "./CartLineItem";
import styles from "./ClientShopping.module.css";

export default function ClientCart() {
  const { cart, ready, count, clear } = useClientCart();
  const { state, retry } = useCafeteriaMenu(
    ready && cart.lines.length ? cart.cafeteriaId : null,
  );
  if (!ready) return <p role="status">Cargando tu carrito…</p>;
  if (!cart.cafeteriaId || !cart.lines.length)
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
  if (state.status === "idle" || state.status === "loading")
    return <p role="status">Cargando tu carrito…</p>;
  if (state.status !== "ok")
    return (
      <section className={styles.empty} role="alert">
        <h1>
          {state.status === "unavailable"
            ? "Tu cafetería ya no está disponible"
            : "No pudimos cargar tu carrito"}
        </h1>
        <p>
          {state.status === "unavailable"
            ? "Vacía el carrito y elige otra cafetería para continuar."
            : "Intenta de nuevo en un momento. Tu carrito se conserva."}
        </p>
        {state.status === "unavailable" ? (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={clear}
          >
            Vaciar carrito
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={retry}
          >
            Volver a intentar
          </button>
        )}
      </section>
    );
  const { menu } = state;
  const items = cartItems(cart, menu);
  const issue = validateCart(cart, menu);
  const total = items.reduce(
    (sum, { line, product }) => sum + (product?.price ?? 0) * line.quantity,
    0,
  );
  return (
    <section className={styles.shopping} aria-labelledby="cart-title">
      <div>
        <h1 id="cart-title">Tu carrito</h1>
        <p className={styles.description}>{menu.cafeteria.name}</p>
        <p className={styles.description}>
          {count} de {MAX_CART_UNITS} unidades
        </p>
      </div>
      <ul className={styles.cartList}>
        {items.map(({ line, product }) => (
          <CartLineItem
            key={line.productId}
            line={line}
            product={product}
            menu={menu}
          />
        ))}
      </ul>
      <div className={styles.cartTotal}>
        <span>Subtotal</span>
        <strong>{currency.format(total)}</strong>
      </div>
      <p className={styles.description}>
        Pago en efectivo en caja al recoger. El total final lo calcula la
        cafetería al recibir tu pedido.
      </p>
      {issue && (
        <p className={styles.notice} aria-live="polite">
          {issue}
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
      <Link
        className={styles.secondaryButton}
        href={cafeteriaHref(menu.cafeteria.id)}
      >
        Seguir eligiendo
      </Link>
      <button type="button" className={styles.secondaryButton} onClick={clear}>
        <Trash2 size={18} aria-hidden="true" />
        Vaciar carrito
      </button>
    </section>
  );
}
