import {
  parseCashSettings,
  parseToleranceCommand,
} from "@/features/cash/contracts";
import { forwardCash } from "@/features/cash/server/forward";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  return forwardCash(request, {
    path: "/api/cash/settings",
    audience: "admin",
    parse: parseCashSettings,
    body: { method: "PUT", parse: parseToleranceCommand },
  });
}
