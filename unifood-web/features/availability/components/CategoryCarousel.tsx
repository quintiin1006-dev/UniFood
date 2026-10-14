"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  CATEGORY_LABELS,
  type CatalogCategory,
  type AvailabilityItem,
} from "../types";
import { ProductCard } from "./ProductCard";
import styles from "./Availability.module.css";

export function CategoryCarousel({
  category,
  items,
  cafeteriaActive,
  busyItems,
  blocked,
  errors,
  onChange,
}: {
  category: CatalogCategory;
  items: AvailabilityItem[];
  cafeteriaActive: boolean;
  busyItems: string[];
  blocked: boolean;
  errors: Record<string, string>;
  onChange: (id: string, available: boolean) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ previous: false, next: false });
  const label = CATEGORY_LABELS[category];
  const headingId = `availability-category-${category}`;
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const measure = () =>
      setBounds({
        previous: element.scrollLeft > 1,
        next:
          element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      });
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [items.length]);
  const move = (direction: number) => {
    const element = rail.current;
    if (element)
      element.scrollBy({
        left: direction * Math.max(250, element.clientWidth * 0.8),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  };
  return (
    <section className={styles.category} aria-labelledby={headingId}>
      <div className={styles.categoryHeader}>
        <div className={styles.categoryTitle}>
          <h3 id={headingId}>{label}</h3>
          <span className={styles.categoryCount}>
            {items.length} {items.length === 1 ? "producto" : "productos"}
          </span>
        </div>
        {items.length > 0 && (
          <div className={styles.carouselActions}>
            <button
              type="button"
              aria-label={`Anterior en ${label}`}
              aria-controls={`${headingId}-rail`}
              disabled={!bounds.previous}
              onClick={() => move(-1)}
            >
              <ChevronLeft aria-hidden="true" size={20} />
            </button>
            <button
              type="button"
              aria-label={`Siguiente en ${label}`}
              aria-controls={`${headingId}-rail`}
              disabled={!bounds.next}
              onClick={() => move(1)}
            >
              <ChevronRight aria-hidden="true" size={20} />
            </button>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <p className={styles.empty}>No hay productos en esta categoría.</p>
      ) : (
        <div
          id={`${headingId}-rail`}
          ref={rail}
          className={`${styles.rail} ${items.length === 1 ? styles.singleRail : ""}`}
          role="region"
          aria-label={`Productos de ${label}`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              move(event.key === "ArrowRight" ? 1 : -1);
            }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              rail.current?.scrollTo({
                left: event.key === "Home" ? 0 : rail.current.scrollWidth,
                behavior: "instant",
              });
            }
          }}
        >
          {items.map((item) => (
            <ProductCard
              key={item.id}
              item={item}
              cafeteriaActive={cafeteriaActive}
              busy={busyItems.includes(item.id)}
              blocked={blocked}
              error={errors[item.id]}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </section>
  );
}
