"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock3, Search, SearchX, X } from "lucide-react";
import { currency } from "../domain/catalog";
import { cafeteriaHref } from "../domain/context";
import {
  CLOSED_NOTICE,
  EMPTY_CATEGORY,
  menuCategories,
  menuHref,
  menuProducts,
  productHref,
} from "../domain/menu";
import type { CafeteriaMenu, MenuCategoryId } from "../types";
import CafeteriaSelector from "./CafeteriaSelector";
import ProductPlaceholder from "./ProductPlaceholder";
import styles from "./ClientCatalog.module.css";
import menuStyles from "./ClientMenu.module.css";

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").trim();

export default function ClientMenu({
  siteName,
  menu,
  categoryId,
}: {
  siteName: string;
  menu: CafeteriaMenu;
  categoryId: MenuCategoryId | null;
}) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const { cafeteria } = menu;
  const category = menuCategories.find(({ id }) => id === categoryId);
  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }
  const inCategory = category
    ? (menu.categories.find(({ id }) => id === category.id)?.products ?? [])
    : menuProducts(menu);
  const products = inCategory.filter((product) =>
    normalize(product.name).includes(normalize(search)),
  );
  return (
    <section className={styles.menu} aria-labelledby="menu-title">
      <Link className={styles.back} href={cafeteriaHref(cafeteria.id)}>
        <ArrowLeft size={22} aria-hidden="true" />
        Volver al inicio
      </Link>
      <CafeteriaSelector siteName={siteName} cafeteria={cafeteria} />
      <div className={styles.pageHeading}>
        <h1 id="menu-title">{category ? category.name : "Menú completo"}</h1>
        <p>
          {category
            ? "Productos de esta categoría en tu cafetería."
            : "Todo lo que ofrece hoy tu cafetería."}
        </p>
      </div>
      {!cafeteria.open && (
        <p className={menuStyles.closed} role="status">
          <Clock3 size={18} aria-hidden="true" />
          {CLOSED_NOTICE}
        </p>
      )}
      <ul className={menuStyles.filters} aria-label="Categorías">
        <li>
          <Link
            href={menuHref(cafeteria.id)}
            aria-current={!category ? "page" : undefined}
          >
            Todo
          </Link>
        </li>
        {menuCategories.map((item) => (
          <li key={item.id}>
            <Link
              href={menuHref(cafeteria.id, item.slug)}
              aria-current={item.id === category?.id ? "page" : undefined}
            >
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
      {inCategory.length === 0 ? (
        <p className={menuStyles.compact}>
          {category
            ? `${EMPTY_CATEGORY}.`
            : "Aún no hay productos en el menú. Vuelve a consultar más tarde."}
        </p>
      ) : (
        <>
          <form
            role="search"
            className={styles.search}
            onSubmit={(event) => event.preventDefault()}
          >
            <Search size={20} aria-hidden="true" />
            <input
              ref={searchInput}
              aria-label="Buscar en el menú"
              type="search"
              placeholder="Busca un producto"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              enterKeyHint="search"
            />
            {search && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={clearSearch}
              >
                <X size={20} aria-hidden="true" />
              </button>
            )}
          </form>
          <p className={styles.resultCount} role="status" aria-live="polite">
            {products.length} {products.length === 1 ? "producto" : "productos"}
          </p>
          <ul className={styles.mealList} aria-label="Menú">
            {products.map((product) => (
              <li key={product.id}>
                <article>
                  <Link
                    className={styles.mealCard}
                    href={productHref(cafeteria.id, product.id)}
                  >
                    <ProductPlaceholder name={product.name} size="card" />
                    <div>
                      <h2>{product.name}</h2>
                      {product.description && <p>{product.description}</p>}
                      <strong className={styles.price}>
                        {currency.format(product.price)}
                      </strong>
                      {cafeteria.open && !product.available && (
                        <small className={styles.availability}>
                          No disponible por ahora
                        </small>
                      )}
                    </div>
                  </Link>
                </article>
              </li>
            ))}
          </ul>
          {!products.length && (
            <div className={styles.empty}>
              <SearchX size={32} aria-hidden="true" />
              <h2>No encontramos coincidencias</h2>
              <p>Prueba con otro nombre de producto.</p>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={clearSearch}
              >
                Ver todo el menú
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
