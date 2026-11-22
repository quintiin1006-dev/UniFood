import { forwardWorkerDailyMenu } from "@/features/daily-menu/server/forward";
export async function PUT(
  request: Request,
  context: { params: Promise<{ additionId: string }> },
) {
  const { additionId } = await context.params;
  return forwardWorkerDailyMenu(request, { kind: "addition", additionId });
}
