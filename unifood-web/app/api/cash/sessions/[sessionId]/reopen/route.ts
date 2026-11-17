import {
  isSessionId,
  parseCashDetail,
  parseReopenCommand,
} from "@/features/cash/contracts";
import { cashFailure, forwardCash } from "@/features/cash/server/forward";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!isSessionId(sessionId))
    return cashFailure(404, { code: "CASH_SESSION_NOT_FOUND" });
  return forwardCash(request, {
    path: `/api/cash/sessions/${sessionId.toLowerCase()}/reopen`,
    audience: "admin",
    parse: parseCashDetail,
    body: { method: "POST", parse: parseReopenCommand },
  });
}
