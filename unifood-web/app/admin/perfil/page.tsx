import { requireAdmin } from "@/features/admin/server/requireAdmin";
import { AdminProfilePanel } from "@/features/admin-profile/components/AdminProfilePanel";

export default async function Page() {
  await requireAdmin();
  return <AdminProfilePanel />;
}
