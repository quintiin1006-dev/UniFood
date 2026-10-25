import { requireAdmin } from "@/features/admin/server/requireAdmin";
import { AdminDashboard } from "@/features/admin-dashboard/components/AdminDashboard";

export default async function Page() {
  await requireAdmin();
  return <AdminDashboard />;
}
