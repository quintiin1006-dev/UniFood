import { parseCashCurrent } from "@/features/cash/contracts";
import { forwardCash } from "@/features/cash/server/forward";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return forwardCash(request, {
    path: "/api/cash/current",
    audience: "operator",
    parse: parseCashCurrent,
  });
}
