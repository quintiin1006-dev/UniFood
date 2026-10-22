import {
  forwardAdminCatalog,
  forwardAdminCatalogMutation,
} from "@/features/admin-catalog/server/forward";

export const dynamic = "force-dynamic";
export async function GET() {
  return forwardAdminCatalog();
}
export async function POST(request: Request) {
  return forwardAdminCatalogMutation(request, "create");
}
