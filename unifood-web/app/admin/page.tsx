import { requireAdmin } from "@/features/admin/server/requireAdmin";
import { AdminComingSoon } from "@/features/admin/components/AdminComingSoon";

export default async function Page() {
  await requireAdmin();
  return (
    <AdminComingSoon
      title="Dashboard"
      description="Aquí encontrarás una visión general de tu cafetería."
    />
  );
}
