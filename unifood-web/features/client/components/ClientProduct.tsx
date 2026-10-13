"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Clock3, Minus, Plus, ShoppingCart } from "lucide-react";
import type { CartLine, CatalogMeal } from "../types";
import type { DemoSite } from "../mocks/catalog";
import {
  currency,
  MAX_CART_MEALS,
  NOTES_LIMIT,
  mealAvailability,
  serviceHours,
} from "../domain/catalog";
import { cartMealKind, MIXED_MEALS_MESSAGE } from "../domain/cart";
import { useColombiaClock } from "../hooks/useColombiaClock";
import { useClientCart } from "./ClientCartProvider";
import CafeteriaSelector from "./CafeteriaSelector";
import styles from "./ClientShopping.module.css";

type ProductProps = {
  site: DemoSite;
  meal: CatalogMeal;
  initialTime: string;
};

export default function ClientProduct(props: ProductProps) {
  const { cart } = useClientCart();
  const line =
    cart.siteId === props.site.id
      ? cart.lines.find((item) => item.mealId === props.meal.id)
      : undefined;
  return (
    <ProductDetails
      key={JSON.stringify([props.site.id, props.meal.id, line])}
      {...props}
      line={line}
    />
  );
}

function ProductDetails({
  site,
  meal,
  initialTime,
  line,
}: ProductProps & { line?: CartLine }) {
  const { cart, count, ready, add, update, ignoreServiceHours } =
    useClientCart();
  const now = useColombiaClock(initialTime);
  const [quantity, setQuantity] = useState(line?.quantity ?? 1);
  const [notes, setNotes] = useState(line?.notes ?? "");
  const availability = mealAvailability(meal, site.id, now, ignoreServiceHours);
  const existing =
    cart.siteId === site.id
      ? cart.lines
          .filter((line) => line.mealId === meal.id)
          .reduce((sum, line) => sum + line.quantity, 0)
      : 0;
  const maximum = Math.max(
    0,
    Math.min(
      MAX_CART_MEALS - count + (line?.quantity ?? 0),
      meal.stock - existing + (line?.quantity ?? 0),
    ),
  );
  const conflict =
    cart.lines.length > 0
      ? cart.siteId !== site.id
        ? "Vacía tu carrito antes de cambiar de cafetería."
        : cartMealKind(cart) !== meal.kind
          ? MIXED_MEALS_MESSAGE
          : ""
      : "";
  const reason =
    conflict ||
    (!availability.open
      ? availability.reason
      : maximum === 0
        ? "Tu carrito ya alcanzó el límite de cantidad o las unidades disponibles."
        : quantity > maximum
          ? `Puedes seleccionar hasta ${maximum} unidad${maximum === 1 ? "" : "es"}.`
          : "");
  const unchanged =
    !!line && quantity === line.quantity && notes.trim() === line.notes;
  return (
    <section className={styles.shopping} aria-labelledby="product-title">
      <Link
        className={styles.back}
        href={`/cuenta/menu?sede=${site.id}&categoria=${meal.kind === "breakfast" ? "desayunos" : "almuerzos"}`}
      >
        <ArrowLeft size={22} aria-hidden="true" />
        Volver al menú
      </Link>
      <CafeteriaSelector site={site} />
      <div className={styles.productImage}>
        <Image
          src={meal.image}
          alt={meal.name}
          fill
          sizes="(max-width: 680px) 100vw, 640px"
          priority
        />
      </div>
      <div>
        <p className={styles.eyebrow}>
          {meal.kind === "breakfast" ? "Desayuno completo" : "Almuerzo"}
        </p>
        <h1 id="product-title">{meal.name}</h1>
        <p className={styles.description}>{meal.description}</p>
        <strong className={styles.productPrice}>
          {currency.format(meal.price)}
        </strong>
      </div>
      <p className={styles.schedule}>
        <Clock3 size={18} aria-hidden="true" />
        {serviceHours(meal.kind)} · Colombia
      </p>
      <form
        className={styles.productForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || reason || unchanged) return;
          if (line) update(line.id, { quantity, notes });
          else add(site.id, meal.id, quantity, notes);
        }}
      >
        <div className={styles.quantityRow}>
          <div>
            <label id="quantity-label">Cantidad</label>
            <p>Máximo 3 platos completos por pedido.</p>
            {line && (
              <p>
                Ya tienes {line.quantity} en el carrito. Ajusta la cantidad y
                guarda los cambios.
              </p>
            )}
          </div>
          <div
            className={styles.quantity}
            role="group"
            aria-labelledby="quantity-label"
          >
            <button
              type="button"
              aria-label="Reducir cantidad"
              disabled={!ready || quantity <= 1}
              onClick={() => setQuantity((value) => value - 1)}
            >
              <Minus size={19} aria-hidden="true" />
            </button>
            <output aria-label="Cantidad seleccionada">{quantity}</output>
            <button
              type="button"
              aria-label="Aumentar cantidad"
              disabled={
                !ready ||
                quantity >= maximum ||
                !availability.open ||
                !!conflict
              }
              onClick={() =>
                setQuantity((value) => Math.min(maximum, value + 1))
              }
            >
              <Plus size={19} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className={styles.notes}>
          <label htmlFor="meal-notes">
            Observaciones <span>(opcional)</span>
          </label>
          <textarea
            id="meal-notes"
            rows={3}
            maxLength={NOTES_LIMIT}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Cuéntanos algo que debamos tener en cuenta"
            aria-describedby="notes-count"
          />
          <small id="notes-count">
            {notes.length}/{NOTES_LIMIT} caracteres. No incluye cambios de
            ingredientes.
          </small>
        </div>
        {reason && (
          <p
            className={styles.notice}
            role="status"
            aria-label="Disponibilidad del plato"
          >
            {reason}
          </p>
        )}
        {conflict && (
          <Link className={styles.secondaryButton} href="/cuenta/carrito">
            Revisar carrito
          </Link>
        )}
        <div className={styles.purchase}>
          <div>
            <span>
              {line ? "Total actualizado del plato" : "Total del plato"}
            </span>
            <strong>{currency.format(meal.price * quantity)}</strong>
          </div>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!ready || !!reason || unchanged}
          >
            <ShoppingCart size={20} aria-hidden="true" />
            {line ? "Actualizar carrito" : "Agregar al carrito"}
          </button>
        </div>
      </form>
    </section>
  );
}
