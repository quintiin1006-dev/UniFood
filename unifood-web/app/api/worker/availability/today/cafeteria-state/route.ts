import { forwardAvailability } from "@/features/availability/server/forward";
export function PUT(request: Request) {
  return forwardAvailability(request, { kind: "cafeteria" });
}
