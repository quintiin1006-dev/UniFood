import { parseCashListing } from "@/features/cash/contracts";
import { cashFailure, forwardCash } from "@/features/cash/server/forward";
import { rangeQuery } from "@/features/cash/server/range";

export const dynamic = "force-dynamic";

/** Read-only closures of every cafeteria, or of one with ?cafeteriaId. */
export async function GET(request: Request) {
  const query = rangeQuery(request, true);
  if (!query) return cashFailure(400, { code: "CASH_INVALID_REQUEST" });
  return forwardCash(request, {
    path: `/api/super-admin/cash/sessions?${query}`,
    audience: "superAdmin",
    parse: parseCashListing,
  });
}
