"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { currency } from "../domain/catalog";
import {
  canRotate,
  isPaused,
  nextIndex,
  prevIndex,
  ROTATE_MS,
  type CarouselPauses,
} from "../domain/featured";
import { productHref } from "../domain/menu";
import type { MenuProduct } from "../types";
import styles from "./FeaturedCarousel.module.css";

const NO_PAUSE: CarouselPauses = {
  hover: false,
  focus: false,
  touch: false,
  user: false,
};
/** Horizontal distance, in pixels, that counts as a swipe. */
const SWIPE_PX = 40;

/**
 * Portada of the client's home (ola 4): a large card that rotates through the available products.
 * It pauses on hover, focus, touch and with the pause button, swipes with a finger, and moves with
 * the arrow keys. Reduced motion keeps it still. Automatic changes are not announced.
 */
export default function FeaturedCarousel({
  products,
  cafeteriaId,
}: {
  products: MenuProduct[];
  cafeteriaId: string;
}) {
  const count = products.length;
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pauses, setPauses] = useState<CarouselPauses>(NO_PAUSE);
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

  // A shorter list (a product went out of stock) must not leave the index past the end.
  const current = count > 0 ? Math.min(index, count - 1) : 0;
  const paused = isPaused(pauses);
  const rotating = canRotate({ count, reducedMotion, paused });

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
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse")
          setPauses((p) => ({ ...p, hover: true }));
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse")
          setPauses((p) => ({ ...p, hover: false }));
      }}
      onFocus={() => setPauses((p) => ({ ...p, focus: true }))}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setPauses((p) => ({ ...p, focus: false }));
      }}
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
          swipeStart.current = event.clientX;
          swiped.current = false;
          setPauses((p) => ({ ...p, touch: true }));
        }}
        onPointerUp={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          setPauses((p) => ({ ...p, touch: false }));
          if (start === null) return;
          const distance = event.clientX - start;
          if (Math.abs(distance) >= SWIPE_PX && count > 1) {
            swiped.current = true;
            go(distance < 0 ? 1 : -1);
          }
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
          setPauses((p) => ({ ...p, touch: false }));
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
          {products.map((product, i) => (
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

      {count > 1 && (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.arrow}
            aria-label="Producto anterior"
            onClick={() => go(-1)}
          >
            <Icon name="flecha-izquierda" size={20} />
          </button>
          <div className={styles.dots}>
            {products.map((product, i) => (
              <button
                key={product.id}
                type="button"
                className={styles.dot}
                aria-label={`Ver ${product.name}`}
                aria-current={i === current ? "true" : undefined}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.arrow}
            aria-label="Producto siguiente"
            onClick={() => go(1)}
          >
            <Icon name="flecha-derecha" size={20} />
          </button>
          {!reducedMotion && (
            <button
              type="button"
              className={styles.pause}
              onClick={() => setPauses((p) => ({ ...p, user: !p.user }))}
            >
              {pauses.user ? "Reanudar carrusel" : "Pausar carrusel"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
