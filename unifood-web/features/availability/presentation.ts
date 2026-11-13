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
