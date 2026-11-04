import type { CatalogMeal, ClientMenu, ClientSite, MealKind } from "../types";

/** Fallback for missing images and for hosts next/image is not configured to load. */
const PLACEHOLDER_IMAGE = "/unifood-logo.png";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** The backend's catalog_category values, translated to the client's sections. */
const BACKEND_CATEGORIES: Record<string, { category: string; kind: MealKind }> =
  {
    DESAYUNO: { category: "desayunos", kind: "breakfast" },
    DEL_DIA: { category: "del-dia", kind: "lunch" },
    CORRIENTE: { category: "corriente", kind: "lunch" },
    EJECUTIVO: { category: "ejecutivos", kind: "lunch" },
    ESPECIAL: { category: "especiales", kind: "lunch" },
  };

export const unavailableMenu: ClientMenu = { sites: [], unavailable: true };

/** Category copy is interface text; which dishes belong to a category comes from the backend. */
export const menuCategories = [
  {
    id: "desayunos",
    name: "Desayunos",
    description:
      "Empieza el día con algo rico. Combos completos, recién preparados.",
  },
  {
    id: "almuerzos",
    name: "Almuerzos",
    description: "Encuentra tu plato para la pausa del día.",
  },
  {
    id: "corriente",
    name: "Almuerzo corriente",
    description: "Platos completos para tu pausa del día.",
  },
  {
    id: "ejecutivos",
    name: "Ejecutivos",
    description: "Una pausa con un sabor diferente.",
  },
  {
    id: "especiales",
    name: "Especiales",
    description: "Algo especial para disfrutar con calma.",
  },
] as const;
export type MenuCategory = (typeof menuCategories)[number];

export function findMenuCategory(value: string | string[] | undefined) {
  return menuCategories.find((category) => category.id === value);
}

export function findSite(
  menu: ClientMenu,
  value: string | string[] | undefined,
) {
  return typeof value === "string"
    ? menu.sites.find((site) => site.id === value)
    : undefined;
}

export function siteMenuHref(siteId: string, category: MenuCategory) {
  return `/cuenta/menu?sede=${siteId}&categoria=${category.id}`;
}

export function mealHref(siteId: string, mealId: string) {
  return `/cuenta/producto/${mealId}?sede=${siteId}`;
}

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
const asText = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;
const asStock = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
/** Spring may serialize BigDecimal as a JSON number or as an exact decimal string. */
const asPrice = (value: unknown) => {
  const price =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isFinite(price) && price > 0 ? price : null;
};
/** Only same-origin paths: next/image throws on a remote host it is not configured for. */
const asLocalImage = (value: unknown) => {
  const image = asText(value);
  return image && /^\/(?![/\\])/.test(image) ? image : PLACEHOLDER_IMAGE;
};

type ParsedMeal = { meal: CatalogMeal; cafeteria: string };

function parseMeal(value: unknown): ParsedMeal | null {
  const meal = asRecord(value);
  if (!meal) return null;
  const id = asText(meal.id);
  const name = asText(meal.name);
  const cafeteria = asText(meal.cafeteriaName);
  const section =
    typeof meal.category === "string" &&
    Object.hasOwn(BACKEND_CATEGORIES, meal.category)
      ? BACKEND_CATEGORIES[meal.category]
      : null;
  const price = asPrice(meal.price);
  const stock = asStock(meal.stock);
  if (
    !id ||
    !name ||
    !cafeteria ||
    !section ||
    price === null ||
    stock === null ||
    typeof meal.availableToday !== "boolean"
  )
    return null;
  return {
    cafeteria,
    meal: {
      id,
      kind: section.kind,
      category: section.category,
      name,
      description: typeof meal.description === "string" ? meal.description : "",
      price,
      image: asLocalImage(meal.imageUrl),
      stock,
      // The menu is read per request, so today's availability is all the backend publishes.
      availableDays: meal.availableToday ? EVERY_DAY : [],
    },
  };
}

function parseSite(value: unknown): ClientSite | null {
  const site = asRecord(value);
  if (!site || !Array.isArray(site.meals)) return null;
  const id = asText(site.id);
  const name = asText(site.name);
  const city = asText(site.city);
  if (!id || !name || !city) return null;
  // Malformed dishes are dropped one by one so a single bad row never hides the whole site.
  const parsed = site.meals
    .map(parseMeal)
    .filter((item): item is ParsedMeal => item !== null);
  return {
    id,
    name,
    city,
    image: asLocalImage(site.imageUrl),
    cafeteria: parsed[0]?.cafeteria ?? name,
    meals: parsed.map((item) => item.meal),
  };
}

/** Converts the untrusted backend payload; anything unexpected becomes an unavailable menu. */
export function toClientMenu(payload: unknown): ClientMenu {
  const body = asRecord(payload);
  if (!body || !Array.isArray(body.sites)) return unavailableMenu;
  return {
    sites: body.sites
      .map(parseSite)
      .filter((site): site is ClientSite => site !== null),
    unavailable: false,
  };
}
