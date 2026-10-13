"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, Pencil, Trash2 } from "lucide-react";
import type { CartLine, CatalogMeal } from "../types";
import { currency, MAX_CART_MEALS, mealAvailability } from "../domain/catalog";
import { mealHref } from "../mocks/catalog";
import { useClientCart } from "./ClientCartProvider";
import CartNotesDialog from "./CartNotesDialog";
import styles from "./ClientShopping.module.css";
import cartStyles from "./ClientCart.module.css";

export default function CartLineItem({
  line,
  meal,
  siteId,
  now,
}: {
  line: CartLine;
  meal: CatalogMeal;
  siteId: string;
  now: Date;
}) {
  const { cart, count, update, remove, ignoreServiceHours } = useClientCart();
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const availability = mealAvailability(meal, siteId, now, ignoreServiceHours);
  const totalQuantity = cart.lines
    .filter((item) => item.mealId === meal.id)
    .reduce((sum, item) => sum + item.quantity, 0);
  const canIncrease =
    availability.open && count < MAX_CART_MEALS && totalQuantity < meal.stock;
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
      <Image src={meal.image} alt="" width={82} height={88} />
      <div>
        <Link href={mealHref(siteId, meal.id)}>
          <h2>{meal.name}</h2>
        </Link>
        <p>Cantidad: {line.quantity}</p>
        {line.notes && <p className={styles.lineNotes}>{line.notes}</p>}
        <strong>{currency.format(meal.price * line.quantity)}</strong>
        {!availability.open && <small>{availability.reason}</small>}
        {totalQuantity > meal.stock && (
          <small>Quedan {meal.stock} unidades. Reduce la cantidad.</small>
        )}
      </div>
      <button
        type="button"
        className={styles.remove}
        aria-label={`Eliminar ${meal.name}`}
        onClick={() => remove(line.id)}
      >
        <Trash2 size={20} aria-hidden="true" />
      </button>
      <div className={cartStyles.controls}>
        <div
          className={styles.quantity}
          role="group"
          aria-label={`Cantidad de ${meal.name}`}
        >
          <button
            type="button"
            aria-label={`Reducir cantidad de ${meal.name}`}
            disabled={line.quantity <= 1}
            onClick={() => update(line.id, { quantity: line.quantity - 1 })}
          >
            <Minus size={17} aria-hidden="true" />
          </button>
          <output aria-label={`Cantidad de ${meal.name}`}>
            {line.quantity}
          </output>
          <button
            type="button"
            aria-label={`Aumentar cantidad de ${meal.name}`}
            disabled={!canIncrease}
            onClick={() => update(line.id, { quantity: line.quantity + 1 })}
          >
            <Plus size={17} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className={cartStyles.editNotes}
          aria-label={`Editar observaciones de ${meal.name}`}
          onClick={() => setEditing(true)}
        >
          <Pencil size={16} aria-hidden="true" /> Observaciones
        </button>
      </div>
      {revealed && (
        <div className={cartStyles.swipeActions}>
          <button type="button" onClick={() => remove(line.id)}>
            Confirmar eliminación
          </button>
          <button type="button" onClick={() => setRevealed(false)}>
            Conservar
          </button>
        </div>
      )}
      {editing && (
        <CartNotesDialog
          line={line}
          name={meal.name}
          onClose={() => setEditing(false)}
        />
      )}
    </li>
  );
}
