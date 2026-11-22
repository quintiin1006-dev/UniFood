"use client";

import { quantityInCart } from "../domain/cart";
import { useEffect, useRef, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import type { CafeteriaMenu, MenuProduct } from "../types";
import { useClientCart } from "./ClientCartProvider";
import {
  addedLive,
  addProductLabel,
  MENU_CLOSED_CHIP,
} from "../../shared/messages";
import styles from "./ProductAddButton.module.css";

/** How long the ring takes to close around «+» before the quantity control appears. */
export const ADD_RING_MS = 600;

/**
 * «+» on a product card. A tap adds one unit at once; a ring draws itself clockwise around the
 * button and ends in a check, then the compact «− n +» appears. Taps during the ring keep adding.
 * Every target is 44 px; the drawing is 36 px and the control is never taller than 44 px. With
 * reduced motion there is no ring: a still check for the same time. Disabled, with its reason in
 * text, when the product is sold out or the cafeteria is closed.
 */
export default function ProductAddButton({
  menu,
  product,
}: {
  menu: CafeteriaMenu;
  product: MenuProduct;
}) {
  const { cart, add, update } = useClientCart();
  const [ringing, setRinging] = useState(false);
  const [ringKey, setRingKey] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const inCart =
    cart.cafeteriaId === menu.cafeteria.id
      ? quantityInCart(cart, product.id)
      : 0;
  const reason = !menu.cafeteria.open
    ? MENU_CLOSED_CHIP
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

  const addOne = () => {
    if (!add(menu, product.id, 1)) return;
    setAnnouncement(addedLive(inCart + 1));
    // Each tap restarts the ring; the unit is already in the cart.
    setRingKey((key) => key + 1);
    setRinging(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRinging(false), ADD_RING_MS);
  };

  return (
    <span className={styles.root}>
      {ringing || inCart === 0 ? (
        <button
          type="button"
          className={styles.target}
          data-ringing={ringing || undefined}
          aria-label={addProductLabel(product.name)}
          onClick={addOne}
        >
          <span className={styles.face} aria-hidden="true">
            <Plus className={styles.plusIcon} size={20} strokeWidth={2.4} />
            {ringing && (
              <Check className={styles.checkIcon} size={20} strokeWidth={2.6} />
            )}
          </span>
          {ringing && (
            <svg
              key={ringKey}
              className={styles.ring}
              viewBox="0 0 44 44"
              aria-hidden="true"
            >
              <circle cx="22" cy="22" r="20" pathLength={100} />
            </svg>
          )}
        </button>
      ) : (
        <span
          className={styles.stepper}
          role="group"
          aria-label={`Cantidad de ${product.name}`}
        >
          <button
            type="button"
            className={styles.target}
            aria-label={`Quitar una unidad de ${product.name}`}
            onClick={() => {
              update(menu, product.id, inCart - 1);
              setAnnouncement(addedLive(inCart - 1));
            }}
          >
            <span className={styles.face} aria-hidden="true">
              <Minus size={20} strokeWidth={2.4} />
            </span>
          </button>
          <span key={inCart} className={styles.count}>
            {inCart}
          </span>
          <button
            type="button"
            className={styles.target}
            aria-label={`Agregar otra unidad de ${product.name}`}
            onClick={() => {
              if (update(menu, product.id, inCart + 1) === null)
                setAnnouncement(addedLive(inCart + 1));
            }}
          >
            <span className={styles.face} aria-hidden="true">
              <Plus size={20} strokeWidth={2.4} />
            </span>
          </button>
        </span>
      )}
      <span className={styles.srOnly} aria-live="polite" role="status">
        {announcement}
      </span>
    </span>
  );
}
