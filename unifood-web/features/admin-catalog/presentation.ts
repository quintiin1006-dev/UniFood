import { validCatalogPrice } from "./contracts";
import type { AdminProduct, CatalogFilters } from "./types";

// Round cents for presentation using integer arithmetic; the original exact value stays in the contract.
export function formatCatalogPrice(value: string): string {
  if (!validCatalogPrice(value)) throw new Error("Invalid catalog price");
  const [whole, cents] = value.split(".");
  const pesos =
    (BigInt(whole) * BigInt(100) + BigInt(cents) + BigInt(50)) / BigInt(100);
  return "$ " + pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO")
    .trim();
export function filterCatalog(
  products: AdminProduct[],
  filters: CatalogFilters,
): AdminProduct[] {
  const search = normalize(filters.search);
  return products.filter(
    (p) =>
      (!search || normalize(p.name).includes(search)) &&
      (!filters.category || p.category === filters.category) &&
      (filters.status === "all" || p.active === (filters.status === "active")),
  );
}
