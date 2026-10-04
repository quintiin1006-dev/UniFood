import { redirect } from "next/navigation";
import RolePlaceholder from "@/features/auth/components/RolePlaceholder";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isAdmin } from "@/features/auth/validation";

export const metadata = { title: "Administración | UniFood" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { profile } = await requireAuth();
  if (!isAdmin(profile)) redirect(destination(profile));
  return <RolePlaceholder title="Administración de cafetería" />;
}
