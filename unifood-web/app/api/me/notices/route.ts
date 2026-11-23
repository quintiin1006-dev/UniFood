import { forwardNotices } from "@/features/notices/server/forward";

// Route Handlers are not cached by default in this Next version; every answer is also no-store.
export function GET() {
  return forwardNotices();
}
