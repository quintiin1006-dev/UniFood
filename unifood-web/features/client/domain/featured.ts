import type { CafeteriaMenu, MenuProduct } from "../types";
import { menuProducts } from "./menu";

/** Time each slide stays on screen before the carousel moves on (ola 4). */
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

export type CarouselPauses = {
  /** Mouse over the carousel. */
  hover: boolean;
  /** Keyboard or any focus inside the carousel. */
  focus: boolean;
  /** A finger or the mouse is pressed on it (swipe in progress). */
  touch: boolean;
  /** The user pressed the pause button. */
  user: boolean;
};

export function isPaused(pauses: CarouselPauses) {
  return pauses.hover || pauses.focus || pauses.touch || pauses.user;
}

/**
 * Automatic rotation runs only with two or more slides, when the user has not asked for less motion
 * and nothing is pausing it. With reduced motion the carousel stays still and the controls move it.
 */
export function canRotate({
  count,
  reducedMotion,
  paused,
}: {
  count: number;
  reducedMotion: boolean;
  paused: boolean;
}) {
  return count >= 2 && !reducedMotion && !paused;
}
