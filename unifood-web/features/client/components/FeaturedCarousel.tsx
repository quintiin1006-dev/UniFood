"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { currency } from "../domain/catalog";
import {
  canRotate,
  carouselSlides,
  isPaused,
  loopTrack,
  nextLoopPosition,
  ROTATE_MS,
  type CarouselPauses,
} from "../domain/featured";
import { productHref } from "../domain/menu";
import { CAROUSEL_LABEL } from "../../shared/messages";
import type { MenuProduct } from "../types";
import styles from "./FeaturedCarousel.module.css";

const NO_PAUSE: CarouselPauses = { hover: false, focus: false, touch: false };

/**
 * Portada of the client's home. It moves forward by itself every five seconds in a real infinite
 * loop: after the last product comes the first again, through a copy of it, never rewinding. It
 * has no visible controls; hover, focus or a finger on it pauses it (WCAG 2.2.2). With reduced
 * motion nothing moves and the first product stays. Automatic changes are not announced.
 */
export default function FeaturedCarousel({
  products,
  cafeteriaId,
}: {
  products: MenuProduct[];
  cafeteriaId: string;
}) {
  const [position, setPosition] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pauses, setPauses] = useState<CarouselPauses>(NO_PAUSE);
  const regionName = useId();
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const slides = carouselSlides(products, reducedMotion);
  const count = slides.length;
  const track = loopTrack(slides);
  // A shorter list (a product went out of stock) must not leave the position past the copy.
  const at = count > 1 ? Math.min(position, count) : 0;
  const shown = at === count ? 0 : at;
  const rotating = canRotate({
    count,
    reducedMotion,
    paused: isPaused(pauses),
  });

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => {
      setAnimate(true);
      setPosition((p) => nextLoopPosition(p, count));
    }, ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [rotating, count, at]);

  if (count === 0) return null;

  const pause = (key: keyof CarouselPauses, value: boolean) =>
    setPauses((current) =>
      current[key] === value ? current : { ...current, [key]: value },
    );

  return (
    <section
      className={styles.carousel}
      aria-roledescription="carrusel"
      aria-labelledby={regionName}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") pause("hover", true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") pause("hover", false);
      }}
      onFocus={() => pause("focus", true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          pause("focus", false);
      }}
      onTouchStart={() => pause("touch", true)}
      onTouchEnd={() => pause("touch", false)}
      onTouchCancel={() => pause("touch", false)}
    >
      <span id={regionName} className={styles.srOnly}>
        {CAROUSEL_LABEL}
      </span>
      <div className={styles.viewport}>
        {/* Automatic changes are not announced; the slide is read when it gets focus. */}
        <div
          className={styles.track}
          data-animate={animate || undefined}
          style={{ transform: `translateX(-${at * 100}%)` }}
          aria-live="off"
          onTransitionEnd={() => {
            if (at !== count) return;
            // On the copy of the first slide: jump to the real one without animation, then
            // turn the animation back on for the next move.
            setAnimate(false);
            setPosition(0);
            frame.current = requestAnimationFrame(() => {
              frame.current = requestAnimationFrame(() => setAnimate(true));
            });
          }}
        >
          {track.map(({ item: product, clone }, i) =>
            clone ? (
              <div
                key={`${product.id}-copy`}
                className={styles.slide}
                aria-hidden="true"
                inert
              >
                <span className={styles.link}>
                  <span className={styles.name}>{product.name}</span>
                  <span className={styles.price}>
                    {currency.format(product.price)}
                  </span>
                </span>
              </div>
            ) : (
              <div
                key={product.id}
                className={styles.slide}
                role="group"
                aria-roledescription="diapositiva"
                aria-label={`${i + 1} de ${count}: ${product.name}`}
                inert={i !== shown}
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
            ),
          )}
        </div>
      </div>
    </section>
  );
}
