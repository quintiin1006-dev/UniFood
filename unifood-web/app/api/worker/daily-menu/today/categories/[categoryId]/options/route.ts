import { forwardWorkerDailyMenu } from "@/features/daily-menu/server/forward";
export async function PUT(
  request: Request,
  context: { params: Promise<{ categoryId: string }> },
) {
  const { categoryId } = await context.params;
  return forwardWorkerDailyMenu(request, { kind: "options", categoryId });
}
