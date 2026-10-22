import { productImageSource } from "@/features/availability/presentation";
import {
  CATALOG_CATEGORIES,
  type AdminCatalogData,
  type AdminProduct,
} from "./types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nullableText = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
export const validCatalogPrice = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(value) &&
  value !== "0.00";
export const validCatalogVersion = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:0|[1-9]\d{0,18})$/.test(value) &&
  BigInt(value) <= BigInt("9223372036854775807");

/** Reject malformed/duplicate rows; project published fields and safe local image references only. */
export function parseAdminCatalog(value: unknown): AdminCatalogData | null {
  if (!record(value) || !Array.isArray(value.products)) return null;
  const ids = new Set<string>();
  const products: AdminProduct[] = [];
  for (const p of value.products) {
    if (
      !record(p) ||
      typeof p.id !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.id) ||
      ids.has(p.id.toLowerCase()) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      Array.from(p.name).length > 150 ||
      !nullableText(p.description) ||
      !validCatalogPrice(p.price) ||
      !CATALOG_CATEGORIES.some((category) => category === p.category) ||
      !nullableText(p.imageUrl) ||
      typeof p.active !== "boolean" ||
      !validCatalogVersion(p.version)
    )
      return null;
    ids.add(p.id.toLowerCase());
    products.push({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      category: p.category as AdminProduct["category"],
      imageUrl: productImageSource(p.imageUrl),
      active: p.active,
      version: p.version,
    });
  }
  return { products };
}
