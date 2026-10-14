import {
  CATALOG_CATEGORIES,
  type TodayAvailability,
  type AvailabilityItem,
} from "./types";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
  );
}
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const optionalText = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

// Validate and pick the published DTO, never forward extra upstream fields.
export function parseToday(value: unknown): TodayAvailability | null {
  if (
    !record(value) ||
    !isBusinessDate(value.businessDate) ||
    !record(value.cafeteria) ||
    !isUuid(value.cafeteria.id) ||
    !text(value.cafeteria.name) ||
    typeof value.cafeteria.active !== "boolean" ||
    typeof value.cafeteria.open !== "boolean" ||
    !Array.isArray(value.categories) ||
    value.categories.length !== CATALOG_CATEGORIES.length
  )
    return null;
  const categories: TodayAvailability["categories"] = [];
  const ids = new Set<string>();
  for (const [index, category] of CATALOG_CATEGORIES.entries()) {
    const group: unknown = value.categories[index];
    if (
      !record(group) ||
      group.category !== category ||
      !Array.isArray(group.items)
    )
      return null;
    const items: AvailabilityItem[] = [];
    for (const entry of group.items as unknown[]) {
      if (
        !record(entry) ||
        !isUuid(entry.id) ||
        ids.has(entry.id.toLowerCase()) ||
        !text(entry.name) ||
        !optionalText(entry.description) ||
        !optionalText(entry.image) ||
        typeof entry.price !== "number" ||
        !Number.isFinite(entry.price) ||
        entry.price < 0 ||
        typeof entry.available !== "boolean"
      )
        return null;
      ids.add(entry.id.toLowerCase());
      items.push({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        price: entry.price,
        image: entry.image,
        available: entry.available,
      });
    }
    categories.push({ category, items });
  }
  return {
    businessDate: value.businessDate,
    cafeteria: {
      id: value.cafeteria.id,
      name: value.cafeteria.name,
      active: value.cafeteria.active,
      open: value.cafeteria.open,
    },
    categories,
  };
}

export function parseBooleanBody(
  value: unknown,
  field: "available" | "open",
): boolean | null {
  return record(value) &&
    Object.keys(value).length === 1 &&
    typeof value[field] === "boolean"
    ? (value[field] as boolean)
    : null;
}
