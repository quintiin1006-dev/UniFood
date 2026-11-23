import { forwardMarkNoticesRead } from "@/features/notices/server/forward";

export function POST(request: Request) {
  return forwardMarkNoticesRead(request);
}
