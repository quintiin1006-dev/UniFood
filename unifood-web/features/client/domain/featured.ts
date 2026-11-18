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
 * The carousel moves on by itself every ROTATE_MS when there are two or more products and the user
 * has not asked for reduced motion. It cannot be paused.
 */
export function canRotate({
  count,
  reducedMotion,
}: {
  count: number;
  reducedMotion: boolean;
}) {
  return count >= 2 && !reducedMotion;
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
