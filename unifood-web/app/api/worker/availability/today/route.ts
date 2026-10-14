import { forwardAvailability } from "@/features/availability/server/forward";
export function GET(request: Request) {
  return forwardAvailability(request, { kind: "read" });
}
