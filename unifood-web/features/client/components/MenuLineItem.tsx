"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { MenuLine } from "../types";
import { MENU_NONE } from "../types";
import { currency } from "../domain/catalog";
import { menuLineAmount, type MenuLineStatus } from "../domain/cart";
import type { ClientDailyMenu } from "@/features/daily-menu/types";
import { formatExtra } from "@/features/daily-menu/presentation";
import {
  CART_LINE_UNAVAILABLE,
  DAILY_MENU_ADDITIONS_LABEL,
  DAILY_MENU_CHOOSE_AGAIN,
  DAILY_MENU_LINE_CHANGED,
  DAILY_MENU_LINE_TITLE,
  DAILY_MENU_SKIP,
} from "@/features/shared/messages";
import { useClientCart } from "./ClientCartProvider";
import ProductPlaceholder from "./ProductPlaceholder";
import styles from "./ClientShopping.module.css";
import cartStyles from "./ClientCart.module.css";

/**
 * The daily menu plate in the cart (docs/propuesta-menu-dinamico.md 4.6): the dish, each
 * choice («Ninguna» included), the additions with their price and the amount, all from today's
 * published menu. A plate that no longer matches says so and can only be chosen again on Inicio
 * or removed; it never changes by itself.
 */
export default function MenuLineItem({
  line,
  daily,
  status,
}: {
  line: MenuLine;
  /** Today's published menu, or null when there is none. */
  daily: ClientDailyMenu | null;
  status: MenuLineStatus;
}) {
  const { removeMenu } = useClientCart();
  const shown = status === "ok" && daily ? daily : null;
  const title = shown?.title ?? DAILY_MENU_LINE_TITLE;
  const choices = shown
    ? shown.categories.flatMap((category) => {
        if (category.kind !== "SINGLE") return [];
        const value = line.choices[category.id];
        const label =
          value === MENU_NONE
            ? DAILY_MENU_SKIP
            : category.options.find(({ id }) => id === value)?.label;
        return label
          ? [{ id: category.id, text: `${category.label}: ${label}` }]
          : [];
      })
    : [];
  const additions = shown
    ? shown.categories.flatMap((category) =>
        category.kind === "ADDITIONS"
          ? category.additions.filter(({ id }) => line.additionIds.includes(id))
          : [],
      )
    : [];
  return (
    <li className={`${styles.cartLine} ${cartStyles.item}`}>
      <ProductPlaceholder name={title} size="line" />
      <div>
        <h2>{title}</h2>
        {shown && (
          <ul className={cartStyles.menuChoices}>
            {choices.map((choice) => (
              <li key={choice.id}>{choice.text}</li>
            ))}
            {additions.length > 0 && (
              <li>
                {DAILY_MENU_ADDITIONS_LABEL}:{" "}
                {additions
                  .map(
                    (addition) =>
                      `${addition.name} (${formatExtra(addition.extraPrice)})`,
                  )
                  .join(", ")}
              </li>
            )}
          </ul>
        )}
        {shown && (
          <strong>{currency.format(menuLineAmount(line, shown))}</strong>
        )}
        {status === "unavailable" && <small>{CART_LINE_UNAVAILABLE}</small>}
        {status === "changed" && (
          <>
            <small>{DAILY_MENU_LINE_CHANGED}</small>
            <Link href="/cuenta" className={cartStyles.editNotes}>
              {DAILY_MENU_CHOOSE_AGAIN}
            </Link>
          </>
        )}
      </div>
      <button
        type="button"
        className={styles.remove}
        aria-label={`Eliminar ${title}`}
        onClick={removeMenu}
      >
        <Trash2 size={20} aria-hidden="true" />
      </button>
    </li>
  );
}
