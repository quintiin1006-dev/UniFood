// Test checkout only: it never sends an order. PR 2 replaces the pickup hours below.
import type { CafeteriaMenu, ClientCart } from "../types";
import {
  colombiaTime,
  COLOMBIA_TIME_ZONE,
  serviceWindow,
  type MealKind,
} from "./catalog";
import { cartItems, restoreCart, validateCart } from "./cart";

export const PREPARATION_MINUTES = 20;
export const PICKUP_INTERVAL_MINUTES = 30;
const MINUTE = 60_000;
export type PickupSlot = { value: string; label: string; available: boolean };
export type CheckoutSummary = {
  cafeteria: string;
  pickupAt: string;
  total: number;
  payment: "CASH_ON_PICKUP";
  lines: {
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }[];
};
export type CheckoutResult =
  { ok: true; summary: CheckoutSummary } | { ok: false; error: string };
const pickupClock = new Intl.DateTimeFormat("es-CO", {
  timeZone: COLOMBIA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const pickupDay = new Intl.DateTimeFormat("es-CO", {
  timeZone: COLOMBIA_TIME_ZONE,
  day: "numeric",
  month: "short",
});

export function pickupLabel(value: string) {
  const date = new Date(value);
  return `${pickupDay.format(date)} · ${pickupClock.format(date)}`;
}

/** Breakfast hours only when every product is a breakfast; any other mix uses lunch hours. */
export function cartMealKind(
  cart: ClientCart,
  menu: CafeteriaMenu,
): MealKind | null {
  const items = cartItems(restoreCart(cart), menu);
  if (!items.length) return null;
  return items.every(({ product }) => product?.category === "DESAYUNO")
    ? "breakfast"
    : "lunch";
}

/** Preview may use the next service date, but never changes the service's time window. */
export function pickupSlots(
  cart: ClientCart,
  menu: CafeteriaMenu,
  now: Date,
  ignoreServiceHours = false,
): PickupSlot[] {
  const kind = cartMealKind(cart, menu);
  if (!kind) return [];
  const earliest = now.getTime() + PREPARATION_MINUTES * MINUTE;
  const preview = process.env.NODE_ENV === "development" && ignoreServiceHours;
  const [start, end] = serviceWindow(kind);
  const midnight =
    now.getTime() -
    colombiaTime(now).minutes * MINUTE -
    now.getUTCSeconds() * 1000 -
    now.getUTCMilliseconds();
  for (let dayOffset = 0; dayOffset <= (preview ? 1 : 0); dayOffset++) {
    const serviceDate = midnight + dayOffset * 24 * 60 * MINUTE;
    const slots: PickupSlot[] = [];
    for (let minute = start; minute <= end; minute += PICKUP_INTERVAL_MINUTES) {
      const timestamp = serviceDate + minute * MINUTE;
      const value = new Date(timestamp).toISOString();
      slots.push({
        value,
        label: pickupLabel(value),
        available: timestamp >= earliest,
      });
    }
    if (!preview || slots.some((slot) => slot.available)) return slots;
  }
  return [];
}

export function reviewCheckout(
  cart: ClientCart,
  menu: CafeteriaMenu | null,
  pickupAt: string,
  accepted: boolean,
  now: Date,
  ignoreServiceHours = false,
): CheckoutResult {
  const error = validateCart(cart, menu);
  if (error || !menu) return { ok: false, error: error ?? "" };
  if (!accepted)
    return {
      ok: false,
      error: "Acepta las condiciones de recogida para continuar.",
    };
  const slot = pickupSlots(cart, menu, now, ignoreServiceHours).find(
    (item) => item.value === pickupAt && item.available,
  );
  if (!slot)
    return {
      ok: false,
      error:
        "Elige una hora disponible con al menos 20 minutos de preparación.",
    };
  const lines = cartItems(restoreCart(cart), menu).map(({ line, product }) => ({
    id: line.productId,
    name: product!.name,
    quantity: line.quantity,
    unitPrice: product!.price,
  }));
  return {
    ok: true,
    summary: {
      cafeteria: menu.cafeteria.name,
      pickupAt: slot.value,
      payment: "CASH_ON_PICKUP",
      lines,
      total: lines.reduce(
        (total, line) => total + line.quantity * line.unitPrice,
        0,
      ),
    },
  };
}
