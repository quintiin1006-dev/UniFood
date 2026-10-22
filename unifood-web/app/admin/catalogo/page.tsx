import { requireAdmin } from "@/features/admin/server/requireAdmin";
import { AdminCatalog } from "@/features/admin-catalog/components/AdminCatalog";

export default async function Page() {
  await requireAdmin();
  return <AdminCatalog />;
}
