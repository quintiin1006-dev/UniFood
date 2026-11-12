"use client";
import { useState } from "react";
import Link from "next/link";
import { Clock3, UtensilsCrossed } from "lucide-react";
import { currency } from "../domain/catalog";
import {
  CLOSED_NOTICE,
  EMPTY_CATEGORY,
  menuCategories,
  menuHref,
  productHref,
} from "../domain/menu";
import type { CafeteriaMenu, MenuCategoryId, MenuProduct } from "../types";
import CafeteriaSelector from "./CafeteriaSelector";
import { RememberCafeteria } from "./CafeteriaMemory";
import ProductPlaceholder from "./ProductPlaceholder";
import styles from "./ClientCatalog.module.css";
import menuStyles from "./ClientMenu.module.css";

export default function ClientHome({
  ownerId,
  fullName,
  siteName,
  menu,
}: {
  ownerId: string;
  fullName: string | null;
  siteName: string;
  menu: CafeteriaMenu;
}) {
  const [filter, setFilter] = useState<MenuCategoryId | null>(null);
  const firstName = fullName?.trim().split(/\s+/)[0];
  const { cafeteria } = menu;
  const visible = menuCategories.filter(
    (category) => !filter || category.id === filter,
  );
  return (
    <section className={styles.home} aria-labelledby="client-home-title">
      <RememberCafeteria ownerId={ownerId} cafeteriaId={cafeteria.id} />
      <div className={styles.pageHeading}>
        <h1 id="client-home-title">
          ¡Hola{firstName ? `, ${firstName}` : ""}!
        </h1>
        <p>¿Qué te gustaría comer hoy?</p>
      </div>
      <CafeteriaSelector siteName={siteName} cafeteria={cafeteria} />
      {!cafeteria.open && (
        <p className={menuStyles.closed} role="status">
          <Clock3 size={18} aria-hidden="true" />
          {CLOSED_NOTICE}
        </p>
      )}
      {menu.categories.length === 0 ? (
        <div className={menuStyles.state}>
          <UtensilsCrossed size={36} strokeWidth={1.5} aria-hidden="true" />
          <h2>Aún no hay productos en el menú</h2>
          <p>Vuelve a consultar más tarde.</p>
        </div>
      ) : (
        <>
          <ul className={menuStyles.filters} aria-label="Filtrar por categoría">
            <li>
              <button
                type="button"
                aria-pressed={filter === null}
                onClick={() => setFilter(null)}
              >
                Todo
              </button>
            </li>
            {menuCategories.map((category) => (
              <li key={category.id}>
                <button
                  type="button"
                  aria-pressed={filter === category.id}
                  onClick={() => setFilter(category.id)}
                >
                  {category.name}
                </button>
              </li>
            ))}
          </ul>
          {visible.map((category) => {
            const products =
              menu.categories.find(({ id }) => id === category.id)?.products ??
              [];
            // Open: carousel of what can be ordered now. Closed: the active products, to see (§6).
            const shown = cafeteria.open
              ? products.filter((product) => product.available)
              : products;
            if (!shown.length)
              return (
                <p key={category.id} className={menuStyles.compact}>
                  <strong>{category.name}</strong>: {EMPTY_CATEGORY}.
                </p>
              );
            const headingId = `category-${category.slug}`;
            return (
              <section
                key={category.id}
                className={menuStyles.category}
                aria-labelledby={headingId}
              >
                <div className={menuStyles.categoryHeader}>
                  <h2 id={headingId}>{category.name}</h2>
                  <Link
                    href={menuHref(cafeteria.id, category.slug)}
                    aria-label={`Ver todo: ${category.name}`}
                  >
                    Ver todo
                  </Link>
                </div>
                <ProductRail
                  label={category.name}
                  cafeteriaId={cafeteria.id}
                  products={shown}
                />
              </section>
            );
          })}
          <Link
            className={styles.secondaryButton}
            href={menuHref(cafeteria.id)}
          >
            Ver el menú completo
          </Link>
        </>
      )}
    </section>
  );
}

function ProductRail({
  label,
  cafeteriaId,
  products,
}: {
  label: string;
  cafeteriaId: string;
  products: MenuProduct[];
}) {
  return (
    <ul
      className={menuStyles.rail}
      aria-label={`Productos: ${label}`}
      aria-roledescription="carrusel"
    >
      {products.map((product) => (
        <li key={product.id}>
          <Link
            className={menuStyles.railCard}
            href={productHref(cafeteriaId, product.id)}
          >
            <ProductPlaceholder name={product.name} size="rail" />
            <strong>{product.name}</strong>
            <span>{currency.format(product.price)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
