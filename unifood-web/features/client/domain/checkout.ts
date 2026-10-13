import type { ClientCart } from "../types";
import { findDemoSite, getSiteMeals } from "../mocks/catalog";
import { colombiaTime, COLOMBIA_TIME_ZONE, serviceWindow } from "./catalog";
import { cartMealKind, restoreCart, validateCart } from "./cart";

export const PREPARATION_MINUTES = 20;
export const PICKUP_INTERVAL_MINUTES = 30;
const MINUTE = 60_000;
export type PickupSlot = { value: string; label: string; available: boolean };
export type CheckoutSummary = {
  siteName: string;
  cafeteria: string;
  pickupAt: string;
  total: number;
  payment: "CASH_ON_PICKUP";
  lines: {
    id: string;
    name: string;
    quantity: number;
    notes: string;
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

/** Preview may use the next service date, but never changes the service's time window. */
export function pickupSlots(
  cart: ClientCart,
  now: Date,
  ignoreServiceHours = false,
): PickupSlot[] {
  const safe = restoreCart(cart);
  const site = findDemoSite(safe.siteId ?? undefined);
  if (!site || !safe.lines.length) return [];
  const kind = cartMealKind(safe);
  if (!kind) return [];
  const earliest = now.getTime() + PREPARATION_MINUTES * MINUTE;
  const preview = process.env.NODE_ENV === "development" && ignoreServiceHours;
  const meals = getSiteMeals(site);
  const selectedMeals = safe.lines.map((line) =>
    meals.find((meal) => meal.id === line.mealId)!,
  );
  const [start, end] = serviceWindow(kind);
  const midnight =
    now.getTime() -
    colombiaTime(now).minutes * MINUTE -
    now.getUTCSeconds() * 1000 -
    now.getUTCMilliseconds();
  for (let dayOffset = 0; dayOffset <= (preview ? 7 : 0); dayOffset++) {
    const serviceDate = midnight + dayOffset * 24 * 60 * MINUTE;
    const weekday = colombiaTime(new Date(serviceDate)).day;
    if (!selectedMeals.every((meal) => meal.availableDays.includes(weekday)))
      continue;
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
  pickupAt: string,
  accepted: boolean,
  now: Date,
  ignoreServiceHours = false,
): CheckoutResult {
  const error = validateCart(cart, now, ignoreServiceHours);
  if (error) return { ok: false, error };
  if (!accepted)
    return {
      ok: false,
      error: "Acepta las condiciones de recogida para continuar.",
    };
  const slot = pickupSlots(cart, now, ignoreServiceHours).find(
    (item) => item.value === pickupAt && item.available,
  );
  if (!slot)
    return {
      ok: false,
      error:
        "Elige una hora disponible con al menos 20 minutos de preparación.",
    };
  const safe = restoreCart(cart);
  const site = findDemoSite(safe.siteId!)!;
  const meals = getSiteMeals(site);
  const lines = safe.lines.map((line) => {
    const meal = meals.find((item) => item.id === line.mealId)!;
    return {
      id: line.id,
      name: meal.name,
      quantity: line.quantity,
      notes: line.notes,
      unitPrice: meal.price,
    };
  });
  return {
    ok: true,
    summary: {
      siteName: site.name,
      cafeteria: site.cafeteria,
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
