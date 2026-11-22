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
  CONNECTION_OFFLINE,
} from "../../shared/messages";
import { ConnectionNotice } from "@/features/shared/components/ConnectionNotice";
import ClosedBanner from "./ClosedBanner";
import FeaturedCarousel from "./FeaturedCarousel";
import CafeteriaPicker from "./CafeteriaPicker";
import type { ContextSite } from "../types";
import { RememberCafeteria } from "./CafeteriaMemory";
import ProductAddButton from "./ProductAddButton";
import ProductPlaceholder from "./ProductPlaceholder";
import menuStyles from "./ClientMenu.module.css";
import styles from "./HomeSections.module.css";
import DailyMenuBlock from "@/features/daily-menu/components/DailyMenuCard";
import { useClientDailyMenu } from "@/features/daily-menu/useClientDailyMenu";
import { DAILY_MENU_REPLACES, homeLayout } from "@/features/daily-menu/state";

/**
 * Inicio, top to bottom: cafeteria selector, carousel (or the closed notice in its place),
 * category chips and one horizontal row per category. Only categories with available products
 * appear, as a chip and as a section; an empty one is not rendered at all.
 *
 * «Menú del día» (docs/propuesta-menu-dinamico.md 4.4): when the live menu says
 * dailyMenuAvailable, the card sits after the chips and takes the place of «Corriente»
 * (DAILY_MENU_REPLACES). Without a card (flag off, no menu, any read failure) Inicio is as today.
 */
export default function ClientHome({
  ownerId,
  siteName,
  sites = [],
  menu: serverMenu,
}: {
  ownerId: string;
  siteName: string;
  /** Every subscribed cafeteria, for the list that opens on Inicio (C2). */
  sites?: ContextSite[];
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
  const daily = useClientDailyMenu(cafeteria.id, current.dailyMenuAvailable);
  // While the card loads or shows, it replaces «Corriente»; a failed read gives it back.
  const replacing = daily.status !== "hidden";
  const productsOf = (id: MenuCategoryId) =>
    menu.categories.find((category) => category.id === id)?.products ?? [];
  const layout = homeLayout({
    order: menuCategories.map(({ id }) => id),
    withProducts: menuCategories
      .map(({ id }) => id)
      .filter((id) => productsOf(id).length > 0),
    replacing,
    filter,
  });
  // A chosen category that just emptied falls back to «Todo».
  const active = layout.active;
  const chips = menuCategories.filter(({ id }) =>
    layout.filterIds.includes(id),
  );
  const shown = menuCategories
    .filter(({ id }) => layout.sectionIds.includes(id))
    .map((category) => ({ category, products: productsOf(category.id) }));
  // The carousel never features a «Corriente» product while the card replaces it.
  const featured = featuredProducts(menu).filter(
    (product) => !replacing || product.category !== DAILY_MENU_REPLACES,
  );
  const dailyMenu = layout.showCard ? (
    <DailyMenuBlock key={cafeteria.id} state={daily} />
  ) : null;
  return (
    <section className={styles.home} aria-label="Inicio">
      <RememberCafeteria ownerId={ownerId} cafeteriaId={cafeteria.id} />
      <CafeteriaPicker
        siteName={siteName}
        cafeteria={cafeteria}
        sites={sites}
      />
      {stale && <ConnectionNotice>{CONNECTION_OFFLINE}</ConnectionNotice>}
      {/* The same room either way: the closed notice takes the carousel's place. */}
      {cafeteria.open ? (
        <FeaturedCarousel products={featured} cafeteriaId={cafeteria.id} />
      ) : (
        <ClosedBanner />
      )}
      {chips.length === 0 ? (
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
            {chips.map((category) => (
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
          {dailyMenu}
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
