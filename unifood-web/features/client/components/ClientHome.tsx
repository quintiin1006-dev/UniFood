"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, UtensilsCrossed } from "lucide-react";
import { currency } from "../domain/catalog";
import {
  EMPTY_CATEGORY,
  menuCategories,
  menuHref,
  productHref,
} from "../domain/menu";
import { useCafeteriaMenu } from "../hooks/useCafeteriaMenu";
import { onlyAvailable } from "../menuRefresh";
import type { CafeteriaMenu, MenuCategoryId, MenuProduct } from "../types";
import { featuredProducts } from "../domain/featured";
import { OFFLINE_RETRYING } from "../../shared/messages";
import ClosedBanner from "./ClosedBanner";
import FeaturedCarousel from "./FeaturedCarousel";
import CafeteriaSelector from "./CafeteriaSelector";
import { RememberCafeteria } from "./CafeteriaMemory";
import ProductPlaceholder from "./ProductPlaceholder";
import ProductAddButton from "./ProductAddButton";
import styles from "./ClientCatalog.module.css";
import menuStyles from "./ClientMenu.module.css";

export default function ClientHome({
  ownerId,
  fullName,
  siteName,
  menu: serverMenu,
}: {
  ownerId: string;
  fullName: string | null;
  siteName: string;
  menu: CafeteriaMenu;
}) {
  const [filter, setFilter] = useState<MenuCategoryId | null>(null);
  // The server's menu is on screen at once; the catalogue is then kept fresh in the browser.
  const { state, stale } = useCafeteriaMenu(
    serverMenu.cafeteria.id,
    serverMenu,
  );
  const current = state.status === "ok" ? state.menu : serverMenu;
  // Only what can be ordered is listed: a product that stopped being available leaves the page.
  const menu = onlyAvailable(current);
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
      {stale && (
        <p className={menuStyles.closed} role="status">
          {OFFLINE_RETRYING}
        </p>
      )}
      {/* The same room either way: the closed banner takes the carousel's place. */}
      {cafeteria.open ? (
        <FeaturedCarousel
          products={featuredProducts(menu)}
          cafeteriaId={cafeteria.id}
        />
      ) : (
        <ClosedBanner />
      )}
      <CafeteriaSelector siteName={siteName} cafeteria={cafeteria} />
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
            if (!products.length)
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
                  menu={menu}
                  products={products}
                />
              </section>
            );
          })}
          <Link className={styles.menuButton} href={menuHref(cafeteria.id)}>
            <span>Ver el menú completo</span>
            <ArrowRight size={20} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </>
      )}
    </section>
  );
}

function ProductRail({
  label,
  menu,
  products,
}: {
  label: string;
  menu: CafeteriaMenu;
  products: MenuProduct[];
}) {
  const cafeteriaId = menu.cafeteria.id;
  return (
    <ul
      className={menuStyles.rail}
      aria-label={`Productos: ${label}`}
      aria-roledescription="carrusel"
    >
      {products.map((product) => (
        <li key={product.id} className={menuStyles.railItem}>
          <Link
            className={menuStyles.railCard}
            href={productHref(cafeteriaId, product.id)}
          >
            <ProductPlaceholder name={product.name} size="rail" />
            <strong>{product.name}</strong>
            <span>{currency.format(product.price)}</span>
          </Link>
          {/* Sibling of the link, not inside it: its clicks never open the product. */}
          <div className={menuStyles.railAdd}>
            <ProductAddButton menu={menu} product={product} />
          </div>
        </li>
      ))}
    </ul>
  );
}
