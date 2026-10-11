import { findDemoSite, getSiteMeals } from "../mocks/catalog";
import type { ClientCart, MealKind } from "../types";
import { MAX_CART_MEALS, NOTES_LIMIT, mealAvailability } from "./catalog";

export const emptyCart = (): ClientCart => ({ siteId: null, lines: [] });
export const cartCount = (cart: ClientCart) =>
  cart.lines.reduce((total, line) => total + line.quantity, 0);
export type CartResult = { cart: ClientCart; error?: string };
export const MIXED_MEALS_MESSAGE =
  "Los desayunos y los almuerzos deben pedirse por separado. Retira un tipo de comida del carrito para continuar.";

/** A null kind identifies an empty or mixed cart, including carts saved before this rule. */
export function cartMealKind(cart: ClientCart): MealKind | null {
  const site = findDemoSite(cart.siteId ?? undefined);
  if (!site || !cart.lines.length) return null;
  const meals = getSiteMeals(site);
  const kinds = new Set(
    cart.lines.map(
      (line) => meals.find((meal) => meal.id === line.mealId)?.kind,
    ),
  );
  return kinds.size === 1 ? ([...kinds][0] ?? null) : null;
}

/** Reducing a stale line is allowed; increasing it checks current availability again. */
export function updateMeal(
  cart: ClientCart,
  lineId: string,
  changes: Partial<Pick<ClientCart["lines"][number], "quantity" | "notes">>,
  now: Date,
  ignoreServiceHours = false,
): CartResult {
  const fail = (error: string) => ({ cart, error });
  const line = cart.lines.find((item) => item.id === lineId);
  if (!line)
    return fail(
      "Este plato ya no está en el carrito. Revisa el contenido actual.",
    );
  const quantity = changes.quantity ?? line.quantity;
  const notes = changes.notes ?? line.notes;
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    cartCount(cart) - line.quantity + quantity > MAX_CART_MEALS
  )
    return fail("Puedes agregar hasta 3 platos completos por pedido.");
  if (notes.length > NOTES_LIMIT)
    return fail(`Las observaciones admiten hasta ${NOTES_LIMIT} caracteres.`);
  if (quantity > line.quantity) {
    const remaining = {
      ...cart,
      lines: cart.lines.filter((item) => item.id !== lineId),
    };
    const result = addMeal(
      remaining,
      cart.siteId ?? "",
      line.mealId,
      quantity,
      notes,
      now,
      lineId,
      ignoreServiceHours,
    );
    if (result.error) return fail(result.error);
  }
  const lines: ClientCart["lines"] = [];
  for (const item of cart.lines) {
    const next =
      item.id === lineId ? { ...item, quantity, notes: notes.trim() } : item;
    const matching = lines.find(
      (entry) => entry.mealId === next.mealId && entry.notes === next.notes,
    );
    if (matching) matching.quantity += next.quantity;
    else lines.push({ ...next });
  }
  return { cart: { ...cart, lines } };
}

export function validateCart(
  cart: ClientCart,
  now: Date,
  ignoreServiceHours = false,
): string | null {
  const safe = restoreCart(cart);
  const site = findDemoSite(safe.siteId ?? undefined);
  if (!site || !safe.lines.length)
    return "Agrega al menos un plato válido a tu carrito.";
  const meals = getSiteMeals(site);
  if (!cartMealKind(safe)) return MIXED_MEALS_MESSAGE;
  for (const line of safe.lines) {
    const meal = meals.find((item) => item.id === line.mealId)!;
    const availability = mealAvailability(
      meal,
      site.id,
      now,
      ignoreServiceHours,
    );
    if (!availability.open) return `${meal.name}: ${availability.reason}.`;
    const quantity = safe.lines
      .filter((item) => item.mealId === meal.id)
      .reduce((total, item) => total + item.quantity, 0);
    if (quantity > meal.stock)
      return `${meal.name}: quedan ${meal.stock} unidades. Ajusta la cantidad.`;
  }
  return null;
}

export function addMeal(
  cart: ClientCart,
  siteId: string,
  mealId: string,
  quantity: number,
  notes: string,
  now: Date,
  lineId: string,
  ignoreServiceHours = false,
): CartResult {
  const fail = (error: string) => ({ cart, error });
  const site = findDemoSite(siteId);
  const meal = site && getSiteMeals(site).find((item) => item.id === mealId);
  if (!meal) return fail("Este plato ya no está disponible.");
  if (cart.lines.length && cart.siteId !== siteId)
    return fail("Vacía tu carrito antes de cambiar de cafetería.");
  if (cart.lines.length && cartMealKind(cart) !== meal.kind)
    return fail(MIXED_MEALS_MESSAGE);
  const availability = mealAvailability(meal, siteId, now, ignoreServiceHours);
  if (!availability.open) return fail(availability.reason);
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity + cartCount(cart) > MAX_CART_MEALS
  )
    return fail("Puedes agregar hasta 3 platos completos por pedido.");
  if (notes.length > NOTES_LIMIT)
    return fail(`Las observaciones admiten hasta ${NOTES_LIMIT} caracteres.`);
  const existingQuantity = cart.lines
    .filter((line) => line.mealId === mealId)
    .reduce((total, line) => total + line.quantity, 0);
  if (existingQuantity + quantity > meal.stock)
    return fail("No hay suficientes unidades disponibles.");
  const trimmed = notes.trim();
  const matching = cart.lines.find(
    (line) => line.mealId === mealId && line.notes === trimmed,
  );
  return {
    cart: {
      siteId,
      lines: matching
        ? cart.lines.map((line) =>
            line.id === matching.id
              ? { ...line, quantity: line.quantity + quantity }
              : line,
          )
        : [...cart.lines, { id: lineId, mealId, quantity, notes: trimmed }],
    },
  };
}

/** Treat browser storage as untrusted. Never persist or accept prices or identity fields. */
export function restoreCart(value: unknown): ClientCart {
  if (!value || typeof value !== "object") return emptyCart();
  const record = value as Partial<ClientCart>;
  const site =
    typeof record.siteId === "string" ? findDemoSite(record.siteId) : undefined;
  if (
    !site ||
    !Array.isArray(record.lines) ||
    record.lines.length > MAX_CART_MEALS
  )
    return emptyCart();
  const meals = getSiteMeals(site);
  const ids = new Set<string>();
  const cart = emptyCart();
  cart.siteId = site.id;
  for (const line of record.lines) {
    if (
      !line ||
      typeof line !== "object" ||
      typeof line.id !== "string" ||
      line.id.length > 80 ||
      ids.has(line.id) ||
      typeof line.mealId !== "string" ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_CART_MEALS ||
      typeof line.notes !== "string" ||
      line.notes.length > NOTES_LIMIT ||
      !meals.some((meal) => meal.id === line.mealId)
    )
      return emptyCart();
    ids.add(line.id);
    cart.lines.push({
      id: line.id,
      mealId: line.mealId,
      quantity: line.quantity,
      notes: line.notes,
    });
  }
  return cartCount(cart) <= MAX_CART_MEALS && cart.lines.length
    ? cart
    : emptyCart();
}
