"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { currency } from "../domain/catalog";
import {
  canRotate,
  carouselSlides,
  nextIndex,
  prevIndex,
  ROTATE_MS,
} from "../domain/featured";
import { productHref } from "../domain/menu";
import type { MenuProduct } from "../types";
import styles from "./FeaturedCarousel.module.css";

/** Horizontal distance, in pixels, that counts as a swipe. */
const SWIPE_PX = 40;

/**
 * Portada of the client's home: a large card that moves by itself every five seconds through the
 * available products. It cannot be paused. With reduced motion nothing moves and the first product
 * stays on screen. A swipe or the arrow keys still change the slide. Automatic changes are not
 * announced to screen readers.
 */
export default function FeaturedCarousel({
  products,
  cafeteriaId,
}: {
  products: MenuProduct[];
  cafeteriaId: string;
}) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const swipeStart = useRef<number | null>(null);
  const swiped = useRef(false);
  const regionName = useId();

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const slides = carouselSlides(products, reducedMotion);
  const count = slides.length;
  // A shorter list (a product went out of stock) must not leave the index past the end.
  const current = count > 0 ? Math.min(index, count - 1) : 0;
  const rotating = canRotate({ count, reducedMotion });

  // Restarted on every change of slide, so a manual move gives the new slide its full time.
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(
      () => setIndex((i) => nextIndex(i, count)),
      ROTATE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [rotating, count, current]);

  if (count === 0) return null;

  function go(step: 1 | -1) {
    setIndex((i) => (step > 0 ? nextIndex(i, count) : prevIndex(i, count)));
  }

  return (
    <section
      className={styles.carousel}
      aria-roledescription="carrusel"
      aria-labelledby={regionName}
      onKeyDown={(event) => {
        if (count < 2) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(-1);
        }
      }}
    >
      <span id={regionName} className={styles.srOnly}>
        Productos destacados
      </span>
      <div
        className={styles.viewport}
        onPointerDown={(event) => {
          if (count < 2) return;
          swipeStart.current = event.clientX;
          swiped.current = false;
        }}
        onPointerUp={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (start === null) return;
          const distance = event.clientX - start;
          if (Math.abs(distance) >= SWIPE_PX && count > 1) {
            swiped.current = true;
            go(distance < 0 ? 1 : -1);
          }
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
        onClickCapture={(event) => {
          // A swipe that ends over a link must not open the product.
          if (swiped.current) {
            event.preventDefault();
            event.stopPropagation();
            swiped.current = false;
          }
        }}
      >
        {/* Automatic changes are not announced; the slide is read when it gets focus. */}
        <div
          className={styles.track}
          style={{ transform: `translateX(-${current * 100}%)` }}
          aria-live="off"
        >
          {slides.map((product, i) => (
            <div
              key={product.id}
              className={styles.slide}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${i + 1} de ${count}: ${product.name}`}
              inert={i !== current}
            >
              <Link
                className={styles.link}
                href={productHref(cafeteriaId, product.id)}
              >
                <span className={styles.name}>{product.name}</span>
                <span className={styles.price}>
                  {currency.format(product.price)}
                </span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
