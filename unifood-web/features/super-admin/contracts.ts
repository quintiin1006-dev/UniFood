import type {
  SuperAdminCafeteria,
  SuperAdminCafeterias,
  SuperAdminInstitution,
  SuperAdminSite,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ENTRIES = 500;

type Shape = Record<string, unknown>;
const object = (value: unknown): value is Shape =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 200;
const flag = (value: unknown): value is boolean => typeof value === "boolean";

/** Picks only the known fields; anything malformed rejects the whole payload. */
function list<T>(value: unknown, item: (entry: unknown) => T | null) {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null;
  const parsed: T[] = [];
  for (const entry of value) {
    const result = item(entry);
    if (!result) return null;
    parsed.push(result);
  }
  return parsed;
}

function cafeteria(value: unknown): SuperAdminCafeteria | null {
  if (
    !object(value) ||
    !id(value.id) ||
    !text(value.name) ||
    !flag(value.subscribed) ||
    !flag(value.hasActiveAdmin)
  )
    return null;
  return {
    id: value.id,
    name: value.name,
    subscribed: value.subscribed,
    hasActiveAdmin: value.hasActiveAdmin,
  };
}

function site(value: unknown): SuperAdminSite | null {
  if (
    !object(value) ||
    !id(value.id) ||
    !text(value.name) ||
    !text(value.city) ||
    !flag(value.active)
  )
    return null;
  const cafeterias = list(value.cafeterias, cafeteria);
  if (!cafeterias) return null;
  return {
    id: value.id,
    name: value.name,
    city: value.city,
    active: value.active,
    cafeterias,
  };
}

function institution(value: unknown): SuperAdminInstitution | null {
  if (
    !object(value) ||
    !id(value.id) ||
    !text(value.name) ||
    !flag(value.active)
  )
    return null;
  const sites = list(value.sites, site);
  if (!sites) return null;
  return { id: value.id, name: value.name, active: value.active, sites };
}

export function parseSuperAdminCafeterias(
  value: unknown,
): SuperAdminCafeterias | null {
  if (!object(value)) return null;
  const institutions = list(value.institutions, institution);
  return institutions ? { institutions } : null;
}
