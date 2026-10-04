import { redirect } from "next/navigation";
import RolePlaceholder from "@/features/auth/components/RolePlaceholder";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isSuperAdmin } from "@/features/auth/validation";

export const metadata = { title: "Administración global | UniFood" };
export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const { profile } = await requireAuth();
  if (!isSuperAdmin(profile)) redirect(destination(profile));
  return <RolePlaceholder title="Administración global" />;
}
