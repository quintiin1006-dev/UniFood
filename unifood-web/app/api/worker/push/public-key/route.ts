import { forwardPublicKey } from "@/features/push/server/forward";

export function GET() {
  return forwardPublicKey("worker");
}
