import { forwardCatalogImage } from "@/features/admin-catalog/server/images";
export async function GET(
  request: Request,
  context: { params: Promise<{ productId: string; imageId: string }> },
) {
  const { productId, imageId } = await context.params;
  return forwardCatalogImage(request, productId, "image", imageId);
}
