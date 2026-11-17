import { cashFailure, forwardCashCsv } from "@/features/cash/server/forward";
import { rangeQuery } from "@/features/cash/server/range";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = rangeQuery(request, true);
  if (!query) return cashFailure(400, { code: "CASH_INVALID_REQUEST" });
  return forwardCashCsv(request, {
    path: `/api/super-admin/cash/sessions/export?${query}`,
    audience: "superAdmin",
  });
}
