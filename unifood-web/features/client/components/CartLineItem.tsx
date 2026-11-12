"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Minus, Plus, Trash2 } from "lucide-react";
import type { CafeteriaMenu, CartLine, MenuProduct } from "../types";
import { currency } from "../domain/catalog";
import { maxQuantity, orderBlocker } from "../domain/cart";
import { productHref } from "../domain/menu";
import { useClientCart } from "./ClientCartProvider";
import ProductPlaceholder from "./ProductPlaceholder";
import styles from "./ClientShopping.module.css";
import cartStyles from "./ClientCart.module.css";

export default function CartLineItem({
  line,
  product,
  menu,
}: {
  line: CartLine;
  /** Null when the product left the menu: the line can only be removed. */
  product: MenuProduct | null;
  menu: CafeteriaMenu;
}) {
  const { cart, update, remove } = useClientCart();
  const [revealed, setRevealed] = useState(false);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const name = product?.name ?? "Producto que ya no está en el menú";
  const blocker = product
    ? orderBlocker(menu, product)
    : "Ya no está en el menú. Retíralo para continuar.";
  const canIncrease =
    !blocker && line.quantity < maxQuantity(cart, line.productId);
  return (
    <li
      className={`${styles.cartLine} ${cartStyles.item}`}
      onPointerDown={(event) => {
        if (
          event.pointerType !== "touch" ||
          (event.target as HTMLElement).closest(
            "button, a, input, textarea, dialog",
          )
        )
          return;
        gesture.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerCancel={() => {
        gesture.current = null;
      }}
      onPointerUp={(event) => {
        if (!gesture.current) return;
        const dx = event.clientX - gesture.current.x;
        const dy = event.clientY - gesture.current.y;
        gesture.current = null;
        if (dx < -60 && Math.abs(dy) < 30) setRevealed(true);
        if (dx > 60 && Math.abs(dy) < 30) setRevealed(false);
      }}
    >
      <ProductPlaceholder name={name} size="line" />
      <div>
        {product ? (
          <Link href={productHref(menu.cafeteria.id, product.id)}>
            <h2>{name}</h2>
          </Link>
        ) : (
          <h2>{name}</h2>
        )}
        <p>Cantidad: {line.quantity}</p>
        {product && (
          <strong>{currency.format(product.price * line.quantity)}</strong>
        )}
        {blocker && <small>{blocker}</small>}
      </div>
      <button
        type="button"
        className={styles.remove}
        aria-label={`Eliminar ${name}`}
        onClick={() => remove(line.productId)}
      >
        <Trash2 size={20} aria-hidden="true" />
      </button>
      <div className={cartStyles.controls}>
        <div
          className={styles.quantity}
          role="group"
          aria-label={`Cantidad de ${name}`}
        >
          <button
            type="button"
            aria-label={`Reducir cantidad de ${name}`}
            disabled={line.quantity <= 1}
            onClick={() => update(menu, line.productId, line.quantity - 1)}
          >
            <Minus size={17} aria-hidden="true" />
          </button>
          <output aria-label={`Cantidad de ${name}`}>{line.quantity}</output>
          <button
            type="button"
            aria-label={`Aumentar cantidad de ${name}`}
            disabled={!canIncrease}
            onClick={() => update(menu, line.productId, line.quantity + 1)}
          >
            <Plus size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
      {revealed && (
        <div className={cartStyles.swipeActions}>
          <button type="button" onClick={() => remove(line.productId)}>
            Confirmar eliminación
          </button>
          <button type="button" onClick={() => setRevealed(false)}>
            Conservar
          </button>
        </div>
      )}
    </li>
  );
}
