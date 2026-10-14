import { forwardAvailability } from "@/features/availability/server/forward";
export async function PUT(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await context.params;
  return forwardAvailability(request, { kind: "item", itemId });
}
