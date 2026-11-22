import type {
  ClientDailyMenu,
  DailyMenuCategory,
  DailyMenuWire,
  DailyMenuWireCategory,
  WorkerDailyMenu,
  WorkerDailyMenuAddition,
  WorkerDailyMenuCategory,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;
/** Each option holds up to 350 characters (section 2.2); anything longer is malformed. */
const MAX_TEXT = 350;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, max = MAX_TEXT): string | null =>
  typeof value === "string" && value.trim() && value.length <= max
    ? value
    : null;
const money = (value: unknown): string | null =>
  typeof value === "string" && MONEY.test(value) ? value : null;

function pickCategory(value: unknown): DailyMenuWireCategory | null {
  const body = record(value);
  if (!body || !isUuid(body.id)) return null;
  const label = text(body.label, 80);
  if (!label || typeof body.canSkip !== "boolean") return null;
  if (body.kind === "SINGLE") {
    if (!Array.isArray(body.options)) return null;
    const options = [];
    for (const item of body.options) {
      const option = record(item);
      const optionLabel = text(option?.label);
      if (!option || !isUuid(option.id) || !optionLabel) return null;
      options.push({ id: option.id, label: optionLabel });
    }
    return {
      id: body.id,
      label,
      kind: "SINGLE",
      canSkip: body.canSkip,
      options,
    };
  }
  if (body.kind === "ADDITIONS") {
    if (!Array.isArray(body.additions)) return null;
    const additions = [];
    for (const item of body.additions) {
      const addition = record(item);
      const name = text(addition?.name, 120);
      const extraPrice = money(addition?.extraPrice);
      if (!addition || !isUuid(addition.id) || !name || !extraPrice)
        return null;
      additions.push({ id: addition.id, name, extraPrice });
    }
    return {
      id: body.id,
      label,
      kind: "ADDITIONS",
      canSkip: body.canSkip,
      additions,
    };
  }
  return null;
}

/**
 * Rebuilds the backend body with only the published fields of the contract (the BFF sends
 * nothing else). Any malformed part makes the whole menu invalid: null.
 */
export function pickDailyMenu(payload: unknown): DailyMenuWire | null {
  const body = record(payload);
  const cafeteria = record(body?.cafeteria);
  if (!body || !cafeteria || !Array.isArray(body.categories)) return null;
  const name = text(cafeteria.name, 200);
  const title = text(body.title, 200);
  const price = money(body.price);
  if (
    !isUuid(cafeteria.id) ||
    !name ||
    typeof cafeteria.open !== "boolean" ||
    typeof body.businessDate !== "string" ||
    !DATE.test(body.businessDate) ||
    !title ||
    !price
  )
    return null;
  const categories: DailyMenuWireCategory[] = [];
  for (const item of body.categories) {
    const category = pickCategory(item);
    if (!category) return null;
    categories.push(category);
  }
  return {
    cafeteria: { id: cafeteria.id, name, open: cafeteria.open },
    businessDate: body.businessDate,
    title,
    price,
    categories,
  };
}

/**
 * The card's view of the menu: prices as numbers, the template order kept, repeated ids
 * dropped, ADDITIONS last. A SINGLE category without options today is not shown, not even
 * with «Ninguna»; an ADDITIONS one without additions is not shown either (section 4.4).
 */
export function toClientDailyMenu(payload: unknown): ClientDailyMenu | null {
  const wire = pickDailyMenu(payload);
  if (!wire) return null;
  const seen = new Set<string>();
  const unique = <T extends { id: string }>(items: T[]) =>
    items.filter(({ id }) => !seen.has(id) && !!seen.add(id));
  const categories: DailyMenuCategory[] = [];
  const hiddenSkips: string[] = [];
  for (const category of unique(wire.categories)) {
    if (category.kind === "SINGLE") {
      const options = unique(category.options);
      if (!options.length && category.canSkip) hiddenSkips.push(category.id);
      if (options.length)
        categories.push({
          id: category.id,
          label: category.label,
          kind: "SINGLE",
          canSkip: category.canSkip,
          options,
        });
    } else {
      const additions = unique(category.additions).map((addition) => ({
        ...addition,
        extraPrice: Number(addition.extraPrice),
      }));
      if (additions.length)
        categories.push({
          id: category.id,
          label: category.label,
          kind: "ADDITIONS",
          additions,
        });
    }
  }
  const singles = categories.filter(({ kind }) => kind === "SINGLE");
  // Without a SINGLE category to choose from, there is no lunch to build: no card.
  if (!singles.length) return null;
  return {
    cafeteria: wire.cafeteria,
    businessDate: wire.businessDate,
    title: wire.title,
    price: Number(wire.price),
    categories: [
      ...singles,
      ...categories.filter(({ kind }) => kind === "ADDITIONS"),
    ],
    hiddenSkips,
  };
}

const SAFE_VERSION = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const labels = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => text(item, 80) !== null)
    ? (value as string[])
    : null;

/**
 * The worker's day rebuilt from the published fields only; anything malformed makes it null.
 * Used by the BFF (what reaches the browser) and by the browser (what it trusts).
 */
export function pickWorkerDay(payload: unknown): WorkerDailyMenu | null {
  const body = record(payload);
  if (
    !body ||
    typeof body.businessDate !== "string" ||
    !DATE.test(body.businessDate) ||
    !SAFE_VERSION(body.version) ||
    typeof body.published !== "boolean" ||
    typeof body.complete !== "boolean" ||
    typeof body.priceSet !== "boolean" ||
    !Array.isArray(body.categories) ||
    !Array.isArray(body.additions)
  )
    return null;
  const missingCategories = labels(body.missingCategories);
  if (!missingCategories) return null;
  const title = body.title === null ? null : text(body.title, 200);
  const price = body.price === null ? null : money(body.price);
  if (body.title !== null && !title) return null;
  if (body.price !== null && !price) return null;
  const categories: WorkerDailyMenuCategory[] = [];
  for (const item of body.categories) {
    const category = record(item);
    const label = text(category?.label, 80);
    if (
      !category ||
      !isUuid(category.id) ||
      !label ||
      category.kind !== "SINGLE" ||
      typeof category.canSkip !== "boolean" ||
      !Array.isArray(category.options) ||
      !Number.isSafeInteger(category.textUsed)
    )
      return null;
    const options = [];
    for (const raw of category.options) {
      const option = record(raw);
      const optionLabel = text(option?.label);
      if (!option || !isUuid(option.id) || !optionLabel) return null;
      options.push({ id: option.id, label: optionLabel });
    }
    categories.push({
      id: category.id,
      label,
      kind: "SINGLE",
      canSkip: category.canSkip,
      options,
      textUsed: category.textUsed as number,
    });
  }
  const additions: WorkerDailyMenuAddition[] = [];
  for (const item of body.additions) {
    const addition = record(item);
    const name = text(addition?.name, 120);
    const extraPrice =
      addition?.extraPrice === null ? null : money(addition?.extraPrice);
    if (
      !addition ||
      !isUuid(addition.id) ||
      !name ||
      (addition.extraPrice !== null && !extraPrice) ||
      typeof addition.available !== "boolean"
    )
      return null;
    additions.push({
      id: addition.id,
      name,
      extraPrice,
      available: addition.available,
    });
  }
  const day: WorkerDailyMenu = {
    businessDate: body.businessDate,
    version: body.version,
    published: body.published,
    complete: body.complete,
    missingCategories,
    priceSet: body.priceSet,
    title,
    price,
    categories,
    additions,
  };
  if (body.skippedCategories !== undefined) {
    const skipped = labels(body.skippedCategories);
    if (!skipped) return null;
    day.skippedCategories = skipped;
  }
  return day;
}
