import { forwardCatalogImage } from "@/features/admin-catalog/server/images";
export async function GET(
  request: Request,
  context: { params: Promise<{ productId: string; operationId: string }> },
) {
  const { productId, operationId } = await context.params;
  return forwardCatalogImage(request, productId, "operation", operationId);
}
