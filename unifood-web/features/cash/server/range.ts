import "server-only";
import { isBusinessDate, isSessionId } from "@/features/cash/contracts";

/** ?from&to as Bogota dates, plus an optional cafeteria for SUPER_ADMIN; null if invalid. */
export function rangeQuery(request: Request, allowCafeteria = false) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(
    allowCafeteria ? ["from", "to", "cafeteriaId"] : ["from", "to"],
  );
  for (const key of params.keys())
    if (!allowed.has(key) || params.getAll(key).length !== 1) return null;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isBusinessDate(from) || !isBusinessDate(to)) return null;
  const query = new URLSearchParams({ from, to });
  const cafeteria = params.get("cafeteriaId");
  if (cafeteria !== null) {
    if (!isSessionId(cafeteria)) return null;
    query.set("cafeteriaId", cafeteria.toLowerCase());
  }
  return query.toString();
}
