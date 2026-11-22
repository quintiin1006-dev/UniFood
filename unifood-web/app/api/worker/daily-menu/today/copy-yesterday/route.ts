import { forwardWorkerDailyMenu } from "@/features/daily-menu/server/forward";
export function POST(request: Request) {
  return forwardWorkerDailyMenu(request, { kind: "copy-yesterday" });
}
