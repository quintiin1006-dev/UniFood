import type { CafeteriaMenu, ClientCart, MenuProduct } from "../types";
import { findProduct } from "./menu";

/** §6 limits. The backend enforces them again; these only avoid a rejected order. */
export const MAX_PER_PRODUCT = 10;
export const MAX_CART_UNITS = 15;

export const emptyCart = (): ClientCart => ({ cafeteriaId: null, lines: [] });
export const cartCount = (cart: ClientCart) =>
  cart.lines.reduce((total, line) => total + line.quantity, 0);
export const quantityInCart = (cart: ClientCart, productId: string) =>
  cart.lines.find((line) => line.productId === productId)?.quantity ?? 0;

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
          line.productId === productId ? { ...line, quantity } : line,
        )
        .filter((line) => line.quantity > 0)
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

/** Cart lines joined with the current menu; a product that left the menu has none. */
export function cartItems(cart: ClientCart, menu: CafeteriaMenu) {
  return cart.lines.map((line) => ({
    line,
    product: findProduct(menu, line.productId) ?? null,
  }));
}

/** Null when the cart can continue to checkout with this menu. */
export function validateCart(
  cart: ClientCart,
  menu: CafeteriaMenu | null,
): string | null {
  const safe = restoreCart(cart);
  if (!safe.lines.length) return "Agrega al menos un producto a tu carrito.";
  if (!menu || menu.cafeteria.id !== safe.cafeteriaId)
    return "No pudimos revisar el menú de tu cafetería.";
  if (!menu.cafeteria.open) return CLOSED_MESSAGE;
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

/**
 * Browser storage is untrusted: only ids and quantities are kept, never prices, names or
 * identity. Anything corrupt or over the limits restores an empty cart. Products are checked
 * against the menu when the cart is shown, because the menu depends on the cafeteria.
 */
export function restoreCart(value: unknown): ClientCart {
  if (!value || typeof value !== "object") return emptyCart();
  const record = value as Partial<ClientCart>;
  if (
    typeof record.cafeteriaId !== "string" ||
    !ID.test(record.cafeteriaId) ||
    !Array.isArray(record.lines) ||
    record.lines.length > MAX_CART_UNITS
  )
    return emptyCart();
  const ids = new Set<string>();
  const cart: ClientCart = { cafeteriaId: record.cafeteriaId, lines: [] };
  for (const line of record.lines as unknown[]) {
    const item = line as Partial<ClientCart["lines"][number]> | null;
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
  return cart.lines.length && cartCount(cart) <= MAX_CART_UNITS
    ? cart
    : emptyCart();
}
