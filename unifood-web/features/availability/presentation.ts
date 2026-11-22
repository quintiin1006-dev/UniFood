import type { TodayAvailability } from "./types";
const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
export const formatAvailabilityPrice = (price: number) => pesos.format(price);
const months = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
export const formatBusinessDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${Number(day)} de ${months[Number(month) - 1]} de ${year}`;
};

// No remote origins are configured yet. Never make Next optimize an arbitrary URL.
export function productImageSource(image: string | null): string | null {
  if (
    !image ||
    !/^\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:png|jpe?g|webp|avif|gif)$/i.test(
      image,
    ) ||
    image.split("/").some((part) => part === "." || part === "..")
  )
    return null;
  return image;
}

/**
 * docs/decisiones.md §2: the panel warns when the cafeteria is open without any product
 * available. It is derived from what the worker sees, so it stays while the situation lasts
 * and goes away as soon as one product is marked available. No confirmation before opening.
 * An administratively inactive cafeteria is hidden from clients, so it gets no warning.
 */
export function openWithoutAvailableProducts(data: TodayAvailability): boolean {
  return (
    data.cafeteria.active &&
    data.cafeteria.open &&
    !data.categories.some((group) => group.items.some((item) => item.available))
  );
}

export const OPEN_WITHOUT_PRODUCTS_MESSAGE =
  "La cafetería está abierta, pero no hay productos disponibles. Los clientes verán el menú, pero no podrán pedir. Marca al menos un producto como disponible.";

/** The editor states the panel needs (features/daily-menu/editor.ts, EditorSnapshot). */
export type DailyMenuEditorView = {
  status: "loading" | "ready" | "hidden" | "error";
  day: { published: boolean; complete: boolean } | null;
};

/**
 * Whether the catalogue's «Del día» section is drawn (docs/propuesta-menu-dinamico.md 4.3). The
 * daily menu editor takes its place only while it is active: hidden (flag off, 401/403/404) or
 * failed, «Del día» is drawn as today. While the editor loads for the first time its skeleton
 * holds the place and «Del día» waits, so it never flickers. Ready, «Del día» gives way when it
 * has no products, or when today's menu is published and complete; a draft menu with «Del día»
 * products keeps them on screen.
 */
export function showDelDiaSection(
  editor: DailyMenuEditorView,
  delDiaItems: number,
): boolean {
  if (editor.status === "loading") return false;
  if (editor.status !== "ready" || !editor.day) return true;
  if (delDiaItems === 0) return false;
  return !(editor.day.published && editor.day.complete);
}

/** The catalogue sections in the panel's order, without «Del día» when the editor holds it. */
export const panelCategories = <T extends { category: string }>(
  categories: readonly T[],
  showDelDia: boolean,
): T[] =>
  categories.filter(({ category }) => showDelDia || category !== "DEL_DIA");
