import { forwardAdminCatalog } from "@/features/admin-catalog/server/forward";

export const dynamic = "force-dynamic";
export async function GET() {
  return forwardAdminCatalog();
}
