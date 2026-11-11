import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isSuperAdmin } from "@/features/auth/validation";
import { SuperAdminPanel } from "@/features/super-admin/components/SuperAdminPanel";

export const metadata = { title: "Administración global | UniFood" };
export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const { profile } = await requireAuth("panel");
  if (!isSuperAdmin(profile)) redirect(destination(profile));
  return <SuperAdminPanel />;
}
