import { forwardWorkerDailyMenu } from "@/features/daily-menu/server/forward";
export function GET(request: Request) {
  return forwardWorkerDailyMenu(request, { kind: "read" });
}
