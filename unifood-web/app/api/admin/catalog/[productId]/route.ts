import { forwardAdminCatalogMutation } from "@/features/admin-catalog/server/forward";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  return forwardAdminCatalogMutation(request, "edit", (await params).productId);
}
