import type {
  CafeteriaMenu,
  CartLine,
  ClientCart,
  MenuLine,
  MenuProduct,
  ProductLine,
} from "../types";
import { MENU_NONE } from "../types";
import { findProduct } from "./menu";
import type {
  ClientDailyMenu,
  DailyMenuSelection,
  DailyMenuSingle,
} from "../../daily-menu/types";
import { SKIP } from "../../daily-menu/types";
import {
  DAILY_MENU_LINE_CHANGED,
  DAILY_MENU_LINE_UNAVAILABLE,
  DAILY_MENU_PENDING_CHOICE,
} from "../../shared/messages";

/** §6 limits. The backend enforces them again; these only avoid a rejected order. */
export const MAX_PER_PRODUCT = 10;
export const MAX_CART_UNITS = 15;

export const emptyCart = (): ClientCart => ({ cafeteriaId: null, lines: [] });
export const isMenuLine = (line: CartLine): line is MenuLine =>
  line.kind === "menu";
export const productLines = (cart: ClientCart): ProductLine[] =>
  cart.lines.filter((line): line is ProductLine => !isMenuLine(line));
/** The one daily menu plate of the cart, if any. */
export const menuLine = (cart: ClientCart): MenuLine | null =>
  cart.lines.find(isMenuLine) ?? null;
/** The plate counts as 1 unit of the 15; its additions do not count. */
export const cartCount = (cart: ClientCart) =>
  cart.lines.reduce(
    (total, line) => total + (isMenuLine(line) ? 1 : line.quantity),
    0,
  );
export const quantityInCart = (cart: ClientCart, productId: string) =>
  productLines(cart).find((line) => line.productId === productId)?.quantity ??
  0;

export type CartResult = { cart: ClientCart; error?: string };

export const OTHER_CAFETERIA_MESSAGE =
  "Tu carrito tiene productos de otra cafetería. Vacíalo antes de cambiar.";
export const CLOSED_MESSAGE =
  "La cafetería está cerrada por ahora. Podrás pedir cuando abra.";
export const UNAVAILABLE_MESSAGE =
  "Este producto no está disponible por ahora.";
export const PER_PRODUCT_MESSAGE = `Puedes pedir hasta ${MAX_PER_PRODUCT} unidades de cada producto.`;
export const TOTAL_MESSAGE = `Tu pedido admite hasta ${MAX_CART_UNITS} unidades en total.`;

/** Why a product cannot be ordered right now, or null when it can. */
export function orderBlocker(menu: CafeteriaMenu, product: MenuProduct) {
  if (!menu.cafeteria.open) return CLOSED_MESSAGE;
  if (!product.available) return UNAVAILABLE_MESSAGE;
  return null;
}

/** The highest quantity this product may have in the cart, given the other lines. */
export function maxQuantity(cart: ClientCart, productId: string) {
  const others = cartCount(cart) - quantityInCart(cart, productId);
  return Math.max(0, Math.min(MAX_PER_PRODUCT, MAX_CART_UNITS - others));
}

/**
 * Sets a product's quantity (0 removes it). Raising it checks the current menu again;
 * lowering it is always allowed, so a stale line can still be reduced or removed.
 */
export function setQuantity(
  cart: ClientCart,
  menu: CafeteriaMenu | null,
  productId: string,
  quantity: number,
): CartResult {
  const fail = (error: string) => ({ cart, error });
  if (!Number.isInteger(quantity) || quantity < 0)
    return fail("Elige una cantidad válida.");
  const current = quantityInCart(cart, productId);
  if (quantity > current) {
    if (!menu) return fail("Espera a que cargue el menú.");
    if (cart.lines.length && cart.cafeteriaId !== menu.cafeteria.id)
      return fail(OTHER_CAFETERIA_MESSAGE);
    const product = findProduct(menu, productId);
    if (!product) return fail(UNAVAILABLE_MESSAGE);
    const blocker = orderBlocker(menu, product);
    if (blocker) return fail(blocker);
    if (quantity > MAX_PER_PRODUCT) return fail(PER_PRODUCT_MESSAGE);
    if (quantity > maxQuantity(cart, productId)) return fail(TOTAL_MESSAGE);
  }
  const lines = current
    ? cart.lines
        .map((line) =>
          !isMenuLine(line) && line.productId === productId
            ? { ...line, quantity }
            : line,
        )
        .filter((line) => isMenuLine(line) || line.quantity > 0)
    : quantity > 0
      ? [...cart.lines, { productId, quantity }]
      : cart.lines;
  if (!lines.length) return { cart: emptyCart() };
  return {
    cart: { cafeteriaId: cart.cafeteriaId ?? menu!.cafeteria.id, lines },
  };
}

export function addProduct(
  cart: ClientCart,
  menu: CafeteriaMenu,
  productId: string,
  quantity: number,
): CartResult {
  if (!Number.isInteger(quantity) || quantity < 1)
    return { cart, error: "Elige una cantidad válida." };
  return setQuantity(
    cart,
    menu,
    productId,
    quantityInCart(cart, productId) + quantity,
  );
}

/** Product lines joined with the current menu; a product that left the menu has none. */
export function cartItems(cart: ClientCart, menu: CafeteriaMenu) {
  return productLines(cart).map((line) => ({
    line,
    product: findProduct(menu, line.productId) ?? null,
  }));
}

const singles = (daily: ClientDailyMenu) =>
  daily.categories.filter(
    (category): category is DailyMenuSingle => category.kind === "SINGLE",
  );
const additionIdsOf = (daily: ClientDailyMenu) =>
  daily.categories.flatMap((category) =>
    category.kind === "ADDITIONS" ? category.additions.map(({ id }) => id) : [],
  );

export type MenuLineStatus = "ok" | "unavailable" | "changed";

/**
 * Whether the plate still matches today's published menu. «unavailable»: there is no menu
 * for this cafeteria and day (unpublished, flag off, another day). «changed»: an option,
 * addition or category is gone or new. Never a silent substitution: the client chooses again.
 */
export function menuLineStatus(
  line: MenuLine,
  daily: ClientDailyMenu | null,
  cafeteriaId: string | null,
): MenuLineStatus {
  if (
    !daily ||
    daily.cafeteria.id !== cafeteriaId ||
    daily.businessDate !== line.businessDate
  )
    return "unavailable";
  const expected = [
    ...singles(daily).map(({ id }) => id),
    ...daily.hiddenSkips,
  ];
  const chosen = Object.keys(line.choices);
  if (
    chosen.length !== expected.length ||
    chosen.some((id) => !expected.includes(id))
  )
    return "changed";
  for (const category of singles(daily)) {
    const value = line.choices[category.id];
    const valid =
      value === MENU_NONE
        ? category.canSkip
        : category.options.some(({ id }) => id === value);
    if (!valid) return "changed";
  }
  if (daily.hiddenSkips.some((id) => line.choices[id] !== MENU_NONE))
    return "changed";
  const additions = additionIdsOf(daily);
  if (line.additionIds.some((id) => !additions.includes(id))) return "changed";
  return "ok";
}

/** The plate's amount with today's published prices, for display only. */
export function menuLineAmount(line: MenuLine, daily: ClientDailyMenu) {
  const extras = daily.categories.flatMap((category) =>
    category.kind === "ADDITIONS" ? category.additions : [],
  );
  return line.additionIds.reduce(
    (sum, id) =>
      sum + (extras.find((addition) => addition.id === id)?.extraPrice ?? 0),
    daily.price,
  );
}

/** The card's selection for a plate already in the cart (its «Actualizar carrito» state). */
export function selectionFromLine(line: MenuLine): DailyMenuSelection {
  return {
    choices: Object.fromEntries(
      Object.entries(line.choices).map(([id, value]) => [
        id,
        value === MENU_NONE ? SKIP : value,
      ]),
    ),
    additionIds: [...line.additionIds],
  };
}

/**
 * Puts the plate in the cart, replacing the one already there (one plate per cart). The
 * selection must be complete for today's menu; only ids are kept, never prices.
 */
export function setMenuLine(
  cart: ClientCart,
  daily: ClientDailyMenu,
  selection: DailyMenuSelection,
): CartResult {
  const fail = (error: string) => ({ cart, error });
  if (cart.lines.length && cart.cafeteriaId !== daily.cafeteria.id)
    return fail(OTHER_CAFETERIA_MESSAGE);
  if (!daily.cafeteria.open) return fail(CLOSED_MESSAGE);
  const choices: Record<string, string> = {};
  for (const category of singles(daily)) {
    const value = selection.choices[category.id];
    if (value === SKIP && category.canSkip) choices[category.id] = MENU_NONE;
    else if (value && category.options.some(({ id }) => id === value))
      choices[category.id] = value;
    else return fail(DAILY_MENU_PENDING_CHOICE);
  }
  for (const id of daily.hiddenSkips) choices[id] = MENU_NONE;
  const available = additionIdsOf(daily);
  const additionIds = [...new Set(selection.additionIds)].filter((id) =>
    available.includes(id),
  );
  const others = cart.lines.filter((line) => !isMenuLine(line));
  if (cartCount({ ...cart, lines: others }) + 1 > MAX_CART_UNITS)
    return fail(TOTAL_MESSAGE);
  const line: MenuLine = {
    kind: "menu",
    businessDate: daily.businessDate,
    choices,
    additionIds,
  };
  return {
    cart: { cafeteriaId: daily.cafeteria.id, lines: [...others, line] },
  };
}

/** Removes the plate; an empty cart forgets its cafeteria. */
export function removeMenuLine(cart: ClientCart): ClientCart {
  const lines = cart.lines.filter((line) => !isMenuLine(line));
  return lines.length ? { ...cart, lines } : emptyCart();
}

/**
 * Null when the cart can continue to checkout with this menu. `daily` is today's published
 * daily menu (null when there is none); a plate that does not match it blocks the payment.
 */
export function validateCart(
  cart: ClientCart,
  menu: CafeteriaMenu | null,
  daily: ClientDailyMenu | null = null,
): string | null {
  const safe = restoreCart(cart);
  if (!safe.lines.length) return "Agrega al menos un producto a tu carrito.";
  if (!menu || menu.cafeteria.id !== safe.cafeteriaId)
    return "No pudimos revisar el menú de tu cafetería.";
  if (!menu.cafeteria.open) return CLOSED_MESSAGE;
  const plate = menuLine(safe);
  if (plate) {
    const status = menuLineStatus(plate, daily, safe.cafeteriaId);
    if (status === "unavailable") return DAILY_MENU_LINE_UNAVAILABLE;
    if (status === "changed") return DAILY_MENU_LINE_CHANGED;
  }
  for (const { line, product } of cartItems(safe, menu)) {
    if (!product)
      return "Un producto de tu carrito ya no está en el menú. Retíralo para continuar.";
    if (!product.available)
      return `${product.name} no está disponible por ahora. Retíralo para continuar.`;
    if (line.quantity > MAX_PER_PRODUCT)
      return `${product.name}: ${PER_PRODUCT_MESSAGE}`;
  }
  if (cartCount(safe) > MAX_CART_UNITS) return TOTAL_MESSAGE;
  return null;
}

const ID = /^[A-Za-z0-9-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Far above any real menu: a handful of categories and additions. */
const MAX_MENU_IDS = 20;

/** A stored plate rebuilt from its ids only, or null when its shape is not understood. */
function restoreMenuLine(value: Record<string, unknown>): MenuLine | null {
  const { businessDate, choices, additionIds } = value;
  if (typeof businessDate !== "string" || !DATE.test(businessDate)) return null;
  if (!choices || typeof choices !== "object" || Array.isArray(choices))
    return null;
  const entries = Object.entries(choices as Record<string, unknown>);
  if (!entries.length || entries.length > MAX_MENU_IDS) return null;
  const kept: Record<string, string> = {};
  for (const [categoryId, optionId] of entries) {
    if (
      !UUID.test(categoryId) ||
      typeof optionId !== "string" ||
      (optionId !== MENU_NONE && !UUID.test(optionId))
    )
      return null;
    kept[categoryId] = optionId;
  }
  if (
    !Array.isArray(additionIds) ||
    additionIds.length > MAX_MENU_IDS ||
    additionIds.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    new Set(additionIds).size !== additionIds.length
  )
    return null;
  return {
    kind: "menu",
    businessDate,
    choices: kept,
    additionIds: [...(additionIds as string[])],
  };
}

/**
 * Browser storage is untrusted: only ids and quantities are kept, never prices, names or
 * identity. A corrupt product line or one over the limits restores an empty cart. A line with
 * a `kind` the cart does not understand, a malformed plate or a second plate is dropped on its
 * own. Products and the plate are checked against the menus when the cart is shown.
 */
export function restoreCart(value: unknown): ClientCart {
  if (!value || typeof value !== "object") return emptyCart();
  const record = value as Partial<ClientCart>;
  if (
    typeof record.cafeteriaId !== "string" ||
    !ID.test(record.cafeteriaId) ||
    !Array.isArray(record.lines) ||
    record.lines.length > MAX_CART_UNITS + 1
  )
    return emptyCart();
  const ids = new Set<string>();
  const cart: ClientCart = { cafeteriaId: record.cafeteriaId, lines: [] };
  let plate: MenuLine | null = null;
  let plates = 0;
  for (const line of record.lines as unknown[]) {
    if (line && typeof line === "object" && "kind" in line) {
      if ((line as { kind?: unknown }).kind === "menu" && plates++ === 0)
        plate = restoreMenuLine(line as Record<string, unknown>);
      continue;
    }
    const item = line as Partial<ProductLine> | null;
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.productId !== "string" ||
      !ID.test(item.productId) ||
      ids.has(item.productId) ||
      !Number.isInteger(item.quantity) ||
      item.quantity! < 1 ||
      item.quantity! > MAX_PER_PRODUCT
    )
      return emptyCart();
    ids.add(item.productId);
    cart.lines.push({ productId: item.productId, quantity: item.quantity! });
  }
  // One plate per cart: with two, neither is trusted.
  if (plate && plates === 1) cart.lines.push(plate);
  return cart.lines.length && cartCount(cart) <= MAX_CART_UNITS
    ? cart
    : emptyCart();
}
