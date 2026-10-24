import { forwardCatalogImage } from "@/features/admin-catalog/server/images";
type Context = { params: Promise<{ productId: string }> };
export async function PUT(request: Request, context: Context) {
  return forwardCatalogImage(
    request,
    (await context.params).productId,
    "upload",
  );
}
export async function DELETE(request: Request, context: Context) {
  return forwardCatalogImage(
    request,
    (await context.params).productId,
    "remove",
  );
}
