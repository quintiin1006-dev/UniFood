import {
  parseCashCurrent,
  parseCashListing,
  parseOpenCommand,
} from "@/features/cash/contracts";
import { cashFailure, forwardCash } from "@/features/cash/server/forward";
import { rangeQuery } from "@/features/cash/server/range";

export const dynamic = "force-dynamic";

/** Closures of the ADMIN's own cafeteria. */
export async function GET(request: Request) {
  const query = rangeQuery(request);
  if (!query) return cashFailure(400, { code: "CASH_INVALID_REQUEST" });
  return forwardCash(request, {
    path: `/api/cash/sessions?${query}`,
    audience: "admin",
    parse: parseCashListing,
  });
}

/** Opens the drawer of the caller's cafeteria. */
export async function POST(request: Request) {
  return forwardCash(request, {
    path: "/api/cash/sessions",
    audience: "operator",
    parse: parseCashCurrent,
    body: { method: "POST", parse: parseOpenCommand },
  });
}
