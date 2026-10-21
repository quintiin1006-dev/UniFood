import { validEmail } from "@/features/auth/validation";
import type { AdminBusinessProfile, AdminProfile } from "./types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const name = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
export const validProfileEmail = (value: unknown): value is string =>
  typeof value === "string" && value === value.trim() && validEmail(value);

/** Reject partial snapshots and pick only the published fields. */
export function parseAdminBusinessProfile(
  value: unknown,
): AdminBusinessProfile | null {
  if (
    !record(value) ||
    value.role !== "ADMIN" ||
    !record(value.cafeteria) ||
    !name(value.cafeteria.name) ||
    typeof value.cafeteria.active !== "boolean" ||
    !record(value.site) ||
    !name(value.site.name) ||
    !record(value.institution) ||
    !name(value.institution.name)
  )
    return null;
  return {
    role: "ADMIN",
    cafeteria: { name: value.cafeteria.name, active: value.cafeteria.active },
    site: { name: value.site.name },
    institution: { name: value.institution.name },
  };
}
export function parseAdminProfile(value: unknown): AdminProfile | null {
  if (!record(value) || !validProfileEmail(value.email)) return null;
  const business = parseAdminBusinessProfile(value);
  return business ? { email: value.email, ...business } : null;
}
