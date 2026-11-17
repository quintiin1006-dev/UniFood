import {
  forwardSubscribe,
  forwardUnsubscribe,
} from "@/features/push/server/forward";

export function POST(request: Request) {
  return forwardSubscribe(request, "client");
}

export function DELETE(request: Request) {
  return forwardUnsubscribe(request, "client");
}
