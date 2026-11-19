"use client";
import { useState } from "react";
import Link from "next/link";
import { currency } from "../domain/catalog";
import { menuCategories, menuHref, productHref } from "../domain/menu";
import { useCafeteriaMenu } from "../hooks/useCafeteriaMenu";
import { onlyAvailable } from "../menuRefresh";
import type { CafeteriaMenu, MenuCategoryId, MenuProduct } from "../types";
import { featuredProducts } from "../domain/featured";
import {
  HOME_ALL_CATEGORIES,
  HOME_SEE_ALL,
  HOME_EMPTY_MENU,
  OFFLINE_RETRYING,
} from "../../shared/messages";
import ClosedBanner from "./ClosedBanner";
import FeaturedCarousel from "./FeaturedCarousel";
import CafeteriaSelector from "./CafeteriaSelector";
import { RememberCafeteria } from "./CafeteriaMemory";
import ProductAddButton from "./ProductAddButton";
import ProductPlaceholder from "./ProductPlaceholder";
import menuStyles from "./ClientMenu.module.css";
import styles from "./HomeSections.module.css";

/**
 * Inicio, top to bottom: cafeteria selector, carousel (or the closed notice in its place),
 * category chips and one horizontal row per category. Only categories with available products
 * appear, as a chip and as a section; an empty one is not rendered at all.
 */
export default function ClientHome({
  ownerId,
  siteName,
  menu: serverMenu,
}: {
  ownerId: string;
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
  const { cafeteria } = menu;
  const sections = menuCategories
    .map((category) => ({
      category,
      products:
        menu.categories.find(({ id }) => id === category.id)?.products ?? [],
    }))
    .filter(({ products }) => products.length > 0);
  // A chosen category that just emptied falls back to «Todo».
  const active = sections.some(({ category }) => category.id === filter)
    ? filter
    : null;
  const shown = sections.filter(
    ({ category }) => !active || category.id === active,
  );
  return (
    <section className={styles.home} aria-label="Inicio">
      <RememberCafeteria ownerId={ownerId} cafeteriaId={cafeteria.id} />
      <CafeteriaSelector siteName={siteName} cafeteria={cafeteria} compact />
      {stale && (
        <p className={styles.notice} role="status">
          {OFFLINE_RETRYING}
        </p>
      )}
      {/* The same room either way: the closed notice takes the carousel's place. */}
      {cafeteria.open ? (
        <FeaturedCarousel
          products={featuredProducts(menu)}
          cafeteriaId={cafeteria.id}
        />
      ) : (
        <ClosedBanner />
      )}
      {sections.length === 0 ? (
        <p className={styles.notice}>{HOME_EMPTY_MENU}</p>
      ) : (
        <>
          <ul className={menuStyles.filters} aria-label="Filtrar por categoría">
            <li>
              <button
                type="button"
                aria-pressed={active === null}
                onClick={() => setFilter(null)}
              >
                {HOME_ALL_CATEGORIES}
              </button>
            </li>
            {sections.map(({ category }) => (
              <li key={category.id}>
                <button
                  type="button"
                  aria-pressed={active === category.id}
                  onClick={() => setFilter(category.id)}
                >
                  {category.name}
                </button>
              </li>
            ))}
          </ul>
          {shown.map(({ category, products }) => {
            const headingId = `category-${category.slug}`;
            return (
              <section
                key={category.id}
                className={styles.section}
                aria-labelledby={headingId}
              >
                <div className={styles.sectionHeader}>
                  <h2 id={headingId}>{category.name}</h2>
                  <Link
                    href={menuHref(cafeteria.id, category.slug)}
                    aria-label={`${HOME_SEE_ALL}: ${category.name}`}
                  >
                    {HOME_SEE_ALL}
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
        </>
      )}
    </section>
  );
}

/**
 * A horizontal row with snap of white product cards, as before #160: thumbnail with the initial,
 * name, price and the «+» in the bottom-right corner, beside the link.
 */
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
