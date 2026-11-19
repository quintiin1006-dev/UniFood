import type { CafeteriaMenu, MenuProduct } from "../types";
import { menuProducts } from "./menu";

/** Time each slide stays on screen before the carousel moves on. */
export const ROTATE_MS = 5000;

/**
 * Products for the home portada: only the available ones, in menu order, each once even when a
 * product sits in two categories. Built from the menu the page already has; no new request.
 */
export function featuredProducts(menu: CafeteriaMenu): MenuProduct[] {
  const seen = new Set<string>();
  return menuProducts(menu).filter((product) => {
    if (!product.available || seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

export function nextIndex(index: number, count: number) {
  return count > 0 ? (index + 1) % count : 0;
}

export function prevIndex(index: number, count: number) {
  return count > 0 ? (index - 1 + count) % count : 0;
}

/**
 * The carousel moves on by itself every ROTATE_MS when there are two or more products, the user
 * has not asked for reduced motion and nothing is pausing it (WCAG 2.2.2: hover, focus or touch).
 * There are no visible controls.
 */
export function canRotate({
  count,
  reducedMotion,
  paused = false,
}: {
  count: number;
  reducedMotion: boolean;
  paused?: boolean;
}) {
  return count >= 2 && !reducedMotion && !paused;
}

export type CarouselPauses = { hover: boolean; focus: boolean; touch: boolean };

export function isPaused(pauses: CarouselPauses) {
  return pauses.hover || pauses.focus || pauses.touch;
}

/**
 * What the carousel shows. With reduced motion nothing moves: only the first product stays on
 * screen, fixed.
 */
export function carouselSlides(
  products: MenuProduct[],
  reducedMotion: boolean,
): MenuProduct[] {
  return reducedMotion ? products.slice(0, 1) : products;
}

/**
 * The track of a real infinite loop: the slides followed by a copy of the first. Moving from the
 * last slide goes forward onto the copy; once there, the track jumps without animation to the real
 * first slide, which looks the same. The carousel never rewinds. One slide needs no copy.
 */
export function loopTrack<T>(slides: T[]): { item: T; clone: boolean }[] {
  const track = slides.map((item) => ({ item, clone: false }));
  return slides.length >= 2
    ? [...track, { item: slides[0], clone: true }]
    : track;
}

/** The next position on the loop track: forward only; the copy (position `count`) is the end. */
export function nextLoopPosition(position: number, count: number) {
  if (count < 2) return 0;
  return Math.min(position + 1, count);
}
