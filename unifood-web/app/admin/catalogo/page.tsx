import { requireAdmin } from "@/features/admin/server/requireAdmin";
import { AdminComingSoon } from "@/features/admin/components/AdminComingSoon";

export default async function Page() {
  await requireAdmin();
  return (
    <AdminComingSoon
      title="Catálogo"
      description="Aquí podrás gestionar el catálogo de tu cafetería."
    />
  );
}
