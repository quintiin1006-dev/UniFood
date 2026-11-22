import {
  DAILY_MENU_ADDITIONS_LABEL,
  DAILY_MENU_SKIP,
} from "../shared/messages";

/**
 * The daily menu chosen in an order (docs/propuesta-menu-dinamico.md 3.5): `dailyMenu` of
 * ClientOrderResponse (prices as decimal strings, "9500.00") and of the worker's OrderResponse
 * (prices as numbers). Both are read here, in one place, to numbers.
 */
export type OrderPlateChoice = {
  category: string;
  kind: "OPTION" | "NONE" | "ADDITION";
  /** null only for «Ninguna». */
  label: string | null;
  /** Only additions carry it. */
  extraPrice: number | null;
};
export type OrderPlate = {
  title: string;
  price: number;
  choices: OrderPlateChoice[];
};

const DECIMAL = /^\d{1,9}(\.\d{1,2})?$/;
const KINDS: readonly string[] = ["OPTION", "NONE", "ADDITION"];

/** A price as either form of the contract; null for anything else. */
export function readPrice(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && DECIMAL.test(value)) return Number(value);
  return null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function readChoice(raw: unknown): OrderPlateChoice | null {
  const choice = record(raw);
  if (!choice || !text(choice.category)) return null;
  if (typeof choice.kind !== "string" || !KINDS.includes(choice.kind))
    return null;
  const kind = choice.kind as OrderPlateChoice["kind"];
  if (kind === "NONE")
    return { category: choice.category, kind, label: null, extraPrice: null };
  if (!text(choice.label)) return null;
  if (kind === "OPTION")
    return {
      category: choice.category,
      kind,
      label: choice.label,
      extraPrice: null,
    };
  const extra = readPrice(choice.extraPrice);
  if (extra === null) return null;
  return {
    category: choice.category,
    kind,
    label: choice.label,
    extraPrice: extra,
  };
}

/**
 * `dailyMenu` of an order, or null when it is absent, null or not the contract. An order
 * without a plate (or an old one) is then drawn exactly as before.
 */
export function toOrderPlate(raw: unknown): OrderPlate | null {
  const menu = record(raw);
  if (!menu || !text(menu.title) || !Array.isArray(menu.choices)) return null;
  const price = readPrice(menu.price);
  if (price === null) return null;
  const choices: OrderPlateChoice[] = [];
  for (const entry of menu.choices) {
    const choice = readChoice(entry);
    if (!choice) return null;
    choices.push(choice);
  }
  return { title: menu.title, price, choices };
}

export type PlateSummary = {
  title: string;
  price: number;
  /** One per SINGLE category, in the order they came: «Proteína: Pollo a la plancha». */
  lines: { category: string; value: string }[];
  /** Every addition, together in one line at the end; null without additions. */
  additions: {
    category: string;
    items: { label: string; extraPrice: number }[];
  } | null;
};

/** The kitchen ticket of the plate: «Ninguna» shows whenever the client chose it. */
export function plateSummary(plate: OrderPlate): PlateSummary {
  const lines: PlateSummary["lines"] = [];
  const items: { label: string; extraPrice: number }[] = [];
  let additionsCategory: string | null = null;
  for (const choice of plate.choices) {
    if (choice.kind === "ADDITION") {
      additionsCategory ??= choice.category;
      items.push({
        label: choice.label ?? "",
        extraPrice: choice.extraPrice ?? 0,
      });
    } else
      lines.push({
        category: choice.category,
        value: choice.kind === "NONE" ? DAILY_MENU_SKIP : (choice.label ?? ""),
      });
  }
  return {
    title: plate.title,
    price: plate.price,
    lines,
    additions: items.length
      ? { category: additionsCategory ?? DAILY_MENU_ADDITIONS_LABEL, items }
      : null,
  };
}

/**
 * Units of a client history row. A plate-only order has no order_items rows (the plate lives in
 * order_daily_menus), so its itemCount is 0: then no count is shown, only the total. Never
 * «0 unidades».
 */
export function historyUnitsText(itemCount: number): string | null {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0) return null;
  return `${itemCount} ${itemCount === 1 ? "unidad" : "unidades"}`;
}

/**
 * The units line of an order in the worker's detail: «1 plato» or «1 plato y 2 unidades» when it
 * carries the daily menu plate; without one, exactly as before («0 unidades» included).
 */
export function orderUnitsText(units: number, hasPlate: boolean): string {
  const unitsLabel = `${units} ${units === 1 ? "unidad" : "unidades"}`;
  if (!hasPlate) return unitsLabel;
  return units > 0 ? `1 plato y ${unitsLabel}` : "1 plato";
}

/** «No hay productos registrados» only for an order with neither products nor a plate. */
export const showsNoProducts = (order: {
  items: readonly unknown[];
  dailyMenu?: OrderPlate | null;
}) => order.items.length === 0 && !order.dailyMenu;
