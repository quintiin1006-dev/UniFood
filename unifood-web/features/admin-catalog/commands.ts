import { CATALOG_CATEGORIES, type CatalogForm } from "./types";
import { validCatalogVersion } from "./contracts";

export const CATALOG_BODY_LIMIT = 16384;
export const catalogUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export type FieldErrors = Partial<Record<keyof CatalogForm, string>>;
export function validateCatalogForm(form: CatalogForm): FieldErrors {
  const errors: FieldErrors = {};
  if (
    !form.name.trim() ||
    /[\u0000\uD800-\uDFFF]/u.test(form.name) ||
    Array.from(form.name.trim()).length > 150
  )
    errors.name = "Escribe un nombre de hasta 150 caracteres.";
  if (
    form.description !== null &&
    (/[\u0000\uD800-\uDFFF]/u.test(form.description) ||
      Array.from(form.description).length > 2000)
  )
    errors.description = "La descripción admite hasta 2.000 caracteres.";
  if (
    !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(form.price) ||
    /^0(?:\.0{1,2})?$/.test(form.price)
  )
    errors.price = "Escribe un precio mayor que cero con máximo dos decimales.";
  if (!CATALOG_CATEGORIES.includes(form.category))
    errors.category = "Selecciona una categoría válida.";
  return errors;
}
export function parseCatalogCommand(
  raw: unknown,
  kind: "create" | "edit" | "status",
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (kind === "edit" && !Object.hasOwn(p, "description")) return null;
  const allowed =
    kind === "status"
      ? ["active", "expectedVersion"]
      : [
          "name",
          "description",
          "price",
          "category",
          ...(kind === "edit" ? ["expectedVersion"] : []),
        ];
  if (Object.keys(p).some((k) => !allowed.includes(k))) return null;
  if (kind !== "create" && !validCatalogVersion(p.expectedVersion)) return null;
  if (kind === "status")
    return typeof p.active === "boolean"
      ? { active: p.active, expectedVersion: p.expectedVersion }
      : null;
  if (
    typeof p.name !== "string" ||
    typeof p.price !== "string" ||
    typeof p.category !== "string" ||
    (p.description !== undefined &&
      p.description !== null &&
      typeof p.description !== "string")
  )
    return null;
  const form = {
    name: p.name.trim(),
    description: p.description ?? null,
    price: p.price,
    category: p.category,
  } as CatalogForm;
  if (Object.keys(validateCatalogForm(form)).length) return null;
  return {
    ...form,
    ...(kind === "edit" ? { expectedVersion: p.expectedVersion } : {}),
  };
}
