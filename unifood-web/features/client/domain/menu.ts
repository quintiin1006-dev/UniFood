import type {
  CafeteriaMenu,
  ContextCafeteria,
  MenuCategory,
  MenuCategoryId,
  MenuProduct,
} from "../types";

/** The §6 filters, in order. Labels are interface text; contents come from the backend. */
export const menuCategories: readonly {
  id: MenuCategoryId;
  slug: string;
  name: string;
}[] = [
  { id: "DEL_DIA", slug: "del-dia", name: "Del día" },
  { id: "DESAYUNO", slug: "desayunos", name: "Desayunos" },
  { id: "CORRIENTE", slug: "corriente", name: "Corriente" },
  { id: "EJECUTIVO", slug: "ejecutivo", name: "Ejecutivo" },
  { id: "ESPECIAL", slug: "especial", name: "Especial" },
  { id: "BEBIDA", slug: "bebidas", name: "Bebidas" },
];
export const CLOSED_NOTICE =
  "La cafetería está cerrada por ahora. Puedes ver el menú, pero no hacer pedidos hasta que abra.";
/** §6 compact line for a category without available products. */
export const EMPTY_CATEGORY =
  "No hay productos disponibles de esta categoría por el momento";

const CATEGORY_IDS = new Set<string>(menuCategories.map(({ id }) => id));

export function categoryName(id: MenuCategoryId) {
  return menuCategories.find((category) => category.id === id)!.name;
}
export function findCategoryBySlug(value: string | string[] | undefined) {
  return typeof value === "string"
    ? menuCategories.find((category) => category.slug === value)
    : undefined;
}
export function menuHref(cafeteriaId: string, slug?: string) {
  const query = new URLSearchParams({ cafeteria: cafeteriaId });
  if (slug) query.set("categoria", slug);
  return `/cuenta/menu?${query}`;
}
export function productHref(cafeteriaId: string, productId: string) {
  return `/cuenta/producto/${encodeURIComponent(productId)}?cafeteria=${encodeURIComponent(cafeteriaId)}`;
}

export function menuProducts(menu: CafeteriaMenu): MenuProduct[] {
  return menu.categories.flatMap((category) => category.products);
}
export function findProduct(menu: CafeteriaMenu, productId: string) {
  return menuProducts(menu).find((product) => product.id === productId);
}
/** A product can be ordered only if it is available and its cafeteria is open today. */
export function canOrder(menu: CafeteriaMenu, product: MenuProduct) {
  return menu.cafeteria.open && product.available;
}

type Json = Record<string, unknown>;
export const asRecord = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
export const asText = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : null;
/** Spring serializes BigDecimal as an exact decimal string; a JSON number is accepted too. */
export const asPrice = (value: unknown) => {
  const price =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isFinite(price) && price > 0 ? price : null;
};

export function parseCafeteria(value: unknown): ContextCafeteria | null {
  const cafeteria = asRecord(value);
  if (!cafeteria) return null;
  const id = asText(cafeteria.id);
  const name = asText(cafeteria.name);
  if (!id || !name || typeof cafeteria.open !== "boolean") return null;
  return { id, name, open: cafeteria.open };
}

function parseProduct(
  value: unknown,
  category: MenuCategoryId,
): MenuProduct | null {
  const product = asRecord(value);
  if (!product) return null;
  const id = asText(product.id);
  const name = asText(product.name);
  const price = asPrice(product.price);
  if (!id || !name || price === null || typeof product.available !== "boolean")
    return null;
  return {
    id,
    name,
    description: asText(product.description),
    price,
    available: product.available,
    category,
  };
}

function parseCategory(value: unknown): MenuCategory | null {
  const category = asRecord(value);
  if (
    !category ||
    typeof category.id !== "string" ||
    !CATEGORY_IDS.has(category.id) ||
    !Array.isArray(category.products)
  )
    return null;
  const id = category.id as MenuCategoryId;
  // Malformed products are dropped one by one so a single bad row never hides the category.
  const products = category.products
    .map((product) => parseProduct(product, id))
    .filter((product): product is MenuProduct => product !== null);
  return products.length ? { id, products } : null;
}

/**
 * Converts the untrusted backend payload. Anything unexpected at the top level returns null,
 * which the screens show as a retryable error. Categories keep the §6 order.
 */
export function toCafeteriaMenu(payload: unknown): CafeteriaMenu | null {
  const body = asRecord(payload);
  if (!body || !Array.isArray(body.categories)) return null;
  const cafeteria = parseCafeteria(body.cafeteria);
  const businessDate = asText(body.businessDate);
  if (!cafeteria || !businessDate) return null;
  const parsed = body.categories
    .map(parseCategory)
    .filter((category): category is MenuCategory => category !== null);
  // A repeated category id or product id is a malformed payload: keep the first one.
  const seenProducts = new Set<string>();
  const categories = menuCategories
    .map(({ id }) => parsed.find((category) => category.id === id))
    .filter((category): category is MenuCategory => !!category)
    .map((category) => ({
      ...category,
      products: category.products.filter((product) => {
        if (seenProducts.has(product.id)) return false;
        seenProducts.add(product.id);
        return true;
      }),
    }))
    .filter((category) => category.products.length > 0);
  return {
    // The closed state wins: a closed cafeteria never offers products, whatever each says.
    cafeteria,
    businessDate,
    categories: cafeteria.open
      ? categories
      : categories.map((category) => ({
          ...category,
          products: category.products.map((product) => ({
            ...product,
            available: false,
          })),
        })),
  };
}
