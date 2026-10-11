"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Search, SearchX, X } from "lucide-react";
import {
  getSiteMeals,
  mealHref,
  type DemoSite,
  type DemoCategory,
} from "../mocks/catalog";
import { currency, mealAvailability } from "../domain/catalog";
import { useColombiaClock } from "../hooks/useColombiaClock";
import CafeteriaSelector from "./CafeteriaSelector";
import { useClientCart } from "./ClientCartProvider";
import styles from "./ClientCatalog.module.css";
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
export default function ClientMenu({
  site,
  category,
  initialTime,
}: {
  site: DemoSite;
  category: DemoCategory;
  initialTime: string;
}) {
  const [search, setSearch] = useState("");
  const now = useColombiaClock(initialTime);
  const { ignoreServiceHours } = useClientCart();
  const searchInput = useRef<HTMLInputElement>(null);
  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }
  const meals = getSiteMeals(site).filter(
    (meal) =>
      (meal.category === category.id ||
        (category.id === "almuerzos" && meal.kind === "lunch")) &&
      normalize(meal.name).includes(normalize(search)),
  );
  return (
    <section className={styles.menu} aria-labelledby="menu-title">
      <Link className={styles.back} href={`/cuenta?sede=${site.id}`}>
        <ArrowLeft size={22} aria-hidden="true" />
        Volver al inicio
      </Link>
      <CafeteriaSelector site={site} />
      <div className={styles.pageHeading}>
        <h1 id="menu-title">{category.name}</h1>
        <p>{category.description}</p>
      </div>
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
          placeholder="Busca un plato"
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
        {meals.length} {meals.length === 1 ? "plato" : "platos"}
      </p>
      <ul className={styles.mealList} aria-label="Menú">
        {meals.map((meal) => (
          <li key={meal.id}>
            <article>
              <Link
                className={styles.mealCard}
                href={mealHref(site.id, meal.id)}
              >
                <Image
                  src={meal.image}
                  alt={meal.name}
                  width={160}
                  height={176}
                  sizes="(max-width: 375px) 96px, 140px"
                />
                <div>
                  <h2>{meal.name}</h2>
                  <p>{meal.description}</p>
                  <strong className={styles.price}>
                    {currency.format(meal.price)}
                  </strong>
                  {!mealAvailability(meal, site.id, now, ignoreServiceHours)
                    .open && (
                    <small className={styles.availability}>
                      {
                        mealAvailability(meal, site.id, now, ignoreServiceHours)
                          .reason
                      }
                    </small>
                  )}
                </div>
              </Link>
            </article>
          </li>
        ))}
      </ul>
      {!meals.length && (
        <div className={styles.empty}>
          <SearchX size={32} aria-hidden="true" />
          <h2>No encontramos coincidencias</h2>
          <p>Prueba con otro nombre de plato.</p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={clearSearch}
          >
            Ver todo el menú
          </button>
        </div>
      )}
    </section>
  );
}
