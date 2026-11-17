import {
  forwardSubscribe,
  forwardUnsubscribe,
} from "@/features/push/server/forward";

export function POST(request: Request) {
  return forwardSubscribe(request, "worker");
}

export function DELETE(request: Request) {
  return forwardUnsubscribe(request, "worker");
}
