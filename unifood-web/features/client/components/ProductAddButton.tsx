"use client";

import { Minus, Plus } from "lucide-react";
import type { CafeteriaMenu, MenuProduct } from "../types";
import { useClientCart } from "./ClientCartProvider";
import styles from "./ProductAddButton.module.css";

/**
 * «+» on a product card (ola 2 · D5). It reuses the cart's add and update: no cart rules here.
 * Adding one unit turns the button into «− n +». Disabled, with its reason in text, when the
 * product is sold out or the cafeteria is closed. Sits beside the card link, not inside it, so
 * a click here never opens the product.
 */
export default function ProductAddButton({
  menu,
  product,
}: {
  menu: CafeteriaMenu;
  product: MenuProduct;
}) {
  const { cart, add, update } = useClientCart();
  const inCart =
    cart.cafeteriaId === menu.cafeteria.id
      ? (cart.lines.find((line) => line.productId === product.id)?.quantity ??
        0)
      : 0;
  const reason = !menu.cafeteria.open
    ? "Cerrada"
    : !product.available
      ? "Agotado"
      : null;

  if (reason)
    return (
      <span
        className={styles.blocked}
        role="status"
        aria-label={`${product.name}: ${reason === "Agotado" ? "agotado" : "la cafetería está cerrada"}`}
      >
        {reason}
      </span>
    );

  if (inCart === 0)
    return (
      <button
        type="button"
        className={styles.add}
        aria-label={`Agregar ${product.name} al carrito`}
        onClick={() => {
          add(menu, product.id, 1);
        }}
      >
        <Plus size={20} strokeWidth={2.4} aria-hidden="true" />
      </button>
    );

  return (
    <div
      className={styles.stepper}
      role="group"
      aria-label={`Cantidad de ${product.name}`}
    >
      <button
        type="button"
        className={styles.step}
        aria-label={`Quitar una unidad de ${product.name}`}
        onClick={() => {
          update(menu, product.id, inCart - 1);
        }}
      >
        <Minus size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <span key={inCart} className={styles.count} aria-live="polite">
        {inCart}
      </span>
      <button
        type="button"
        className={styles.step}
        aria-label={`Agregar otra unidad de ${product.name}`}
        onClick={() => {
          update(menu, product.id, inCart + 1);
        }}
      >
        <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}
